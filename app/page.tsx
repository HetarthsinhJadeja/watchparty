"use client";

import { useState } from "react";
import { useEffect } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { safeRedirectPath } from "@/lib/auth-redirect.ts";
import {
  createRoomIdentityArguments,
  ensureUserSession,
  joinRoomIdentityArguments,
} from "@/lib/guest-session.ts";

type Room = {
  id: string;
  code: string;
  display_name: string;
  status: string;
};

function isRoom(value: unknown): value is Room {
  if (!value || typeof value !== "object") return false;

  const room = value as Partial<Room>;
  return (
    typeof room.id === "string" &&
    typeof room.code === "string" &&
    typeof room.display_name === "string" &&
    typeof room.status === "string"
  );
}

function makeRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const randomBytes = new Uint8Array(8);
  crypto.getRandomValues(randomBytes);
  const suffix = Array.from(randomBytes, (byte) => alphabet[byte % alphabet.length]).join("");

  return `WP-${suffix}`;
}

function explainRoomError(error: { code?: string; message?: string }) {
  const message = (error.message ?? "").toLowerCase();

  if (error.code === "23505" || message.includes("duplicate key")) {
    return "That room code was already taken. Please try again.";
  }
  if (message.includes("room not found")) {
    return "We couldn't find that room code. Check it and try again.";
  }
  if (message.includes("identity does not match") || message.includes("verified user")) {
    return "Your session could not be verified. Refresh the page to restore your guest session, then retry.";
  }
  if (error.code === "42501" || message.includes("permission denied") || message.includes("row-level security")) {
    return "Supabase denied this action. Check the room access policies and your sign-in status.";
  }
  if (error.code === "PGRST202" || message.includes("could not find the function")) {
    return "The room database functions are not available yet. Apply the existing Supabase schema, then try again.";
  }
  if (message.includes("failed to fetch") || message.includes("network") || message.includes("fetch")) {
    return "Couldn't reach Supabase. Check your internet connection and try again.";
  }

  return "We couldn't complete that room action. Please try again.";
}

const steps = [
  {
    number: "01",
    title: "Make a room",
    description: "Create a room with a persistent code and share it with your people.",
  },
  {
    number: "02",
    title: "Bring everyone in",
    description: "Your friends can join the same room with its code.",
  },
  {
    number: "03",
    title: "Enjoy the moment",
    description: "Settle in together and keep the movie in sync.",
  },
];

export default function Home() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [sessionMessage, setSessionMessage] = useState("");
  const [sessionRetry, setSessionRetry] = useState(0);
  const [roomLoading, setRoomLoading] = useState<"create" | "join" | null>(null);
  const [roomMessage, setRoomMessage] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [joinMessage, setJoinMessage] = useState("");

  useEffect(() => {
    let active = true;
    async function initializeSession() {
      setAuthReady(false);
      setSessionMessage("");
      try {
        const nextSession = await ensureUserSession(supabase.auth);
        if (!active) return;
        setSession(nextSession);
        setAuthReady(true);
        const nextPath = safeRedirectPath(new URLSearchParams(window.location.search).get("next"));
        if (nextPath !== "/") router.replace(nextPath);
      } catch {
        if (!active) return;
        setSession(null);
        setAuthReady(true);
        setSessionMessage("We couldn't start your guest session. Check your connection and try again.");
      }
    }

    const { data: authListener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;
      if (nextSession) {
        setSession(nextSession);
        setAuthReady(true);
        setSessionMessage("");
      }
      if (event === "SIGNED_OUT") {
        setSession(null);
        setAuthReady(false);
        // Let Supabase finish the sign-out callback before asking it to sign in again.
        window.setTimeout(() => {
          if (active) void initializeSession();
        }, 0);
      }
    });

    void initializeSession();

    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, [router, sessionRetry]);

  async function createRoom() {
    setRoomMessage("");
    if (!session?.user.id) {
      setRoomMessage("Your guest session is not ready yet. Please try again in a moment.");
      return;
    }

    setRoomLoading("create");
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const { data, error } = await supabase.rpc("create_room", {
          p_code: makeRoomCode(),
          p_display_name: "Movie fan",
          ...createRoomIdentityArguments(session.user.id),
          p_metadata: {},
        });

        if (error) {
          const duplicate = error.code === "23505" || error.message.toLowerCase().includes("duplicate key");
          if (duplicate && attempt < 2) continue;
          setRoomMessage(explainRoomError(error));
          return;
        }

        if (!isRoom(data)) {
          setRoomMessage("Supabase returned an unexpected room response. Please try again.");
          return;
        }

        router.push(`/room/${data.id}`);
        return;
      }
    } catch {
      setRoomMessage("Couldn't reach Supabase. Check your internet connection and try again.");
    } finally {
      setRoomLoading(null);
    }
  }

  async function joinRoom(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanedCode = joinCode.trim().toUpperCase();

    if (!cleanedCode) {
      setJoinMessage("Enter a room code to continue.");
      return;
    }

    setJoinCode(cleanedCode);
    if (!session?.user.id) {
      setJoinMessage("Your guest session is not ready yet. Please try again in a moment.");
      return;
    }

    setRoomLoading("join");
    setJoinMessage("");
    try {
      const { data, error } = await supabase.rpc("join_room", {
        p_code: cleanedCode,
        p_display_name: "Movie fan",
        ...joinRoomIdentityArguments(session.user.id),
      });

      if (error) {
        setJoinMessage(explainRoomError(error));
        return;
      }
      if (!isRoom(data)) {
        setJoinMessage("Supabase returned an unexpected room response. Please try again.");
        return;
      }

      router.push(`/room/${data.id}`);
    } catch {
      setJoinMessage("Couldn't reach Supabase. Check your internet connection and try again.");
    } finally {
      setRoomLoading(null);
    }
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
      <div className="cinema-glow pointer-events-none absolute inset-x-0 top-0 h-[760px]" aria-hidden="true" />
      <header className="relative z-10 mx-auto flex w-full max-w-7xl items-center justify-between px-5 py-5 sm:px-8 lg:px-12">
        <a href="#top" className="inline-flex items-center gap-2 rounded-md text-lg font-semibold tracking-tight focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--accent-focus)]" aria-label="WatchParty home">
          <Image src="/images/watchparty-logo.png" alt="" aria-hidden="true" width={2400} height={1792} priority className="h-9 w-auto rounded object-contain sm:h-10" />
          <span>watch<span className="text-[var(--accent-text)]">party</span></span>
        </a>
        <nav aria-label="Main navigation" className="flex items-center gap-4 sm:gap-8">
          <a href="#how-it-works" className="hidden text-sm text-[#a9a8a3] transition hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--accent-focus)] sm:inline">How it works</a>
          <a href="#get-started" className="rounded-full border border-white/15 px-4 py-2.5 text-sm font-medium transition hover:border-[var(--accent)]/60 hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--accent-focus)]">Get started <span aria-hidden="true">↗</span></a>
        </nav>
      </header>

      <section id="top" className="relative mx-auto grid w-full max-w-7xl items-center gap-12 px-5 pb-20 pt-14 sm:px-8 sm:pb-28 sm:pt-20 lg:grid-cols-[1.02fr_.98fr] lg:gap-8 lg:px-12 lg:pb-32 lg:pt-24">
        <div className="relative z-10 max-w-2xl">
          <p className="mb-6 flex items-center gap-3 text-xs font-semibold uppercase tracking-[.22em] text-[var(--accent-text)]"><span className="h-px w-8 bg-[var(--accent)]" /> A little closer, wherever you are</p>
          <h1 className="text-[clamp(3.4rem,8vw,6.7rem)] font-semibold leading-[.97] tracking-[-.075em]">Your people.<br />Your movie.<br /><span className="font-serif font-normal italic text-[var(--accent-text)]">One moment.</span></h1>
          <p className="mt-7 max-w-lg text-base leading-7 text-[#aaa9a4] sm:text-lg sm:leading-8">Good movies are better shared. Bring your favorite people together for a cozy night in, even when you&apos;re miles apart.</p>
          <a href="#get-started" className="mt-9 inline-flex items-center gap-3 rounded-full bg-[var(--accent)] px-6 py-3.5 text-sm font-semibold text-[var(--accent-foreground)] transition hover:bg-[var(--accent-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">Start a watch party <span aria-hidden="true">↗</span></a>
          <p className="mt-5 text-xs text-[#777873]">Create a persistent room and watch together in sync.</p>
        </div>

        <div className="relative mx-auto w-full max-w-[560px] lg:justify-self-end" aria-hidden="true">
          <div className="film-frame relative aspect-[1.12/1] overflow-hidden rounded-[2rem] border border-white/10 bg-[#151a22] p-3 shadow-2xl sm:rounded-[2.5rem] sm:p-4">
            <div className="relative h-full overflow-hidden rounded-[1.45rem] bg-[#11151d] sm:rounded-[2rem]">
              <svg className="absolute inset-0 h-full w-full" viewBox="0 0 720 640" preserveAspectRatio="xMidYMid slice">
                <defs>
                  <linearGradient id="home-theatre" x1="0" x2="1" y1="0" y2="1">
                    <stop offset="0" stopColor="#273644" />
                    <stop offset=".52" stopColor="#151a22" />
                    <stop offset="1" stopColor="#0b0d12" />
                  </linearGradient>
                  <radialGradient id="screen-light">
                    <stop offset="0" stopColor="#c4e8f8" stopOpacity=".7" />
                    <stop offset="1" stopColor="#79c9f2" stopOpacity=".02" />
                  </radialGradient>
                  <linearGradient id="screen-image" x1="0" x2="1" y1="0" y2="1">
                    <stop offset="0" stopColor="#50697a" />
                    <stop offset=".58" stopColor="#243747" />
                    <stop offset="1" stopColor="#17212e" />
                  </linearGradient>
                </defs>
                <rect width="720" height="640" fill="url(#home-theatre)" />
                <ellipse cx="365" cy="270" rx="280" ry="250" fill="url(#screen-light)" opacity=".48" />
                <path d="M0 0h92l92 456H0Zm720 0h-92l-92 456h184Z" fill="#090b10" fillOpacity=".6" />
                <rect x="151" y="105" width="418" height="282" rx="15" fill="#080a0e" stroke="#ffffff" strokeOpacity=".18" strokeWidth="2" />
                <rect x="164" y="118" width="392" height="256" rx="8" fill="url(#screen-image)" />
                <circle cx="355" cy="245" r="150" fill="url(#screen-light)" opacity=".58" />
                <path d="M0 492q180-64 360 0t360 0v148H0Z" fill="#0b0d12" />
                <path d="M0 537q180-58 360 0t360 0v103H0Z" fill="#151a22" />
                <path d="M34 640v-56q0-30 36-30h110q36 0 36 30v56m118 0v-56q0-30 36-30h110q36 0 36 30v56m118 0v-56q0-30 36-30h52v86" fill="#202832" stroke="#303b48" strokeWidth="3" />
                <path d="M0 0h720v640H0Z" fill="url(#home-theatre)" fillOpacity=".12" />
              </svg>
            </div>
          </div>
        </div>
      </section>

      <section id="get-started" className="relative border-y border-white/[.07] bg-[#101218]/80 px-5 py-16 sm:px-8 sm:py-20 lg:px-12">
        <div className="mx-auto grid w-full max-w-7xl gap-10 lg:grid-cols-[.72fr_1.28fr] lg:items-start">
          <div className="max-w-sm">
            <p className="text-xs font-semibold uppercase tracking-[.2em] text-[var(--accent-text)]">Make it a movie night</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-.04em] sm:text-4xl">Your couch is wherever you are.</h2>
            <p className="mt-4 text-sm leading-6 text-[#999a9d]">Create a room or enter a code from a friend to start watching together.</p>
            <div className="mt-6 rounded-2xl border border-white/10 bg-[var(--surface-raised)] p-4" aria-live="polite">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-[#c6c7c6]">{!authReady ? "Preparing your guest session…" : session ? "Ready to start a movie night." : "Guest access is temporarily unavailable."}</p>
                {authReady && !session && <button type="button" onClick={() => setSessionRetry((attempt) => attempt + 1)} className="rounded-lg border border-white/15 px-3 py-2 text-xs text-[#c6c7c6] transition hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-focus)]">Try again</button>}
              </div>
              <p className="mt-2 text-xs leading-5 text-[#a7a9aa]">Room membership still controls what you can access.</p>
              {sessionMessage && <p className="mt-2 text-xs leading-5 text-[var(--danger)]" role="alert">{sessionMessage}</p>}
            </div>
            {roomMessage && <p className="mt-3 text-sm leading-5 text-[var(--danger)]" role="alert">{roomMessage}</p>}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <article className="rounded-3xl border border-white/10 bg-[var(--surface-raised)] p-6 sm:p-7">
              <div className="flex items-center justify-between"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent-text)]" aria-hidden="true">✳</span><span className="text-xs text-[#6f7277]">01 / HOST</span></div>
              <h3 className="mt-6 text-xl font-semibold">Create a room</h3>
              <p className="mt-2 min-h-12 text-sm leading-6 text-[#999a9d]">Create a room with a shareable code that stays saved in Supabase.</p>
              <button type="button" onClick={createRoom} disabled={roomLoading !== null || !authReady || !session} aria-busy={roomLoading === "create"} className="mt-6 w-full rounded-xl bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-[var(--accent-foreground)] transition hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">{roomLoading === "create" ? "Creating room…" : "Create room"}</button>
              <p className="mt-4 min-h-5 text-xs leading-5 text-[#a7a9aa]" aria-live="polite">{roomLoading === "create" ? "Saving your room…" : roomMessage}</p>
            </article>

            <article className="rounded-3xl border border-white/10 bg-[var(--surface-raised)] p-6 sm:p-7">
              <div className="flex items-center justify-between"><span className="grid h-10 w-10 place-items-center rounded-xl bg-white/[.06] text-[var(--accent-text)]" aria-hidden="true">↗</span><span className="text-xs text-[#6f7277]">02 / JOIN</span></div>
              <h3 className="mt-6 text-xl font-semibold">Join a room</h3>
              <p className="mt-2 min-h-12 text-sm leading-6 text-[#999a9d]">Got a code? Enter it to join the room.</p>
              <form onSubmit={joinRoom} className="mt-6">
                <label htmlFor="room-code" className="mb-2 block text-xs font-medium text-[#c4c5c6]">Room code</label>
                <input id="room-code" name="roomCode" type="text" autoComplete="off" value={joinCode} onChange={(event) => { setJoinCode(event.target.value); setJoinMessage(""); }} placeholder="e.g. NOVA-MOON" className="w-full rounded-xl border border-white/15 bg-[var(--surface-low)] px-4 py-3 text-sm uppercase tracking-[.08em] text-white outline-none transition placeholder:normal-case placeholder:tracking-normal placeholder:text-[#64676d] focus:border-[var(--accent-focus)]/70 focus:ring-2 focus:ring-[var(--accent-focus)]/20" aria-describedby="join-feedback" />
                <button type="submit" disabled={roomLoading !== null || !authReady || !session} aria-busy={roomLoading === "join"} className="mt-3 w-full rounded-xl border border-white/15 px-4 py-3 text-sm font-semibold text-white transition hover:border-white/30 hover:bg-white/[.04] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-focus)]">{roomLoading === "join" ? "Joining room…" : <>Join room <span aria-hidden="true">→</span></>}</button>
                <p id="join-feedback" className="mt-3 min-h-5 text-xs leading-5 text-[#a7a9aa]" aria-live="polite">{roomLoading === "join" ? "Checking the room code…" : joinMessage || "Room codes are checked against Supabase."}</p>
              </form>
            </article>
          </div>
        </div>
      </section>

      <section id="how-it-works" className="mx-auto w-full max-w-7xl px-5 py-20 sm:px-8 sm:py-28 lg:px-12">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-xs font-semibold uppercase tracking-[.2em] text-[var(--accent-text)]">Easy as pressing play</p><h2 className="mt-4 text-3xl font-semibold tracking-[-.04em] sm:text-4xl">Three steps to together.</h2></div><p className="max-w-sm text-sm leading-6 text-[#999a9d]">Bring your people together with synchronized playback, a shared queue, and room chat.</p></div>
        <div className="mt-10 grid gap-4 sm:mt-14 sm:grid-cols-3">
          {steps.map((step) => <article key={step.number} className="rounded-2xl border border-white/[.08] bg-white/[.02] p-6 sm:p-7"><span className="font-mono text-sm text-[var(--accent-text)]">{step.number}</span><h3 className="mt-8 text-lg font-semibold">{step.title}</h3><p className="mt-2 text-sm leading-6 text-[#999a9d]">{step.description}</p></article>)}
        </div>
      </section>

      <footer className="border-t border-white/[.08] px-5 py-7 sm:px-8 lg:px-12">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 text-xs text-[#777a80] sm:flex-row sm:items-center sm:justify-between"><a href="#top" className="font-semibold tracking-tight text-[#e9e7e0] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--accent-focus)]">watch<span className="text-[var(--accent-text)]">party</span></a><p>Made for movie nights, wherever life puts you.</p><p>Early preview · More together soon</p></div>
      </footer>
    </main>
  );
}
