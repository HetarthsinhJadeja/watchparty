export type PlaybackAction = "play" | "pause" | "seek";
export type PlaybackActionState = {
  is_playing: boolean;
  position_ms: number;
  video_id: string | null;
};

export function getTransportCorrectionCommand(
  authoritativeIsPlaying: boolean,
  observedIsPlaying: boolean | null,
): "play" | "pause" | null {
  if (observedIsPlaying === null || observedIsPlaying === authoritativeIsPlaying) return null;
  return authoritativeIsPlaying ? "play" : "pause";
}

export function isMatchingAppliedTransportState(
  authoritativeIsPlaying: boolean,
  observedIsPlaying: boolean,
) {
  return authoritativeIsPlaying === observedIsPlaying;
}

export type MetricSummary = {
  sampleCount: number;
  medianMs: number | null;
  p95Ms: number | null;
  maximumMs: number | null;
};

export function logPlaybackMetric(stage: string, details: Record<string, unknown>) {
  if (process.env.NODE_ENV !== "development") return;
  console.info("[WatchParty playback metric]", { stage, ...details });
}

export function createPlaybackEventId(roomId: string, stateVersion: number) {
  return `${roomId}:${stateVersion}`;
}

export function isPlaybackVersionNewer(currentVersion: number, incomingVersion: number) {
  return Number.isFinite(currentVersion) && Number.isFinite(incomingVersion) && incomingVersion > currentVersion;
}

export function isPlaybackVersionAtLeast(currentVersion: number, incomingVersion: number) {
  return Number.isFinite(currentVersion) && Number.isFinite(incomingVersion) && incomingVersion >= currentVersion;
}

export function classifyPlaybackAction(previous: PlaybackActionState | null, next: PlaybackActionState): PlaybackAction | null {
  if (!previous || previous.video_id !== next.video_id) return null;
  if (previous.is_playing !== next.is_playing) return next.is_playing ? "play" : "pause";
  if (previous.position_ms !== next.position_ms) return "seek";
  return null;
}

export function estimatePropagationLatencyMs(
  actionTimestampMs: number,
  receivedTimestampMs: number,
  clocksComparable: boolean,
) {
  if (!clocksComparable || !Number.isFinite(actionTimestampMs) || !Number.isFinite(receivedTimestampMs)) return null;
  const latencyMs = receivedTimestampMs - actionTimestampMs;
  return latencyMs >= 0 ? latencyMs : null;
}

export function measurePlaybackDriftMs(
  expectedPositionSeconds: number,
  actualPositionSeconds: number,
  clocksComparable: boolean,
) {
  if (!clocksComparable || !Number.isFinite(expectedPositionSeconds) || !Number.isFinite(actualPositionSeconds)) return null;
  return Math.round(Math.abs(actualPositionSeconds - expectedPositionSeconds) * 1000);
}

export function summarizeMeasurements(samples: number[]): MetricSummary {
  const sorted = samples.filter((sample) => Number.isFinite(sample) && sample >= 0).sort((left, right) => left - right);
  if (sorted.length === 0) return { sampleCount: 0, medianMs: null, p95Ms: null, maximumMs: null };

  const middle = Math.floor(sorted.length / 2);
  const medianMs = sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];

  return {
    sampleCount: sorted.length,
    medianMs,
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
    maximumMs: sorted[sorted.length - 1],
  };
}
