import { extractYouTubeTitle, isYouTubeVideoId } from "@/lib/room-media";

export async function GET(request: Request) {
  const videoId = new URL(request.url).searchParams.get("videoId");
  if (!isYouTubeVideoId(videoId)) {
    return Response.json({ error: "Invalid YouTube video ID." }, { status: 400 });
  }

  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(videoUrl)}&format=json`;

  try {
    const response = await fetch(endpoint, {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      return Response.json(
        { error: response.status === 404 ? "Video unavailable." : "Title lookup failed." },
        { status: response.status === 404 ? 404 : 502 },
      );
    }

    const title = extractYouTubeTitle(await response.json());
    if (!title) return Response.json({ error: "YouTube returned no title." }, { status: 502 });
    return Response.json({ title });
  } catch {
    return Response.json({ error: "Title lookup failed." }, { status: 502 });
  }
}
