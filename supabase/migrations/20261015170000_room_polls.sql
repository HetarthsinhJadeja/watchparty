-- Secure host-only poll creation and authenticated one-vote-per-poll voting.
-- Poll and option inserts are atomic through create_room_poll().

begin;

create or replace function public.create_room_poll(
  p_room_id uuid,
  p_question text,
  p_options text[]
)
returns public.room_polls
language plpgsql
security definer
set search_path = pg_catalog
set row_security = off
as $$
declare
  v_poll public.room_polls;
  v_option text;
  v_index integer := 0;
begin
  if auth.uid() is null
    or not public.is_room_member(p_room_id)
    or not public.is_room_host(p_room_id) then
    raise exception 'Only the current signed-in room host can create a poll'
      using errcode = '42501';
  end if;

  if p_question is null or length(trim(p_question)) = 0 or length(trim(p_question)) > 200 then
    raise exception 'Poll questions must contain 1 to 200 characters'
      using errcode = '22023';
  end if;

  if p_options is null or cardinality(p_options) < 2 or cardinality(p_options) > 6 then
    raise exception 'Polls require between 2 and 6 options'
      using errcode = '22023';
  end if;

  foreach v_option in array p_options loop
    if v_option is null or length(trim(v_option)) = 0 or length(trim(v_option)) > 100 then
      raise exception 'Poll options must contain 1 to 100 characters'
        using errcode = '22023';
    end if;
  end loop;

  insert into public.room_polls (room_id, question, created_by_user_id)
  values (p_room_id, trim(p_question), auth.uid())
  returning * into v_poll;

  foreach v_option in array p_options loop
    insert into public.poll_options (poll_id, label, sort_order)
    values (v_poll.id, trim(v_option), v_index);
    v_index := v_index + 1;
  end loop;

  return v_poll;
end;
$$;

-- The function inserts into tables whose direct INSERT privilege is revoked
-- below. Use the trusted room-RPC owner and fail-closed RLS settings, while
-- keeping application objects schema-qualified in the function body.
alter function public.create_room_poll(uuid, text, text[]) owner to postgres;
alter function public.create_room_poll(uuid, text, text[]) set search_path = pg_catalog;
alter function public.create_room_poll(uuid, text, text[]) set row_security = off;

revoke all on function public.create_room_poll(uuid, text, text[]) from public, anon;
grant execute on function public.create_room_poll(uuid, text, text[]) to authenticated;

-- Force all poll and option inserts through the atomic authorization-checked RPC.
revoke insert on public.room_polls, public.poll_options from authenticated;

drop policy if exists "Members can create polls" on public.room_polls;
create policy "Only the current signed-in host can create polls"
on public.room_polls
for insert
to authenticated
with check (
  created_by_user_id = (select auth.uid())
  and created_by_guest_id is null
  and public.is_room_member(room_id)
  and public.is_room_host(room_id)
);

drop policy if exists "Host or members may update poll metadata" on public.room_polls;
create policy "Only the current host may update poll metadata"
on public.room_polls
for update
to authenticated
using (public.is_room_member(room_id) and public.is_room_host(room_id))
with check (public.is_room_member(room_id) and public.is_room_host(room_id));

drop policy if exists "Members can create poll options" on public.poll_options;
create policy "Only the current host can create poll options"
on public.poll_options
for insert
to authenticated
with check (
  exists (
    select 1
    from public.room_polls rp
    where rp.id = poll_id
      and public.is_room_member(rp.room_id)
      and public.is_room_host(rp.room_id)
  )
);

drop policy if exists "Members can cast a vote once per poll" on public.poll_votes;
create policy "Signed-in room members can cast one valid vote"
on public.poll_votes
for insert
to authenticated
with check (
  voter_user_id = (select auth.uid())
  and voter_guest_id is null
  and exists (
    select 1
    from public.room_polls rp
    join public.poll_options po on po.poll_id = rp.id
    where rp.id = poll_votes.poll_id
      and po.id = poll_votes.option_id
      and rp.status = 'active'
      and (rp.closes_at is null or rp.closes_at > now())
      and public.is_room_member(rp.room_id)
  )
);

commit;
