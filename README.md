# 🎬 WatchParty

**Watch videos together, from anywhere.**

WatchParty is a collaborative video-watching web application where friends can create private rooms, share a room code, and enjoy videos together. It brings synchronized playback, live chat, reactions, polls, and a shared playlist into one place.

🌐 **Live Demo:** https://watchparty-woad.vercel.app  
💻 **Source Code:** https://github.com/HetarthsinhJadeja/watchparty

---

## ✨ Features

- **🚪 Create & Join Rooms** — Create a room or join friends using a room code.
- **▶️ Synchronized Playback** — Coordinate play, pause, and seek actions across room members.
- **📺 Shared Playlist** — Add and manage YouTube videos and direct MP4/WebM video sources.
- **💬 Real-Time Chat** — Send messages and interact with other participants.
- **😀 Emoji Reactions** — React and make movie nights more engaging.
- **📊 Interactive Polls** — Let participants vote together.
- **👥 Participant Presence** — See who's currently connected to the room.
- **🎭 Movie Discovery** — Explore movie suggestions and recommendations.
- **👤 Guest Access** — Join without entering an email through Supabase anonymous authentication.
- **🔐 Room Permissions** — Separate authentication, room membership, and host permissions.

*Note: Live multi-user behavior depends on the deployed Supabase configuration and should be tested in separate browser sessions.*

---

## 🛠️ Tech Stack

| Technology | Purpose |
|---|---|
| Next.js | Application framework and routing |
| React | Component-based user interface |
| TypeScript | Type-safe application development |
| Tailwind CSS v4 | Styling and responsive UI |
| Supabase | Authentication, PostgreSQL database, and Realtime |
| YouTube Player | YouTube video playback |
| Vercel | Hosting and deployment |
| Git & GitHub | Version control and source code hosting |

### 🏗️ How It Works

1. A user opens WatchParty and starts a guest session.
2. The user creates a room or joins an existing room using its code.
3. Supabase handles authentication, database operations, and Realtime communication.
4. Room members share playlist updates, messages, reactions, polls, and playback actions.
5. Each participant plays supported media in their own browser.

**Architecture overview**

`Browser → Next.js Application → Supabase`

YouTube videos are played by the browser's YouTube player rather than streamed through the WatchParty backend. Supabase Realtime communicates updates between clients; the quality of playback synchronization depends on network conditions and the synchronization logic.

---

## 🚀 Getting Started

### Prerequisites

- Node.js 24.x LTS recommended
- npm
- Git
- A Supabase project

### 1. Clone the Repository

```bash
git clone https://github.com/HetarthsinhJadeja/watchparty.git
cd watchparty
```

### 2. Install Dependencies

```bash
npm ci
```

### 3. Configure Environment Variables

Create a `.env.local` file in the project root:

```env
NEXT_PUBLIC_SUPABASE_URL=https://<your-project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<your-publishable-key>
```

Replace the placeholders with the corresponding values from your Supabase project.

**Security:** Never commit `.env.local` or place a Supabase service-role key in client-side code or a `NEXT_PUBLIC_` variable.

### 4. Configure Supabase

1. Enable **Anonymous Sign-Ins** in Supabase Authentication settings and save the change.
2. Review `supabase/schema.sql` and the migration files.
3. Apply the required schema, functions, policies, and migrations after checking the existing database state.
4. Keep Row Level Security (RLS) and room-membership authorization policies enabled.

Email magic-link authentication is available as an optional flow and requires the appropriate Supabase redirect configuration.

### 5. Start the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 📂 Project Structure

```text
watchparty/
├── app/
│   ├── auth/                 # Optional email authentication
│   ├── room/[roomId]/        # Room interface and media player
│   ├── api/youtube-title/    # YouTube title lookup
│   ├── page.tsx              # Homepage and room entry
│   └── globals.css           # Global styling
├── lib/
│   ├── guest-session.ts      # Guest session management
│   ├── supabase.ts           # Browser Supabase client
│   ├── supabase-server.ts    # Server Supabase client
│   ├── room-media.ts         # Media parsing and metadata
│   ├── playlist-state.ts     # Playlist Realtime helpers
│   ├── playback-metrics.ts   # Playback measurements
│   └── movie-catalogue.ts    # Movie discovery data
├── tests/                    # Automated tests
├── supabase/
│   ├── schema.sql            # Base database schema
│   └── migrations/           # Database migrations
├── proxy.ts                  # Request and auth-claim handling
├── package.json              # Dependencies and scripts
└── README.md
```

---

## 🧪 Testing & Verification

Run the following commands from the project directory:

```bash
npm run lint
npx tsc --noEmit
npm test
npm run test:playback
npm run build
git diff --check
```

These checks cover linting, TypeScript, automated tests, playback calculations, production compilation, and whitespace errors.

To test collaborative behavior, open separate browser sessions, create a room in one, join it from another, and verify playback, chat, playlist updates, permissions, late joining, and reconnection.

---

## ☁️ Deployment

WatchParty is deployed on Vercel.

- **Live application:** https://watchparty-woad.vercel.app
- **GitHub repository:** https://github.com/HetarthsinhJadeja/watchparty

For your own deployment:

1. Import the GitHub repository into Vercel.
2. Configure the required Supabase environment variables.
3. Confirm anonymous authentication is enabled.
4. Verify the database schema, migrations, and RLS policies.
5. Build and deploy the application.
6. Test the deployed application with multiple browser sessions.

A successful deployment does not by itself guarantee that every real-time feature is configured correctly.

---

## 🔒 Security Considerations

- Keep credentials and `.env.local` out of version control.
- Use Supabase RLS to restrict database access.
- Validate user identity and room permissions on the backend.
- Do not treat anonymous authentication as automatic room authorization.
- Never expose service-role credentials in browser code.

---

## 🔮 Future Improvements

Potential improvements include:

- More robust playback synchronization under high latency.
- Better recovery after temporary disconnections.
- Expanded media-source support.
- Improved mobile experience and accessibility.
- Performance testing with more concurrent room participants.
- Enhanced room controls and moderation.

---

## 👨‍💻 Author

**Hetarthsinh Jadeja**

Built with Next.js, TypeScript, and Supabase as a collaborative project exploring real-time web applications, authentication, database security, and synchronized media playback.

---

⭐ **Explore the project:** https://github.com/HetarthsinhJadeja/watchparty

🎬 **Try WatchParty:** https://watchparty-woad.vercel.app
