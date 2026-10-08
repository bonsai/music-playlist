import type { LogEntry, PlayRecord, ScrobbleRecord } from "./types";

/**
 * Canonical JSONL row for the play history. Field names are the ones the rest of
 * the bonsai music tooling already reads, so the export drops straight in.
 */
export interface PlayJsonlRow {
  source: "radiooooo";
  tier: string;
  artist: string;
  track: string;
  album?: string;
  duration?: number;
  year?: number;
  country?: string;
  mood?: string;
  track_id?: string;
  started_at: string;
  listened_sec: number;
  scrobbled: boolean;
  scrobbled_at?: string;
  threshold_sec?: number;
}

export function playToJsonl(p: PlayRecord): PlayJsonlRow {
  const row: PlayJsonlRow = {
    source: p.source,
    tier: p.tier,
    artist: p.artist,
    track: p.track,
    started_at: new Date(p.startedAt).toISOString(),
    listened_sec: p.listenedSec,
    scrobbled: p.scrobbled,
  };
  if (p.album) row.album = p.album;
  if (p.duration !== undefined) row.duration = p.duration;
  if (p.year !== undefined) row.year = p.year;
  if (p.country) row.country = p.country;
  if (p.mood) row.mood = p.mood;
  if (p.radiooooId) row.track_id = p.radiooooId;
  if (p.scrobbledAt) row.scrobbled_at = new Date(p.scrobbledAt).toISOString();
  if (p.rule) row.threshold_sec = p.rule.thresholdSec;
  return row;
}

/** Still-pending scrobbles, exported so nothing is lost while offline. */
export function queuedToJsonl(q: ScrobbleRecord): PlayJsonlRow {
  const row: PlayJsonlRow = {
    source: "radiooooo",
    tier: q.source,
    artist: q.artist,
    track: q.track,
    started_at: new Date(q.timestamp * 1000).toISOString(),
    listened_sec: 0,
    scrobbled: false,
  };
  if (q.album) row.album = q.album;
  if (q.duration !== undefined) row.duration = q.duration;
  return row;
}

export function eventToJsonl(e: LogEntry): Record<string, unknown> {
  return {
    source: "radiooooo",
    tier: "event",
    at: new Date(e.at).toISOString(),
    kind: e.kind,
    ok: e.ok,
    track: e.track ?? null,
    detail: e.detail ?? null,
    ...(e.data ?? {}),
  };
}

/** One object per line, no trailing commas, keys in insertion order. */
export function toJsonl(rows: readonly unknown[]): string {
  return rows.length === 0 ? "" : `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`;
}

export function download(filename: string, text: string, mime = "application/x-ndjson"): void {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function stamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "");
}