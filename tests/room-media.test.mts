import assert from "node:assert/strict";
import test from "node:test";
import { extractYouTubeTitle, parseRoomMediaUrl, parseStoredRoomMedia, youtubeTitleFallback } from "../lib/room-media.ts";

test("playlist media accepts supported YouTube and direct video links", () => {
  assert.deepEqual(parseRoomMediaUrl("https://youtu.be/abcdefghijk"), {
    kind: "youtube",
    id: "abcdefghijk",
    storedValue: "youtube:abcdefghijk",
  });
  assert.equal(parseRoomMediaUrl("https://media.example/movie.webm")?.kind, "direct");
});

test("YouTube ID extraction handles every supported URL form", () => {
  const urls = [
    "https://www.youtube.com/watch?v=abcdefghijk&list=playlist",
    "https://youtube.com/embed/abcdefghijk",
    "https://m.youtube.com/shorts/abcdefghijk",
    "https://youtu.be/abcdefghijk?t=30",
  ];
  for (const url of urls) {
    const media = parseRoomMediaUrl(url);
    assert.equal(media?.kind === "youtube" ? media.id : null, "abcdefghijk");
  }
});

test("YouTube oEmbed titles are trimmed and unusable responses get a useful fallback", () => {
  assert.equal(extractYouTubeTitle({ title: "  A Real Video Title  " }), "A Real Video Title");
  assert.equal(extractYouTubeTitle({ title: "  " }), null);
  assert.equal(extractYouTubeTitle(null), null);
  assert.equal(youtubeTitleFallback("abcdefghijk"), "YouTube video (abcdefghijk)");
});

test("playlist media rejects unsupported or malformed links", () => {
  assert.equal(parseRoomMediaUrl("https://youtube.com/watch?v=too-short"), null);
  assert.equal(parseRoomMediaUrl("https://youtube.com.evil.example/watch?v=abcdefghijk"), null);
  assert.equal(parseRoomMediaUrl("https://media.example/movie.mp4.exe"), null);
  assert.equal(parseRoomMediaUrl("javascript:alert(1)"), null);
});

test("stored playlist media accepts the existing playback encoding", () => {
  assert.deepEqual(parseStoredRoomMedia("youtube:abcdefghijk"), {
    kind: "youtube",
    id: "abcdefghijk",
    storedValue: "youtube:abcdefghijk",
  });
  assert.equal(parseStoredRoomMedia("https://media.example/movie.mp4")?.kind, "direct");
  assert.equal(parseStoredRoomMedia("youtube:invalid"), null);
});
