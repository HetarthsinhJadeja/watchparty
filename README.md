# WatchParty 🎬

WatchParty is an early-stage web app for bringing friends together for a movie night, wherever they are.

## Current status

The landing page includes a responsive introduction, a temporary room-code generator, and a join-code form with clear feedback. Room codes only exist in the current page session. Joining a code does not look up or connect to a real room yet.

The project includes the Supabase JavaScript client and a client setup in `lib/supabase.ts`, but the landing page does not use Supabase. Persistent rooms, video playback, realtime synchronisation, chat, and authentication are not implemented yet.

## Tech stack

- Next.js App Router
- React and TypeScript
- Tailwind CSS
- Supabase JavaScript client (installed; not yet used by the app)

## Run locally

Install Node.js and npm, then run:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Security

Keep `.env.local`, API credentials, and Supabase secret keys out of Git. Never use a Supabase service-role or secret key in browser code.
