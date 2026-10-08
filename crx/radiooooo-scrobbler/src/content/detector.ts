/**
 * Isolated-world half of the Radioooo detector.
 *
 * Responsibilities:
 *  - merge the three metadata tiers (network > MediaSession > DOM)
 *  - follow the real <audio> element(s) Radioooo plays through
 *  - accumulate *actually listened* time, pause-aware
 *  - fire `track` once per change and `scrobble-ready` once per play-through
 */

import { RADIOOOOO_HOSTS } from "../shared/normalize";
import { mergeMeta, normaliseFromDom, normaliseMediaSession, normaliseTrackPayload } from "../shared/normalize";
import { evaluateScrobbleRule, trackKey } from "../shared/scrobble";
import type { MetaSource, PlaybackReport, PlaybackState, TrackMeta } from "../shared/types";

const BRIDGE_EVENT = "radioooo-scrobbler:bridge";
const REPLAY_EVENT = "radioooo-scrobbler:replay";
const ASSET_BASE = "https://app.radiooooo.com/asset/image/track/large";
const POLL_MS = 1_000;
/** Ignore sub-second jitter when deciding the track changed. */
const TRACK_KEY_GRACE_MS = 500;

interface TierState {
  network: TrackMeta | null;
  mediaSession: TrackMeta | null;
  dom: TrackMeta | null;
}

const tiers: TierState = { network: null, mediaSession: null, dom: null };
const boundAudio = new WeakSet<HTMLAudioElement>();

interface Playthrough {
  key: string;
  startedAt: number;
  listenedSec: number;
  lastTickAt: number;
  playing: boolean;
  meta: TrackMeta;
  submitted: boolean;
}

let current: Playthrough | null = null;
let lastAnnouncedAt = 0;
let lastReportAt = 0;

function send(message: unknown): void {
  try {
    chrome.runtime.sendMessage(message, () => void chrome.runtime.lastError);
  } catch {
    /* service worker asleep or extension reloading */
  }
}

function sayHello(bridgeAlive: boolean): void {
  send({ type: "hello", bridgeAlive });
}

function bestMeta(): TrackMeta | null {
  const order: Array<[MetaSource, TrackMeta | null]> = [
    ["network", tiers.network],
    ["media-session", tiers.mediaSession],
    ["dom", tiers.dom],
  ];
  let best: TrackMeta | null = null;
  for (const [, meta] of order) {
    if (!meta) continue;
    best = best ? mergeMeta(best, meta) : meta;
  }
  return best;
}

/* ------------------------------------------------------------- track change */

function adopt(meta: TrackMeta): void {
  const key = trackKey(meta.artist, meta.track);
  const now = Date.now();
  const active = current;

  if (active && active.key === key) {
    // Keep accumulating, but refresh the metadata (album/duration arrive late).
    active.meta = mergeMeta(active.meta, meta);
    return;
  }

  const wasPlaying = active?.playing ?? false;
  const carriedOver = now - lastAnnouncedAt < TRACK_KEY_GRACE_MS;
  current = {
    key,
    startedAt: now,
    listenedSec: 0,
    lastTickAt: now,
    playing: false,
    meta,
    submitted: false,
  };
  lastAnnouncedAt = now;

  send({ type: "track", meta, startedAt: carriedOver && wasPlaying ? now : null });
  if (carriedOver && wasPlaying) announceProgress(true);
}

/* --------------------------------------------------------------- reporting */

function announceProgress(force = false): void {
  if (!current) return;
  const now = Date.now();
  if (!force && now - lastReportAt < 2_000) return;
  lastReportAt = now;

  const report: PlaybackReport = {
    state: current.playing ? "playing" : "paused",
    listenedSec: current.listenedSec,
    startedAt: current.startedAt,
    positionSec: 0,
    source: current.meta.source,
  };
  send({ type: "playback", report });
}

function maybeScrobble(audio: HTMLAudioElement): void {
  if (!current || current.submitted) return;
  const duration =
    current.meta.duration && current.meta.duration > 0
      ? current.meta.duration
      : Number.isFinite(audio.duration) && audio.duration > 0
        ? audio.duration
        : undefined;

  const verdict = evaluateScrobbleRule({
    durationSec: duration,
    listenedSec: current.listenedSec,
  });
  if (!verdict.scrobble) return;

  current.submitted = true;
  send({
    type: "scrobble-ready",
    record: {
      artist: current.meta.artist,
      track: current.meta.track,
      album: current.meta.album,
      duration,
      timestamp: Math.floor(current.startedAt / 1000),
      chosenByUser: 0,
      source: current.meta.source,
    },
  });
}

/* ------------------------------------------------------------------- audio */

function playbackStateOf(audio: HTMLAudioElement | null): PlaybackState {
  if (!audio) return "unknown";
  if (audio.ended) return "stopped";
  if (audio.paused) return "paused";
  return "playing";
}

function tick(audio: HTMLAudioElement | null): void {
  const state = playbackStateOf(audio);
  const now = Date.now();

  if (current) {
    if (state === "playing") {
      if (!current.playing) {
        // Resuming starts the clock for this play-through.
        current.playing = true;
        if (current.listenedSec === 0 && now - current.startedAt > TRACK_KEY_GRACE_MS * 4) {
          current.startedAt = now;
        }
      }
      const delta = (now - current.lastTickAt) / 1000;
      // Ignore huge jumps (tab throttling, machine sleep).
      if (delta > 0 && delta < 30) current.listenedSec += delta;
    } else {
      current.playing = false;
    }
    current.lastTickAt = now;
  }

  announceProgress();
  if (state === "playing") maybeScrobble(audio as HTMLAudioElement);
}

function onAudioEvent(audio: HTMLAudioElement): void {
  tick(audio);
}

function bindAudio(audio: HTMLAudioElement): void {
  if (boundAudio.has(audio)) return;
  boundAudio.add(audio);
  for (const ev of ["play", "playing", "pause", "ended", "seeked", "timeupdate", "emptied"] as const) {
    audio.addEventListener(ev, () => onAudioEvent(audio));
  }
}

function currentAudio(): HTMLAudioElement | null {
  const all = [...document.querySelectorAll("audio")];
  if (all.length === 0) return null;
  const playing = all.filter((a) => !a.paused && !a.ended);
  const withSrc = all.filter((a) => a.currentSrc || a.src);
  const pool = withSrc.length > 0 ? withSrc : all;
  return playing[0] ?? pool[0] ?? null;
}

/* ---------------------------------------------------------------- sampling */

function refreshTiers(): void {
  tiers.mediaSession = normaliseMediaSession(
    typeof navigator.mediaSession === "undefined" ? null : navigator.mediaSession.metadata,
  );
  tiers.dom = normaliseFromDom(document);
}

function poll(): void {
  for (const a of document.querySelectorAll("audio")) bindAudio(a);
  refreshTiers();

  const meta = bestMeta();
  if (meta) adopt(meta);

  const audio = currentAudio();
  if (audio) tick(audio);
}

/* -------------------------------------------------------------------- boot */

interface BridgeMessage {
  kind?: "hello" | "track";
  seen?: number;
  payload?: unknown;
}

function relayFromBridge(ev: Event): void {
  const detail = (ev as CustomEvent<string>).detail;
  if (typeof detail !== "string") return;
  let msg: BridgeMessage;
  try {
    msg = JSON.parse(detail) as BridgeMessage;
  } catch {
    return;
  }
  if (msg.kind === "hello") {
    // Deliberately does *not* ask for a replay: the bridge echoes every request,
    // so replying here would loop forever.
    sayHello(true);
    return;
  }
  if (msg.kind === "track") {
    const normalised = normaliseTrackPayload(msg.payload, ASSET_BASE);
    if (!normalised) return;
    tiers.network = normalised;
    if (
      current &&
      trackKey(current.meta.artist, current.meta.track) ===
        trackKey(normalised.artist, normalised.track)
    ) {
      current.meta = mergeMeta(current.meta, normalised);
    }
  }
}

function isRadioooo(): boolean {
  return RADIOOOOO_HOSTS.includes(location.hostname);
}

if (isRadioooo()) {
  document.addEventListener(BRIDGE_EVENT, relayFromBridge);
  // Replay may race the bridge; ask again after the app has booted.
  window.dispatchEvent(new CustomEvent(REPLAY_EVENT));
  setTimeout(() => window.dispatchEvent(new CustomEvent(REPLAY_EVENT)), 1_500);
  setTimeout(() => window.dispatchEvent(new CustomEvent(REPLAY_EVENT)), 4_000);
  poll();
  setInterval(poll, POLL_MS);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      window.dispatchEvent(new CustomEvent(REPLAY_EVENT));
      tick(currentAudio());
    }
  });
  sayHello(Boolean((window as unknown as { __radiooooScrobblerBridge?: unknown }).__radiooooScrobblerBridge));
}