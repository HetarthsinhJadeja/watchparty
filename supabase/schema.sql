-- WatchParty Supabase schema v1
-- Purpose:
--   - store room metadata, membership, and playback state in Postgres
--   - protect room data with Row Level Security (RLS)
--   - support both authenticated users and guest room participants via signed room credentials
--   - prepare the schema for Realtime broadcast and presence updates
--
-- Notes:
--   - This file is intentionally versioned and designed to be reviewed and applied as a migration.
--   - Keep room lookup and host assignment in trusted database operations when possible.
--   - Do not place service-role or secret keys in browser code, and do not rely on a publishable key for authorization.

create extension if not exists pgcrypto;

-- Enums ------------------------------------------------------------------------

create type public.room_role as enum ('host', 'member');
create type public.room_status as enum ('waiting', 'live', 'archived');
create type public.poll_status as enum ('active', 'closed');

-- Core room tables -------------------------------------------------------------

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  display_name text not null default 'WatchParty',
  status public.room_status not null default 'waiting',
  host_user_id uuid,
  host_guest_id text,
  created_by_user_id uuid,
  created_by_guest_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint rooms_code_format check (code ~ '^[A-Z0-9-]{4,12}$'),
  constraint rooms_host_identity check (
    (
      (host_user_id is not null and host_guest_id is null)
      or (host_user_id is null and host_guest_id is not null)
    )
  ),
  constraint rooms_creator_identity check (
    (
      (created_by_user_id is not null and created_by_guest_id is null)
      or (created_by_user_id is null and created_by_guest_id is not null)
    )
  )
);

create index if not exists idx_rooms_code on public.rooms (code);
create index if not exists idx_rooms_updated_at on public.rooms (updated_at desc);
create index if not exists idx_rooms_status on public.rooms (status);

create table if not exists public.room_members (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid,
  guest_id text,
  role public.room_role not null default 'member',
  display_name text,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint room_members_identity check (
    (
      (user_id is not null and guest_id is null)
      or (user_id is null and guest_id is not null)
    )
  ),
  constraint room_members_unique_user unique (room_id, user_id),
  constraint room_members_unique_guest unique (room_id, guest_id)
);

create index if not exists idx_room_members_room on public.room_members (room_id);
create index if not exists idx_room_members_last_seen on public.room_members (last_seen_at desc);

create table if not exists public.room_presence (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid,
  guest_id text,
  display_name text not null,
  is_connected boolean not null default true,
  last_seen_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint room_presence_identity check (
    (
      (user_id is not null and guest_id is null)
      or (user_id is null and guest_id is not null)
    )
  ),
  constraint room_presence_unique_user unique (room_id, user_id),
  constraint room_presence_unique_guest unique (room_id, guest_id)
);

create index if not exists idx_room_presence_room on public.room_presence (room_id);
create index if not exists idx_room_presence_connected on public.room_presence (room_id, is_connected, last_seen_at desc);

create table if not exists public.room_playback (
  room_id uuid primary key references public.rooms(id) on delete cascade,
  video_id text,
  title text,
  is_playing boolean not null default false,
  position_ms bigint not null default 0,
  duration_ms bigint,
  playback_timestamp timestamptz not null default now(),
  state_version bigint not null default 0,
  last_authorized_by uuid,
  last_authorized_guest text,
  metadata jsonb not null default '{}'::jsonb,
  constraint room_playback_position_non_negative check (position_ms >= 0),
  constraint room_playback_duration check (duration_ms is null or duration_ms >= 0)
);

create index if not exists idx_room_playback_state_version on public.room_playback (state_version desc);

-- Shared content tables ---------------------------------------------------------

create table if not exists public.room_playlist_items (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  media_id text not null,
  kind text not null default 'movie',
  title text not null,
  poster_url text,
  duration_ms bigint,
  added_by_user_id uuid,
  added_by_guest_id text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint room_playlist_items_sort_non_negative check (sort_order >= 0)
);

create index if not exists idx_room_playlist_room_order on public.room_playlist_items (room_id, sort_order, created_at desc);

create table if not exists public.room_polls (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  question text not null,
  status public.poll_status not null default 'active',
  created_by_user_id uuid,
  created_by_guest_id text,
  created_at timestamptz not null default now(),
  closes_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  constraint room_polls_closes_at check (closes_at is null or closes_at > created_at)
);

create table if not exists public.poll_options (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.room_polls(id) on delete cascade,
  label text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint poll_options_sort_non_negative check (sort_order >= 0)
);

create index if not exists idx_poll_options_poll on public.poll_options (poll_id, sort_order);

create table if not exists public.poll_votes (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.room_polls(id) on delete cascade,
  option_id uuid not null references public.poll_options(id) on delete cascade,
  voter_user_id uuid,
  voter_guest_id text,
  created_at timestamptz not null default now(),
  constraint poll_votes_identity check (
    (
      (voter_user_id is not null and voter_guest_id is null)
      or (voter_user_id is null and voter_guest_id is not null)
    )
  ),
  constraint poll_votes_unique_user unique (poll_id, voter_user_id),
  constraint poll_votes_unique_guest unique (poll_id, voter_guest_id)
);

create index if not exists idx_poll_votes_poll on public.poll_votes (poll_id, option_id);

create table if not exists public.room_chat_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  sender_user_id uuid,
  sender_guest_id text,
  message text not null,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint room_chat_messages_identity check (
    (
      (sender_user_id is not null and sender_guest_id is null)
      or (sender_user_id is null and sender_guest_id is not null)
    )
  )
);

create index if not exists idx_room_chat_messages_room_time on public.room_chat_messages (room_id, created_at desc);

-- Audit/activity log -----------------------------------------------------------

create table if not exists public.room_activity (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  actor_user_id uuid,
  actor_guest_id text,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint room_activity_identity check (
    (
      (actor_user_id is not null and actor_guest_id is null)
      or (actor_user_id is null and actor_guest_id is not null)
    )
  )
);

create index if not exists idx_room_activity_room_time on public.room_activity (room_id, created_at desc);

-- Timestamps -------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  new.last_activity_at = now();
  return new;
end;
$$;

create or replace trigger rooms_touch_updated_at
before update on public.rooms
for each row
execute function public.touch_updated_at();

-- Reusable helpers --------------------------------------------------------------

create or replace function public.current_guest_identity()
returns text
language sql
stable
as $$
  select nullif(
    ((current_setting('request.jwt.claims', true))::jsonb ->> 'room_guest_id'),
    ''
  );
$$;

create or replace function public.current_participant_identity()
returns text
language sql
stable
as $$
  select coalesce(
    auth.uid()::text,
    public.current_guest_identity()
  );
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

-- Trusted operations ------------------------------------------------------------
-- These functions are intended for backend or SQL-side orchestration and help keep
-- authorization logic centralized instead of trusting arbitrary client-side calls.

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

  -- SECURITY DEFINER functions must bind caller-supplied IDs to verified JWT claims.
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

  -- Never trust an identity UUID supplied by a browser caller.
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

-- Row Level Security -----------------------------------------------------------

alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.room_presence enable row level security;
alter table public.room_playback enable row level security;
alter table public.room_playlist_items enable row level security;
alter table public.room_polls enable row level security;
alter table public.poll_options enable row level security;
alter table public.poll_votes enable row level security;
alter table public.room_chat_messages enable row level security;
alter table public.room_activity enable row level security;

create policy "Room members can read rooms"
on public.rooms
for select
using (
  public.is_room_member(id)
);

create policy "Members can create rooms when authenticated or guest credentials are present"
on public.rooms
for insert
with check (
  (
    auth.uid() is not null
    and host_user_id = auth.uid()
    and created_by_user_id = auth.uid()
  )
  or (
    public.current_guest_identity() is not null
    and host_guest_id = public.current_guest_identity()
    and created_by_guest_id = public.current_guest_identity()
  )
);

create policy "Only the room host can update a room"
on public.rooms
for update
using (public.is_room_host(id))
with check (public.is_room_host(id));

create policy "Only the room host can delete a room"
on public.rooms
for delete
using (public.is_room_host(id));

create policy "Room members can read membership"
on public.room_members
for select
using (public.is_room_member(room_id));

create policy "Members may join or refresh membership"
on public.room_members
for insert
with check (
  (
    auth.uid() is not null
    and user_id = auth.uid()
    and public.is_room_member(room_id)
  )
  or (
    public.current_guest_identity() is not null
    and guest_id = public.current_guest_identity()
  )
);

create policy "Members can update their own membership"
on public.room_members
for update
using (
  (
    auth.uid() is not null and user_id = auth.uid()
  )
  or (
    public.current_guest_identity() is not null and guest_id = public.current_guest_identity()
  )
)
with check (
  (
    auth.uid() is not null and user_id = auth.uid()
  )
  or (
    public.current_guest_identity() is not null and guest_id = public.current_guest_identity()
  )
);

create policy "Only room members can read room presence"
on public.room_presence
for select
using (public.is_room_member(room_id));

create policy "Room members can upsert presence"
on public.room_presence
for insert
with check (public.is_room_member(room_id));

create policy "Room members can update presence"
on public.room_presence
for update
using (public.is_room_member(room_id))
with check (public.is_room_member(room_id));

create policy "Room members can read playback state"
on public.room_playback
for select
using (public.is_room_member(room_id));

create policy "Only the host may update playback state"
on public.room_playback
for update
using (public.is_room_host(room_id))
with check (public.is_room_host(room_id));

create policy "Only the host may insert a playback row"
on public.room_playback
for insert
with check (public.is_room_host(room_id));

create policy "Room members can read playlist items"
on public.room_playlist_items
for select
using (public.is_room_member(room_id));

create policy "Room members can add or change playlist items"
on public.room_playlist_items
for insert
with check (public.is_room_member(room_id));

create policy "Host or members may edit playlist metadata"
on public.room_playlist_items
for update
using (public.is_room_member(room_id))
with check (public.is_room_member(room_id));

create policy "Room members can read polls"
on public.room_polls
for select
using (public.is_room_member(room_id));

create policy "Members can create polls"
on public.room_polls
for insert
with check (public.is_room_member(room_id));

create policy "Host or members may update poll metadata"
on public.room_polls
for update
using (public.is_room_member(room_id))
with check (public.is_room_member(room_id));

create policy "Room members can read poll options"
on public.poll_options
for select
using (
  exists (
    select 1
    from public.room_polls rp
    where rp.id = poll_id
      and public.is_room_member(rp.room_id)
  )
);

create policy "Members can create poll options"
on public.poll_options
for insert
with check (
  exists (
    select 1
    from public.room_polls rp
    where rp.id = poll_id
      and public.is_room_member(rp.room_id)
  )
);

create policy "Room members can read vote rows"
on public.poll_votes
for select
using (
  exists (
    select 1
    from public.room_polls rp
    where rp.id = poll_id
      and public.is_room_member(rp.room_id)
  )
);

create policy "Members can cast a vote once per poll"
on public.poll_votes
for insert
with check (
  exists (
    select 1
    from public.room_polls rp
    where rp.id = poll_id
      and public.is_room_member(rp.room_id)
  )
);

create policy "Members can read chat"
on public.room_chat_messages
for select
using (public.is_room_member(room_id));

create policy "Members can post chat"
on public.room_chat_messages
for insert
with check (public.is_room_member(room_id));

create policy "Room members can read activity"
on public.room_activity
for select
using (public.is_room_member(room_id));

create policy "Members can add activity"
on public.room_activity
for insert
with check (public.is_room_member(room_id));

-- Grants -----------------------------------------------------------------------

grant usage on schema public to postgres, anon, authenticated;
grant all on all tables in schema public to postgres;
grant select, insert, update, delete on public.rooms to authenticated;
grant select, insert, update, delete on public.room_members to authenticated;
grant select, insert, update, delete on public.room_presence to authenticated;
grant select, insert, update, delete on public.room_playback to authenticated;
grant select, insert, update, delete on public.room_playlist_items to authenticated;
grant select, insert, update, delete on public.room_polls to authenticated;
grant select, insert, update, delete on public.poll_options to authenticated;
grant select, insert, update, delete on public.poll_votes to authenticated;
grant select, insert, update, delete on public.room_chat_messages to authenticated;
grant select, insert, update, delete on public.room_activity to authenticated;

-- Policy helpers only reveal membership/host status for the caller's own JWT identity.
alter function public.is_room_member(uuid) owner to postgres;
alter function public.is_room_host(uuid) owner to postgres;
alter function public.create_room(text, text, uuid, text, jsonb) owner to postgres;
alter function public.join_room(text, text, uuid, text) owner to postgres;

revoke all on function public.is_room_member(uuid) from public;
grant execute on function public.is_room_member(uuid) to anon, authenticated;
revoke all on function public.is_room_host(uuid) from public;
grant execute on function public.is_room_host(uuid) to anon, authenticated;

-- The RPCs verify supplied identities against signed JWT claims before writing.
revoke all on function public.create_room(text, text, uuid, text, jsonb) from public;
grant execute on function public.create_room(text, text, uuid, text, jsonb) to anon, authenticated;
revoke all on function public.join_room(text, text, uuid, text) from public;
grant execute on function public.join_room(text, text, uuid, text) to anon, authenticated;

-- Realtime ---------------------------------------------------------------------
-- Only expose the tables that should broadcast to clients and keep the database as the source of truth.
-- In Supabase, this typically means ensuring the `supabase_realtime` publication exists.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.rooms;
    alter publication supabase_realtime add table public.room_members;
    alter publication supabase_realtime add table public.room_presence;
    alter publication supabase_realtime add table public.room_playback;
    alter publication supabase_realtime add table public.room_playlist_items;
    alter publication supabase_realtime add table public.room_polls;
    alter publication supabase_realtime add table public.poll_options;
    alter publication supabase_realtime add table public.poll_votes;
    alter publication supabase_realtime add table public.room_chat_messages;
  end if;
end $$;

-- Operational notes ------------------------------------------------------------
-- 1. Room codes should be generated on the server side to avoid collisions and to preserve the intended format.
-- 2. Host-only actions must be checked in SQL and enforced by policies; a client must never be the final authority.
-- 3. Guest access is supported only when the app issues a signed room credential and includes a room_guest_id claim.
-- 4. Browser code should never call a service role or secret key, and no NEXT_PUBLIC_ variable should carry a secret.
-- 5. Realtime broadcasts are transient; durable room state, votes, playlists, and playback must remain in Postgres.
