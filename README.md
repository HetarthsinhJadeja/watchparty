# WatchParty 🎬

WatchParty is a real-time synchronized movie-watching application. Friends can create a room, share its code, and watch supported videos together with synchronized playback, chat, reactions, a shared playlist, polls, participant presence, and movie recommendations.

## Current implementation

The homepage restores an existing Supabase session or starts an anonymous guest session. Users can create or join a room without entering an email or opening a magic link. The email sign-in page and callback remain available as optional routes; they are not required for the default guest flow.

Anonymous authentication establishes a Supabase user identity; it does not grant access to a room. The `create_room` and `join_room` RPCs validate the supplied user ID against `auth.uid()`. Room membership checks and row-level security (RLS) separately enforce room access and host or participant permissions. A new browser or device has a different anonymous identity and must join a room with its code before it becomes a member.

The application includes persistent room creation and joining, host transfer, a shared playlist for YouTube and direct MP4/WebM sources, synchronized playback, polls, local movie discovery and recommendations, persistent room chat, emoji reactions, and Realtime presence. Movie discovery is recommendation-only; it does not provide playable links or add recommendations directly to the playlist. YouTube playlist titles use YouTube's public oEmbed endpoint, with a useful fallback when a title cannot be resolved. The presence of a feature in the repository does not mean every live Supabase or multi-user behavior has been verified for a deployment.

Playlist entries are stored in `room_playlist_items`. The room's `room_playback.video_id` stores YouTube sources as `youtube:<video-id>` and direct sources as their URL. Group genre preferences are saved in the browser and announced through Realtime Presence while a member is online.

## Project structure

```text
app/
  auth/                  Optional email sign-in page and callback
  room/[roomId]/         Protected room and room features
  api/youtube-title/     YouTube title lookup route
  page.tsx               Guest-session homepage, room creation and joining
  globals.css            Global styles and Tailwind theme
lib/
  auth-redirect.ts       Validates internal return destinations
  guest-session.ts       Reuses and deduplicates guest-session initialization
  playback-metrics.ts    Playback measurement calculations and logging
  playlist-state.ts      Playlist Realtime state helpers
  room-media.ts          Media URL parsing and metadata helpers
  movie-catalogue.ts     Local movie discovery data
  supabase.ts            Browser Supabase client
  supabase-server.ts     Server Supabase client
tests/
  *.test.mts             Guest-session, playback, media, playlist and catalogue tests
proxy.ts                 Refreshes and validates Supabase claims for room routes
postcss.config.mjs       Tailwind CSS v4 PostCSS integration
supabase/
  schema.sql             Base database schema and policies
  migrations/            Reviewed database changes
```

## Prerequisites

- Node.js 24.x LTS is recommended. The project uses Next.js 16 and Node's built-in TypeScript support for its test scripts.
- npm
- Git
- A Supabase project

## Supabase setup

### Application environment variables

The application needs these two public Supabase configuration values. Create `.env.local` in the project root and enter the values from your Supabase project. Use the same names in your deployment provider's environment settings. Never commit real values.

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://<your-project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<your-supabase-publishable-key>
```

Never put a service-role key or other secret in browser code or a `NEXT_PUBLIC_` variable.

### Supabase dashboard settings

In the Supabase dashboard, open Authentication settings, enable **Anonymous Sign-Ins**, and click **Save**. This dashboard setting is separate from the application environment variables above. Without it, the default guest-session flow cannot initialize.

The application uses private Supabase Realtime channels. Keep the authorization policies and room membership checks in place; do not make channels public to work around an access problem. If you use the optional email magic-link flow, configure the Supabase Auth Site URL and allowed redirect URLs for the exact local and production `/auth/callback` URLs. Guest sessions do not use that callback.

### Database schema and migrations

For a new database, review and apply `supabase/schema.sql`, then review the migrations required for the features you intend to use. For an existing database, compare the live schema, functions, policies, grants, and Realtime publication with the checked-in files. Apply only reviewed migrations that are actually missing. A table's existence or a migration file in this repository does not prove that a migration has been applied. Do not blindly rerun migrations or weaken RLS.

The application uses the existing `create_room` and `join_room` RPCs and expects their identity checks to bind user IDs to `auth.uid()`. The migration directory includes room identity binding and RLS hardening, chat/reactions, playlist host deletion and DELETE replication identity, host transfer, Realtime presence and authorization, and polls. Review each migration's prerequisites and live state before applying it; filenames are not an application ledger, and numeric order alone does not establish dependencies.

## Local development

Clone the repository:

```powershell
git clone https://github.com/HetarthsinhJadeja/watchparty.git
cd watchparty
```

Create `.env.local` with the two values above, then install the exact lockfile dependencies and start the app:

```powershell
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The development and production scripts use Next.js's Webpack bundler, and Tailwind CSS v4 is processed by its PostCSS plugin.

On Windows, if you already use nvm-windows and need to select Node 24, inspect installed versions and switch to an installed 24.x version in PowerShell:

```powershell
nvm list
nvm use <installed-24.x-version>
node -v
npm -v
```

Switching Node versions changes the runtime selected by that shell; it does not change the project's dependencies. Do not install a version manager as part of this project setup unless you choose to do so separately.

## Verification

Run the local checks from the repository root:

```powershell
npm run lint
npx tsc --noEmit
npm test
npm run test:playback
npm run build
git diff --check
```

These checks cover linting, TypeScript, automated logic tests, playback calculations, production compilation, and whitespace errors. A successful build does not verify live Supabase settings, deployed authentication, or multi-user synchronization.

## Playback synchronization measurements

Development builds expose a **Playback measurement** panel in the room. Open browser developer tools and filter the Console for `[WatchParty playback metric]`. Metrics are logged locally; they are not sent to Supabase or saved. Events are correlated by `roomId:state_version`. Host logs include the action timestamp and database-write round trip; receiving clients log Realtime receipt time and the Supabase commit timestamp. A latency value is reported only when timestamps can be compared. Native YouTube seeks are detected by a polling loop, so their recorded action time is the detection time and may trail the user's seek.

Use this reproducible procedure:

1. Start the app with `npm run dev`. Open one host browser and at least one separate member browser or profile. Create a room as host, join it from the other browser, and use the same supported media source on each client. Record browser, OS, media type, and Supabase region.
2. For a two-client baseline, verify the clients' clocks before enabling clock comparison. Warm up playback, then perform at least 100 play, 100 pause, and 100 seek actions. For each receiving client, collect `realtime-action-received` records with a numeric `propagationLatencyMs`. Report sample count, median, nearest-rank p95, and maximum separately by action type. Exclude warm-up actions and actions with omitted latency.
3. For the ten-user target, repeat with one host and nine viewers connected concurrently. Report each viewer separately and the combined sample distribution. Do not count a host database-write round trip as propagation latency.
4. For correction, inspect `direct-drift-correction-started` / `direct-correction-result` for direct video, or `youtube-drift-correction-started` / `youtube-correction-result` for YouTube. Compare numeric after-correction drift values against 500 ms. Each result is one observation after a seek request, not proof of a hard real-time bound.
5. For late joining, start playback and open the room in a new member browser. Record the `playback-snapshot` with `source: initial-room-load`, the player-apply result, and the viewer's first measured drift. For reconnect, briefly disconnect a viewer's network, restore it, then record `source: realtime-reconnect`, the next received action, and drift after correction. Repeat each scenario at least 20 times and include failures and timeouts.

The target of p95 propagation at or below 250 ms and drift at or below 500 ms after correction remains unverified until measurements are collected and reported with their test conditions. Local development does not make the playback transport local-only; measurements include the network path to Supabase Realtime and back.

## Vercel deployment preparation

1. Import the GitHub repository into Vercel and select Node.js 24.x in the project build settings.
2. Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to the required Vercel environments using the actual values from Supabase. Do not commit them.
3. In the separate Supabase dashboard, confirm **Anonymous Sign-Ins** is enabled and saved. Review the target database schema and migration state before using room features.
4. If email magic links will be used, add the exact production `/auth/callback` URL to Supabase Auth's allowed redirect URLs and set the intended Site URL. Add local or preview callback URLs only if you plan to use those environments for email sign-in.
5. Run the verification commands above and confirm the production build succeeds before deploying. Deployment and live production behavior are not verified by these instructions.

## Security notes

Keep `.env.local` and all credentials out of Git. Room RPCs validate supplied user IDs against the caller's signed JWT identity (`auth.uid()`). Supabase anonymous Auth users use the `authenticated` database role, but they still need a matching room membership row. Do not change room RLS to treat anonymous authentication as public database access. Host permissions remain separate from authentication and room membership.

---

WatchParty — a shared screen for movie nights with friends.
