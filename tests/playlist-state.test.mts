import assert from "node:assert/strict";
import test from "node:test";
import { applyPlaylistDelete } from "../lib/playlist-state.mts";

const items = [
  { id: "item-a", room_id: "room-a", title: "First" },
  { id: "item-b", room_id: "room-a", title: "Second" },
];

test("playlist DELETE event removes the matching item immediately", () => {
  assert.deepEqual(applyPlaylistDelete(items, "room-a", { id: "item-a", room_id: "room-a" }), [items[1]]);
});

test("playlist DELETE event from another room does not change this queue", () => {
  assert.deepEqual(applyPlaylistDelete(items, "room-a", { id: "item-a", room_id: "room-b" }), items);
});

test("playlist DELETE event with only a known item ID remains actionable", () => {
  assert.deepEqual(applyPlaylistDelete(items, "room-a", { id: "item-b" }), [items[0]]);
  assert.deepEqual(applyPlaylistDelete(items, "room-a", {}), items);
});
