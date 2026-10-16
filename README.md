# WatchParty 🎬

WatchParty is a real-time synchronized movie-watching web application that lets people create rooms, invite friends, and enjoy videos together. It combines synchronized playback with live chat, emoji reactions, shared playlists, group polls, and movie discovery in a single responsive interface.

Built with Next.js, TypeScript, Tailwind CSS, and Supabase, WatchParty is designed to make watching together feel simple, interactive, and seamless.

## Features

- **Email Authentication:** Sign in using Supabase email magic links.
- **Room Creation and Joining:** Create a watch room and invite others to join.
- **Synchronized Playback:** Keep supported video playback synchronized between room participants.
- **Host Controls:** Allow the room host to control playback and manage room activities.
- **Multiple Video Sources:** Support YouTube videos and direct MP4/WebM media URLs.
- **Shared Playlist:** Maintain a common queue of videos for the room.
- **Real-Time Chat:** Exchange messages with other participants.
- **Emoji Reactions:** Send animated reactions that appear over the video area.
- **Room Presence:** View room participants and their online status.
- **Host Transfer:** Transfer room-host privileges when supported by the room workflow.
- **Group Polls:** Create and participate in polls to decide what to watch.
- **Movie Discovery:** Explore movie recommendations with available descriptions and metadata.
- **Responsive Interface:** Use the room interface across desktop and mobile screen sizes.

## Getting Started

### Prerequisites

Make sure the following are installed:

- Node.js and npm
- Git
- A Supabase account and project

### Installation

Clone the repository:

```bash
git clone https://github.com/HetarthsinhJadeja/watchparty.git
cd watchparty
```

Install dependencies:

```bash
npm install
```

### Environment Configuration

Create a `.env.local` file in the project root and configure the Supabase environment variables required by the application.

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your_supabase_publishable_key
```

Obtain these values from your Supabase project's API settings. Use the project's publishable key, not its secret or service-role key.

Keep `.env.local` out of source control. Never commit real credentials or secret keys to GitHub.

### Run the Development Server

Start the application:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

The development server supports hot reloading while you edit the application.

## Authentication and Room Flows

WatchParty uses Supabase authentication with email magic links.

The general sign-in flow is:

1. Open the sign-in page.
2. Enter an email address and request a magic link.
3. Open the authentication email.
4. Follow the link to return to WatchParty.
5. Complete the authentication callback and access the authenticated application.

The application includes an authentication callback route and cookie-backed session handling.

After signing in, users can create or join rooms and access the available room features according to their permissions.

For production deployments, configure the Supabase Site URL and allowed Redirect URLs to match the deployed application's domain and authentication callback route.

## Watch Room and Real-Time Synchronization

The watch room brings video playback and group interaction together in a shared interface.

### Video Playback

Supported video sources include YouTube videos and direct MP4/WebM media URLs. Playback controls allow the host to manage supported playback actions, while synchronization logic communicates playback state to room participants.

The application includes playback-state handling and measurement utilities to help evaluate synchronization performance.

### Shared Playlist

Room participants can interact with the shared playlist according to the permissions implemented by the application. Playlist changes are handled through the room's database and real-time update mechanisms.

### Chat and Emoji Reactions

The chat panel supports real-time room communication. Emoji reactions provide a lightweight way to react during playback, with animated effects that appear over the player.

### Room Members and Host Transfer

Room presence helps participants see who is currently in the room. Host-transfer functionality supports handing control to another participant through the application's room workflow.

### Group Polls

Polls allow room participants to vote on group decisions, such as choosing what to watch next. Poll operations use the room's existing data and permission mechanisms.

### Movie Discovery

The discovery section presents available movie recommendations and associated metadata. It is separate from the playable-video input and shared playlist.

## Database and Security

Supabase provides the application's backend services, including authentication, database storage, row-level security, and real-time updates.

The project contains SQL migrations for room-related functionality and security policies.

Important implementation areas include:

- **Row-Level Security (RLS):** Controls access to room data and related records.
- **Database Functions and RPCs:** Support room operations and permission checks.
- **Realtime Subscriptions:** Deliver supported database changes to connected clients.
- **Authentication Sessions:** Maintain authenticated user sessions through the application's Supabase integration.

Apply and verify the project's required migrations in Supabase before running the application against a new database.

Never expose Supabase secret or service-role keys in browser code or variables prefixed with `NEXT_PUBLIC_`. Client-accessible operations must rely on appropriate database permissions and security policies.

## Testing

Run the checks supported by the project:

```bash
npm run lint
npx tsc --noEmit
npm test
npm run build
```

The project also includes playback-related tests. Check `package.json` for the exact playback test command configured in the current version.

These checks help validate code quality, TypeScript correctness, application logic, and production compilation. They do not replace testing the application with multiple authenticated users.

## Deployment on Vercel

WatchParty can be deployed using Vercel's Next.js hosting platform.

### Deployment Steps

1. Push the project to GitHub.
2. Open [Vercel](https://vercel.com/).
3. Import the `watchparty` repository.
4. Keep the framework preset set to Next.js.
5. Add the required environment variables in the Vercel project settings.
6. Deploy the application.
7. Configure Supabase authentication URLs for the production domain.
8. Test authentication, room creation, playback, and real-time features on the deployed website.

### Supabase Redirect Configuration

In the Supabase dashboard, open **Authentication → URL Configuration**.

Set the Site URL to the production website's origin and add the authentication callback URL to the allowed Redirect URLs.

For local development, retain:

```text
http://localhost:3000/auth/callback
```

For production, replace the example domain with the actual deployed domain:

```text
https://your-production-domain/auth/callback
```

Use the exact production URL assigned to your deployment. Preview deployments may require additional allowed redirect URLs if you intend to test authentication on them.

### Production Verification

After deployment, verify:

- Email magic-link authentication and callback handling.
- Room creation and joining.
- Host-controlled playback synchronization.
- Shared playlist updates.
- Chat and emoji reactions.
- Member presence and host transfer.
- Poll creation and voting.
- Responsive behavior on desktop and mobile.

A successful production build confirms compilation, but live multi-user synchronization and authentication should be tested separately.

## Project Structure

The repository is organized around the Next.js App Router and supporting application modules.

```text
watchparty/
├── app/
│   ├── api/                  # API route handlers
│   ├── auth/                 # Authentication and callback routes
│   ├── room/
│   │   └── [roomId]/         # Watch room and feature components
│   ├── globals.css           # Global styles
│   ├── layout.tsx            # Root application layout
│   └── page.tsx              # Main authenticated page
├── lib/
│   ├── supabase.ts           # Browser Supabase client
│   ├── supabase-server.ts    # Server-side Supabase utilities
│   ├── auth-redirect.mts     # Authentication redirect utilities
│   ├── movie-catalogue.ts    # Movie discovery data
│   ├── room-media.ts         # Media-related utilities
│   └── playback-metrics.mts  # Playback measurements
├── public/
│   └── images/               # Public image assets
├── supabase/                 # Database migrations and SQL
├── tests/                    # Automated tests
├── proxy.ts                  # Request/session handling
├── package.json
├── package-lock.json
└── README.md
```

The tree highlights the main project areas; individual files and feature modules may change as development continues.

## Future Improvements

Potential areas for further development include:

- More extensive multi-user synchronization testing.
- Improved playback drift handling and latency measurements.
- Additional room customization options.
- Expanded movie discovery and recommendation capabilities.
- Further accessibility and mobile usability improvements.

## Learn More

Explore the official documentation for the technologies used in WatchParty:

- [Next.js Documentation](https://nextjs.org/docs)
- [Supabase Documentation](https://supabase.com/docs)
- [Supabase Authentication](https://supabase.com/docs/guides/auth)
- [Supabase Realtime](https://supabase.com/docs/guides/realtime)
- [Vercel Documentation](https://vercel.com/docs)

---

WatchParty — a shared screen for movie nights with friends.
