"use client";

import { useState } from "react";

export type RoomMember = {
  id: string;
  user_id: string | null;
  guest_id: string | null;
  role: "host" | "member";
  display_name: string | null;
  joined_at: string;
};

type Props = {
  members: RoomMember[];
  onlineUserIds: ReadonlySet<string>;
  presenceStatus: "connecting" | "retrying" | "available" | "unavailable";
  hostUserId: string | null;
  currentUserId: string | null;
  isHost: boolean;
  isLoading: boolean;
  transferPending: boolean;
  message: string;
  onTransfer(targetUserId: string): Promise<boolean>;
};

function displayName(member: RoomMember) {
  const name = member.display_name?.trim();
  if (name) return name;
  return member.user_id ? "Room member" : "Guest member";
}

function memberInitials(member: RoomMember) {
  const words = displayName(member).split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((word) => word[0]?.toUpperCase()).join("");
}

export default function RoomMembersPanel({
  members,
  onlineUserIds,
  presenceStatus,
  hostUserId,
  currentUserId,
  isHost,
  isLoading,
  transferPending,
  message,
  onTransfer,
}: Props) {
  const [selectedTargetId, setSelectedTargetId] = useState("");
  const host = members.find((member) => member.user_id === hostUserId);
  const hostName = host ? displayName(host) : "Room host";
  const availableTargets = members.filter((member) => member.user_id && member.user_id !== hostUserId);

  async function confirmTransfer() {
    const target = availableTargets.find((member) => member.user_id === selectedTargetId);
    if (!target?.user_id) return;
    const name = displayName(target);
    if (!window.confirm(`Transfer host privileges to ${name}? You will become a room member.`)) return;
    if (await onTransfer(target.user_id)) setSelectedTargetId("");
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-[var(--surface)] p-3.5 sm:p-4" aria-labelledby="room-members-heading">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="room-members-heading" className="text-base font-semibold text-[var(--foreground)]">Room members</h2>
          <p className="mt-1 text-xs text-[#92949a]">Current host: <span className="font-medium text-[var(--accent-text)]">{hostName}{hostUserId === currentUserId ? " (you)" : ""}</span></p>
          <p className="mt-1 text-xs text-[#85878b]" role="status">
            {presenceStatus === "connecting" ? "Checking live presence…" : presenceStatus === "retrying" ? "Realtime is reconnecting; online status is temporarily unavailable." : presenceStatus === "available" ? "Online status updates live; membership can persist while offline." : "Live presence is unavailable; member rows show room membership only."}
          </p>
        </div>
        <span className="rounded-full border border-white/10 px-2.5 py-1 text-xs text-[#b8b9b5]">{members.length}</span>
      </div>

      {isLoading ? (
        <p className="mt-4 text-sm text-[#92949a]" role="status">Loading room members…</p>
      ) : members.length === 0 ? (
        <p className="mt-4 text-sm text-[#92949a]">Member information is not available.</p>
      ) : (
        <ul className="mt-3 space-y-1.5" aria-label="Room members list">
          {members.map((member) => {
            const isCurrentHost = member.user_id === hostUserId;
            const isCurrentUser = member.user_id === currentUserId;
            return (
              <li key={member.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/[.07] bg-[var(--surface-low)] px-3 py-2">
                <span className="flex min-w-0 items-center gap-2.5">
                  <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/10 bg-[var(--surface-subtle)] text-[10px] font-semibold tracking-wide text-[#d7d8dc]">{memberInitials(member)}</span>
                  <span className="min-w-0 truncate text-sm text-[#e7e5de]">{displayName(member)}{isCurrentUser ? " · You" : ""}</span>
                </span>
                {isCurrentHost ? (
                  <span className="flex shrink-0 items-center gap-2">
                    <span className={`text-[11px] ${presenceStatus === "available" && member.user_id && onlineUserIds.has(member.user_id) ? "text-[var(--accent-text)]" : "text-[#85878b]"}`}>
                      {presenceStatus === "connecting" ? "Checking…" : presenceStatus === "retrying" ? "Reconnecting…" : presenceStatus === "unavailable" ? "Unknown" : member.user_id && onlineUserIds.has(member.user_id) ? "Online" : "Offline"}
                    </span>
                    <span className="rounded-full bg-[var(--accent)]/10 px-2.5 py-1 text-[11px] font-semibold text-[var(--accent-text)]">Host</span>
                  </span>
                ) : (
                  <span className="flex shrink-0 items-center gap-2">
                    <span className={`text-[11px] ${presenceStatus === "available" && member.user_id && onlineUserIds.has(member.user_id) ? "text-[var(--accent-text)]" : "text-[#85878b]"}`}>
                      {presenceStatus === "connecting" ? "Checking…" : presenceStatus === "retrying" ? "Reconnecting…" : presenceStatus === "unavailable" ? "Unknown" : member.user_id && onlineUserIds.has(member.user_id) ? "Online" : "Offline"}
                    </span>
                    <span className="text-[11px] text-[#85878b]">Member</span>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {isHost && availableTargets.length > 0 && (
        <div className="mt-4 border-t border-white/10 pt-4">
          <label htmlFor="new-room-host" className="mb-2 block text-xs font-medium text-[#c4c5c6]">Transfer host to</label>
          <div className="flex gap-2">
            <select
              id="new-room-host"
              value={availableTargets.some((member) => member.user_id === selectedTargetId) ? selectedTargetId : ""}
              onChange={(event) => setSelectedTargetId(event.target.value)}
              disabled={transferPending}
              className="min-w-0 flex-1 rounded-lg border border-white/15 bg-[var(--background)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--accent-focus)]/70 focus:ring-2 focus:ring-[var(--accent-focus)]/20 disabled:opacity-50"
            >
              <option value="">Choose a member</option>
              {availableTargets.map((member) => (
                <option key={member.id} value={member.user_id ?? ""}>{displayName(member)}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void confirmTransfer()}
              disabled={!selectedTargetId || transferPending}
              className="shrink-0 rounded-lg border border-[var(--accent)]/30 px-3 py-2 text-xs font-semibold text-[var(--accent-text)] transition hover:bg-[var(--accent)]/10 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-focus)]"
            >{transferPending ? "Transferring…" : "Transfer"}</button>
          </div>
          <p className="mt-2 text-xs leading-5 text-[#85878b]">Transfer is immediate. Your playback and playlist controls will be removed.</p>
        </div>
      )}

      {message && <p className="mt-3 text-xs leading-5 text-[var(--danger)]" role="alert">{message}</p>}
    </section>
  );
}
