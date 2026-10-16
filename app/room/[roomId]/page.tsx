import { Suspense } from "react";
import RoomClient from "./room-client";

async function RoomContent({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = await params;
  return <RoomClient roomId={roomId} />;
}

export default function RoomPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-[var(--background)] text-sm text-[var(--accent-text)]">
          Loading your room…
        </main>
      }
    >
      <RoomContent params={params} />
    </Suspense>
  );
}
