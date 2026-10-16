export type PlaylistDeleteRow = {
  id?: unknown;
  room_id?: unknown;
};

export function applyPlaylistDelete<T extends { id: string; room_id: string }>(
  items: T[],
  currentRoomId: string,
  deletedRow: PlaylistDeleteRow,
): T[] {
  if (typeof deletedRow.id !== "string") return items;
  if (typeof deletedRow.room_id === "string" && deletedRow.room_id !== currentRoomId) return items;
  return items.filter((item) => item.id !== deletedRow.id);
}
