-- Allow signed-in room members to publish only their own online presence.
-- Presence is ephemeral in Supabase Realtime; room_members remains the source
-- of persistent membership and display names.

begin;

drop policy if exists "WatchParty room members can receive private room presence" on realtime.messages;
create policy "WatchParty room members can receive private room presence"
on realtime.messages
for select
to authenticated
using (
  extension = 'presence'
  and case
    when (select realtime.topic()) ~ '^room-playback-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then public.is_room_member(substring((select realtime.topic()) from 15)::uuid)
    else false
  end
);

drop policy if exists "WatchParty room members can publish own private room presence" on realtime.messages;
create policy "WatchParty room members can publish own private room presence"
on realtime.messages
for insert
to authenticated
with check (
  extension = 'presence'
  and payload ->> 'user_id' = (select auth.uid())::text
  and case
    when (select realtime.topic()) ~ '^room-playback-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then public.is_room_member(substring((select realtime.topic()) from 15)::uuid)
    else false
  end
);

commit;
