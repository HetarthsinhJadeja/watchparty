"use client";

import { useState } from "react";

export type PollOption = {
  id: string;
  label: string;
  sort_order: number;
  votes: number;
};

export type RoomPoll = {
  id: string;
  question: string;
  status: "active" | "closed";
  created_at: string;
  options: PollOption[];
  totalVotes: number;
  currentUserOptionId: string | null;
};

type Props = {
  polls: RoomPoll[];
  currentUserId: string | null;
  isHost: boolean;
  isLoading: boolean;
  isCreating: boolean;
  votingPollId: string | null;
  error: string;
  message: string;
  onCreate(question: string, options: string[]): Promise<boolean>;
  onVote(pollId: string, optionId: string): Promise<boolean>;
};

const MAX_OPTIONS = 6;

export default function RoomPolls({
  polls,
  currentUserId,
  isHost,
  isLoading,
  isCreating,
  votingPollId,
  error,
  message,
  onCreate,
  onVote,
}: Props) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedOptions = options.map((option) => option.trim()).filter(Boolean);
    if (await onCreate(question.trim(), normalizedOptions)) {
      setQuestion("");
      setOptions(["", ""]);
    }
  }

  function updateOption(index: number, value: string) {
    setOptions((current) => current.map((option, itemIndex) => itemIndex === index ? value : option));
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-[var(--surface)] p-3.5 sm:p-4" aria-labelledby="room-polls-heading">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 id="room-polls-heading" className="text-base font-semibold text-[var(--foreground)]">Group polls</h2>
          <p className="mt-1 text-xs text-[#92949a]">Vote together while you watch.</p>
        </div>
        <span aria-hidden="true" className="grid h-9 w-9 place-items-center rounded-full border border-white/10 text-[var(--accent-text)]">◉</span>
      </div>

      {isHost && (
        <form onSubmit={(event) => void submit(event)} className="mt-4 space-y-3 rounded-xl border border-white/[.07] bg-[var(--surface-low)] p-3 sm:p-4">
          <label htmlFor="poll-question" className="block text-xs font-medium text-[#c4c5c6]">Ask your room</label>
          <input
            id="poll-question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            maxLength={200}
            required
            placeholder="What should we watch next?"
            className="w-full rounded-lg border border-white/15 bg-[var(--background)] px-3 py-2.5 text-sm text-white outline-none placeholder:text-[#777980] focus:border-[var(--accent-focus)]/70 focus:ring-2 focus:ring-[var(--accent-focus)]/20"
          />
          <div className="space-y-2">
            {options.map((option, index) => (
              <div key={index} className="flex gap-2">
                <label htmlFor={`poll-option-${index}`} className="sr-only">Option {index + 1}</label>
                <input
                  id={`poll-option-${index}`}
                  value={option}
                  onChange={(event) => updateOption(index, event.target.value)}
                  maxLength={100}
                  required
                  placeholder={`Option ${index + 1}`}
                  className="min-w-0 flex-1 rounded-lg border border-white/15 bg-[var(--background)] px-3 py-2 text-sm text-white outline-none placeholder:text-[#777980] focus:border-[var(--accent-focus)]/70 focus:ring-2 focus:ring-[var(--accent-focus)]/20"
                />
                {options.length > 2 && (
                  <button
                    type="button"
                    onClick={() => setOptions((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                    className="rounded-lg border border-white/10 px-3 text-xs text-[#b8b9b5] hover:border-[var(--danger)]/50 hover:text-[var(--danger)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-focus)]"
                    aria-label={`Remove option ${index + 1}`}
                  >Remove</button>
                )}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setOptions((current) => current.length < MAX_OPTIONS ? [...current, ""] : current)}
              disabled={options.length >= MAX_OPTIONS}
              className="rounded-lg border border-white/10 px-3 py-2 text-xs text-[#c4c5c6] hover:bg-white/5 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-focus)]"
            >Add option</button>
            <button
              type="submit"
              disabled={isCreating || !question.trim() || options.some((option) => !option.trim())}
              className="rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-[var(--accent-foreground)] transition hover:bg-[var(--accent-hover)] disabled:cursor-wait disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >{isCreating ? "Creating poll…" : "Create poll"}</button>
          </div>
        </form>
      )}

      {error && <p className="mt-3 rounded-lg border border-[var(--danger)]/20 bg-[var(--danger)]/[.06] px-3 py-2 text-xs leading-5 text-[var(--danger)]" role="alert">{error}</p>}
      {message && <p className="mt-3 text-xs text-[var(--accent-text)]" role="status">{message}</p>}

      {isLoading ? (
        <p className="mt-5 text-sm text-[#92949a]" role="status">Loading polls…</p>
      ) : polls.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-white/10 px-3 py-3 text-center text-sm text-[#92949a]">No polls yet. {isHost ? "Create one for the room." : "The host can start one."}</p>
      ) : (
        <ul className="mt-4 space-y-3" aria-label="Room polls">
          {polls.map((poll) => {
            const hasVoted = poll.currentUserOptionId !== null;
            return (
              <li key={poll.id} className="rounded-xl border border-white/[.07] bg-[var(--surface-low)] p-3 sm:p-4">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-sm font-medium leading-5 text-[var(--foreground)]">{poll.question}</h3>
                  <span className="shrink-0 rounded-full border border-white/10 px-2 py-1 text-[10px] text-[#a5a7aa]">{poll.status === "active" ? "Active" : "Closed"}</span>
                </div>
                <ul className="mt-3 space-y-2" aria-label={`Answer options for ${poll.question}`}>
                  {poll.options.map((option) => {
                    const percentage = poll.totalVotes ? Math.round(option.votes / poll.totalVotes * 100) : 0;
                    const isCurrentUsersVote = poll.currentUserOptionId === option.id;
                    return (
                      <li key={option.id}>
                        <div className={`relative overflow-hidden rounded-lg border ${isCurrentUsersVote ? "border-[var(--accent)]/45 bg-[var(--surface-raised)]" : "border-white/10 bg-[var(--background)]"}`}>
                          {(hasVoted || poll.status === "closed") && (
                            <div className="absolute inset-y-0 left-0 bg-[var(--accent)]/10" style={{ width: `${percentage}%` }} aria-hidden="true" />
                          )}
                          <div className="relative flex items-center justify-between gap-2 px-3 py-2.5">
                            <span className="min-w-0 flex-1 truncate text-sm text-[#e7e5de]">{option.label}</span>
                            {hasVoted || poll.status === "closed" ? (
                              <span className="flex shrink-0 items-center gap-2 text-xs text-[#c4c5c6]">
                                {isCurrentUsersVote && <span className="rounded-full bg-[var(--accent)]/12 px-2 py-0.5 font-medium text-[var(--accent-text)]">Your vote</span>}
                                <span>{option.votes} · {percentage}%</span>
                              </span>
                            ) : currentUserId ? (
                              <button
                                type="button"
                                onClick={() => void onVote(poll.id, option.id)}
                                disabled={votingPollId === poll.id}
                                className="shrink-0 rounded-md border border-[var(--accent)]/30 px-2.5 py-1.5 text-xs font-medium text-[var(--accent-text)] hover:bg-[var(--accent)]/10 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-focus)]"
                              >{votingPollId === poll.id ? "Voting…" : "Vote"}</button>
                            ) : <span className="text-xs text-[#85878b]">Sign in to vote</span>}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-2 text-[11px] text-[#85878b]">
                  {hasVoted ? "Your vote is in · " : ""}{poll.totalVotes} {poll.totalVotes === 1 ? "vote" : "votes"}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
