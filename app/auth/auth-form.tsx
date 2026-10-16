"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

type FeedbackKind = "idle" | "success" | "error";

export default function AuthForm({
  nextPath,
  initialError,
}: {
  nextPath: string;
  initialError: string;
}) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(initialError);
  const [feedbackKind, setFeedbackKind] = useState<FeedbackKind>(initialError ? "error" : "idle");

  function showFeedback(nextMessage: string, kind: FeedbackKind) {
    setMessage(nextMessage);
    setFeedbackKind(kind);
  }

  async function requestSignIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanedEmail = email.trim();
    if (!cleanedEmail) {
      showFeedback("Enter your email address to receive a sign-in link.", "error");
      return;
    }

    setLoading(true);
    showFeedback("", "idle");
    try {
      const callbackUrl = new URL("/auth/callback", window.location.origin);
      callbackUrl.searchParams.set("next", nextPath);
      const { error } = await supabase.auth.signInWithOtp({
        email: cleanedEmail,
        options: { emailRedirectTo: callbackUrl.toString() },
      });

      if (error) {
        showFeedback(
          error.message.toLowerCase().includes("rate limit")
            ? "Too many sign-in emails were requested. Wait a little and try again."
            : "Supabase couldn't send the sign-in link. Check the email settings and try again.",
          "error",
        );
        return;
      }

      showFeedback("Check your email. After you confirm the link, we’ll return you to your destination.", "success");
    } catch {
      showFeedback("Couldn't reach Supabase. Check your internet connection and try again.", "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={requestSignIn} className="space-y-3">
      <label htmlFor="email" className="block text-sm font-medium text-[#e4e2dc]">Email address</label>
      <div className="group flex items-center gap-3 rounded-xl border border-white/[.13] bg-[var(--surface-raised)] px-4 transition focus-within:border-[var(--accent-focus)]/70 focus-within:ring-2 focus-within:ring-[var(--accent-focus)]/15">
        <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-[#777d7f] transition group-focus-within:text-[var(--accent-text)]" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="2.5" y="4" width="15" height="12" rx="2" /><path d="m3.5 5 6.5 5 6.5-5" /></svg>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            if (feedbackKind === "error") showFeedback("", "idle");
          }}
          placeholder="you@example.com"
          className="min-w-0 flex-1 bg-transparent py-3.5 text-sm text-white outline-none placeholder:text-[#696e72]"
          aria-describedby={message ? "auth-feedback" : undefined}
        />
      </div>
      <button
        type="submit"
        disabled={loading}
        aria-busy={loading}
        className="mt-3 flex w-full items-center justify-center gap-2.5 rounded-xl bg-[var(--accent)] px-4 py-3.5 text-sm font-semibold text-[var(--accent-foreground)] shadow-[0_8px_28px_rgba(121,201,242,.12)] transition hover:bg-[var(--accent-hover)] active:translate-y-px disabled:cursor-wait disabled:opacity-70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-white"
      >
        {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--accent-foreground)]/30 border-t-[var(--accent-foreground)] motion-reduce:animate-none" aria-hidden="true" />}
        {loading ? "Sending magic link…" : "Send magic link"}
      </button>
      {message && (
        <p
          id="auth-feedback"
          className={`pt-1 text-xs leading-5 ${feedbackKind === "error" ? "text-[var(--danger)]" : "text-[var(--accent-text)]"}`}
          role={feedbackKind === "error" ? "alert" : "status"}
          aria-live="polite"
        >
          {message}
        </p>
      )}
    </form>
  );
}
