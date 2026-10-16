const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

export function isYouTubeVideoId(value: unknown): value is string {
  return typeof value === "string" && YOUTUBE_ID_PATTERN.test(value);
}

export function extractYouTubeTitle(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || !("title" in payload)) return null;
  const title = payload.title;
  return typeof title === "string" && title.trim() ? title.trim() : null;
}

export function youtubeTitleFallback(videoId: string) {
  return `YouTube video (${videoId})`;
}

export type RoomMedia =
  | { kind: "youtube"; id: string; storedValue: string }
  | { kind: "direct"; url: string; storedValue: string };

export function parseRoomMediaUrl(input: string): RoomMedia | null {
  let url: URL;

  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }

  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
    return null;
  }

  const hostname = url.hostname.toLowerCase();
  const isYouTubeHost = ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(hostname);

  if (isYouTubeHost) {
    let id = "";
    if (hostname === "youtu.be") {
      const pathSegments = url.pathname.split("/").filter(Boolean);
      id = pathSegments.length === 1 ? pathSegments[0] : "";
    } else if (url.pathname === "/watch") {
      id = url.searchParams.get("v") ?? "";
    } else {
      const match = url.pathname.match(/^\/(?:shorts|embed)\/([^/]+)\/?$/);
      id = match?.[1] ?? "";
    }

    if (!isYouTubeVideoId(id)) return null;
    return { kind: "youtube", id, storedValue: `youtube:${id}` };
  }

  if (!/\.(?:mp4|webm)$/i.test(url.pathname)) return null;
  return { kind: "direct", url: url.toString(), storedValue: url.toString() };
}

export function resolveStoredRoomMedia(value: string | null, fallbackUrl: string): RoomMedia {
  if (!value) {
    return { kind: "direct", url: fallbackUrl, storedValue: fallbackUrl };
  }

  return parseStoredRoomMedia(value)
    ?? { kind: "direct", url: fallbackUrl, storedValue: fallbackUrl };
}

export function parseStoredRoomMedia(value: string): RoomMedia | null {
  if (value.startsWith("youtube:")) {
    const id = value.slice("youtube:".length);
    if (isYouTubeVideoId(id)) {
      return { kind: "youtube", id, storedValue: value };
    }
    return null;
  }

  const parsed = parseRoomMediaUrl(value);
  return parsed?.kind === "direct" ? parsed : null;
}
