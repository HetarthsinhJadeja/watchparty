"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { parseRoomMediaUrl, parseStoredRoomMedia, resolveStoredRoomMedia, youtubeTitleFallback } from "@/lib/room-media";
import { applyPlaylistDelete } from "@/lib/playlist-state.ts";
import { MOVIES, sanitizeGenrePreferences, type Movie } from "@/lib/movie-catalogue";
import {
  classifyPlaybackAction,
  createPlaybackEventId,
  estimatePropagationLatencyMs,
  isPlaybackVersionAtLeast,
  isPlaybackVersionNewer,
  isMatchingAppliedTransportState,
  logPlaybackMetric,
  measurePlaybackDriftMs,
  type PlaybackAction,
} from "@/lib/playback-metrics.ts";
import { supabase } from "@/lib/supabase";
import RoomChat from "./room-chat";
import RoomMembersPanel, { type RoomMember } from "./room-members-panel";
import RoomPlaylist, { type PlaylistItem } from "./room-playlist";
import RoomPolls, { type RoomPoll } from "./room-polls";
import MovieDiscovery from "./movie-discovery";
import YouTubePlayerFrame, { type YouTubePlayerHandle } from "./youtube-player";

type Room = {
  id: string;
  code: string;
  display_name: string;
  host_user_id: string | null;
};

export type Playback = {
  room_id: string;
  video_id: string | null;
  title: string | null;
  is_playing: boolean;
  position_ms: number;
  duration_ms: number | null;
  playback_timestamp: string;
  state_version: number;
};

const genrePreferencesStorageKey = (roomId: string, userId: string) => `watchparty:genre-preferences:${roomId}:${userId}`;

function readGenrePreferences(roomId: string, userId: string) {
  try {
    const stored = window.localStorage.getItem(genrePreferencesStorageKey(roomId, userId));
    return stored ? sanitizeGenrePreferences(JSON.parse(stored)) : [];
  } catch {
    return [];
  }
}

type SkipDirection = "rewind" | "forward";
type FloatingReaction = { id: string; emoji: string };
type RoomFloatingReaction = FloatingReaction & { left: number; drift: number };
type FloatingReactionStyle = CSSProperties & { "--reaction-drift": string };

function describeSupabaseError(error: {
  code?: string;
  message: string;
  details?: string;
  hint?: string;
}) {
  return [error.code, error.message, error.details, error.hint]
    .filter(Boolean)
    .join(" — ");
}

function describePlaylistError(error: { code?: string; message?: string }) {
  const message = error.message ?? "Unknown database error";
  if (error.code === "23505") return "That video is already in the playlist.";
  if (error.code === "42501" || /row-level security|permission denied/i.test(message)) {
    return "Supabase denied this playlist change. Confirm you are a room member and that the host-removal policy has been applied.";
  }
  if (error.code === "42P01") return "The room playlist table is missing. Apply the project schema before using the playlist.";
  if (/fetch|network|timeout/i.test(message)) return "The playlist could not reach Supabase. Check your connection and try again.";
  return `Playlist update failed: ${message}`;
}

function sortPlaylist(items: PlaylistItem[]) {
  return [...items].sort((a, b) =>
    a.sort_order - b.sort_order
    || a.created_at.localeCompare(b.created_at)
    || a.id.localeCompare(b.id),
  );
}

function describeHostTransferError(error: { code?: string; message?: string }) {
  const message = error.message ?? "Unknown database error";
  if (error.code === "PGRST202" || /could not find the function/i.test(message)) {
    return "Host transfer is not available yet. Review and apply the room host-transfer migration.";
  }
  if (error.code === "P0002") return "This room is no longer available.";
  if (error.code === "22023") return "That member is no longer in the room. Refresh the member list and choose someone else.";
  if (error.code === "42501") return "Transfer rejected. Only the current room host can transfer host privileges.";
  if (/fetch|network|timeout/i.test(message)) return "Could not reach Supabase. Check your connection; the room will refresh if the transfer completed.";
  return `Host transfer failed: ${message}`;
}

function describePollError(error: { code?: string; message?: string }, action: "load" | "create" | "vote") {
  const message = error.message ?? "Unknown database error";
  if (error.code === "23505") return "You have already voted in this poll.";
  if (error.code === "42501" || /row-level security|permission denied/i.test(message)) {
    return action === "create"
      ? "Poll creation was denied. Confirm you are the current host and review the room polls migration."
      : "This poll action was denied. Confirm your guest session is active and you are still a room member.";
  }
  if (error.code === "PGRST202" && action === "create") return "Poll creation is not set up yet. Review and apply the room polls migration.";
  if (error.code === "42P01") return "Poll tables are missing. Apply the project schema before using polls.";
  if (/fetch|network|timeout/i.test(message)) return "Could not reach Supabase. Check your connection and try again.";
  if (error.code === "22023") return message;
  return `Poll ${action} failed: ${message}`;
}

const sampleVideo = "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";

function currentPositionMs(state: Playback) {
  const elapsedMs = state.is_playing
    ? Math.max(0, Date.now() - Date.parse(state.playback_timestamp))
    : 0;
  return Math.max(0, Number(state.position_ms) + elapsedMs);
}

export default function RoomClient({ roomId }: { roomId: string }) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const youtubeRef = useRef<YouTubePlayerHandle>(null);
  const roomChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const currentGenrePreferencesRef = useRef<string[]>([]);
  const ignoreLocalEventsUntil = useRef(0);
  const skipSequence = useRef<{
    direction: SkipDirection | null;
    count: number;
    lastPressAt: number;
    timer: number | null;
  }>({ direction: null, count: 0, lastPressAt: 0, timer: null });
  const stateVersion = useRef(0);
  const pendingDirectCorrection = useRef<{ eventId: string; expectedPositionSeconds: number; reason: string } | null>(null);
  const directSeekStartedAt = useRef(0);
  const [room, setRoom] = useState<Room | null>(null);
  const [playback, setPlayback] = useState<Playback | null>(null);
  const playbackRef = useRef<Playback | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [mediaUrl, setMediaUrl] = useState("");
  const [nextSkip, setNextSkip] = useState<{ direction: SkipDirection | null; seconds: number }>({ direction: null, seconds: 10 });
  const [errorMessage, setErrorMessage] = useState("");
  const [connectionMessage, setConnectionMessage] = useState("Connecting to your room…");
  const [clocksComparable, setClocksComparable] = useState(false);
  const clocksComparableRef = useRef(false);
  const playlistRefreshVersion = useRef(0);
  const [playlistItems, setPlaylistItems] = useState<PlaylistItem[]>([]);
  const [playlistLoading, setPlaylistLoading] = useState(true);
  const [playlistAdding, setPlaylistAdding] = useState(false);
  const [removingPlaylistItemId, setRemovingPlaylistItemId] = useState<string | null>(null);
  const [playlistError, setPlaylistError] = useState("");
  const [polls, setPolls] = useState<RoomPoll[]>([]);
  const [pollsLoading, setPollsLoading] = useState(true);
  const [pollCreating, setPollCreating] = useState(false);
  const [votingPollId, setVotingPollId] = useState<string | null>(null);
  const [pollError, setPollError] = useState("");
  const [pollMessage, setPollMessage] = useState("");
  const pollRefreshVersion = useRef(0);
  const [roomMembers, setRoomMembers] = useState<RoomMember[]>([]);
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(() => new Set());
  const [presenceStatus, setPresenceStatus] = useState<"connecting" | "retrying" | "available" | "unavailable">("connecting");
  const [currentGenrePreferences, setCurrentGenrePreferences] = useState<string[]>([]);
  const [groupGenrePreferences, setGroupGenrePreferences] = useState<Record<string, string[]>>({});
  const [genrePreferenceMessage, setGenrePreferenceMessage] = useState("");
  const [roomMembersLoading, setRoomMembersLoading] = useState(true);
  const [roomMembersMessage, setRoomMembersMessage] = useState("");
  const [hostTransferPending, setHostTransferPending] = useState(false);
  const [roomReactions, setRoomReactions] = useState<RoomFloatingReaction[]>([]);
  const roomMembersRefreshVersion = useRef(0);

  const showRoomReaction = useCallback((reaction: FloatingReaction) => {
    setRoomReactions((current) => [
      ...current,
      {
        ...reaction,
        left: 12 + Math.random() * 76,
        drift: Math.round((Math.random() - 0.5) * 56),
      },
    ].slice(-12));
  }, []);

  const removeRoomReaction = useCallback((reactionId: string) => {
    setRoomReactions((current) => current.filter((reaction) => reaction.id !== reactionId));
  }, []);

  useEffect(() => {
    const { data: authListener } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_OUT") return;
      setCurrentUserId(null);
      setIsHost(false);
      setPresenceStatus("unavailable");
      setOnlineUserIds(new Set());
      setGroupGenrePreferences({});
      setConnectionMessage("Starting a new guest session");
      setErrorMessage("Your guest session ended. Return to the home page to continue.");
      setIsReady(false);
      const channel = roomChannelRef.current;
      roomChannelRef.current = null;
      if (channel) void supabase.removeChannel(channel);
      const nextPath = `/room/${encodeURIComponent(roomId)}`;
      router.replace(`/?next=${encodeURIComponent(nextPath)}`);
    });
    return () => authListener.subscription.unsubscribe();
  }, [roomId, router]);

  const updatePlaybackState = useCallback((next: Playback) => {
    playbackRef.current = next;
    stateVersion.current = Math.max(stateVersion.current, Number(next.state_version) || 0);
    setPlayback(next);
  }, []);

  useEffect(() => {
    if (!currentUserId) return;
    const storageKey = genrePreferencesStorageKey(roomId, currentUserId);
    function syncOtherTabPreferences(event: StorageEvent) {
      if (event.key !== storageKey) return;
      let genres: string[] = [];
      try {
        genres = event.newValue ? sanitizeGenrePreferences(JSON.parse(event.newValue)) : [];
      } catch {
        genres = [];
      }
      currentGenrePreferencesRef.current = genres;
      setCurrentGenrePreferences(genres);
      const roomChannel = roomChannelRef.current;
      if (roomChannel) void roomChannel.track({ preferred_genres: genres }).catch(() => undefined);
    }
    window.addEventListener("storage", syncOtherTabPreferences);
    return () => window.removeEventListener("storage", syncOtherTabPreferences);
  }, [currentUserId, roomId]);

  const activeMedia = resolveStoredRoomMedia(playback?.video_id ?? null, sampleVideo);
  const activeMediaKey = activeMedia.kind === "direct" ? `direct:${activeMedia.url}` : `youtube:${activeMedia.id}`;

  const refreshPlaylist = useCallback(async (showLoading = false) => {
    const requestVersion = ++playlistRefreshVersion.current;
    if (showLoading) setPlaylistLoading(true);
    const { data, error } = await supabase
      .from("room_playlist_items")
      .select("id, room_id, media_id, kind, title, sort_order, created_at, metadata")
      .eq("room_id", roomId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (requestVersion !== playlistRefreshVersion.current) return;
    if (error) {
      setPlaylistError(describePlaylistError(error));
    } else {
      setPlaylistItems(sortPlaylist((data ?? []) as PlaylistItem[]));
      setPlaylistError("");
    }
    setPlaylistLoading(false);
  }, [roomId]);

  const refreshRoomMembers = useCallback(async (showLoading = false) => {
    const requestVersion = ++roomMembersRefreshVersion.current;
    if (showLoading) setRoomMembersLoading(true);
    const { data, error } = await supabase
      .from("room_members")
      .select("id, user_id, guest_id, role, display_name, joined_at")
      .eq("room_id", roomId)
      .order("joined_at", { ascending: true });
    if (requestVersion !== roomMembersRefreshVersion.current) return;
    if (error) {
      setRoomMembersMessage(`Could not load room members: ${describeSupabaseError(error)}`);
    } else {
      setRoomMembers((data ?? []) as RoomMember[]);
      setRoomMembersMessage("");
    }
    setRoomMembersLoading(false);
  }, [roomId]);

  const refreshPolls = useCallback(async (userId: string, showLoading = false) => {
    const requestVersion = ++pollRefreshVersion.current;
    if (showLoading) setPollsLoading(true);
    const { data: pollData, error: pollLoadError } = await supabase
      .from("room_polls")
      .select("id, question, status, created_at")
      .eq("room_id", roomId)
      .order("created_at", { ascending: false });
    if (requestVersion !== pollRefreshVersion.current) return;
    if (pollLoadError) {
      setPollError(describePollError(pollLoadError, "load"));
      setPollsLoading(false);
      return;
    }

    const rows = (pollData ?? []) as { id: string; question: string; status: "active" | "closed"; created_at: string }[];
    if (rows.length === 0) {
      setPolls([]);
      setPollError("");
      setPollsLoading(false);
      return;
    }

    const pollIds = rows.map((poll) => poll.id);
    const [optionResult, voteResult] = await Promise.all([
      supabase
        .from("poll_options")
        .select("id, poll_id, label, sort_order")
        .in("poll_id", pollIds)
        .order("sort_order", { ascending: true }),
      supabase
        .from("poll_votes")
        .select("poll_id, option_id, voter_user_id")
        .in("poll_id", pollIds),
    ]);
    if (requestVersion !== pollRefreshVersion.current) return;
    if (optionResult.error || voteResult.error) {
      setPollError(describePollError(optionResult.error ?? voteResult.error!, "load"));
      setPollsLoading(false);
      return;
    }

    const options = (optionResult.data ?? []) as { id: string; poll_id: string; label: string; sort_order: number }[];
    const votes = (voteResult.data ?? []) as { poll_id: string; option_id: string; voter_user_id: string | null }[];
    setPolls(rows.map((poll) => {
      const pollOptions = options.filter((option) => option.poll_id === poll.id);
      const pollVotes = votes.filter((vote) => vote.poll_id === poll.id);
      return {
        ...poll,
        options: pollOptions.map((option) => ({
          ...option,
          votes: pollVotes.filter((vote) => vote.option_id === option.id).length,
        })),
        totalVotes: pollVotes.length,
        currentUserOptionId: pollVotes.find((vote) => vote.voter_user_id === userId)?.option_id ?? null,
      };
    }));
    setPollError("");
    setPollsLoading(false);
  }, [roomId]);

  const applyPlaybackToVideo = useCallback(async (next: Playback) => {
    if (activeMedia.kind !== "direct") return;
    const video = videoRef.current;
    if (!video || video.readyState < HTMLMediaElement.HAVE_METADATA) return;

    const position = currentPositionMs(next) / 1000;
    const beforePosition = video.currentTime;
    const driftBeforeCorrectionMs = measurePlaybackDriftMs(position, beforePosition, clocksComparableRef.current);
    const eventId = createPlaybackEventId(roomId, Number(next.state_version));
    logPlaybackMetric("direct-player-apply", {
      eventId,
      stateVersion: next.state_version,
      expectedPositionSeconds: position,
      actualPositionSeconds: beforePosition,
      driftBeforeCorrectionMs,
      clockComparisonConfirmed: clocksComparableRef.current,
    });
    const needsSeek = Number.isFinite(position) && Math.abs(beforePosition - position) > 1.25;
    const needsPlay = next.is_playing && video.paused;
    const needsPause = !next.is_playing && !video.paused;
    if (needsSeek || needsPlay || needsPause) {
      ignoreLocalEventsUntil.current = performance.now() + 800;
    }
    if (needsSeek) {
      pendingDirectCorrection.current = { eventId, expectedPositionSeconds: position, reason: "playback-state-apply" };
      video.currentTime = position;
    }

    if (needsPlay) {
      try {
        await video.play();
      } catch {
        setErrorMessage("Your browser blocked automatic playback. Press play on the video to continue.");
      }
    } else if (needsPause) {
      video.pause();
    }

    window.setTimeout(() => {
      if (videoRef.current !== video) return;
      const expectedPositionSeconds = currentPositionMs(next) / 1000;
      logPlaybackMetric("direct-player-apply-result", {
        eventId,
        stateVersion: next.state_version,
        expectedPositionSeconds,
        actualPositionSeconds: video.currentTime,
        driftAfterApplyMs: measurePlaybackDriftMs(expectedPositionSeconds, video.currentTime, clocksComparableRef.current),
        measuredAtMs: Date.now(),
        clockComparisonConfirmed: clocksComparableRef.current,
      });
    }, 500);
  }, [activeMedia.kind, roomId]);

  useEffect(() => {
    let active = true;
    let hasConnectedRealtimeOnce = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let pollRefreshTimer: number | null = null;
    let presenceRetryTimer: number | null = null;
    let presenceTrackingSucceeded = false;

    function schedulePollRefresh(userId: string) {
      if (pollRefreshTimer !== null) window.clearTimeout(pollRefreshTimer);
      pollRefreshTimer = window.setTimeout(() => {
        pollRefreshTimer = null;
        if (active) void refreshPolls(userId);
      }, 100);
    }

    function clearPresenceSnapshot() {
      setOnlineUserIds(new Set());
      setGroupGenrePreferences({});
    }

    function markPresenceUnavailable() {
      if (presenceRetryTimer !== null) window.clearTimeout(presenceRetryTimer);
      presenceRetryTimer = null;
      presenceTrackingSucceeded = false;
      clearPresenceSnapshot();
      setPresenceStatus("unavailable");
    }

    function markPresenceRetrying() {
      if (presenceRetryTimer !== null) window.clearTimeout(presenceRetryTimer);
      presenceTrackingSucceeded = false;
      clearPresenceSnapshot();
      setPresenceStatus("retrying");
      presenceRetryTimer = window.setTimeout(() => {
        presenceRetryTimer = null;
        if (active) setPresenceStatus((status) => status === "retrying" ? "unavailable" : status);
      }, 15000);
    }

    function syncPresence(roomChannel: ReturnType<typeof supabase.channel>) {
      if (!presenceTrackingSucceeded) return;
      if (presenceRetryTimer !== null) window.clearTimeout(presenceRetryTimer);
      presenceRetryTimer = null;
      const presenceState = roomChannel.presenceState<{ preferred_genres?: unknown }>();
      const onlineIds = new Set<string>();
      const memberGenres = new Map<string, Set<string>>();
      for (const [presenceKey, metas] of Object.entries(presenceState)) {
        // Display names and host status come from room_members. The key is
        // client-supplied, so presence is advisory and never grants privileges.
        onlineIds.add(presenceKey);
        const genres = memberGenres.get(presenceKey) ?? new Set<string>();
        for (const meta of metas) {
          for (const genre of sanitizeGenrePreferences(meta.preferred_genres)) genres.add(genre);
        }
        memberGenres.set(presenceKey, genres);
      }
      setOnlineUserIds(onlineIds);
      setGroupGenrePreferences(Object.fromEntries([...memberGenres].map(([userId, genres]) => [userId, [...genres]])));
      setPresenceStatus("available");
    }

    async function refreshLatestPlayback(source: "initial-subscription" | "realtime-reconnect") {
      const { data, error } = await supabase
        .from("room_playback")
        .select("room_id, video_id, title, is_playing, position_ms, duration_ms, playback_timestamp, state_version")
        .eq("room_id", roomId)
        .maybeSingle();
      if (!active) return;
      if (error) {
        setErrorMessage(`Playback refresh failed: ${describeSupabaseError(error)}`);
        return;
      }
      if (data && isPlaybackVersionAtLeast(stateVersion.current, Number(data.state_version))) {
        logPlaybackMetric("playback-snapshot", {
          source,
          eventId: createPlaybackEventId(roomId, Number(data.state_version)),
          stateVersion: data.state_version,
          playbackTimestamp: data.playback_timestamp,
          receivedAtMs: Date.now(),
        });
        updatePlaybackState(data as Playback);
      }
    }

    async function refreshLatestRoom(userId: string) {
      const { data, error } = await supabase
        .from("rooms")
        .select("id, code, display_name, host_user_id")
        .eq("id", roomId)
        .maybeSingle();
      if (!active) return;
      if (error) {
        setRoomMembersMessage(`Room information refresh failed: ${describeSupabaseError(error)}`);
      } else if (data) {
        setRoom(data as Room);
        setIsHost(data.host_user_id === userId);
      }
    }

    async function loadRoom() {
      setErrorMessage("");
      setPolls([]);
      setPollsLoading(true);
      setPollError("");
      setOnlineUserIds(new Set());
      setGroupGenrePreferences({});
      setPresenceStatus("connecting");
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (!active) return;
      if (sessionError || !sessionData.session?.user.id) {
        setErrorMessage("Your guest session is not available. Return to the home page to start a new session.");
        setConnectionMessage("Guest session required");
        router.replace("/");
        return;
      }
      setCurrentUserId(sessionData.session.user.id);
      const initialGenrePreferences = readGenrePreferences(roomId, sessionData.session.user.id);
      currentGenrePreferencesRef.current = initialGenrePreferences;
      setCurrentGenrePreferences(initialGenrePreferences);

      const { data: roomData, error: roomError } = await supabase
        .from("rooms")
        .select("id, code, display_name, host_user_id")
        .eq("id", roomId)
        .maybeSingle();
      if (!active) return;
      if (roomError) {
        setErrorMessage(`Room lookup failed: ${describeSupabaseError(roomError)}`);
        setConnectionMessage("Room lookup failed");
        return;
      }
      if (!roomData) {
        setErrorMessage("Supabase returned no room visible to this account for that ID. The room may not exist, or its membership/RLS policy may be blocking access.");
        setConnectionMessage("Room unavailable");
        return;
      }

      setRoom(roomData as Room);
      setIsHost(roomData.host_user_id === sessionData.session.user.id);

      const { data: playbackData, error: playbackError } = await supabase
        .from("room_playback")
        .select("room_id, video_id, title, is_playing, position_ms, duration_ms, playback_timestamp, state_version")
        .eq("room_id", roomId)
        .maybeSingle();
      if (!active) return;
      if (playbackError) {
        setErrorMessage(`The room loaded, but playback lookup failed: ${describeSupabaseError(playbackError)}`);
      } else if (!playbackData) {
        setErrorMessage("The room loaded, but Supabase returned no playback row visible to this account. Check the room playback row and its RLS policy.");
      } else {
        logPlaybackMetric("playback-snapshot", {
          source: "initial-room-load",
          eventId: createPlaybackEventId(roomId, Number(playbackData.state_version)),
          stateVersion: playbackData.state_version,
          playbackTimestamp: playbackData.playback_timestamp,
          receivedAtMs: Date.now(),
        });
        updatePlaybackState(playbackData as Playback);
      }

      const roomChannel = supabase
        .channel(`room-playback-${roomId}`, {
          config: { private: true, presence: { key: sessionData.session.user.id } },
        });
      channel = roomChannel;
      roomChannelRef.current = roomChannel;
      roomChannel
        .on("presence", { event: "sync" }, () => {
          if (!active) return;
          syncPresence(roomChannel);
        })
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "room_playback",
            filter: `room_id=eq.${roomId}`,
          },
          (payload) => {
            const next = payload.new as Playback;
            if (!active || next.room_id !== roomId) return;
            if (!isPlaybackVersionNewer(stateVersion.current, Number(next.state_version))) return;
            const receivedAtMs = Date.now();
            const actionTimestampMs = Date.parse(next.playback_timestamp);
            const action = classifyPlaybackAction(playbackRef.current, next);
            if (action) {
              const propagationLatencyMs = estimatePropagationLatencyMs(actionTimestampMs, receivedAtMs, clocksComparableRef.current);
              logPlaybackMetric("realtime-action-received", {
                eventId: createPlaybackEventId(roomId, Number(next.state_version)),
                action,
                stateVersion: next.state_version,
                actionTimestampMs,
                receivedAtMs,
                serverCommitTimestamp: payload.commit_timestamp,
                propagationLatencyMs,
                clockComparisonConfirmed: clocksComparableRef.current,
                latencyOmittedReason: propagationLatencyMs !== null
                  ? undefined
                  : clocksComparableRef.current
                    ? "Timestamp was invalid or the receiving clock preceded the host clock"
                    : "Browser clocks were not confirmed comparable",
              });
            }
            updatePlaybackState(next);
          },
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "room_playlist_items",
            filter: `room_id=eq.${roomId}`,
          },
          (payload) => {
            if (!active) return;
            if (payload.eventType === "DELETE") {
              const deletedRow = payload.old as { id?: unknown; room_id?: unknown };
              playlistRefreshVersion.current += 1;
              setPlaylistItems((items) => applyPlaylistDelete(items, roomId, deletedRow));
              return;
            }
            void refreshPlaylist();
          },
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "rooms",
            filter: `id=eq.${roomId}`,
          },
          (payload) => {
            const next = payload.new as Room;
            if (!active || next.id !== roomId) return;
            setRoom(next);
            setIsHost(next.host_user_id === sessionData.session?.user.id);
          },
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "room_members",
            filter: `room_id=eq.${roomId}`,
          },
          () => {
            if (active) void refreshRoomMembers();
          },
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "room_polls", filter: `room_id=eq.${roomId}` },
          () => {
            if (active) schedulePollRefresh(sessionData.session!.user.id);
          },
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "poll_options" },
          () => {
            if (active) schedulePollRefresh(sessionData.session!.user.id);
          },
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "poll_votes" },
          () => {
            if (active) schedulePollRefresh(sessionData.session!.user.id);
          },
        )
        .subscribe((status, error) => {
          if (!active) return;
          if (status === "SUBSCRIBED") {
            setConnectionMessage("Connected · playback sync is live");
            if (presenceRetryTimer !== null) window.clearTimeout(presenceRetryTimer);
            presenceRetryTimer = null;
            presenceTrackingSucceeded = false;
            clearPresenceSnapshot();
            setPresenceStatus("connecting");
            void roomChannel.track({ preferred_genres: currentGenrePreferencesRef.current }).then((trackStatus) => {
              if (!active) return;
              if (trackStatus !== "ok") {
                console.error(
                  "[WatchParty presence track] non-ok",
                  String(trackStatus),
                  "topic",
                  `room-playback-${roomId}`,
                  "signedIn",
                  Boolean(sessionData.session?.user.id),
                );
                if (trackStatus === "timed out") markPresenceRetrying();
                else markPresenceUnavailable();
              } else {
                presenceTrackingSucceeded = true;
                syncPresence(roomChannel);
              }
            }).catch((error: unknown) => {
              if (!active) return;
              const trackError = error && typeof error === "object"
                ? error as { message?: unknown; code?: unknown }
                : null;
              console.error(
                "[WatchParty presence track] rejected",
                String(error),
                "topic",
                `room-playback-${roomId}`,
                "signedIn",
                Boolean(sessionData.session?.user.id),
                "message",
                typeof trackError?.message === "string" ? trackError.message : "",
                "code",
                typeof trackError?.code === "string" ? trackError.code : "",
              );
              markPresenceUnavailable();
            });
            const source = hasConnectedRealtimeOnce ? "realtime-reconnect" : "initial-subscription";
            if (hasConnectedRealtimeOnce) {
              void refreshLatestRoom(sessionData.session!.user.id);
              void refreshPlaylist(true);
              void refreshRoomMembers(true);
            }
            hasConnectedRealtimeOnce = true;
            void refreshLatestPlayback(source);
            void refreshPolls(sessionData.session!.user.id, true);
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            markPresenceRetrying();
            const channelError = error && typeof error === "object"
              ? error as { message?: unknown; code?: unknown }
              : null;
            console.error(
              "[WatchParty playback Realtime] subscription failure",
              status,
              "topic",
              `room-playback-${roomId}`,
              "signedIn",
              Boolean(sessionData.session?.user.id),
              "error",
              String(error),
              "message",
              typeof channelError?.message === "string" ? channelError.message : "",
              "code",
              typeof channelError?.code === "string" ? channelError.code : "",
            );
            setConnectionMessage("Realtime connection unavailable");
            setErrorMessage(`Supabase Realtime ${status}${error?.message ? `: ${error.message}` : ". Check the Realtime publication and access policies."}`);
          } else if (status === "CLOSED") {
            markPresenceUnavailable();
            setConnectionMessage("Realtime connection closed");
          }
        });

      setIsReady(true);
      void refreshPlaylist(true);
      void refreshRoomMembers(true);
      void refreshPolls(sessionData.session.user.id, true);
    }

    void loadRoom().catch(() => {
      if (active) {
        setErrorMessage("Couldn't reach Supabase. Check your internet connection and try again.");
        setConnectionMessage("Connection failed");
      }
    });

    return () => {
      active = false;
      playlistRefreshVersion.current += 1;
      roomMembersRefreshVersion.current += 1;
      pollRefreshVersion.current += 1;
      if (pollRefreshTimer !== null) window.clearTimeout(pollRefreshTimer);
      if (presenceRetryTimer !== null) window.clearTimeout(presenceRetryTimer);
      if (roomChannelRef.current === channel) roomChannelRef.current = null;
      if (channel) {
        void supabase.removeChannel(channel).then((removeStatus) => {
          if (removeStatus !== "ok") {
            console.warn("[WatchParty Realtime cleanup] non-ok", String(removeStatus), "topic", `room-playback-${roomId}`);
          }
        }).catch((cleanupError: unknown) => {
          console.error("[WatchParty Realtime cleanup] rejected", String(cleanupError), "topic", `room-playback-${roomId}`);
        });
      }
    };
  }, [refreshPlaylist, refreshPolls, refreshRoomMembers, roomId, router, updatePlaybackState]);

  async function createRoomPoll(question: string, options: string[]) {
    if (!isHost || !currentUserId) {
      setPollError("Only the current signed-in host can create a poll.");
      return false;
    }
    setPollCreating(true);
    setPollError("");
    setPollMessage("");
    try {
      const { error } = await supabase.rpc("create_room_poll", {
        p_room_id: roomId,
        p_question: question,
        p_options: options,
      });
      if (error) {
        setPollError(describePollError(error, "create"));
        return false;
      }
      setPollMessage("Poll created for everyone in the room.");
      await refreshPolls(currentUserId);
      return true;
    } catch {
      setPollError("Could not reach Supabase. Check your connection and try again.");
      return false;
    } finally {
      setPollCreating(false);
    }
  }

  async function castPollVote(pollId: string, optionId: string) {
    if (!currentUserId) {
      setPollError("Your guest session is not available. Return to the home page and try again.");
      return false;
    }
    if (polls.find((poll) => poll.id === pollId)?.currentUserOptionId) {
      setPollError("You have already voted in this poll.");
      return false;
    }
    setVotingPollId(pollId);
    setPollError("");
    setPollMessage("");
    try {
      const { error } = await supabase.from("poll_votes").insert({
        poll_id: pollId,
        option_id: optionId,
        voter_user_id: currentUserId,
        voter_guest_id: null,
      });
      if (error) {
        setPollError(describePollError(error, "vote"));
        if (error.code === "23505") void refreshPolls(currentUserId);
        return false;
      }
      setPollMessage("Your vote has been counted.");
      await refreshPolls(currentUserId);
      return true;
    } catch {
      setPollError("Could not reach Supabase. Check your connection and try again.");
      return false;
    } finally {
      setVotingPollId(null);
    }
  }

  function updateGenrePreferences(nextGenres: string[]) {
    const safeGenres = sanitizeGenrePreferences(nextGenres);
    currentGenrePreferencesRef.current = safeGenres;
    setCurrentGenrePreferences(safeGenres);
    setGenrePreferenceMessage("Preferences saved in this browser.");
    if (currentUserId) {
      try {
        window.localStorage.setItem(genrePreferencesStorageKey(roomId, currentUserId), JSON.stringify(safeGenres));
      } catch {
        setGenrePreferenceMessage("Preferences will last for this session because browser storage is unavailable.");
      }
      const roomChannel = roomChannelRef.current;
      if (roomChannel && presenceStatus === "available") {
        void roomChannel.track({ preferred_genres: safeGenres }).then((status) => {
          if (status !== "ok") setGenrePreferenceMessage("Preferences are saved here but could not be shared live with the room.");
        }).catch(() => {
          setGenrePreferenceMessage("Preferences are saved here but could not be shared live with the room.");
        });
      } else {
        setGenrePreferenceMessage("Preferences are saved here and will be shared when room presence connects.");
      }
    }
  }

  async function transferRoomHost(targetUserId: string) {
    if (!isHost || !currentUserId || targetUserId === currentUserId) {
      setRoomMembersMessage("Only the current host can transfer host privileges to another member.");
      return false;
    }
    if (!roomMembers.some((member) => member.user_id === targetUserId)) {
      setRoomMembersMessage("That member is no longer in the room. Refresh the member list and try again.");
      return false;
    }

    setHostTransferPending(true);
    setRoomMembersMessage("");
    try {
      const { data, error } = await supabase.rpc("transfer_room_host", {
        p_room_id: roomId,
        p_target_user_id: targetUserId,
      });
      if (error) {
        setRoomMembersMessage(describeHostTransferError(error));
        if (error.code === "42501" || error.code === "22023") void refreshRoomMembers(true);
        return false;
      }
      if (data !== targetUserId) {
        setRoomMembersMessage("Supabase returned an unexpected host transfer response. Refresh the room and check its current host.");
        return false;
      }

      setRoom((current) => current ? { ...current, host_user_id: targetUserId } : current);
      setIsHost(targetUserId === currentUserId);
      setRoomMembers((current) => current.map((member) => ({
        ...member,
        role: member.user_id === targetUserId ? "host" : "member",
      })));
      setRoomMembersMessage("");
      void refreshRoomMembers();
      return true;
    } catch (error) {
      setRoomMembersMessage(describeHostTransferError({ message: error instanceof Error ? error.message : "Network request failed" }));
      return false;
    } finally {
      setHostTransferPending(false);
    }
  }

  useEffect(() => () => {
    if (skipSequence.current.timer !== null) window.clearTimeout(skipSequence.current.timer);
  }, []);

  useEffect(() => {
    if (!activeMediaKey.startsWith("direct:")) return;
    const video = videoRef.current;
    if (!video) return;
    video.load();
  }, [activeMediaKey]);

  useEffect(() => {
    if (!playback || !activeMediaKey.startsWith("direct:")) return;
    // This effect synchronizes the native player with the authoritative DB state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void applyPlaybackToVideo(playback);
  }, [activeMediaKey, applyPlaybackToVideo, playback]);

  useEffect(() => {
    if (isHost || activeMedia.kind !== "direct") return;
    const timer = window.setInterval(() => {
      const state = playbackRef.current;
      const video = videoRef.current;
      if (!state?.is_playing || !video || video.paused || video.readyState < HTMLMediaElement.HAVE_METADATA) return;
      const desiredPosition = currentPositionMs(state) / 1000;
      if (Math.abs(video.currentTime - desiredPosition) > 2.5) {
        const eventId = createPlaybackEventId(roomId, Number(state.state_version));
        logPlaybackMetric("direct-drift-correction-started", {
          eventId,
          stateVersion: state.state_version,
          expectedPositionSeconds: desiredPosition,
          actualPositionSeconds: video.currentTime,
          driftBeforeCorrectionMs: measurePlaybackDriftMs(desiredPosition, video.currentTime, clocksComparableRef.current),
          clockComparisonConfirmed: clocksComparableRef.current,
        });
        pendingDirectCorrection.current = { eventId, expectedPositionSeconds: desiredPosition, reason: "periodic-drift-correction" };
        ignoreLocalEventsUntil.current = performance.now() + 800;
        video.currentTime = desiredPosition;
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [activeMedia.kind, isHost, roomId]);

  async function writePlayback(next: Playback, action?: PlaybackAction) {
    const previous = playbackRef.current;
    const actionTimestampMs = Date.parse(next.playback_timestamp);
    const eventId = createPlaybackEventId(roomId, Number(next.state_version));
    const writeStartedAt = performance.now();
    updatePlaybackState(next);
    if (action) {
      logPlaybackMetric("host-action-started", {
        eventId,
        action,
        stateVersion: next.state_version,
        actionTimestampMs,
        actionTimestamp: next.playback_timestamp,
      });
    }
    let data: { room_id: string }[] | null = null;
    let error: { code?: string; message: string } | null = null;
    try {
      const result = await supabase
        .from("room_playback")
        .update({
          video_id: next.video_id,
          title: next.title,
          is_playing: next.is_playing,
          position_ms: next.position_ms,
          duration_ms: next.duration_ms,
          playback_timestamp: next.playback_timestamp,
          state_version: next.state_version,
        })
        .eq("room_id", roomId)
        .lt("state_version", next.state_version)
        .select("room_id");
      data = result.data;
      error = result.error;
    } catch (caught) {
      error = {
        message: caught instanceof Error ? caught.message : String(caught),
      };
    }
    const writeRoundTripMs = performance.now() - writeStartedAt;
    let writeResult = error ? "error" : data?.length ? "updated" : "no-row-confirmed";

    if (!error && !data?.length) {
      try {
        const { data: latestData, error: latestError } = await supabase
          .from("room_playback")
          .select("room_id, video_id, title, is_playing, position_ms, duration_ms, playback_timestamp, state_version")
          .eq("room_id", roomId)
          .maybeSingle();
        if (!latestError && latestData && isPlaybackVersionAtLeast(Number(next.state_version), Number(latestData.state_version))) {
          if (isPlaybackVersionAtLeast(Number(playbackRef.current?.state_version ?? 0), Number(latestData.state_version))) {
            updatePlaybackState(latestData as Playback);
          }
          writeResult = "superseded-by-newer-state";
        }
      } catch {
        writeResult = "no-row-confirmed";
      }
    }

    if (action) {
      logPlaybackMetric("host-database-write-finished", {
        eventId,
        action,
        stateVersion: next.state_version,
        result: writeResult,
        writeRoundTripMs,
        receivedAtMs: Date.now(),
      });
    }

    if ((error || writeResult === "no-row-confirmed") && playbackRef.current?.state_version === next.state_version) {
      setErrorMessage(error
        ? `Supabase rejected the playback update: ${describeSupabaseError(error)}`
        : "Supabase did not confirm the playback update. Check that you are the room host.");
      if (previous) {
        stateVersion.current = Number(previous.state_version) || 0;
        updatePlaybackState(previous);
      }
    }
  }

  async function saveHostPlayback(
    isPlaying: boolean,
    positionSeconds?: number,
    durationSeconds?: number,
    action: PlaybackAction = isPlaying ? "play" : "pause",
    actionTimestampMs = Date.now(),
  ) {
    const current = playbackRef.current;
    if (!isHost || !current) return;
    // Ignore only the matching event generated by an authoritative apply. A
    // conflicting native play/pause event is a new host action and must pass.
    if (performance.now() < ignoreLocalEventsUntil.current && isMatchingAppliedTransportState(current.is_playing, isPlaying)) return;
    const video = videoRef.current;
    const position = positionSeconds ?? video?.currentTime ?? 0;
    const duration = durationSeconds ?? video?.duration;
    const next: Playback = {
      ...current,
      is_playing: isPlaying,
      position_ms: Math.max(0, Math.round(position * 1000)),
      duration_ms: Number.isFinite(duration) && (duration as number) > 0
        ? Math.round((duration as number) * 1000)
        : current.duration_ms,
      playback_timestamp: new Date(actionTimestampMs).toISOString(),
      state_version: Math.max(stateVersion.current, Number(current.state_version) || 0) + 1,
    };
    await writePlayback(next, action);
  }

  async function saveHostSeek(positionSeconds: number, isPlaying: boolean, durationSeconds?: number, actionTimestampMs = Date.now()) {
    await saveHostPlayback(isPlaying, positionSeconds, durationSeconds, "seek", actionTimestampMs);
  }

  function handleSkip(direction: SkipDirection) {
    if (!isHost) return;

    const now = Date.now();
    const sequence = skipSequence.current;
    const continuesSequence = sequence.direction === direction && now - sequence.lastPressAt < 2500;
    const count = continuesSequence ? Math.min(sequence.count + 1, 3) : 1;
    const jumpSeconds = count * 10;

    if (sequence.timer !== null) window.clearTimeout(sequence.timer);
    sequence.direction = direction;
    sequence.count = count;
    sequence.lastPressAt = now;
    sequence.timer = window.setTimeout(() => {
      sequence.direction = null;
      sequence.count = 0;
      sequence.lastPressAt = 0;
      sequence.timer = null;
      setNextSkip({ direction: null, seconds: 10 });
    }, 2500);
    setNextSkip({ direction, seconds: Math.min(count + 1, 3) * 10 });

    const delta = direction === "forward" ? jumpSeconds : -jumpSeconds;
    if (activeMedia.kind === "youtube") {
      const result = youtubeRef.current?.seekBy(delta);
      if (result) void saveHostSeek(result.positionSeconds, result.isPlaying, result.durationSeconds, now);
      return;
    }

    const video = videoRef.current;
    if (!video) return;
    const currentPosition = video.currentTime;
    const hasDuration = Number.isFinite(video.duration) && video.duration > 0;
    const requestedPosition = Math.max(0, currentPosition + delta);
    const targetPosition = hasDuration ? Math.min(requestedPosition, video.duration) : requestedPosition;
    if (Math.abs(targetPosition - currentPosition) < 0.05) return;

    ignoreLocalEventsUntil.current = performance.now() + 1000;
    video.currentTime = targetPosition;
    void saveHostSeek(targetPosition, !video.paused, hasDuration ? video.duration : undefined, now);
  }

  function handleDirectVideoSeeked() {
    const pending = pendingDirectCorrection.current;
    const video = videoRef.current;
    if (pending && video) {
      logPlaybackMetric("direct-correction-result", {
        eventId: pending.eventId,
        reason: pending.reason,
        expectedPositionSeconds: pending.expectedPositionSeconds,
        actualPositionSeconds: video.currentTime,
        driftAfterCorrectionMs: measurePlaybackDriftMs(pending.expectedPositionSeconds, video.currentTime, clocksComparableRef.current),
        clockComparisonConfirmed: clocksComparableRef.current,
        measuredAtMs: Date.now(),
      });
      pendingDirectCorrection.current = null;
    }
    void saveHostSeek(video?.currentTime ?? 0, !video?.paused, video?.duration ?? 0, directSeekStartedAt.current || Date.now());
    directSeekStartedAt.current = 0;
  }

  async function selectMedia(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const media = parseRoomMediaUrl(mediaUrl);
    if (!media) {
      setErrorMessage("Paste a valid YouTube link or a direct MP4/WebM video URL.");
      return;
    }
    const current = playbackRef.current;
    if (!current) {
      setErrorMessage("Playback state is still loading. Try again in a moment.");
      return;
    }

    ignoreLocalEventsUntil.current = performance.now() + 1600;
    const next: Playback = {
      ...current,
      video_id: media.storedValue,
      title: media.kind === "youtube" ? youtubeTitleFallback(media.id) : new URL(media.url).hostname,
      is_playing: false,
      position_ms: 0,
      duration_ms: null,
      playback_timestamp: new Date().toISOString(),
      state_version: Math.max(stateVersion.current, Number(current.state_version) || 0) + 1,
    };
    setErrorMessage("");
    await writePlayback(next);
  }

  async function addPlaylistItem(input: string, movie?: Movie) {
    const media = parseRoomMediaUrl(input);
    if (!media) {
      setPlaylistError("Use a valid YouTube link or a direct MP4/WebM URL. This checks the link format, not whether the video is available.");
      return false;
    }
    if (!room || !currentUserId) {
      setPlaylistError("Room membership is still loading. Try adding the video again in a moment.");
      return false;
    }
    if (movie && playlistItems.some((item) => item.metadata?.catalogue_movie_id === movie.id)) {
      setPlaylistError(`${movie.title} is already in the shared playlist.`);
      return false;
    }

    setPlaylistAdding(true);
    setPlaylistError("");
    try {
      const { data: lastItem, error: orderError } = await supabase
        .from("room_playlist_items")
        .select("sort_order")
        .eq("room_id", roomId)
        .order("sort_order", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (orderError) {
        setPlaylistError(describePlaylistError(orderError));
        return false;
      }

      let title = movie?.title ?? (media.kind === "youtube" ? youtubeTitleFallback(media.id) : new URL(media.url).hostname);
      if (!movie && media.kind === "youtube") {
        try {
          const response = await fetch(`/api/youtube-title?videoId=${encodeURIComponent(media.id)}`, {
            signal: AbortSignal.timeout(6000),
          });
          if (response.ok) {
            const result: unknown = await response.json();
            if (result && typeof result === "object" && "title" in result && typeof result.title === "string" && result.title.trim()) {
              title = result.title.trim();
            }
          }
        } catch {
          // Keep the useful video-ID fallback and continue queuing the link.
        }
      }
      const { data, error } = await supabase
        .from("room_playlist_items")
        .insert({
          room_id: roomId,
          media_id: media.storedValue,
          kind: "movie",
          title,
          sort_order: Number(lastItem?.sort_order ?? -1) + 1,
          added_by_user_id: currentUserId,
          metadata: movie ? { catalogue_movie_id: movie.id } : {},
        })
        .select("id, room_id, media_id, kind, title, sort_order, created_at, metadata")
        .single();
      if (error) {
        setPlaylistError(describePlaylistError(error));
        return false;
      }

      playlistRefreshVersion.current += 1;
      setPlaylistItems((items) => sortPlaylist([...items.filter((item) => item.id !== data.id), data as PlaylistItem]));
      setPlaylistError("");
      void refreshPlaylist();
      return true;
    } catch (error) {
      setPlaylistError(describePlaylistError({ message: error instanceof Error ? error.message : "Network request failed" }));
      return false;
    } finally {
      setPlaylistAdding(false);
    }
  }

  async function removePlaylistItem(itemId: string) {
    if (!isHost) return;
    setRemovingPlaylistItemId(itemId);
    setPlaylistError("");
    try {
      const { data, error } = await supabase
        .from("room_playlist_items")
        .delete()
        .eq("room_id", roomId)
        .eq("id", itemId)
        .select("id");
      if (error) {
        setPlaylistError(describePlaylistError(error));
        return;
      }
      if (!data?.length) {
        setPlaylistError("The item was not removed. Confirm the room playlist host-removal policy has been applied.");
        return;
      }
      playlistRefreshVersion.current += 1;
      setPlaylistItems((items) => items.filter((item) => item.id !== itemId));
      void refreshPlaylist();
    } catch (error) {
      setPlaylistError(describePlaylistError({ message: error instanceof Error ? error.message : "Network request failed" }));
    } finally {
      setRemovingPlaylistItemId(null);
    }
  }

  async function playPlaylistItem(item: PlaylistItem) {
    if (!isHost) return;
    const media = parseStoredRoomMedia(item.media_id);
    const current = playbackRef.current;
    if (!media || !current) {
      setErrorMessage("This playlist item has an unsupported link or playback is still loading.");
      return;
    }
    ignoreLocalEventsUntil.current = performance.now() + 1600;
    const next: Playback = {
      ...current,
      video_id: media.storedValue,
      title: item.title.trim() || (media.kind === "youtube" ? youtubeTitleFallback(media.id) : new URL(media.url).hostname),
      is_playing: true,
      position_ms: 0,
      duration_ms: null,
      playback_timestamp: new Date().toISOString(),
      state_version: Math.max(stateVersion.current, Number(current.state_version) || 0) + 1,
    };
    setErrorMessage("");
    await writePlayback(next);
  }

  function handleMetadataLoaded() {
    const latest = playbackRef.current;
    if (latest) void applyPlaybackToVideo(latest);
  }

  function toggleMute() {
    if (activeMedia.kind === "youtube") {
      youtubeRef.current?.toggleMute();
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setIsMuted(video.muted);
    if (playbackRef.current?.is_playing && video.paused) {
      void video.play().then(() => setErrorMessage("")).catch(() => {
        setErrorMessage("Press play on the video to allow playback in this browser.");
      });
    }
  }

  if (!isReady) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--background)] px-5 text-[var(--foreground)]">
        <div className="max-w-md text-center">
          <p className="text-sm text-[var(--accent-text)]">{connectionMessage}</p>
          {errorMessage && <p className="mt-4 text-sm leading-6 text-[var(--danger)]" role="alert">{errorMessage}</p>}
          <Link href="/" className="mt-6 inline-block text-sm text-[#c4c5c6] underline underline-offset-4">Back to WatchParty</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[var(--background)] px-4 py-4 text-[var(--foreground)] sm:px-6 sm:py-6 xl:px-8">
      <div className="mx-auto max-w-[1400px]">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
          <Link href="/" aria-label="WatchParty home" className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-focus)]">
            <Image src="/images/watchparty-logo.png" alt="" aria-hidden="true" width={2400} height={1792} className="h-8 w-auto rounded object-contain" />
            <span>watch<span className="text-[var(--accent-text)]">party</span></span>
          </Link>
          <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
            <p className="text-xs text-[#85878b] sm:text-sm" role="status">{connectionMessage}</p>
            {room && <span className="rounded-full border border-white/15 px-4 py-2 font-mono text-sm tracking-[.12em] text-[var(--accent-text)]">{room.code}</span>}
            <Link href="/" className="rounded-full border border-white/15 px-4 py-2 text-sm text-[#d2d1cc] hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-focus)]">Leave room</Link>
          </div>
        </header>

        {process.env.NODE_ENV === "development" && (
          <details className="mt-3 rounded-xl border border-white/10 bg-[var(--surface)] px-3 py-2.5 text-xs text-[#c4c5c6]">
            <summary className="cursor-pointer font-medium text-[var(--accent-text)]">Playback measurement (development)</summary>
            <label className="mt-3 flex items-start gap-2 leading-5">
              <input
                type="checkbox"
                checked={clocksComparable}
                onChange={(event) => {
                  clocksComparableRef.current = event.target.checked;
                  setClocksComparable(event.target.checked);
                }}
                className="mt-1 accent-[var(--accent)]"
              />
              <span>I verified this browser’s clock is synchronized with the host clock within 50 ms. Otherwise cross-client latency and drift are omitted.</span>
            </label>
            <p className="mt-2 leading-5">Open browser developer tools and filter the Console for “WatchParty playback metric”. Event IDs use room ID and playback state version.</p>
          </details>
        )}

        <section className="mt-5">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{room?.display_name ?? "WatchParty room"}</h1>
              <p className="mt-1.5 text-sm text-[#92949a]">A shared movie night, wherever you are.</p>
            </div>
            <p className="rounded-full border border-white/10 bg-[var(--surface)] px-3 py-1.5 text-xs text-[#c4c5c6]">{isHost ? "You are hosting" : "Watching with the host"}</p>
          </div>

          {isHost && (
            <form onSubmit={selectMedia} className="mb-4 rounded-2xl border border-white/10 bg-[var(--surface)] p-3 sm:p-4">
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  id="room-media-url"
                  type="url"
                  value={mediaUrl}
                  onChange={(event) => setMediaUrl(event.target.value)}
                  aria-label="Video URL for this room"
                  placeholder="YouTube link or direct MP4/WebM URL"
                  className="min-w-0 flex-1 rounded-lg border border-white/15 bg-[var(--background)] px-3.5 py-2.5 text-sm text-white outline-none placeholder:text-[#777980] focus:border-[var(--accent-focus)]/70 focus:ring-2 focus:ring-[var(--accent-focus)]/20"
                />
                <button type="submit" disabled={!playback} className="rounded-lg bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-[var(--accent-foreground)] transition hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">Set video</button>
              </div>
            </form>
          )}

          <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(19rem,1fr)] lg:items-start xl:gap-5">
            <div className="min-w-0 space-y-4">
              <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-black shadow-2xl">
                {activeMedia.kind === "youtube" ? (
                  <YouTubePlayerFrame
                    key={`${activeMedia.id}:${isHost ? "host" : "viewer"}`}
                    ref={youtubeRef}
                    videoId={activeMedia.id}
                    isHost={isHost}
                    playback={playback}
                    clockComparisonConfirmed={clocksComparable}
                    onPlay={(position, duration) => void saveHostPlayback(true, position, duration, "play")}
                    onPause={(position, duration) => void saveHostPlayback(false, position, duration, "pause")}
                    onSeek={(position, playing, duration, detectedAtMs) => void saveHostSeek(position, playing, duration, detectedAtMs)}
                    onMutedChange={setIsMuted}
                    onError={setErrorMessage}
                  />
                ) : (
                  <video
                    ref={videoRef}
                    key={activeMedia.url}
                    className="aspect-video w-full bg-black"
                    src={activeMedia.url}
                    controls={isHost}
                    playsInline
                    muted={!isHost && isMuted}
                    onLoadedMetadata={handleMetadataLoaded}
                    onPlay={() => void saveHostPlayback(true)}
                    onPause={() => void saveHostPlayback(false)}
                    onSeeking={() => { directSeekStartedAt.current = Date.now(); }}
                    onSeeked={handleDirectVideoSeeked}
                    onError={() => setErrorMessage("This direct video could not be loaded. Check the URL and try an MP4 or WebM file.")}
                    aria-label="WatchParty shared video"
                  />
                )}
                <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden" aria-hidden="true">
                  {roomReactions.map((reaction) => (
                    <span
                      key={reaction.id}
                      className="wp-floating-reaction absolute bottom-[7%] text-3xl drop-shadow-[0_3px_12px_rgba(0,0,0,.7)] sm:text-4xl"
                      style={{ left: `${reaction.left}%`, "--reaction-drift": `${reaction.drift}px` } as FloatingReactionStyle}
                      onAnimationEnd={() => removeRoomReaction(reaction.id)}
                    >
                      {reaction.emoji}
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-[#a5a7aa]">{isHost ? "Use the player controls to play, pause, and seek. Changes sync to room members." : "Playback follows the host. Turn sound on for this device when you are ready."}</p>
                {!isHost && <button type="button" onClick={toggleMute} className="rounded-xl border border-white/15 px-4 py-2.5 text-sm transition hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-focus)]">{isMuted ? "Turn sound on" : "Turn sound off"}</button>}
              </div>
              {isHost && (
                <div className="flex flex-wrap gap-2" aria-label="Playback skip controls">
                  <button
                    type="button"
                    onClick={() => handleSkip("rewind")}
                    aria-label={`Rewind ${nextSkip.direction === "rewind" ? nextSkip.seconds : 10} seconds`}
                    className="rounded-xl border border-white/15 px-4 py-2.5 text-sm font-medium text-[#e7e5de] transition hover:border-[var(--accent)]/60 hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-focus)]"
                  >
                    <span aria-hidden="true">↶</span> Rewind <span className="ml-1 text-[var(--accent-text)]">{nextSkip.direction === "rewind" ? nextSkip.seconds : 10}s</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSkip("forward")}
                    aria-label={`Skip forward ${nextSkip.direction === "forward" ? nextSkip.seconds : 10} seconds`}
                    className="rounded-xl border border-white/15 px-4 py-2.5 text-sm font-medium text-[#e7e5de] transition hover:border-[var(--accent)]/60 hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-focus)]"
                  >
                    Skip forward <span className="ml-1 text-[var(--accent-text)]">{nextSkip.direction === "forward" ? nextSkip.seconds : 10}s</span> <span aria-hidden="true">↷</span>
                  </button>
                </div>
              )}
            </div>
            <div className="grid min-w-0 content-start gap-4">
              <RoomMembersPanel
                members={roomMembers}
                onlineUserIds={onlineUserIds}
                presenceStatus={presenceStatus}
                hostUserId={room?.host_user_id ?? null}
                currentUserId={currentUserId}
                isHost={isHost}
                isLoading={roomMembersLoading}
                transferPending={hostTransferPending}
                message={roomMembersMessage}
                onTransfer={transferRoomHost}
              />
              {currentUserId && <RoomChat roomId={roomId} userId={currentUserId} onFloatingReaction={showRoomReaction} />}
            </div>
            <div className="min-w-0 space-y-4 lg:col-start-1 lg:row-start-2">
              <RoomPlaylist
                items={playlistItems}
                currentMediaId={playback?.video_id ?? null}
                isLoading={playlistLoading}
                isAdding={playlistAdding}
                removingItemId={removingPlaylistItemId}
                error={playlistError}
                isHost={isHost}
                onAdd={addPlaylistItem}
                onRemove={(itemId) => void removePlaylistItem(itemId)}
                onPlay={(item) => void playPlaylistItem(item)}
              />
              <RoomPolls
                polls={polls}
                currentUserId={currentUserId}
                isHost={isHost}
                isLoading={pollsLoading}
                isCreating={pollCreating}
                votingPollId={votingPollId}
                error={pollError}
                message={pollMessage}
                onCreate={createRoomPoll}
                onVote={castPollVote}
              />
            </div>
          </div>
          <div className="mt-4">
            <MovieDiscovery
              movies={MOVIES}
              currentGenres={currentGenrePreferences}
              preferenceMessage={genrePreferenceMessage}
              preferencesByMember={groupGenrePreferences}
              onPreferencesChange={updateGenrePreferences}
            />
          </div>
          {errorMessage && (
            <div className="mt-4 rounded-xl border border-[var(--danger)]/20 bg-[var(--danger)]/[.06] px-4 py-3 text-sm leading-6 text-[var(--danger)]" role="alert">
              {errorMessage}
              {activeMedia.kind === "youtube" && (
                <a className="ml-2 underline underline-offset-4" href={`https://www.youtube.com/watch?v=${activeMedia.id}`} target="_blank" rel="noopener noreferrer">Open on YouTube</a>
              )}
            </div>
          )}
          {!playback && <p className="mt-4 text-xs text-[#85878b]">Waiting for the room playback record…</p>}
        </section>
      </div>
    </main>
  );
}
