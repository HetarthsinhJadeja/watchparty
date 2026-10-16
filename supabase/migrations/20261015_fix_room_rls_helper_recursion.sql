-- Repair SECURITY DEFINER membership helpers without re-entering their own RLS
-- policies. This does not harden create_room/join_room; apply
-- 20261015_harden_room_rls_security.sql before serving application traffic.

begin;

do $$
begin
  if to_regprocedure('auth.uid()') is null
    or (select prorettype from pg_proc where oid = to_regprocedure('auth.uid()')) <> 'uuid'::regtype then
    raise exception 'Expected auth.uid() returning uuid';
  end if;

  if to_regprocedure('public.current_guest_identity()') is null
    or (select prorettype from pg_proc where oid = to_regprocedure('public.current_guest_identity()')) <> 'text'::regtype
    or position('request.jwt.claims' in lower(pg_get_functiondef(to_regprocedure('public.current_guest_identity()')))) = 0
    or position('room_guest_id' in lower(pg_get_functiondef(to_regprocedure('public.current_guest_identity()')))) = 0 then
    raise exception 'Expected public.current_guest_identity() to return the signed room_guest_id claim';
  end if;
end;
$$;

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

alter function public.is_room_member(uuid) owner to postgres;
alter function public.is_room_host(uuid) owner to postgres;
alter function public.is_room_member(uuid) security definer;
alter function public.is_room_host(uuid) security definer;
alter function public.is_room_member(uuid) set search_path = pg_catalog;
alter function public.is_room_host(uuid) set search_path = pg_catalog;
alter function public.is_room_member(uuid) set row_security = off;
alter function public.is_room_host(uuid) set row_security = off;

revoke all on function public.is_room_member(uuid) from public;
grant execute on function public.is_room_member(uuid) to anon, authenticated;
revoke all on function public.is_room_host(uuid) from public;
grant execute on function public.is_room_host(uuid) to anon, authenticated;

commit;
