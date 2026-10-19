import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyPlaybackAction,
  createPlaybackEventId,
  estimatePropagationLatencyMs,
  getTransportCorrectionCommand,
  isPlaybackVersionAtLeast,
  isPlaybackVersionNewer,
  isMatchingAppliedTransportState,
  measurePlaybackDriftMs,
  summarizeMeasurements,
} from "../lib/playback-metrics.ts";

test("playback changes distinguish controls from media changes", () => {
  const current = { is_playing: false, position_ms: 1000, video_id: "video-a" };
  assert.equal(classifyPlaybackAction(current, { ...current, is_playing: true }), "play");
  assert.equal(classifyPlaybackAction({ ...current, is_playing: true }, current), "pause");
  assert.equal(classifyPlaybackAction(current, { ...current, position_ms: 2000 }), "seek");
  assert.equal(classifyPlaybackAction(current, { ...current, video_id: "video-b" }), null);
  assert.equal(classifyPlaybackAction(null, current), null);
});

test("play then pause remains a newer authoritative pause", () => {
  const initial = { is_playing: false, position_ms: 1000, video_id: "video-a" };
  const play = { ...initial, is_playing: true };
  const pause = { ...play, is_playing: false };
  assert.equal(classifyPlaybackAction(initial, play), "play");
  assert.equal(classifyPlaybackAction(play, pause), "pause");
  assert.equal(isPlaybackVersionNewer(4, 5), true);
  assert.equal(isPlaybackVersionNewer(5, 4), false);
});

test("duplicate and stale Realtime versions are ignored while latest snapshots can reconcile", () => {
  assert.equal(isPlaybackVersionNewer(8, 8), false);
  assert.equal(isPlaybackVersionNewer(9, 8), false);
  assert.equal(isPlaybackVersionNewer(8, 9), true);
  assert.equal(isPlaybackVersionAtLeast(8, 9), true);
  assert.equal(isPlaybackVersionAtLeast(9, 8), false);
});

test("late-join and reconnect snapshots accept authoritative newer state only", () => {
  const viewerVersion = 3;
  const latestHostPauseVersion = 7;
  const stalePlayVersion = 6;
  assert.equal(isPlaybackVersionAtLeast(viewerVersion, latestHostPauseVersion), true);
  assert.equal(isPlaybackVersionAtLeast(latestHostPauseVersion, stalePlayVersion), false);
  assert.equal(isPlaybackVersionAtLeast(latestHostPauseVersion, latestHostPauseVersion), true);
});

test("viewer transport events are corrected to host authority without seeking", () => {
  assert.equal(getTransportCorrectionCommand(true, false), "play");
  assert.equal(getTransportCorrectionCommand(false, true), "pause");
  assert.equal(getTransportCorrectionCommand(true, true), null);
  assert.equal(getTransportCorrectionCommand(false, false), null);
  assert.equal(getTransportCorrectionCommand(true, null), null);
});

test("suppression ignores matching player feedback but allows a conflicting host action", () => {
  assert.equal(isMatchingAppliedTransportState(true, true), true);
  assert.equal(isMatchingAppliedTransportState(false, false), true);
  assert.equal(isMatchingAppliedTransportState(true, false), false);
  assert.equal(isMatchingAppliedTransportState(false, true), false);
});

test("event IDs correlate one room state version", () => {
  assert.equal(createPlaybackEventId("room-123", 8), "room-123:8");
});

test("propagation latency is omitted unless clocks are comparable", () => {
  assert.equal(estimatePropagationLatencyMs(1000, 1180, false), null);
  assert.equal(estimatePropagationLatencyMs(1000, 1180, true), 180);
  assert.equal(estimatePropagationLatencyMs(1200, 1180, true), null);
});

test("drift is absolute and omitted unless clocks are comparable", () => {
  assert.equal(measurePlaybackDriftMs(12, 12.4, false), null);
  assert.equal(measurePlaybackDriftMs(12, 12.4, true), 400);
});

test("summaries report sample count, median, nearest-rank p95, and maximum", () => {
  assert.deepEqual(summarizeMeasurements([5, 1, 3, 2, 4, Number.NaN, -1]), {
    sampleCount: 5,
    medianMs: 3,
    p95Ms: 5,
    maximumMs: 5,
  });
  assert.deepEqual(summarizeMeasurements([]), {
    sampleCount: 0,
    medianMs: null,
    p95Ms: null,
    maximumMs: null,
  });
});
