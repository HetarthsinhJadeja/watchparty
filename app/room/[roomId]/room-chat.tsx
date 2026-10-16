"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

const MAX_MESSAGE_LENGTH = 500;
const REACTION_COOLDOWN_MS = 900;
const REACTION_LIFETIME_MS = 4000;
const reactions = ["❤️", "😂", "🔥", "😮", "👏", "👍"] as const;

type MessageRow = {
  id: string;
  room_id?: string;
  sender_user_id: string | null;
  sender_guest_id: string | null;
  message: string;
  created_at: string;
};

type RoomMessage = MessageRow & { senderName: string };
type FloatingReaction = { id: string; emoji: string };

function friendlyError(error: { code?: string; message?: string }) {
  if (error.code === "42501") {
    return "Supabase denied this message. Confirm you are still a member of this room.";
  }
  if (error.code === "23514") {
    return "Messages must contain text and be 500 characters or fewer.";
  }
  if (/fetch|network|timeout/i.test(error.message ?? "")) {
    return "Couldn't reach Supabase. Check your connection and try again.";
  }
  return "Your message could not be sent. Please try again.";
}

export default function RoomChat({
  roomId,
  userId,
  onFloatingReaction,
}: {
  roomId: string;
  userId: string;
  onFloatingReaction(reaction: FloatingReaction): void;
}) {
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [memberNames, setMemberNames] = useState<Record<string, string>>({});
  const [historyLoading, setHistoryLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [channelMessage, setChannelMessage] = useState("Connecting to room chat…");
  const [reactionMessage, setReactionMessage] = useState("");
  const listEndRef = useRef<HTMLDivElement>(null);
  const namesRef = useRef<Record<string, string>>({});
  const messageIds = useRef(new Set<string>());
  const reactionIds = useRef(new Set<string>());
  const reactionTimers = useRef(new Map<string, number>());
  const reactionCooldownTimer = useRef<number | null>(null);
  const reactionChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const displayNameFor = useCallback((row: Pick<MessageRow, "sender_user_id" | "sender_guest_id">) => {
    if (row.sender_user_id === userId) return "You";
    if (row.sender_user_id) return namesRef.current[`user:${row.sender_user_id}`] || "Room member";
    if (row.sender_guest_id) return namesRef.current[`guest:${row.sender_guest_id}`] || "Room member";
    return "Room member";
  }, [userId]);

  const addMessage = useCallback((row: MessageRow) => {
    if (!row.id || messageIds.current.has(row.id)) return;
    messageIds.current.add(row.id);
    setMessages((current) => [...current, { ...row, senderName: displayNameFor(row) }].slice(-100));
  }, [displayNameFor]);

  const addReaction = useCallback((reaction: FloatingReaction) => {
    if (!reaction.id || reactionIds.current.has(reaction.id) || !reactions.includes(reaction.emoji as (typeof reactions)[number])) return;
    reactionIds.current.add(reaction.id);
    onFloatingReaction(reaction);
    const timer = window.setTimeout(() => {
      reactionIds.current.delete(reaction.id);
      reactionTimers.current.delete(reaction.id);
    }, REACTION_LIFETIME_MS);
    reactionTimers.current.set(reaction.id, timer);
  }, [onFloatingReaction]);

  useEffect(() => {
    let active = true;
    let chatChannel: ReturnType<typeof supabase.channel> | null = null;
    let reactionChannel: ReturnType<typeof supabase.channel> | null = null;
    const timersToClear = reactionTimers.current;
    const reactionIdsToClear = reactionIds.current;

    async function loadHistory() {
      const [messageResult, memberResult] = await Promise.all([
        supabase
          .from("room_chat_messages")
          .select("id, sender_user_id, sender_guest_id, message, created_at")
          .eq("room_id", roomId)
          .order("created_at", { ascending: false })
          .limit(50),
        supabase
          .from("room_members")
          .select("user_id, guest_id, display_name")
          .eq("room_id", roomId),
      ]);

      if (!active) return;
      if (memberResult.error) {
        setErrorMessage("Chat is open, but participant names could not be loaded.");
      } else {
        const names: Record<string, string> = {};
        for (const member of memberResult.data ?? []) {
          const safeName = typeof member.display_name === "string" ? member.display_name.trim() : "";
          if (safeName && member.user_id) names[`user:${member.user_id}`] = safeName;
          if (safeName && member.guest_id) names[`guest:${member.guest_id}`] = safeName;
        }
        namesRef.current = names;
        setMemberNames(names);
      }

      if (messageResult.error) {
        setErrorMessage(friendlyError(messageResult.error));
      } else {
        const recent = (messageResult.data ?? []).reverse() as MessageRow[];
        const historyIds = new Set(recent.map((message) => message.id));
        for (const message of recent) messageIds.current.add(message.id);
        setMessages((current) => {
          const arrivedWhileLoading = current.filter((message) => !historyIds.has(message.id));
          return [...recent.map((message) => ({ ...message, senderName: displayNameFor(message) })), ...arrivedWhileLoading]
            .sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at))
            .slice(-100);
        });
      }
      setHistoryLoading(false);
    }

    void loadHistory().catch(() => {
      if (!active) return;
      setErrorMessage("Couldn't load recent chat. Check your connection and refresh the room.");
      setHistoryLoading(false);
    });

    chatChannel = supabase
      .channel(`room-chat-${roomId}`, { config: { private: true } })
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "room_chat_messages", filter: `room_id=eq.${roomId}` },
        (payload) => {
          if (!active) return;
          const row = payload.new as MessageRow;
          if (row.room_id === roomId) addMessage(row);
        },
      )
      .subscribe((status) => {
        if (!active) return;
        if (status === "SUBSCRIBED") setChannelMessage("Live chat connected");
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setChannelMessage("Live chat unavailable; messages can still be retried");
        if (status === "CLOSED") setChannelMessage("Live chat disconnected");
      });

    reactionChannel = supabase
      .channel(`room-reactions-${roomId}`, { config: { private: true, broadcast: { self: true, ack: true } } })
      .on("broadcast", { event: "reaction" }, ({ payload }) => {
        if (!active || !payload || typeof payload !== "object") return;
        const incoming = payload as { id?: unknown; emoji?: unknown };
        if (typeof incoming.id === "string" && typeof incoming.emoji === "string") {
          addReaction({ id: incoming.id, emoji: incoming.emoji });
        }
      })
      .subscribe((status) => {
        if (!active) return;
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setReactionMessage("Reactions could not connect. Check the room Realtime policies.");
        } else if (status === "SUBSCRIBED") {
          setReactionMessage("");
        }
      });
    reactionChannelRef.current = reactionChannel;

    return () => {
      active = false;
      if (chatChannel) void supabase.removeChannel(chatChannel);
      if (reactionChannel) void supabase.removeChannel(reactionChannel);
      reactionChannelRef.current = null;
      for (const timer of timersToClear.values()) window.clearTimeout(timer);
      timersToClear.clear();
      reactionIdsToClear.clear();
      if (reactionCooldownTimer.current !== null) window.clearTimeout(reactionCooldownTimer.current);
    };
  }, [addMessage, addReaction, displayNameFor, roomId]);

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  async function sendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text) {
      setErrorMessage("Write a message before sending.");
      return;
    }
    if (text.length > MAX_MESSAGE_LENGTH) {
      setErrorMessage("Messages can be up to 500 characters.");
      return;
    }

    setSending(true);
    setErrorMessage("");
    try {
      const { data, error } = await supabase
        .from("room_chat_messages")
        .insert({ room_id: roomId, sender_user_id: userId, sender_guest_id: null, message: text })
        .select("id, sender_user_id, sender_guest_id, message, created_at")
        .single();

      if (error) {
        setErrorMessage(friendlyError(error));
        return;
      }
      addMessage(data as MessageRow);
      setDraft("");
    } catch {
      setErrorMessage("Couldn't reach Supabase. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  }

  async function sendReaction(emoji: (typeof reactions)[number]) {
    if (reactionCooldownTimer.current !== null) {
      setReactionMessage("Give reactions a moment before sending another.");
      return;
    }
    reactionCooldownTimer.current = window.setTimeout(() => {
      reactionCooldownTimer.current = null;
    }, REACTION_COOLDOWN_MS);
    setReactionMessage("");
    const reaction = { id: crypto.randomUUID(), emoji };
    const channel = reactionChannelRef.current;
    if (!channel) {
      setReactionMessage("Reactions are still connecting. Please try again in a moment.");
      return;
    }
    try {
      const result = await channel.send({ type: "broadcast", event: "reaction", payload: reaction });
      if (result !== "ok") {
        setReactionMessage("That reaction did not send. Check your connection and try again.");
        return;
      }
    } catch {
      setReactionMessage("That reaction did not send. Check your connection and try again.");
      return;
    }
    addReaction(reaction);
  }

  return (
    <aside className="flex h-[480px] min-h-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-[var(--surface)] lg:h-[min(68vh,680px)] lg:min-h-[480px]" aria-label="Room chat and reactions">
      <div className="border-b border-white/10 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-[var(--foreground)]">Room chat</h2>
          <span className="text-[11px] text-[#8d9094]" role="status">{channelMessage}</span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2" role="group" aria-label="Send a quick reaction">
          {reactions.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => void sendReaction(emoji)}
              aria-label={`Send ${emoji} reaction`}
              className="grid h-9 min-w-9 place-items-center rounded-lg border border-white/10 bg-white/[.03] text-base transition hover:border-[var(--accent)]/50 hover:bg-white/[.08] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-focus)]"
            >
              {emoji}
            </button>
          ))}
        </div>
        {reactionMessage && <p className="mt-2 text-xs text-[var(--danger)]" role="status">{reactionMessage}</p>}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3" role="log" aria-label="Room messages" aria-live="polite" aria-relevant="additions text">
        {historyLoading ? (
          <p className="py-5 text-center text-sm text-[#9b9da1]" role="status">Loading recent messages…</p>
        ) : messages.length === 0 ? (
          <p className="py-5 text-center text-sm leading-6 text-[#85878b]">No messages yet. Say hello to your room.</p>
        ) : (
          <ol className="space-y-4">
            {messages.map((message) => (
              <li key={message.id} className={`min-w-0 rounded-xl px-3 py-2 ${message.senderName === "You" ? "border border-[var(--accent)]/15 bg-[var(--accent)]/[.06]" : ""}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-xs font-medium text-[var(--accent-text)]">{message.senderName}</span>
                  <time className="shrink-0 text-[10px] text-[#777a80]" dateTime={message.created_at}>
                    {new Date(message.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                  </time>
                </div>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-5 text-[#e4e2dc]">{message.message}</p>
              </li>
            ))}
          </ol>
        )}
        <div ref={listEndRef} />
      </div>

      <form onSubmit={sendMessage} className="border-t border-white/10 p-3">
        <label htmlFor={`room-message-${roomId}`} className="sr-only">Message your room</label>
        <textarea
          id={`room-message-${roomId}`}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            if (errorMessage) setErrorMessage("");
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          maxLength={MAX_MESSAGE_LENGTH}
          rows={2}
          placeholder="Write a message…"
          className="w-full resize-none rounded-xl border border-white/10 bg-[var(--background)] px-3 py-2.5 text-sm leading-5 text-white outline-none placeholder:text-[#70737a] focus:border-[var(--accent-focus)]/60 focus:ring-2 focus:ring-[var(--accent-focus)]/15"
          aria-describedby={`room-message-help-${roomId}`}
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <span id={`room-message-help-${roomId}`} className="text-[10px] text-[#7c7e83]">Enter to send · Shift+Enter for a new line · {draft.length}/{MAX_MESSAGE_LENGTH}</span>
          <button type="submit" disabled={sending || !draft.trim()} className="shrink-0 rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-[var(--accent-foreground)] transition hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
        {errorMessage && <p className="mt-2 text-xs leading-5 text-[var(--danger)]" role="alert">{errorMessage}</p>}
        {Object.keys(memberNames).length === 0 && !historyLoading && <span className="sr-only">Participant names are not available yet.</span>}
      </form>
    </aside>
  );
}
