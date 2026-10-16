-- Include the playlist row's room_id in DELETE change records so the existing
-- room_id-filtered Postgres Changes subscription can route removals by room.

begin;

alter table public.room_playlist_items replica identity full;

commit;
