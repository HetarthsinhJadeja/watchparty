-- Bind SECURITY DEFINER room RPC identity parameters to signed JWT claims.
-- This preserves the existing RPC signatures and return type.

begin;

-- Refuse to create a new overload if the live RPC signature differs from the
-- checked-in frontend contract. Review any overloads manually before retrying.
do $$
declare
  v_create_oid oid := to_regprocedure('public.create_room(text,text,uuid,text,jsonb)')::oid;
  v_join_oid oid := to_regprocedure('public.join_room(text,text,uuid,text)')::oid;
  v_overload_count integer;
begin
  select count(*) into v_overload_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'create_room' and p.prokind = 'f';
  if v_overload_count <> 1 or v_create_oid is null then
    raise exception 'Expected exactly one public.create_room(text,text,uuid,text,jsonb) function; inspect live overloads before applying';
  end if;

  select count(*) into v_overload_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'join_room' and p.prokind = 'f';
  if v_overload_count <> 1 or v_join_oid is null then
    raise exception 'Expected exactly one public.join_room(text,text,uuid,text) function; inspect live overloads before applying';
  end if;

  if not exists (
    select 1 from pg_proc p
    where p.oid = v_create_oid
      and p.proargnames = array['p_code', 'p_display_name', 'p_created_by_user_id', 'p_created_by_guest_id', 'p_metadata']::text[]
      and p.prorettype = 'public.rooms'::regtype
  ) then
    raise exception 'create_room arguments or return type do not match the checked-in schema';
  end if;

  if not exists (
    select 1 from pg_proc p
    where p.oid = v_join_oid
      and p.proargnames = array['p_code', 'p_display_name', 'p_user_id', 'p_guest_id']::text[]
      and p.prorettype = 'public.rooms'::regtype
  ) then
    raise exception 'join_room arguments or return type do not match the checked-in schema';
  end if;

  if to_regprocedure('auth.uid()') is null
    or (select prorettype from pg_proc where oid = to_regprocedure('auth.uid()')::oid) <> 'uuid'::regtype::oid then
    raise exception 'Expected auth.uid() returning uuid';
  end if;

  if to_regprocedure('public.current_guest_identity()') is null
    or (select prorettype from pg_proc where oid = to_regprocedure('public.current_guest_identity()')::oid) <> 'text'::regtype::oid
    or position('request.jwt.claims' in lower(pg_get_functiondef(to_regprocedure('public.current_guest_identity()')))) = 0
    or position('room_guest_id' in lower(pg_get_functiondef(to_regprocedure('public.current_guest_identity()')))) = 0 then
    raise exception 'Expected public.current_guest_identity() to return the signed room_guest_id claim';
  end if;
end;
$$;

create or replace function public.create_room(
  p_code text,
  p_display_name text default 'WatchParty',
  p_created_by_user_id uuid default null,
  p_created_by_guest_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns public.rooms
language plpgsql
security definer
set search_path = pg_catalog
set row_security = off
as $$
declare
  v_room public.rooms;
begin
  if p_code is null or length(trim(p_code)) = 0 then
    raise exception 'Room code is required';
  end if;

  if auth.uid() is not null then
    if p_created_by_user_id is distinct from auth.uid() or p_created_by_guest_id is not null then
      raise exception 'Creator identity does not match the authenticated caller';
    end if;
  elsif public.current_guest_identity() is not null then
    if p_created_by_guest_id is distinct from public.current_guest_identity()
      or p_created_by_user_id is not null then
      raise exception 'Creator identity does not match the signed guest caller';
    end if;
  else
    raise exception 'A verified user or signed guest identity is required';
  end if;

  if p_created_by_user_id is null and p_created_by_guest_id is null then
    raise exception 'A room requires either an authenticated user or a guest identity';
  end if;

  if p_created_by_user_id is not null and p_created_by_guest_id is not null then
    raise exception 'A room creator cannot be both authenticated and guest-based';
  end if;

  insert into public.rooms (
    code,
    display_name,
    host_user_id,
    host_guest_id,
    created_by_user_id,
    created_by_guest_id,
    metadata
  )
  values (
    upper(p_code),
    p_display_name,
    p_created_by_user_id,
    p_created_by_guest_id,
    p_created_by_user_id,
    p_created_by_guest_id,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning * into v_room;

  insert into public.room_members (
    room_id,
    user_id,
    guest_id,
    role,
    display_name
  )
  values (
    v_room.id,
    p_created_by_user_id,
    p_created_by_guest_id,
    'host',
    coalesce(p_display_name, 'Host')
  );

  insert into public.room_playback (room_id)
  values (v_room.id);

  return v_room;
end;
$$;

create or replace function public.join_room(
  p_code text,
  p_display_name text,
  p_user_id uuid default null,
  p_guest_id text default null
)
returns public.rooms
language plpgsql
security definer
set search_path = pg_catalog
set row_security = off
as $$
declare
  v_room public.rooms;
begin
  if p_code is null or length(trim(p_code)) = 0 then
    raise exception 'Room code is required';
  end if;

  if auth.uid() is not null then
    if p_user_id is distinct from auth.uid() or p_guest_id is not null then
      raise exception 'Participant identity does not match the authenticated caller';
    end if;
  elsif public.current_guest_identity() is not null then
    if p_guest_id is distinct from public.current_guest_identity()
      or p_user_id is not null then
      raise exception 'Participant identity does not match the signed guest caller';
    end if;
  else
    raise exception 'A verified user or signed guest identity is required';
  end if;

  if p_user_id is null and p_guest_id is null then
    raise exception 'Join requires either a user identity or guest identity';
  end if;

  if p_user_id is not null and p_guest_id is not null then
    raise exception 'A participant cannot be both user and guest';
  end if;

  select *
  into v_room
  from public.rooms
  where code = upper(trim(p_code))
  limit 1;

  if v_room.id is null then
    raise exception 'Room not found';
  end if;

  if exists (
    select 1
    from public.room_members rm
    where rm.room_id = v_room.id
      and (
        (p_user_id is not null and rm.user_id = p_user_id)
        or (p_guest_id is not null and rm.guest_id = p_guest_id)
      )
  ) then
    update public.room_members
    set last_seen_at = now(),
        display_name = p_display_name
    where room_id = v_room.id
      and (
        (p_user_id is not null and user_id = p_user_id)
        or (p_guest_id is not null and guest_id = p_guest_id)
      );

    return v_room;
  end if;

  insert into public.room_members (
    room_id,
    user_id,
    guest_id,
    role,
    display_name
  )
  values (
    v_room.id,
    p_user_id,
    p_guest_id,
    'member',
    p_display_name
  );

  update public.rooms
  set last_activity_at = now(),
      updated_at = now()
  where id = v_room.id;

  return v_room;
end;
$$;

-- Keep ownership and callable roles explicit while this migration is applied;
-- the hardening migration repeats these settings as its final checks.
alter function public.create_room(text, text, uuid, text, jsonb) owner to postgres;
alter function public.join_room(text, text, uuid, text) owner to postgres;
revoke all on function public.create_room(text, text, uuid, text, jsonb) from public;
grant execute on function public.create_room(text, text, uuid, text, jsonb) to anon, authenticated;
revoke all on function public.join_room(text, text, uuid, text) from public;
grant execute on function public.join_room(text, text, uuid, text) to anon, authenticated;

commit;
