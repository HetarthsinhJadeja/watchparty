-- Transfer room host ownership atomically for signed-in room members.
-- The caller identity always comes from auth.uid(); a client cannot nominate
-- itself as the current host or update host_user_id directly through this RPC.

begin;

create or replace function public.transfer_room_host(
  p_room_id uuid,
  p_target_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
set row_security = off
as $$
declare
  v_room public.rooms;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'An authenticated user is required';
  end if;

  if p_room_id is null or p_target_user_id is null or p_target_user_id = auth.uid() then
    raise exception using errcode = '22023', message = 'Choose another existing room member';
  end if;

  -- Serialize transfers for this room. A concurrent caller must re-check the
  -- host identity after this lock is acquired.
  select *
  into v_room
  from public.rooms
  where id = p_room_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Room not found';
  end if;

  if v_room.host_user_id is distinct from auth.uid() or v_room.host_guest_id is not null then
    raise exception using errcode = '42501', message = 'Only the current signed-in room host can transfer host privileges';
  end if;

  -- Lock the target membership too, so it cannot leave between validation and
  -- the atomic ownership update.
  perform 1
  from public.room_members
  where room_id = p_room_id
    and user_id = p_target_user_id
    and guest_id is null
  for update;

  if not found then
    raise exception using errcode = '22023', message = 'The target must be an existing signed-in room member';
  end if;

  update public.room_members
  set role = 'member'
  where room_id = p_room_id
    and role = 'host';

  update public.room_members
  set role = 'host'
  where room_id = p_room_id
    and user_id = p_target_user_id;

  update public.rooms
  set host_user_id = p_target_user_id,
      host_guest_id = null,
      updated_at = now(),
      last_activity_at = now()
  where id = p_room_id;

  return p_target_user_id;
end;
$$;

alter function public.transfer_room_host(uuid, uuid) owner to postgres;
alter function public.transfer_room_host(uuid, uuid) set search_path = pg_catalog;
alter function public.transfer_room_host(uuid, uuid) set row_security = off;
revoke all on function public.transfer_room_host(uuid, uuid) from public;
grant execute on function public.transfer_room_host(uuid, uuid) to authenticated;

-- RoomClient does not update room rows directly. Removing this broad table
-- grant makes this authorization-checked RPC the only client path that can
-- change host identity, while the SECURITY DEFINER function runs as postgres.
revoke update on public.rooms from authenticated;

-- Membership changes, including the denormalized role label, are handled by
-- trusted room RPCs; the browser does not need direct UPDATE access.
revoke update on public.room_members from authenticated;

commit;
