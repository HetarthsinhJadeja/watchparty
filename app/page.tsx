"use client";

import { useState } from "react";

const roomWords = ["NOVA", "MOON", "MINT", "LUNA", "COMET", "COVE", "MUSE", "DUSK"];

function makeRoomCode() {
  const first = roomWords[Math.floor(Math.random() * roomWords.length)];
  let second = roomWords[Math.floor(Math.random() * roomWords.length)];

  while (second === first) {
    second = roomWords[Math.floor(Math.random() * roomWords.length)];
  }

  return `${first}-${second}`;
}

const steps = [
  {
    number: "01",
    title: "Make a room",
    description: "Start a room and get a simple code to share with your people.",
  },
  {
    number: "02",
    title: "Bring everyone in",
    description: "Your friends can enter the code and get ready for the movie.",
  },
  {
    number: "03",
    title: "Enjoy the moment",
    description: "Settle in together. Shared playback is coming in a later phase.",
  },
];

export default function Home() {
  const [roomCode, setRoomCode] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [joinMessage, setJoinMessage] = useState("");
  const [copyMessage, setCopyMessage] = useState("");

  function createRoom() {
    setRoomCode(makeRoomCode());
    setCopyMessage("");
  }

  function joinRoom(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanedCode = joinCode.trim().toUpperCase();

    if (!cleanedCode) {
      setJoinMessage("Enter a room code to continue.");
      return;
    }

    setJoinCode(cleanedCode);
    setJoinMessage(
      `You entered ${cleanedCode}. Room lookup will be available in a later phase.`,
    );
  }

  async function copyRoomCode() {
    if (!roomCode) return;

    try {
      await navigator.clipboard.writeText(roomCode);
      setCopyMessage("Code copied to clipboard.");
    } catch {
      setCopyMessage("Copy is unavailable here. Select the code to copy it.");
    }
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#090b10] text-[#f5f2eb]">
      <div className="cinema-glow pointer-events-none absolute inset-x-0 top-0 h-[760px]" aria-hidden="true" />
      <header className="relative z-10 mx-auto flex w-full max-w-7xl items-center justify-between px-5 py-5 sm:px-8 lg:px-12">
        <a href="#top" className="flex items-center gap-3 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#d6f379]" aria-label="WatchParty home">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#d6f379] text-[#10130c]">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true"><path d="M7 4.8c0-.8.9-1.3 1.6-.9l10.2 6.1a2.3 2.3 0 0 1 0 4L8.6 20.1c-.7.4-1.6-.1-1.6-.9V4.8Z" /></svg>
          </span>
          <span className="text-lg font-semibold tracking-tight">watch<span className="text-[#d6f379]">party</span></span>
        </a>
        <nav aria-label="Main navigation" className="flex items-center gap-4 sm:gap-8">
          <a href="#how-it-works" className="hidden text-sm text-[#a9a8a3] transition hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#d6f379] sm:inline">How it works</a>
          <a href="#get-started" className="rounded-full border border-white/15 px-4 py-2.5 text-sm font-medium transition hover:border-[#d6f379]/60 hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#d6f379]">Get started <span aria-hidden="true">↗</span></a>
        </nav>
      </header>

      <section id="top" className="relative mx-auto grid w-full max-w-7xl items-center gap-12 px-5 pb-20 pt-14 sm:px-8 sm:pb-28 sm:pt-20 lg:grid-cols-[1.02fr_.98fr] lg:gap-8 lg:px-12 lg:pb-32 lg:pt-24">
        <div className="relative z-10 max-w-2xl">
          <p className="mb-6 flex items-center gap-3 text-xs font-semibold uppercase tracking-[.22em] text-[#d6f379]"><span className="h-px w-8 bg-[#d6f379]" /> A little closer, wherever you are</p>
          <h1 className="text-[clamp(3.4rem,8vw,6.7rem)] font-semibold leading-[.97] tracking-[-.075em]">Your people.<br />Your movie.<br /><span className="font-serif font-normal italic text-[#d6f379]">One moment.</span></h1>
          <p className="mt-7 max-w-lg text-base leading-7 text-[#aaa9a4] sm:text-lg sm:leading-8">Good movies are better shared. Bring your favorite people together for a cozy night in, even when you&apos;re miles apart.</p>
          <a href="#get-started" className="mt-9 inline-flex items-center gap-3 rounded-full bg-[#d6f379] px-6 py-3.5 text-sm font-semibold text-[#14170e] transition hover:bg-[#e2ff8c] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">Start a watch party <span aria-hidden="true">↗</span></a>
          <p className="mt-5 text-xs text-[#777873]">A first look at WatchParty. Rooms are temporary for now.</p>
        </div>

        <div className="relative mx-auto w-full max-w-[560px] lg:justify-self-end" aria-label="Illustration of friends watching a movie together">
          <div className="film-frame relative aspect-[1.12/1] overflow-hidden rounded-[2rem] border border-white/10 bg-[#171a20] p-3 shadow-2xl sm:rounded-[2.5rem] sm:p-4">
            <div className="relative flex h-full flex-col overflow-hidden rounded-[1.45rem] bg-[#24282b] sm:rounded-[2rem]">
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_65%_35%,rgba(224,139,91,.55),transparent_37%),radial-gradient(ellipse_at_28%_70%,rgba(164,116,129,.55),transparent_42%),linear-gradient(145deg,#647477_0%,#37464a_34%,#24262a_71%,#17191f_100%)]" />
              <div className="absolute inset-0 opacity-40" style={{ backgroundImage: "linear-gradient(180deg,transparent 35%,rgba(7,8,11,.84) 100%)" }} />
              <div className="relative z-10 flex items-center justify-between p-5 sm:p-7">
                <span className="flex items-center gap-2 rounded-full border border-white/20 bg-black/20 px-3 py-2 text-[10px] font-medium uppercase tracking-[.14em] text-white/90 backdrop-blur"><span className="h-1.5 w-1.5 rounded-full bg-[#d6f379]" /> Friday night</span>
                <span className="text-xs text-white/70">9:41 PM</span>
              </div>
              <div className="relative z-10 mt-auto px-6 pb-7 sm:px-9 sm:pb-9">
                <div className="mb-5 flex items-end gap-2" aria-hidden="true">
                  <span className="h-16 w-10 rounded-t-[48%] bg-[#d29b79] shadow-[0_10px_28px_rgba(0,0,0,.22)] sm:h-24 sm:w-14" />
                  <span className="h-24 w-14 rounded-t-[48%] bg-[#d5c3ae] shadow-[0_10px_28px_rgba(0,0,0,.22)] sm:h-32 sm:w-[4.5rem]" />
                  <span className="h-[4.5rem] w-11 rounded-t-[48%] bg-[#8a9b8a] shadow-[0_10px_28px_rgba(0,0,0,.22)] sm:h-28 sm:w-16" />
                  <span className="ml-auto rounded-full border border-white/20 bg-black/30 px-3 py-2 text-[10px] text-white/90 backdrop-blur sm:text-xs">+2 watching</span>
                </div>
                <div className="rounded-2xl border border-white/15 bg-[#111318]/75 p-4 backdrop-blur-md sm:p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div><p className="text-[10px] uppercase tracking-[.18em] text-white/50">Now showing</p><p className="mt-1 text-sm font-medium sm:text-base">The good kind of together</p></div>
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#d6f379] text-[#16190f]" aria-hidden="true">▶</span>
                  </div>
                  <div className="mt-4 h-1 overflow-hidden rounded-full bg-white/15"><span className="block h-full w-[38%] rounded-full bg-[#d6f379]" /></div>
                  <div className="mt-2 flex justify-between text-[10px] text-white/45"><span>18:24</span><span>1:42:08</span></div>
                </div>
              </div>
            </div>
          </div>
          <div className="absolute -right-2 top-[19%] rounded-xl border border-white/10 bg-[#202329]/90 px-3 py-2 text-xs text-white shadow-lg backdrop-blur sm:-right-5 sm:px-4 sm:py-3"><span className="mr-2">💬</span>this is the best scene</div>
          <div className="absolute -left-2 top-[45%] rounded-full border border-white/10 bg-[#d6f379] px-3 py-2 text-sm shadow-lg sm:-left-6 sm:px-4">🍿</div>
        </div>
      </section>

      <section id="get-started" className="relative border-y border-white/[.07] bg-[#101218]/80 px-5 py-16 sm:px-8 sm:py-20 lg:px-12">
        <div className="mx-auto grid w-full max-w-7xl gap-10 lg:grid-cols-[.72fr_1.28fr] lg:items-start">
          <div className="max-w-sm">
            <p className="text-xs font-semibold uppercase tracking-[.2em] text-[#d6f379]">Make it a movie night</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-.04em] sm:text-4xl">Your couch is wherever you are.</h2>
            <p className="mt-4 text-sm leading-6 text-[#999a9d]">Start a room or enter a code from a friend. We&apos;re building the shared experience one good step at a time.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <article className="rounded-3xl border border-white/10 bg-[#171a21] p-6 sm:p-7">
              <div className="flex items-center justify-between"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#d6f379]/10 text-[#d6f379]" aria-hidden="true">✳</span><span className="text-xs text-[#6f7277]">01 / HOST</span></div>
              <h3 className="mt-6 text-xl font-semibold">Create a room</h3>
              <p className="mt-2 min-h-12 text-sm leading-6 text-[#999a9d]">Get a temporary code and invite your favorite people.</p>
              <button type="button" onClick={createRoom} className="mt-6 w-full rounded-xl bg-[#d6f379] px-4 py-3 text-sm font-semibold text-[#14170e] transition hover:bg-[#e2ff8c] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">Create room</button>
              {roomCode ? <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3" aria-live="polite"><p className="text-[10px] uppercase tracking-[.16em] text-[#8f9296]">Your temporary room code</p><div className="mt-2 flex items-center justify-between gap-2"><code className="select-all text-lg font-semibold tracking-[.12em] text-[#d6f379]">{roomCode}</code><button type="button" onClick={copyRoomCode} className="rounded-lg border border-white/15 px-3 py-2 text-xs text-white/80 transition hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d6f379]">Copy</button></div><p className="mt-2 text-xs text-[#a7a9aa]">{copyMessage || "This code is only stored in this page for now."}</p></div> : <p className="mt-4 text-xs text-[#73767b]" aria-live="polite">Your code will appear here.</p>}
            </article>

            <article className="rounded-3xl border border-white/10 bg-[#171a21] p-6 sm:p-7">
              <div className="flex items-center justify-between"><span className="grid h-10 w-10 place-items-center rounded-xl bg-white/[.06] text-[#e6b7a2]" aria-hidden="true">↗</span><span className="text-xs text-[#6f7277]">02 / JOIN</span></div>
              <h3 className="mt-6 text-xl font-semibold">Join a room</h3>
              <p className="mt-2 min-h-12 text-sm leading-6 text-[#999a9d]">Got a code? Enter it here to get the next step ready.</p>
              <form onSubmit={joinRoom} className="mt-6">
                <label htmlFor="room-code" className="mb-2 block text-xs font-medium text-[#c4c5c6]">Room code</label>
                <input id="room-code" name="roomCode" type="text" autoComplete="off" value={joinCode} onChange={(event) => { setJoinCode(event.target.value); setJoinMessage(""); }} placeholder="e.g. NOVA-MOON" className="w-full rounded-xl border border-white/15 bg-[#0d0f14] px-4 py-3 text-sm uppercase tracking-[.08em] text-white outline-none transition placeholder:normal-case placeholder:tracking-normal placeholder:text-[#64676d] focus:border-[#d6f379]/70 focus:ring-2 focus:ring-[#d6f379]/20" aria-describedby="join-feedback" />
                <button type="submit" className="mt-3 w-full rounded-xl border border-white/15 px-4 py-3 text-sm font-semibold text-white transition hover:border-white/30 hover:bg-white/[.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d6f379]">Continue with code <span aria-hidden="true">→</span></button>
                <p id="join-feedback" className="mt-3 min-h-5 text-xs leading-5 text-[#a7a9aa]" aria-live="polite">{joinMessage || "Room codes are not checked against a database yet."}</p>
              </form>
            </article>
          </div>
        </div>
      </section>

      <section id="how-it-works" className="mx-auto w-full max-w-7xl px-5 py-20 sm:px-8 sm:py-28 lg:px-12">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-xs font-semibold uppercase tracking-[.2em] text-[#d6f379]">Easy as pressing play</p><h2 className="mt-4 text-3xl font-semibold tracking-[-.04em] sm:text-4xl">Three steps to together.</h2></div><p className="max-w-sm text-sm leading-6 text-[#999a9d]">The foundation is here. Shared playback is the next chapter.</p></div>
        <div className="mt-10 grid gap-4 sm:mt-14 sm:grid-cols-3">
          {steps.map((step) => <article key={step.number} className="rounded-2xl border border-white/[.08] bg-white/[.02] p-6 sm:p-7"><span className="font-mono text-sm text-[#d6f379]">{step.number}</span><h3 className="mt-8 text-lg font-semibold">{step.title}</h3><p className="mt-2 text-sm leading-6 text-[#999a9d]">{step.description}</p></article>)}
        </div>
      </section>

      <footer className="border-t border-white/[.08] px-5 py-7 sm:px-8 lg:px-12">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 text-xs text-[#777a80] sm:flex-row sm:items-center sm:justify-between"><a href="#top" className="font-semibold tracking-tight text-[#e9e7e0] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#d6f379]">watch<span className="text-[#d6f379]">party</span></a><p>Made for movie nights, wherever life puts you.</p><p>Early preview · More together soon</p></div>
      </footer>
    </main>
  );
}
