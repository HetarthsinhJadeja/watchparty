# WatchParty 🎬

WatchParty brings friends together for a movie night, wherever they are.

## Current status

The app supports email-link sign-in, persistent room creation and joining, host transfer, a shared playlist for YouTube and direct MP4/WebM links, shared playback, group polls, local movie discovery and group recommendations, persistent room chat, and transient emoji reactions. Room members can add playlist links; the host can play or remove queued items, create polls, and transfer host privileges to another signed-in room member. YouTube playlist titles are resolved through YouTube's public oEmbed endpoint, with a video-ID fallback when lookup fails. Hosts control playback, and room members receive room, membership, playlist, poll, and playback updates through Supabase Postgres Changes. Playlist entries use the existing `room_playlist_items` table; the room's existing `room_playback.video_id` field stores a YouTube source as `youtube:<video-id>` and direct sources as their URL. Movie discovery uses a small bundled catalogue and never supplies playable links; queueing a catalogue title requires a supported URL.

Room creation and joining use the `create_room` and `join_room` database functions in `supabase/schema.sql`. For an existing project, apply the room identity, RLS-helper, and hardening migrations in `supabase/migrations/` before applying `20261015130000_room_chat_reactions.sql`. Apply `20261015140000_room_playlist_host_delete.sql` for host-only playlist removal; review and apply `20261016110000_playlist_delete_realtime_replica_identity.sql` so room-filtered Realtime DELETE events include the room ID. Apply `20261015150000_transfer_room_host.sql` for atomic host transfer, `20261015160000_room_realtime_presence.sql` for private live participant presence, and `20261015170000_room_polls.sql` for host-only poll creation and validated voting; review and apply these migrations separately. For a new project, apply `supabase/schema.sql` and then the chat/reactions, playlist-removal, playlist-delete-realtime, host-transfer, room-presence, and room-polls migrations. The base schema includes the playlist and poll tables in the Realtime publication; confirm the schema has been applied before using these features. The app's room Realtime channels are private, so disable “Allow public access” in Supabase Realtime settings after applying the migrations. The signed-in path is implemented; guests are not supported because guest access requires a signed JWT claim that this app does not issue. Room members remain persistent records; live online status and genre preferences come from ephemeral Supabase Realtime Presence, with preferences saved per room and signed-in user in the current browser. Movie discovery is local catalogue metadata only; no movie is marked playable until a user supplies a supported source URL.

## Playback synchronization baseline

Development builds expose a **Playback measurement** panel in the room. Open browser developer tools and filter the Console for `[WatchParty playback metric]`. No metrics are sent to Supabase or saved. Each control action is correlated by `roomId:state_version`; host logs include the action timestamp and the database-write round trip, while receiving clients log the Realtime receipt time and Supabase commit timestamp. Native YouTube seeks are detected by a 500 ms polling loop, so their recorded action time is the detection time and can trail the user's seek by up to one poll interval.

Propagation latency and expected-position drift are calculated only after you check the panel's clock-comparability box. Before checking it, synchronize every test device's operating-system clock and verify the host/receiver clocks differ by no more than 50 ms. If that condition is unknown, leave the box unchecked; event timestamps and server commit time are still logged, but no cross-client latency or drift number is reported. Host database-write round trip is a same-client monotonic-clock measurement and does not depend on device clock synchronization.

### Reproducible procedure

1. Start the app with `npm run dev`, sign in on one host browser and one or more viewer browsers, and open the same room. Use the same supported media source on every client. Keep the clients on the same local network and record browser, OS, media type, and Supabase region with the results.
2. For a two-client baseline, enable clock comparison on the viewer after verifying the clocks. Warm up playback, then perform at least 100 play, 100 pause, and 100 seek actions. For each viewer, collect `realtime-action-received` records with a numeric `propagationLatencyMs`; calculate sample count, median, nearest-rank p95, and maximum separately for each action type. Exclude warm-up actions and any action with an omitted latency.
3. For the ten-user target, repeat with one host and nine viewers connected concurrently. Report each viewer separately as well as the combined sample distribution; do not count a host database-write round trip as propagation latency.
4. For correction, inspect `direct-drift-correction-started` / `direct-correction-result` for direct video, or `youtube-drift-correction-started` / `youtube-correction-result` for YouTube. Use only records with numeric before/after drift and compare the after-correction values against 500 ms. The 500 ms result sample is a single observation 500 ms after the seek request, not proof of a hard real-time bound.
5. For late join, start playback, open the room on a new signed-in viewer, and record the `playback-snapshot` with `source: initial-room-load`, the ensuing player-apply result, and the viewer's first measured drift. For reconnect, disconnect a viewer's network briefly, restore it, then record `source: realtime-reconnect`, the next received action, and drift after correction. Repeat each scenario at least 20 times and include failures/timeouts in the report.

### Results (not yet measured)

| Scenario | Samples | Median latency | p95 latency | Maximum latency | Drift after correction |
|---|---:|---:|---:|---:|---:|
| Two clients, play / pause / seek | 0 | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED |
| Ten concurrent clients, play / pause / seek | 0 | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED |
| Late join and reconnect | 0 | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED |

The target of p95 propagation at or below 250 ms and drift at or below 500 ms after correction remains unverified until these runs are recorded. The full test suite runs with `npm test`; playback-only calculation tests run with `npm run test:playback`. Both require Node.js 22.6 or later for native TypeScript test-file support.

These measurements include the network path to the configured Supabase Realtime service and back. Running the Next.js development server locally does not make the playback transport local-only.

## Tech stack

- Next.js App Router
- React and TypeScript
- Tailwind CSS
- Supabase JavaScript client and Realtime

## Run locally

Install Node.js and npm, then run:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in `.env.local`. Enable email sign-in in Supabase Auth and allow the exact local and production callback URLs (`/auth/callback`) in the Auth URL Configuration. Signed-in sessions use Supabase SSR cookies; `proxy.ts` refreshes them and verifies claims before allowing access to `/` or `/room/*`. Never expose a service-role or secret key in browser code.

## Security

Keep `.env.local` and all credentials out of Git. The room RPCs validate the authenticated user ID against the signed-in JWT before creating or joining a room.
