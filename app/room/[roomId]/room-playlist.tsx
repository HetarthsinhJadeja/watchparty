"use client";

import { useState } from "react";
import { parseStoredRoomMedia } from "@/lib/room-media";

export type PlaylistItem = {
  id: string;
  room_id: string;
  media_id: string;
  kind: string;
  title: string;
  sort_order: number;
  created_at: string;
  metadata?: Record<string, unknown> | null;
};

type Props = {
  items: PlaylistItem[];
  currentMediaId: string | null;
  isLoading: boolean;
  isAdding: boolean;
  removingItemId: string | null;
  error: string;
  isHost: boolean;
  onAdd(url: string): Promise<boolean>;
  onRemove(itemId: string): void;
  onPlay(item: PlaylistItem): void;
};

function itemTitle(item: PlaylistItem) {
  if (item.title.trim()) return item.title;
  const media = parseStoredRoomMedia(item.media_id);
  if (media?.kind === "youtube") return `YouTube video (${media.id})`;
  if (media?.kind === "direct") return new URL(media.url).hostname;
  return "Untitled video";
}

export default function RoomPlaylist({
  items,
  currentMediaId,
  isLoading,
  isAdding,
  removingItemId,
  error,
  isHost,
  onAdd,
  onRemove,
  onPlay,
}: Props) {
  const [url, setUrl] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await onAdd(url)) setUrl("");
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-[var(--surface)] p-3.5 sm:p-4" aria-labelledby="room-playlist-heading">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 id="room-playlist-heading" className="text-base font-semibold text-[var(--foreground)]">Shared playlist</h2>
          <p className="mt-1 text-xs text-[#92949a]">{items.length} {items.length === 1 ? "video" : "videos"} in the queue</p>
        </div>
        <span aria-hidden="true" className="grid h-9 w-9 place-items-center rounded-full border border-white/10 text-[var(--accent-text)]">♫</span>
      </div>

      <form onSubmit={(event) => void submit(event)} className="mt-4 space-y-2">
        <label htmlFor="playlist-video-url" className="sr-only">YouTube or direct MP4/WebM URL</label>
        <input
          id="playlist-video-url"
          type="url"
          required
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="Add a YouTube or MP4/WebM link"
          aria-describedby="playlist-url-help"
          className="w-full rounded-xl border border-white/15 bg-[var(--background)] px-3 py-2.5 text-sm text-white outline-none placeholder:text-[#777980] focus:border-[var(--accent-focus)]/70 focus:ring-2 focus:ring-[var(--accent-focus)]/20"
        />
        <div className="flex items-center justify-between gap-3">
          <p id="playlist-url-help" className="text-xs text-[#85878b]">Supported links only; availability is not checked.</p>
          <button
            type="submit"
            disabled={isAdding || !url.trim()}
            className="shrink-0 rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-[var(--accent-foreground)] transition hover:bg-[var(--accent-hover)] disabled:cursor-wait disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            {isAdding ? "Adding…" : "Add video"}
          </button>
        </div>
      </form>

      {error && <p className="mt-3 rounded-lg border border-[var(--danger)]/20 bg-[var(--danger)]/[.06] px-3 py-2 text-xs leading-5 text-[var(--danger)]" role="alert">{error}</p>}

      {isLoading ? (
        <p className="mt-5 text-sm text-[#92949a]" role="status">Loading playlist…</p>
      ) : items.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-white/10 px-3 py-3 text-center text-sm text-[#92949a]">The queue is empty. Add a video to get movie night started.</p>
      ) : (
        <ol className="mt-4 max-h-80 space-y-2 overflow-y-auto pr-1" aria-label="Playlist queue">
          {items.map((item, index) => {
            const media = parseStoredRoomMedia(item.media_id);
            const isCurrent = item.media_id === currentMediaId;
            const mediaType = media?.kind === "youtube" ? "YouTube" : media?.kind === "direct" ? "Direct video" : "Unsupported source";
            return (
              <li key={item.id} aria-current={isCurrent ? "true" : undefined} className={`flex min-w-0 items-center gap-3 rounded-xl border p-3 transition-colors ${isCurrent ? "border-[var(--accent)]/35 bg-[var(--surface-raised)]" : "border-white/[.07] bg-[var(--surface-low)]"}`}>
                <span className="w-6 shrink-0 text-center font-mono text-xs text-[#85878b]" aria-label={`Queue position ${index + 1}`}>{index + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-[#e7e5de]" title={itemTitle(item)}>{itemTitle(item)}</p>
                  <p className="mt-1 text-xs text-[#85878b]">{isCurrent ? "Current video · " : ""}{mediaType}</p>
                </div>
                {isHost && media && (
                  <button
                    type="button"
                    onClick={() => onPlay(item)}
                    className="rounded-lg border border-[var(--accent)]/30 px-2.5 py-1.5 text-xs font-medium text-[var(--accent-text)] hover:bg-[var(--accent)]/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-focus)]"
                    aria-label={`Play ${itemTitle(item)} for everyone`}
                  >Play</button>
                )}
                {isHost && (
                  <button
                    type="button"
                    onClick={() => onRemove(item.id)}
                    disabled={removingItemId === item.id}
                    className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-[#c7c6c2] hover:border-[var(--danger)]/50 hover:text-[var(--danger)] disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-focus)]"
                    aria-label={`Remove ${itemTitle(item)} from playlist`}
                  >{removingItemId === item.id ? "Removing…" : "Remove"}</button>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
