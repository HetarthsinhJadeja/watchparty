-- Allow only the room host to remove playlist items.
-- The base schema grants authenticated users DELETE, but intentionally has no
-- DELETE policy, so RLS currently denies removals for every user.

begin;

drop policy if exists "Only room hosts can remove playlist items"
on public.room_playlist_items;

create policy "Only room hosts can remove playlist items"
on public.room_playlist_items
for delete
to authenticated
using (public.is_room_host(room_id));

commit;
