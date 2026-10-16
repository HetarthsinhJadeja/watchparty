import { Suspense } from "react";
import Image from "next/image";
import { redirect } from "next/navigation";
import { safeRedirectPath } from "@/lib/auth-redirect.mts";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import AuthForm from "./auth-form";

async function AuthContent({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const nextPath = safeRedirectPath(params.next);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();

  if (!error && typeof data?.claims?.sub === "string") {
    redirect(nextPath);
  }

  const errorMessage = params.error === "expired"
    ? "This sign-in link is expired or invalid. Request a fresh link and try again."
    : params.error === "configuration"
      ? "Sign-in is temporarily unavailable. Please try again later."
      : "";

  return (
    <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)] lg:grid lg:min-h-[100svh] lg:grid-cols-[1.08fr_.92fr]">
      <section className="relative isolate flex min-h-[410px] flex-col justify-between overflow-hidden border-b border-white/[.08] px-6 py-7 sm:px-10 sm:py-9 lg:min-h-[100svh] lg:border-b-0 lg:border-r lg:px-14 lg:py-12 xl:px-20">
        <div className="absolute inset-0 -z-20 bg-[#141b20]" aria-hidden="true" />
        <svg className="absolute inset-0 -z-10 h-full w-full" viewBox="0 0 1200 1000" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <defs>
            <linearGradient id="auth-sky" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#111820" />
              <stop offset=".43" stopColor="#30333b" />
              <stop offset=".69" stopColor="#94765f" />
              <stop offset="1" stopColor="#202229" />
            </linearGradient>
            <radialGradient id="auth-light">
              <stop offset="0" stopColor="var(--accent)" stopOpacity=".58" />
              <stop offset=".32" stopColor="var(--accent)" stopOpacity=".15" />
              <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="auth-hill" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0" stopColor="#292c33" />
              <stop offset="1" stopColor="#111719" />
            </linearGradient>
          </defs>
          <rect width="1200" height="1000" fill="url(#auth-sky)" />
          <circle cx="835" cy="440" r="330" fill="url(#auth-light)" />
          <circle cx="835" cy="440" r="72" fill="var(--accent)" fillOpacity=".72" />
          <path d="M0 610 150 520l130 63 158-162 133 144 157-105 167 137 139-90 166 108v385H0Z" fill="#343740" fillOpacity=".77" />
          <path d="m0 694 181-126 148 74 177-112 161 138 171-110 145 82 127-58 190 106v312H0Z" fill="url(#auth-hill)" />
          <path d="M0 805q185-123 370-36t365 8q205-108 465 41v182H0Z" fill="#111719" />
          <path d="M0 0h1200v1000H0Z" fill="url(#auth-sky)" fillOpacity=".12" />
        </svg>
        <div className="pointer-events-none absolute inset-0 -z-[5] bg-[linear-gradient(90deg,rgba(7,9,12,.40),rgba(7,9,12,.06)_75%),linear-gradient(180deg,rgba(7,9,12,.36),transparent_30%,rgba(7,9,12,.76))]" aria-hidden="true" />

        <div className="relative flex items-center gap-3">
          <Image src="/images/watchparty-logo.png" alt="" aria-hidden="true" width={2400} height={1792} priority className="h-11 w-auto rounded-md object-contain sm:h-12" />
          <span className="text-xl font-semibold tracking-tight">watch<span className="text-[var(--accent-text)]">party</span></span>
        </div>

        <div className="relative mt-20 max-w-xl pb-2 lg:mt-0 lg:pb-8">
          <p className="mb-5 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[.22em] text-[var(--accent-text)]"><span className="h-px w-8 bg-[var(--accent)]/80" /> A little closer, wherever you are</p>
          <h1 className="max-w-lg text-[clamp(2.7rem,6.1vw,5.25rem)] font-semibold leading-[.98] tracking-[-.065em]">Good stories are better <span className="font-serif font-normal italic text-[var(--accent-text)]">shared.</span></h1>
          <p className="mt-6 max-w-md text-sm leading-6 text-white/75 sm:text-base sm:leading-7">Settle in with your people. We’ll keep the movie night feeling like one room.</p>
          <p className="mt-8 text-xs text-white/65">One movie. Your favorite people.</p>
        </div>
        <p className="relative mt-8 text-[10px] uppercase tracking-[.18em] text-white/40 lg:mt-0">Make tonight a little more together</p>
      </section>

      <section className="flex min-h-[min(650px,calc(100svh-410px))] items-center justify-center bg-[radial-gradient(ellipse_at_50%_42%,rgba(243,240,235,.045),transparent_60%),#0c0e12] px-6 py-12 sm:px-10 lg:min-h-[100svh] lg:px-12 xl:px-16">
        <div className="w-full max-w-[400px]">
          <h2 className="text-3xl font-semibold tracking-[-.04em] sm:text-[2.6rem]">Sign in to WatchParty</h2>
          <p className="mt-3 text-sm leading-6 text-[#a5a7a6]">Enter your email and we’ll send you a secure magic link.</p>
          <div className="mt-8">
            <AuthForm nextPath={nextPath} initialError={errorMessage} />
          </div>
        </div>
      </section>
    </main>
  );
}

export default function AuthPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-[var(--background)] text-sm text-[var(--accent-text)]">
          Checking your sign-in…
        </main>
      }
    >
      <AuthContent searchParams={searchParams} />
    </Suspense>
  );
}
