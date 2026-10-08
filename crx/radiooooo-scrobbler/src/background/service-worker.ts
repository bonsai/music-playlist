import {
  FLUSH_ALARM,
  FLUSH_PERIOD_MINUTES,
  SCROBBLE_BATCH_SIZE,
} from "../shared/constants";
import { credsFrom, LastFmError, lastfm } from "../shared/lastfm";
import { evaluateScrobbleRule, trackKey } from "../shared/scrobble";
import type {
  LogEntry,
  NowPlaying,
  PersistedState,
  PlaybackReport,
  PlayRecord,
  RuntimeMessage,
  ScrobbleRecord,
  Settings,
  StateSnapshot,
  TrackMeta,
} from "../shared/types";
import { store } from "./store";

const NP_RESEND_AFTER_MS = 30_000;
/** Playback ticks arrive every couple of seconds; persist them far less often. */
const FLUSH_DEBOUNCE_MS = 10_000;

let flushing = false;
let flushTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = undefined;
    void store.flush();
  }, FLUSH_DEBOUNCE_MS);
}

function log(
  state: PersistedState,
  kind: LogEntry["kind"],
  ok: boolean,
  extra: Partial<Omit<LogEntry, "at" | "kind" | "ok">> = {},
): void {
  const entry: LogEntry = { at: Date.now(), kind, ok, ...extra };
  state.log.push(entry);
  if (state.log.length > state.settings.logLimit) {
    state.log.splice(0, state.log.length - state.settings.logLimit);
  }
  if (state.settings.debug) console.debug("[radioooo-scrobbler]", entry);
}

function creds(state: PersistedState) {
  return credsFrom(state.settings, state.sessionKey);
}

function isAuthenticated(state: PersistedState): boolean {
  return Boolean(state.settings.apiKey && state.settings.apiSecret && state.sessionKey);
}

function snapshot(state: PersistedState): StateSnapshot {
  return {
    settings: state.settings,
    sessionName: state.settings.sessionName,
    authenticated: isAuthenticated(state),
    queue: state.queue,
    log: state.log,
    plays: state.plays,
    nowPlaying: state.nowPlaying,
    lastFlushAt: state.lastFlushAt,
  };
}

/* ---------------------------------------------------------- play history */

function playId(meta: TrackMeta, startedAt: number): string {
  return `${startedAt}-${meta.artist}-${meta.track}`.slice(0, 120);
}

/** The play record a scrobble belongs to: newest same-track row that is unfinished. */
function findPlay(state: PersistedState, artist: string, track: string): PlayRecord | undefined {
  for (let i = state.plays.length - 1; i >= 0; i -= 1) {
    const p = state.plays[i];
    if (p && !p.scrobbled && trackKey(p.artist, p.track) === trackKey(artist, track)) return p;
  }
  return undefined;
}

function prunePlays(state: PersistedState): void {
  const limit = state.settings.playLogLimit;
  if (state.plays.length > limit) state.plays.splice(0, state.plays.length - limit);
}

/** Appends a row for a newly detected track. */
function openPlay(state: PersistedState, meta: TrackMeta, startedAt: number): PlayRecord {
  const record: PlayRecord = {
    id: playId(meta, startedAt),
    source: "radiooooo",
    tier: meta.source,
    artist: meta.artist,
    track: meta.track,
    startedAt,
    listenedSec: 0,
    scrobbled: false,
  };
  if (meta.album) record.album = meta.album;
  if (meta.duration) record.duration = meta.duration;
  if (meta.year) record.year = meta.year;
  if (meta.country) record.country = meta.country;
  if (meta.mood) record.mood = meta.mood;
  if (meta.coverUrl) record.coverUrl = meta.coverUrl;
  if (meta.id) record.radiooooId = meta.id;
  state.plays.push(record);
  prunePlays(state);
  return record;
}

/**
 * Updates the row for the current track. Called on every playback tick, so it
 * must stay cheap; `listenedSec` only ever moves forward.
 */
function touchPlay(state: PersistedState, listenedSec: number): void {
  const np = state.nowPlaying;
  if (!np.meta || !np.report) return;
  const record = findPlay(state, np.meta.artist, np.meta.track);
  if (!record) return;
  if (listenedSec > record.listenedSec) record.listenedSec = Math.round(listenedSec);
  record.duration = record.duration ?? np.meta.duration;
}

/** Freezes the current row with its final listen time and scrobble verdict. */
function closePlay(state: PersistedState): void {
  const np = state.nowPlaying;
  if (!np.meta || !np.report) return;
  const record = findPlay(state, np.meta.artist, np.meta.track);
  if (!record) return;
  record.listenedSec = Math.max(record.listenedSec, Math.round(np.report.listenedSec));
  const verdict = evaluateScrobbleRule({
    durationSec: record.duration,
    listenedSec: record.listenedSec,
  });
  record.rule = { thresholdSec: verdict.thresholdSec, met: verdict.scrobble };
}

function pruneQueue(state: PersistedState): void {
  const ttl = state.settings.queueTtlMs;
  const now = Date.now();
  const before = state.queue.length;
  state.queue = state.queue.filter((r) => now - r.createdAt <= ttl);
  if (state.queue.length !== before) {
    state.queue.sort((a, b) => a.timestamp - b.timestamp);
  }
  const limit = state.settings.queueLimit;
  if (state.queue.length > limit) {
    state.queue.splice(0, state.queue.length - limit);
  }
}

/* ---------------------------------------------------------------- now playing */

function setNowPlaying(state: PersistedState, meta: TrackMeta, report: PlaybackReport): void {
  state.nowPlaying = {
    meta,
    report,
    bridgeAlive: state.nowPlaying.bridgeAlive,
    updatedAt: Date.now(),
    lastNpAttemptAt: 0,
  };
}

async function sendNowPlaying(state: PersistedState): Promise<void> {
  const np: NowPlaying = state.nowPlaying;
  const meta = np.meta;
  if (!meta || !np.report || np.report.state !== "playing") return;
  if (!state.settings.enabled || !state.settings.submitNowPlaying) return;
  if (!isAuthenticated(state)) return;
  np.lastNpAttemptAt = Date.now();

  try {
    await lastfm.updateNowPlaying(creds(state), {
      artist: meta.artist,
      track: meta.track,
      album: meta.album,
      duration: meta.duration,
    });
    log(state, "now-playing-sent", true, {
      track: `${meta.artist} — ${meta.track}`,
      detail: `source=${meta.source}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(state, "now-playing-failed", false, {
      track: `${meta.artist} — ${meta.track}`,
      detail: message,
    });
  }
}

/* ------------------------------------------------------------------- queue */

async function flushQueue(state: PersistedState, reason: string): Promise<void> {
  if (flushing) return;
  if (!isAuthenticated(state)) return;
  pruneQueue(state);
  if (state.queue.length === 0) {
    state.lastFlushAt = Date.now();
    return;
  }
  if (!state.settings.submitScrobbles) return;

  flushing = true;
  try {
    const ordered = [...state.queue].sort((a, b) => a.timestamp - b.timestamp);
    for (let i = 0; i < ordered.length; i += SCROBBLE_BATCH_SIZE) {
      const batch = ordered.slice(i, i + SCROBBLE_BATCH_SIZE);
      let ok = false;
      try {
        await lastfm.scrobble(creds(state), batch);
        const ids = new Set(batch.map((b) => b.id));
        state.queue = state.queue.filter((r) => !ids.has(r.id));
        for (const r of batch) {
          const play = findPlay(state, r.artist, r.track);
          if (play) {
            play.scrobbled = true;
            play.scrobbledAt = Date.now();
            play.queued = false;
          }
        }
        log(state, "flush", true, { detail: `${reason}: ${batch.length} accepted`, data: { batch: batch.length } });
        ok = true;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const retriable = err instanceof LastFmError ? err.retriable : true;
        for (const r of batch) {
          r.attempts += 1;
          r.lastError = message;
        }
        if (!retriable) {
          // Auth/permission problems: stop hammering, keep the data.
          const ids = new Set(batch.map((b) => b.id));
          state.queue = state.queue.filter((r) => !ids.has(r.id));
          log(state, "flush", false, { detail: `${reason}: dropping ${batch.length} — ${message}` });
        } else {
          log(state, "flush", false, { detail: `${reason}: ${batch.length} deferred — ${message}` });
        }
        state.lastFlushAt = Date.now();
        if (!ok) break;
      }
    }
    state.lastFlushAt = Date.now();
  } finally {
    flushing = false;
  }
}

/* ------------------------------------------------------------------ handlers */

function onTrack(state: PersistedState, meta: TrackMeta, startedAt: number | null): void {
  const prev = state.nowPlaying.meta;
  const changed = !prev || trackKey(prev.artist, prev.track) !== trackKey(meta.artist, meta.track);

  const report: PlaybackReport = {
    state: startedAt === null ? "paused" : "playing",
    listenedSec: 0,
    startedAt,
    positionSec: 0,
    source: meta.source,
  };
  if (changed) closePlay(state);
  setNowPlaying(state, meta, report);
  if (startedAt !== null) openPlay(state, meta, startedAt);
  log(state, "track-detected", true, {
    track: `${meta.artist} — ${meta.track}`,
    detail: `source=${meta.source}${changed ? "" : " (repeat)"}`,
    data: { album: meta.album, duration: meta.duration, id: meta.id },
  });
  if (changed && startedAt !== null) void sendNowPlaying(state);
}

function onPlayback(state: PersistedState, report: PlaybackReport): void {
  const np = state.nowPlaying;
  if (!np.meta) return;
  const wasPlaying = np.report?.state === "playing";
  np.report = report;
  np.updatedAt = Date.now();
  touchPlay(state, report.listenedSec);

  // Resend Now Playing when a paused track resumes, but not on every tick.
  if (
    report.state === "playing" &&
    !wasPlaying &&
    Date.now() - np.lastNpAttemptAt > NP_RESEND_AFTER_MS
  ) {
    void sendNowPlaying(state);
  }
}

function onScrobbleReady(
  state: PersistedState,
  payload: Omit<ScrobbleRecord, "id" | "createdAt" | "attempts">,
): void {
  if (!state.settings.enabled || !state.settings.submitScrobbles) return;

  const record: ScrobbleRecord = {
    ...payload,
    id: `${payload.timestamp}-${payload.artist}-${payload.track}`.slice(0, 120),
    createdAt: Date.now(),
    attempts: 0,
  };
  if (state.queue.some((r) => r.id === record.id)) return;

  state.queue.push(record);
  pruneQueue(state);
  const play = findPlay(state, record.artist, record.track);
  if (play) play.queued = true;
  log(state, "scrobble-queued", true, {
    track: `${record.artist} — ${record.track}`,
    detail: `queue=${state.queue.length}`,
  });
  void flushQueue(state, "queue");
}

async function handleAuthToken(state: PersistedState, token: string): Promise<void> {
  const session = await lastfm.getSession(credsFrom(state.settings), token);
  state.sessionKey = session.key;
  state.settings.sessionKey = session.key;
  state.settings.sessionName = session.name;
  log(state, "auth-changed", true, { detail: `signed in as ${session.name}` });
}

async function handleMessage(
  msg: RuntimeMessage,
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  const state = await store.load();

  switch (msg.type) {
    case "hello": {
      state.nowPlaying.bridgeAlive = msg.bridgeAlive;
      state.nowPlaying.updatedAt = Date.now();
      scheduleFlush();
      return snapshot(state);
    }
    case "track":
      onTrack(state, msg.meta, msg.startedAt);
      // A track change is rare and worth surfacing immediately.
      await store.flush();
      return { ok: true };
    case "playback":
      onPlayback(state, msg.report);
      scheduleFlush();
      return { ok: true };
    case "scrobble-ready":
      onScrobbleReady(state, msg.record);
      return { ok: true, queued: state.queue.length };
    case "get-state":
      return snapshot(state);
    case "get-log":
      return { log: state.log, queue: state.queue };
    case "get-plays":
      return state.plays;
    case "save-settings": {
      const patch: Partial<Settings> = { ...msg.patch };
      delete (patch as { sessionKey?: string }).sessionKey;
      Object.assign(state.settings, patch);
      await store.flush();
      return snapshot(state);
    }
    case "request-token": {
      if (!state.settings.apiKey) throw new Error("API key is required first");
      const token = await lastfm.getToken(credsFrom(state.settings));
      await chrome.tabs.create({ url: lastfm.authUrl(state.settings.apiKey, token, state.settings.authRedirectUri) });
      log(state, "auth-changed", true, { detail: "auth window opened" });
      return { ok: true, token };
    }
    case "complete-auth":
      await handleAuthToken(state, msg.token.trim());
      await store.flush();
      return snapshot(state);
    case "logout":
      state.sessionKey = "";
      state.settings.sessionKey = "";
      state.settings.sessionName = null;
      await store.flush();
      log(state, "auth-changed", true, { detail: "signed out" });
      return snapshot(state);
    case "flush-now":
      await flushQueue(state, "manual");
      await store.flush();
      return { ok: true, flushed: state.lastFlushAt };
    case "clear-log":
      state.log = [];
      await store.flush();
      return snapshot(state);
    case "clear-plays":
      state.plays = [];
      log(state, "diagnostics", true, { detail: "play history cleared" });
      await store.flush();
      return snapshot(state);
    case "test-auth": {
      const name = await lastfm.validateSession(creds(state));
      state.settings.sessionName = name;
      await store.flush();
      return { ok: true, name };
    }
    default: {
      const _exhaustive: never = msg;
      void _exhaustive;
      void sender;
      return { ok: false };
    }
  }
}

/* ------------------------------------------------------------------- wiring */

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(FLUSH_ALARM, { periodInMinutes: FLUSH_PERIOD_MINUTES, delayInMinutes: 1 });
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(FLUSH_ALARM, { periodInMinutes: FLUSH_PERIOD_MINUTES, delayInMinutes: 1 });
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== FLUSH_ALARM) return;
  void store.load().then((state) => flushQueue(state, "alarm")).then(() => store.flush());
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  void sender;
  handleMessage(msg as RuntimeMessage, sender).then(
    (result) => sendResponse({ ok: true, result }),
    (err: unknown) =>
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
  );
  return true;
});

void store.load().then((state) => {
  chrome.alarms.create(FLUSH_ALARM, { periodInMinutes: FLUSH_PERIOD_MINUTES, delayInMinutes: 1 });
  if (state.queue.length > 0) void flushQueue(state, "startup").then(() => store.flush());
});