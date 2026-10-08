export type MetaSource = "network" | "media-session" | "dom";

/** Normalised now-playing metadata, whatever the detection tier. */
export interface TrackMeta {
  /** Radiooooo track id when known. */
  id?: string;
  artist: string;
  track: string;
  album?: string;
  /** Seconds. */
  duration?: number;
  year?: number;
  country?: string;
  mood?: string;
  songwriter?: string;
  coverUrl?: string;
  source: MetaSource;
}

export type PlaybackState = "playing" | "paused" | "stopped" | "unknown";

/** What the content script reports on every meaningful change. */
export interface PlaybackReport {
  state: PlaybackState;
  /** Seconds of actual listening accumulated for this play-through. */
  listenedSec: number;
  /** Epoch ms when the current play-through began (first play after a change). */
  startedAt: number | null;
  positionSec: number;
  /** Which detection tier supplied the metadata for the current track. */
  source: MetaSource | "none";
}

export interface ScrobbleRecord {
  id: string;
  artist: string;
  track: string;
  album?: string;
  duration?: number;
  /** Epoch seconds, floored — Last.fm's `timestamp`. */
  timestamp: number;
  chosenByUser: 0;
  source: MetaSource;
  createdAt: number;
  attempts: number;
  lastError?: string;
}

/**
 * One row of the local play history. Serialised 1:1 to the JSONL export, which
 * is the canonical shape for downstream analysis.
 */
export interface PlayRecord {
  /** Stable identity: `${startedAt}-${artist}-${track}`. */
  id: string;
  /** Always "radiooooo"; kept distinct from `tier`, which says how we saw it. */
  source: "radiooooo";
  tier: MetaSource;
  artist: string;
  track: string;
  album?: string;
  duration?: number;
  year?: number;
  country?: string;
  mood?: string;
  coverUrl?: string;
  /** Radioooo's own `_id`, used as `track_id` in the JSONL export. */
  radiooooId?: string;
  /** Epoch ms when this play-through started. */
  startedAt: number;
  /** Seconds actually listened at the time it was written out. */
  listenedSec: number;
  scrobbled: boolean;
  scrobbledAt?: number;
  /** Set when the record reached the queue but Last.fm has not accepted it yet. */
  queued?: boolean;
  /** Scrobble rule state at close, for tuning the threshold later. */
  rule?: { thresholdSec: number; met: boolean };
}

export type EventKind =
  | "track-detected"
  | "now-playing-sent"
  | "now-playing-failed"
  | "scrobble-queued"
  | "scrobble-sent"
  | "scrobble-failed"
  | "auth-changed"
  | "flush"
  | "bridge-status"
  | "diagnostics";

/** Row written to the local JSONL-able event log. */
export interface LogEntry {
  at: number;
  kind: EventKind;
  ok: boolean;
  track?: string;
  detail?: string;
  data?: Record<string, unknown>;
}

export interface Settings {
  apiKey: string;
  apiSecret: string;
  sessionKey: string;
  sessionName: string | null;
  enabled: boolean;
  submitNowPlaying: boolean;
  submitScrobbles: boolean;
  /** Redirect URI sent to Last.fm during the web auth flow. */
  authRedirectUri: string;
  /** Max ms a scrobble may wait in the queue before it is dropped. */
  queueTtlMs: number;
  /** Hard cap on the offline queue. */
  queueLimit: number;
  /** Rows kept in the in-extension event log. */
  logLimit: number;
  /** Rows kept in the local play history (the JSONL export). */
  playLogLimit: number;
  debug: boolean;
}

export interface NowPlaying {
  meta: TrackMeta | null;
  report: PlaybackReport | null;
  /** True once the MAIN-world bridge reported in. */
  bridgeAlive: boolean;
  /** Last time playback state or metadata changed. */
  updatedAt: number;
  /** Last `track.updateNowPlaying` attempt, used to rate-limit resends. */
  lastNpAttemptAt: number;
}

export interface PersistedState {
  settings: Settings;
  sessionKey: string;
  queue: ScrobbleRecord[];
  log: LogEntry[];
  plays: PlayRecord[];
  nowPlaying: NowPlaying;
  lastFlushAt: number | null;
}

export type RuntimeMessage =
  | { type: "hello"; bridgeAlive: boolean }
  | { type: "track"; meta: TrackMeta; startedAt: number | null }
  | { type: "playback"; report: PlaybackReport }
  | { type: "scrobble-ready"; record: Omit<ScrobbleRecord, "id" | "createdAt" | "attempts"> }
  | { type: "get-state" }
  | { type: "get-log" }
  | { type: "get-plays" }
  | { type: "save-settings"; patch: Partial<Settings> }
  | { type: "request-token" }
  | { type: "complete-auth"; token: string }
  | { type: "logout" }
  | { type: "flush-now" }
  | { type: "clear-log" }
  | { type: "clear-plays" }
  | { type: "test-auth" };

export interface StateSnapshot {
  settings: Settings;
  sessionName: string | null;
  authenticated: boolean;
  queue: ScrobbleRecord[];
  log: LogEntry[];
  plays: PlayRecord[];
  nowPlaying: NowPlaying;
  lastFlushAt: number | null;
}