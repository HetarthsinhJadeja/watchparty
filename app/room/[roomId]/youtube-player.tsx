"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Playback } from "./room-client";
import {
  createPlaybackEventId,
  getTransportCorrectionCommand,
  isMatchingAppliedTransportState,
  logPlaybackMetric,
  measurePlaybackDriftMs,
} from "@/lib/playback-metrics.mts";

type PlayerEvent = { target: YouTubePlayer };
type StateEvent = PlayerEvent & { data: number };
type ErrorEvent = PlayerEvent & { data: number };

type YouTubePlayer = {
  destroy(): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  playVideo(): void;
  pauseVideo(): void;
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
};

type YouTubeApi = {
  Player: new (
    element: HTMLElement,
    options: {
      width: string;
      height: string;
      videoId: string;
      playerVars: Record<string, number | string>;
      events: {
        onReady: (event: PlayerEvent) => void;
        onStateChange: (event: StateEvent) => void;
        onError: (event: ErrorEvent) => void;
      };
    },
  ) => YouTubePlayer;
};

declare global {
  interface Window {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

export type YouTubeSeekResult = {
  positionSeconds: number;
  durationSeconds?: number;
  isPlaying: boolean;
};

export type YouTubePlayerHandle = {
  toggleMute(): boolean | null;
  seekBy(deltaSeconds: number): YouTubeSeekResult | null;
};

type Props = {
  videoId: string;
  isHost: boolean;
  playback: Playback | null;
  onPlay(positionSeconds: number, durationSeconds: number): void;
  onPause(positionSeconds: number, durationSeconds: number): void;
  onSeek(positionSeconds: number, isPlaying: boolean, durationSeconds: number, detectedAtMs: number): void;
  onMutedChange(isMuted: boolean): void;
  onError(message: string): void;
  clockComparisonConfirmed: boolean;
};

let apiPromise: Promise<YouTubeApi> | null = null;

function loadYouTubeApi(): Promise<YouTubeApi> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;

  apiPromise = new Promise<YouTubeApi>((resolve, reject) => {
    const scriptUrl = "https://www.youtube.com/iframe_api";
    let settled = false;
    const timeout = window.setTimeout(() => finish(new Error("YouTube player API timed out.")), 15000);
    const previousCallback = window.onYouTubeIframeAPIReady;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      if (error) {
        apiPromise = null;
        reject(error);
      } else if (window.YT?.Player) {
        resolve(window.YT);
      } else {
        apiPromise = null;
        reject(new Error("YouTube player API did not initialize."));
      }
    };

    window.onYouTubeIframeAPIReady = () => {
      previousCallback?.();
      finish();
    };

    let script = document.querySelector<HTMLScriptElement>(`script[src="${scriptUrl}"]`);
    if (!script) {
      script = document.createElement("script");
      script.src = scriptUrl;
      script.async = true;
      script.onerror = () => finish(new Error("YouTube player API could not be loaded."));
      document.head.appendChild(script);
    } else {
      script.addEventListener("error", () => finish(new Error("YouTube player API could not be loaded.")), { once: true });
    }
  });

  return apiPromise;
}

function getPlaybackPosition(playback: Playback) {
  const seconds = Number(playback.position_ms) / 1000;
  const elapsed = playback.is_playing
    ? Math.max(0, (Date.now() - Date.parse(playback.playback_timestamp)) / 1000)
    : 0;
  return Math.max(0, seconds + elapsed);
}

function playerErrorMessage(code: number) {
  if (code === 2) return "YouTube rejected this video ID. Check the link and try again.";
  if (code === 5) return "This video could not be played in the embedded HTML5 player.";
  if (code === 100) return "This video is unavailable, private, or has been removed.";
  if (code === 101 || code === 150) return "The video owner does not allow playback on other websites.";
  if (code === 153) return "YouTube did not receive this page's referrer. Open the room in a normal browser tab and try again.";
  return "YouTube could not play this video. It may be unavailable in your region or account.";
}

const YouTubePlayerFrame = forwardRef<YouTubePlayerHandle, Props>(function YouTubePlayerFrame(
  { videoId, isHost, playback, onPlay, onPause, onSeek, onMutedChange, onError, clockComparisonConfirmed },
  forwardedRef,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YouTubePlayer | null>(null);
  const latestPlayback = useRef(playback);
  const callbacks = useRef({ onPlay, onPause, onSeek, onMutedChange, onError });
  const suppressEventsUntil = useRef(0);
  const suppressedTransportFeedback = useRef<{ isPlaying: boolean; expiresAt: number } | null>(null);
  const [isPlayerReady, setIsPlayerReady] = useState(false);
  const [playerFailed, setPlayerFailed] = useState(false);
  const [playerStatus, setPlayerStatus] = useState("");
  const [needsPlaybackClick, setNeedsPlaybackClick] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const updateFullscreen = () => {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    };
    document.addEventListener("fullscreenchange", updateFullscreen);
    return () => document.removeEventListener("fullscreenchange", updateFullscreen);
  }, []);

  const toggleFullscreen = async () => {
    const container = containerRef.current;
    if (!container) return;
    try {
      if (document.fullscreenElement === container) await document.exitFullscreen();
      else await container.requestFullscreen();
    } catch {
      callbacks.current.onError("Your browser could not change fullscreen mode. Try using a supported browser.");
    }
  };

  useEffect(() => {
    latestPlayback.current = playback;
    callbacks.current = { onPlay, onPause, onSeek, onMutedChange, onError };
  }, [onError, onMutedChange, onPause, onPlay, onSeek, playback]);

  const applyPlayback = (next: Playback) => {
    const player = playerRef.current;
    if (!player || !isPlayerReady) return;

    try {
      const desired = getPlaybackPosition(next);
      const actualBefore = player.getCurrentTime();
      const playerState = player.getPlayerState();
      const driftBeforeCorrectionMs = measurePlaybackDriftMs(desired, actualBefore, clockComparisonConfirmed);
      const eventId = createPlaybackEventId(next.room_id, Number(next.state_version));
      const needsSeek = Math.abs(actualBefore - desired) > 1.25;
      logPlaybackMetric("youtube-player-apply", {
        eventId,
        stateVersion: next.state_version,
        expectedPositionSeconds: desired,
        actualPositionSeconds: actualBefore,
        driftBeforeCorrectionMs,
        correctionRequested: needsSeek,
        clockComparisonConfirmed,
      });
      if (needsSeek) {
        suppressEventsUntil.current = performance.now() + 1400;
        suppressedTransportFeedback.current = { isPlaying: next.is_playing, expiresAt: performance.now() + 1400 };
        player.seekTo(desired, true);
      }
      if (next.is_playing) {
        if (!isHost && !player.isMuted()) {
          player.mute();
          callbacks.current.onMutedChange(true);
        }
        if (playerState !== 1) {
          suppressEventsUntil.current = performance.now() + 1400;
          suppressedTransportFeedback.current = { isPlaying: true, expiresAt: performance.now() + 1400 };
          player.playVideo();
        }
      } else if (playerState === 1 || playerState === 3) {
        suppressEventsUntil.current = performance.now() + 1400;
        suppressedTransportFeedback.current = { isPlaying: false, expiresAt: performance.now() + 1400 };
        player.pauseVideo();
        setNeedsPlaybackClick(false);
      }
      window.setTimeout(() => {
        if (playerRef.current !== player) return;
        try {
          const actualAfter = player.getCurrentTime();
          const expectedAfter = getPlaybackPosition(next);
          logPlaybackMetric("youtube-player-apply-result", {
            eventId,
            stateVersion: next.state_version,
            expectedPositionSeconds: expectedAfter,
            actualPositionSeconds: actualAfter,
            driftAfterApplyMs: measurePlaybackDriftMs(expectedAfter, actualAfter, clockComparisonConfirmed),
            correctionRequested: needsSeek,
            measuredAtMs: Date.now(),
            clockComparisonConfirmed,
          });
        } catch {
          // YouTube can briefly be unavailable while it applies the requested position.
        }
      }, 500);
    } catch {
      callbacks.current.onError("The YouTube player is still preparing this video. Please try again in a moment.");
    }
  };

  useImperativeHandle(forwardedRef, () => ({
    toggleMute() {
      const player = playerRef.current;
      if (!player) return null;
      const nextIsMuted = !player.isMuted();
      if (nextIsMuted) player.mute();
      else player.unMute();
      callbacks.current.onMutedChange(nextIsMuted);
      return nextIsMuted;
    },
    seekBy(deltaSeconds: number) {
      const player = playerRef.current;
      if (!player || !isPlayerReady) return null;
      const currentPosition = player.getCurrentTime();
      const duration = player.getDuration();
      const hasDuration = Number.isFinite(duration) && duration > 0;
      const requestedPosition = Math.max(0, currentPosition + deltaSeconds);
      const positionSeconds = hasDuration ? Math.min(requestedPosition, duration) : requestedPosition;
      if (Math.abs(positionSeconds - currentPosition) < 0.05) return null;

      suppressEventsUntil.current = performance.now() + 1400;
      suppressedTransportFeedback.current = {
        isPlaying: player.getPlayerState() === 1,
        expiresAt: performance.now() + 1400,
      };
      player.seekTo(positionSeconds, true);
      return {
        positionSeconds,
        durationSeconds: hasDuration ? duration : undefined,
        isPlaying: player.getPlayerState() === 1,
      };
    },
  }), [isPlayerReady]);

  useEffect(() => {
    let active = true;
    void loadYouTubeApi().then((api) => {
      if (!active || !mountRef.current) return;
      playerRef.current = new api.Player(mountRef.current, {
        width: "100%",
        height: "100%",
        videoId,
        playerVars: {
          autoplay: 0,
          controls: isHost ? 1 : 0,
          disablekb: isHost ? 0 : 1,
          enablejsapi: 1,
          origin: window.location.origin,
          playsinline: 1,
          rel: 0,
        },
        events: {
          onReady: () => {
            if (!active) return;
            setIsPlayerReady(true);
            if (!isHost) {
              playerRef.current?.mute();
              callbacks.current.onMutedChange(true);
            }
            if (latestPlayback.current) applyPlayback(latestPlayback.current);
          },
          onStateChange: (event) => {
            if (!active) return;
            if (event.data === 3) setPlayerStatus("Buffering video…");
            else if (event.data === 1 || event.data === 2 || event.data === 0) setPlayerStatus("");
            if (!isHost) {
              const authoritative = latestPlayback.current;
              const observedIsPlaying = event.data === 1 ? true : event.data === 2 ? false : null;
              const correction = authoritative
                ? getTransportCorrectionCommand(authoritative.is_playing, observedIsPlaying)
                : null;
              if (correction) {
                suppressEventsUntil.current = performance.now() + 1000;
                if (correction === "play") event.target.playVideo();
                else event.target.pauseVideo();
              }
              return;
            }
            const observedIsPlaying = event.data === 1 ? true : event.data === 2 || event.data === 0 ? false : null;
            const expectedFeedback = suppressedTransportFeedback.current;
            if (expectedFeedback && performance.now() < expectedFeedback.expiresAt && observedIsPlaying !== null) {
              suppressedTransportFeedback.current = null;
              if (isMatchingAppliedTransportState(expectedFeedback.isPlaying, observedIsPlaying)) return;
            }
            const player = event.target;
            const position = player.getCurrentTime();
            const duration = player.getDuration();
            if (event.data === 1) callbacks.current.onPlay(position, duration);
            if (event.data === 2 || event.data === 0) callbacks.current.onPause(position, duration);
          },
          onError: (event) => {
            if (!active) return;
            setPlayerFailed(true);
            callbacks.current.onError(playerErrorMessage(event.data));
          },
        },
      });
    }).catch(() => {
      if (!active) return;
      setPlayerFailed(true);
      callbacks.current.onError("YouTube's player could not load. Check your connection and try again.");
    });

    return () => {
      active = false;
      playerRef.current?.destroy();
      playerRef.current = null;
    };
    // The player is created once per video ID. Changes to host/playback are applied separately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  useEffect(() => {
    if (playback && isPlayerReady) applyPlayback(playback);
    // applyPlayback intentionally reads the latest playback and player refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlayerReady, playback?.state_version, playback?.video_id]);

  useEffect(() => {
    if (!isPlayerReady || !isHost) return;
    let previousPosition = 0;
    let previousTime = performance.now();
    const timer = window.setInterval(() => {
      const player = playerRef.current;
      if (!player) return;
      try {
        const currentPosition = player.getCurrentTime();
        const currentTime = performance.now();
        const playerState = player.getPlayerState();
        const elapsedSeconds = (currentTime - previousTime) / 1000;
        const positionDelta = currentPosition - previousPosition;
        const seekDetected = playerState === 2
          ? Math.abs(positionDelta) > 0.9
          : playerState === 1 && Math.abs(positionDelta - elapsedSeconds) > 2.25;

        if (seekDetected && currentTime >= suppressEventsUntil.current) {
          suppressEventsUntil.current = currentTime + 1000;
          const detectedAtMs = Date.now();
          logPlaybackMetric("youtube-host-seek-detected", {
            detectedAtMs,
            pollingIntervalMs: 500,
            observedPositionSeconds: currentPosition,
            note: "Native YouTube seek time is observed by polling; this timestamp follows the seek by up to one polling interval.",
          });
          callbacks.current.onSeek(currentPosition, playerState === 1, player.getDuration(), detectedAtMs);
        }
        previousPosition = currentPosition;
        previousTime = currentTime;
      } catch {
        // Player can briefly be unavailable while buffering or changing state.
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, [isHost, isPlayerReady]);

  useEffect(() => {
    if (!isPlayerReady || isHost || !playback?.is_playing) return;
    const timer = window.setInterval(() => {
      const player = playerRef.current;
      if (!player) return;
      try {
        const desired = getPlaybackPosition(playback);
        const actualBefore = player.getCurrentTime();
        if (player.getPlayerState() === 1 && Math.abs(actualBefore - desired) > 2.5) {
          const eventId = createPlaybackEventId(playback.room_id, Number(playback.state_version));
          logPlaybackMetric("youtube-drift-correction-started", {
            eventId,
            stateVersion: playback.state_version,
            expectedPositionSeconds: desired,
            actualPositionSeconds: actualBefore,
            driftBeforeCorrectionMs: measurePlaybackDriftMs(desired, actualBefore, clockComparisonConfirmed),
            clockComparisonConfirmed,
          });
          suppressEventsUntil.current = performance.now() + 1000;
          player.seekTo(desired, true);
          window.setTimeout(() => {
            if (playerRef.current !== player) return;
            try {
              const actualAfter = player.getCurrentTime();
              const expectedAfter = getPlaybackPosition(playback);
              logPlaybackMetric("youtube-correction-result", {
                eventId,
                stateVersion: playback.state_version,
                expectedPositionSeconds: expectedAfter,
                actualPositionSeconds: actualAfter,
                driftAfterCorrectionMs: measurePlaybackDriftMs(expectedAfter, actualAfter, clockComparisonConfirmed),
                measuredAtMs: Date.now(),
                clockComparisonConfirmed,
              });
            } catch {
              // Ignore short-lived YouTube API gaps; the next correction poll remains active.
            }
          }, 500);
        }
      } catch {
        // A transient API state is corrected on its next poll.
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [clockComparisonConfirmed, isHost, isPlayerReady, playback]);

  useEffect(() => {
    if (!isPlayerReady || isHost || !playback?.is_playing) return;
    const timer = window.setTimeout(() => {
      try {
        if (playerRef.current && playerRef.current.getPlayerState() !== 1) {
          setNeedsPlaybackClick(true);
        }
      } catch {
        setNeedsPlaybackClick(true);
      }
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [isHost, isPlayerReady, playback?.is_playing, playback?.state_version]);

  return (
    <div
      ref={containerRef}
      className={isFullscreen ? "fixed inset-0 z-50 h-screen w-screen bg-black" : "relative aspect-video w-full bg-black"}
    >
      <div ref={mountRef} className={`absolute inset-0 h-full w-full${isHost ? "" : " pointer-events-none"}`} />
      {!isHost && (
        <button
          type="button"
          onClick={() => void toggleFullscreen()}
          aria-label={isFullscreen ? "Exit fullscreen video" : "View video in fullscreen"}
          className="absolute right-3 top-3 z-30 rounded-lg border border-white/25 bg-black/80 px-3 py-2 text-sm font-medium text-white shadow-lg transition hover:bg-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-focus)]"
        >
          {isFullscreen ? "Exit fullscreen" : "Fullscreen"}
        </button>
      )}
      {!isPlayerReady && !playerFailed && (
        <div className="absolute inset-0 grid place-items-center bg-black/70 text-sm text-[var(--accent-text)]" role="status">
          Loading YouTube player…
        </div>
      )}
      {playerStatus && !playerFailed && (
        <div className="pointer-events-none absolute inset-x-0 top-0 bg-black/65 px-4 py-2 text-center text-xs text-white" role="status">
          {playerStatus}
        </div>
      )}
      {needsPlaybackClick && !playerFailed && (
        <button type="button" onClick={() => {
          playerRef.current?.mute();
          callbacks.current.onMutedChange(true);
          playerRef.current?.playVideo();
          setNeedsPlaybackClick(false);
        }} className="absolute inset-x-4 bottom-4 mx-auto w-fit rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent-foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
          Tap to start synced playback
        </button>
      )}
    </div>
  );
});

export default YouTubePlayerFrame;
