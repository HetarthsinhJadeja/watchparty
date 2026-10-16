-- Finish hardening the room identity helpers and SECURITY DEFINER RPCs.
-- Requires 20261015_bind_room_rpc_identity.sql first. The preflight verifies
-- exact signatures, argument names, return types, the expected identity checks,
-- and the trusted guest-identity helper before changing ownership or grants.

begin;

do $$
declare
  v_create_oid oid := to_regprocedure('public.create_room(text,text,uuid,text,jsonb)')::oid;
  v_join_oid oid := to_regprocedure('public.join_room(text,text,uuid,text)')::oid;
  v_guest_oid oid := to_regprocedure('public.current_guest_identity()')::oid;
  v_auth_uid_oid oid := to_regprocedure('auth.uid()')::oid;
  v_overload_count integer;
  v_argument_names text[];
  v_return_type oid;
  v_body text;
begin
  select count(*) into v_overload_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'create_room' and p.prokind = 'f';
  if v_overload_count <> 1 or v_create_oid is null then
    raise exception 'Expected exactly one public.create_room(text,text,uuid,text,jsonb) function; inspect live overloads before hardening';
  end if;

  select count(*) into v_overload_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'join_room' and p.prokind = 'f';
  if v_overload_count <> 1 or v_join_oid is null then
    raise exception 'Expected exactly one public.join_room(text,text,uuid,text) function; inspect live overloads before hardening';
  end if;

  select p.proargnames, p.prorettype
  into v_argument_names, v_return_type
  from pg_proc p
  where p.oid = v_create_oid;
  if v_argument_names is distinct from array[
      'p_code', 'p_display_name', 'p_created_by_user_id', 'p_created_by_guest_id', 'p_metadata'
    ]::text[]
    or v_return_type is distinct from 'public.rooms'::regtype then
    raise exception 'create_room arguments or return type do not match the checked-in schema';
  end if;

  select p.proargnames, p.prorettype
  into v_argument_names, v_return_type
  from pg_proc p
  where p.oid = v_join_oid;
  if v_argument_names is distinct from array[
      'p_code', 'p_display_name', 'p_user_id', 'p_guest_id'
    ]::text[]
    or v_return_type is distinct from 'public.rooms'::regtype then
    raise exception 'join_room arguments or return type do not match the checked-in schema';
  end if;

  if v_auth_uid_oid is null
    or (select p.prorettype from pg_proc p where p.oid = v_auth_uid_oid) is distinct from 'uuid'::regtype::oid then
    raise exception 'Expected auth.uid() returning uuid';
  end if;

  if v_guest_oid is null
    or (select p.prorettype from pg_proc p where p.oid = v_guest_oid) is distinct from 'text'::regtype::oid then
    raise exception 'Expected public.current_guest_identity() returning text';
  end if;

  if position('request.jwt.claims' in lower(pg_get_functiondef(v_guest_oid))) = 0
    or position('room_guest_id' in lower(pg_get_functiondef(v_guest_oid))) = 0 then
    raise exception 'current_guest_identity() must derive room_guest_id from verified JWT claims';
  end if;

  select regexp_replace(lower(p.prosrc), '[[:space:]]+', '', 'g')
  into v_body
  from pg_proc p where p.oid = v_create_oid;
  if position('ifp_created_by_user_idisdistinctfromauth.uid()orp_created_by_guest_idisnotnullthen' in v_body) = 0
    or position('elsifpublic.current_guest_identity()isnotnullthenifp_created_by_guest_idisdistinctfrompublic.current_guest_identity()orp_created_by_user_idisnotnullthen' in v_body) = 0
    or position('raiseexception''creatoridentitydoesnotmatchtheauthenticatedcaller''' in v_body) = 0
    or position('raiseexception''creatoridentitydoesnotmatchthesignedguestcaller''' in v_body) = 0
    or position('raiseexception''averifieduserorsignedguestidentityisrequired''' in v_body) = 0 then
    raise exception 'create_room is missing the expected authenticated and guest identity rejection checks';
  end if;

  select regexp_replace(lower(p.prosrc), '[[:space:]]+', '', 'g')
  into v_body
  from pg_proc p where p.oid = v_join_oid;
  if position('ifp_user_idisdistinctfromauth.uid()orp_guest_idisnotnullthen' in v_body) = 0
    or position('elsifpublic.current_guest_identity()isnotnullthenifp_guest_idisdistinctfrompublic.current_guest_identity()orp_user_idisnotnullthen' in v_body) = 0
    or position('raiseexception''participantidentitydoesnotmatchtheauthenticatedcaller''' in v_body) = 0
    or position('raiseexception''participantidentitydoesnotmatchthesignedguestcaller''' in v_body) = 0
    or position('raiseexception''averifieduserorsignedguestidentityisrequired''' in v_body) = 0 then
    raise exception 'join_room is missing the expected authenticated and guest identity rejection checks';
  end if;
end;
$$;

-- SECURITY DEFINER helpers read only the requested room and evaluate identity
-- from the caller's verified JWT. The fixed search_path contains only built-ins;
-- application objects in the function bodies are schema-qualified.
create or replace function public.is_room_member(room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
set row_security = off
as $$
  select exists (
    select 1
    from public.room_members rm
    where rm.room_id = $1
      and (
        rm.user_id = auth.uid()
        or rm.guest_id = public.current_guest_identity()
      )
  );
$$;

create or replace function public.is_room_host(room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
set row_security = off
as $$
  select exists (
    select 1
    from public.rooms r
    where r.id = $1
      and (
        (r.host_user_id is not null and r.host_user_id = auth.uid())
        or (r.host_guest_id is not null and r.host_guest_id = public.current_guest_identity())
      )
  );
$$;

-- Supabase migrations should run with sufficient privileges to assign the
-- trusted table-owner role. Fail and roll back rather than leave weaker owners.
alter function public.is_room_member(uuid) owner to postgres;
alter function public.is_room_host(uuid) owner to postgres;
alter function public.create_room(text, text, uuid, text, jsonb) owner to postgres;
alter function public.join_room(text, text, uuid, text) owner to postgres;

alter function public.is_room_member(uuid) security definer;
alter function public.is_room_host(uuid) security definer;
alter function public.create_room(text, text, uuid, text, jsonb) security definer;
alter function public.join_room(text, text, uuid, text) security definer;

alter function public.is_room_member(uuid) set search_path = pg_catalog;
alter function public.is_room_host(uuid) set search_path = pg_catalog;
alter function public.create_room(text, text, uuid, text, jsonb) set search_path = pg_catalog;
alter function public.join_room(text, text, uuid, text) set search_path = pg_catalog;

alter function public.is_room_member(uuid) set row_security = off;
alter function public.is_room_host(uuid) set row_security = off;
alter function public.create_room(text, text, uuid, text, jsonb) set row_security = off;
alter function public.join_room(text, text, uuid, text) set row_security = off;

-- Helpers are callable by API roles for RLS evaluation; room RPCs are callable
-- by the current signed-in or signed-guest path. PUBLIC receives no EXECUTE.
revoke all on function public.is_room_member(uuid) from public;
grant execute on function public.is_room_member(uuid) to anon, authenticated;
revoke all on function public.is_room_host(uuid) from public;
grant execute on function public.is_room_host(uuid) to anon, authenticated;

revoke all on function public.create_room(text, text, uuid, text, jsonb) from public;
grant execute on function public.create_room(text, text, uuid, text, jsonb) to anon, authenticated;
revoke all on function public.join_room(text, text, uuid, text) from public;
grant execute on function public.join_room(text, text, uuid, text) to anon, authenticated;

commit;
