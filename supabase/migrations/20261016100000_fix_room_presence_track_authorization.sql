-- Realtime authorizes Presence writes using the authenticated role, topic, and
-- extension. The track payload is not part of that authorization context, so
-- payload identity checks cannot validate track() callers. Keep the room-
-- membership check; Presence metadata is informational and must not grant room
-- access or determine host/member permissions.

begin;

drop policy if exists "WatchParty room members can publish own private room presence"
on realtime.messages;
drop policy if exists "WatchParty room members can publish private room presence"
on realtime.messages;

create policy "WatchParty room members can publish private room presence"
on realtime.messages
for insert
to authenticated
with check (
  extension = 'presence'
  and case
    when (select realtime.topic()) ~ '^room-playback-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then public.is_room_member(substring((select realtime.topic()) from 15)::uuid)
    else false
  end
);

commit;
