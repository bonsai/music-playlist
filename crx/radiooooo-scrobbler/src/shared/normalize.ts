import { parseDurationToSeconds } from "./scrobble";
import type { MetaSource, TrackMeta } from "./types";

export const RADIOOOOO_HOSTS = ["app.radiooooo.com"];

function str(v: unknown): string | undefined {
  if (typeof v === "string") {
    const t = v.trim();
    return t.length > 0 ? t : undefined;
  }
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return undefined;
}

function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
}

const ARTIST_SUFFIXES = /\s+[-–—]\s+\d{4}$/;

/**
 * Radiooooo builds its MediaSession title as `${title} | ${COUNTRY} ${year}`,
 * which is not scrobble-safe. Keep only the leading segment.
 */
export function stripRadioooooTitleSuffix(title: string): string {
  const idx = title.indexOf(" | ");
  return (idx > 0 ? title.slice(0, idx) : title).trim();
}

/** Normalise "Artist - Album", "Artist – Album" or "Artist — Album". */
export function splitArtistAlbum(text: string): { artist: string; album?: string } {
  const cleaned = text.replace(ARTIST_SUFFIXES, "").trim();
  const m = cleaned.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (!m || !m[1] || !m[2]) return { artist: cleaned };
  return { artist: m[1].trim(), album: m[2].trim() };
}

export function normaliseWhitespace(v: string): string {
  return v.replace(/\s+/g, " ").trim();
}

function coverUrlFrom(raw: unknown, assetBase: string): string | undefined {
  if (typeof raw === "string" && raw.startsWith("http")) return raw;
  if (raw && typeof raw === "object") {
    const c = raw as { path?: unknown; filename?: unknown; url?: unknown };
    const path = str(c.path);
    const filename = str(c.filename);
    if (typeof c.url === "string" && c.url.startsWith("http")) return c.url;
    if (path && filename) return `${assetBase}/${path}medium/${filename}`;
  }
  return undefined;
}

/**
 * Tier 1 — the app's own `/track/play/<id>` payload. This is the only source
 * that reliably carries album, duration and the Radiooooo track id.
 *
 * @param assetBase Origin serving `/asset/image/track/...`.
 */
export function normaliseTrackPayload(
  raw: unknown,
  assetBase: string,
  source: MetaSource = "network",
): TrackMeta | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;

  const artist = str(t.artist);
  const title = str(t.title) ?? str(t.name);
  if (!artist || !title) return null;

  // The player echoes this shape; a bare `links` object without a title is not a track.
  const looksLikeTrack =
    t.links !== undefined ||
    num(t.length) !== undefined ||
    t.album !== undefined ||
    t.cover !== undefined ||
    t._id !== undefined;
  if (!looksLikeTrack) return null;

  const meta: TrackMeta = {
    artist: normaliseWhitespace(artist),
    track: normaliseWhitespace(stripRadioooooTitleSuffix(title)),
    source,
  };
  const id = str(t._id) ?? str(t.id);
  if (id) meta.id = id;
  const album = str(t.album);
  if (album) meta.album = normaliseWhitespace(album);
  const duration = num(t.length) ?? num(t.duration);
  if (duration !== undefined) meta.duration = duration;
  const year = num(t.year);
  if (year !== undefined) meta.year = Math.round(year);
  const country = str(t.country);
  if (country) meta.country = country;
  const mood = str(t.mood);
  if (mood) meta.mood = mood;
  const songwriter = str(t.songwriter);
  if (songwriter) meta.songwriter = songwriter;
  const cover = coverUrlFrom(t.cover, assetBase);
  if (cover) meta.coverUrl = cover;
  return meta;
}

/** Tier 2 — `navigator.mediaSession.metadata`, which Radiooooo sets on web. */
export function normaliseMediaSession(
  input: MediaMetadata | null | undefined,
): TrackMeta | null {
  if (!input) return null;
  // `duration` and `artwork` are set by Radiooooo but missing from older lib.dom types.
  const md = input as MediaMetadata & {
    duration?: number;
    artwork?: ReadonlyArray<{ src?: string }>;
  };
  const artist = normaliseWhitespace(md.artist ?? "");
  const rawTitle = normaliseWhitespace(md.title ?? "");
  if (!artist || !rawTitle) return null;

  const meta: TrackMeta = {
    artist,
    track: normaliseWhitespace(stripRadioooooTitleSuffix(rawTitle)),
    source: "media-session",
  };
  const album = normaliseWhitespace(md.album ?? "");
  if (album && album !== "undefined" && album !== "null") meta.album = album;
  if (typeof md.duration === "number" && Number.isFinite(md.duration) && md.duration > 0) {
    meta.duration = md.duration;
  }
  const artwork = md.artwork?.[0];
  if (artwork?.src) meta.coverUrl = artwork.src;
  return meta;
}

/** Last-resort DOM scrape; the two roots are the desktop and mobile player bars. */
export function normaliseFromDom(doc: Document): TrackMeta | null {
  const roots = [
    doc.querySelector(".track-container"),
    doc.querySelector("aside.now"),
  ].filter((el): el is Element => el !== null);

  for (const root of roots) {
    const titleEl = root.querySelector<HTMLElement>(".info .title, .body .title, .title");
    const artistEl = root.querySelector<HTMLElement>(".info .artist, .body .artist, .artist");
    const rawTitle = normaliseWhitespace(titleEl?.textContent ?? "");
    if (!rawTitle) continue;

    const rawArtist = normaliseWhitespace((artistEl?.textContent ?? "").replace(/\s+/g, " "));
    const { artist, album } = splitArtistAlbum(rawArtist);
    if (!artist) continue;

    const durationText = normaliseWhitespace(
      root.querySelector<HTMLElement>(".duration, .progress .duration, .time")?.textContent ?? "",
    );
    const duration = durationText.includes(":")
      ? parseDurationToSeconds(durationText) ?? undefined
      : undefined;

    const meta: TrackMeta = {
      artist,
      track: normaliseWhitespace(stripRadioooooTitleSuffix(rawTitle)),
      source: "dom",
    };
    if (album) meta.album = album;
    if (duration !== undefined && duration > 0) meta.duration = duration;
    return meta;
  }
  return null;
}

/** Richer merge: a lower tier only fills gaps the higher tier left open. */
export function mergeMeta(high: TrackMeta, low: TrackMeta | null): TrackMeta {
  if (!low) return high;
  const out: TrackMeta = { ...high };
  if (!out.id && low.id) out.id = low.id;
  if (!out.album && low.album) out.album = low.album;
  if (!out.duration && low.duration) out.duration = low.duration;
  if (!out.year && low.year) out.year = low.year;
  if (!out.country && low.country) out.country = low.country;
  if (!out.coverUrl && low.coverUrl) out.coverUrl = low.coverUrl;
  if (!out.mood && low.mood) out.mood = low.mood;
  if (!out.songwriter && low.songwriter) out.songwriter = low.songwriter;
  return out;
}