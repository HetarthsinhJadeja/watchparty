-- Secure persistent room chat and authorize transient reaction broadcasts.
-- Apply only after the base schema has created room_chat_messages and the
-- membership helpers have been installed. This migration does not alter data.

begin;

drop policy if exists "Members can read chat" on public.room_chat_messages;
drop policy if exists "Members can post chat" on public.room_chat_messages;
drop policy if exists "WatchParty room members can read chat" on public.room_chat_messages;
drop policy if exists "WatchParty members can post their own chat" on public.room_chat_messages;

create policy "WatchParty room members can read chat"
on public.room_chat_messages
for select
to authenticated
using (public.is_room_member(room_id));

create policy "WatchParty members can post their own chat"
on public.room_chat_messages
for insert
to authenticated
with check (
  public.is_room_member(room_id)
  and char_length(trim(message)) > 0
  and char_length(message) <= 500
  and (
    (
      auth.uid() is not null
      and sender_user_id = auth.uid()
      and sender_guest_id is null
    )
    or (
      auth.uid() is null
      and public.current_guest_identity() is not null
      and sender_user_id is null
      and sender_guest_id = public.current_guest_identity()
    )
  )
);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'room_chat_messages'
    ) then
    alter publication supabase_realtime add table public.room_chat_messages;
  end if;
end;
$$;

grant select, insert on public.room_chat_messages to authenticated;

drop policy if exists "WatchParty room members can join private chat channels" on realtime.messages;
drop policy if exists "WatchParty room members can join private playback channels" on realtime.messages;
drop policy if exists "WatchParty room members can receive reactions" on realtime.messages;
drop policy if exists "WatchParty room members can send reactions" on realtime.messages;

create policy "WatchParty room members can join private chat channels"
on realtime.messages
for select
to authenticated
using (
  case
    when (select realtime.topic()) ~ '^room-chat-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then public.is_room_member(substring((select realtime.topic()) from 11)::uuid)
    else false
  end
);

create policy "WatchParty room members can join private playback channels"
on realtime.messages
for select
to authenticated
using (
  case
    when (select realtime.topic()) ~ '^room-playback-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then public.is_room_member(substring((select realtime.topic()) from 15)::uuid)
    else false
  end
);

create policy "WatchParty room members can receive reactions"
on realtime.messages
for select
to authenticated
using (
  extension = 'broadcast'
  and case
    when (select realtime.topic()) ~ '^room-reactions-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then public.is_room_member(substring((select realtime.topic()) from 16)::uuid)
    else false
  end
);

create policy "WatchParty room members can send reactions"
on realtime.messages
for insert
to authenticated
with check (
  extension = 'broadcast'
  and case
    when (select realtime.topic()) ~ '^room-reactions-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then public.is_room_member(substring((select realtime.topic()) from 16)::uuid)
    else false
  end
);

commit;
