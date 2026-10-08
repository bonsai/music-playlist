import { test } from "node:test";
import assert from "node:assert/strict";
import { importTs } from "./helpers/bundle.mjs";

const { evaluateScrobbleRule, parseDurationToSeconds, trackKey } = await importTs(
  "shared/scrobble.ts",
  "scrobble",
);

test("parses the mm:ss and hh:mm:ss shapes Radiooooo renders", () => {
  assert.equal(parseDurationToSeconds("00:00"), 0);
  assert.equal(parseDurationToSeconds("2:56"), 176);
  assert.equal(parseDurationToSeconds("10:05"), 605);
  assert.equal(parseDurationToSeconds("1:02:03"), 3723);
  assert.equal(parseDurationToSeconds("--"), null);
  assert.equal(parseDurationToSeconds("3"), null);
  assert.equal(parseDurationToSeconds(""), null);
});

test("three minute track fires at 90s", () => {
  assert.equal(evaluateScrobbleRule({ durationSec: 180, listenedSec: 89 }).scrobble, false);
  const hit = evaluateScrobbleRule({ durationSec: 180, listenedSec: 90 });
  assert.equal(hit.scrobble, true);
  assert.equal(hit.thresholdSec, 90);
});

test("eight minute track fires at the four minute cap", () => {
  const r = evaluateScrobbleRule({ durationSec: 480, listenedSec: 239 });
  assert.equal(r.scrobble, false);
  assert.equal(r.thresholdSec, 240);
  assert.equal(evaluateScrobbleRule({ durationSec: 480, listenedSec: 240 }).scrobble, true);
});

test("tracks of 30s or less never fire", () => {
  assert.equal(evaluateScrobbleRule({ durationSec: 30, listenedSec: 600 }).scrobble, false);
  assert.equal(evaluateScrobbleRule({ durationSec: 20, listenedSec: 600 }).reason, "too-short");
});

test("unknown duration falls back to the four minute rule", () => {
  const r = evaluateScrobbleRule({ durationSec: undefined, listenedSec: 241 });
  assert.equal(r.scrobble, true);
  assert.equal(r.reason, "ok");
  assert.equal(evaluateScrobbleRule({ durationSec: undefined, listenedSec: 10 }).reason, "unknown-duration");
});

test("remaining time is reported so the UI can show a countdown", () => {
  assert.equal(evaluateScrobbleRule({ durationSec: 300, listenedSec: 100 }).remainingSec, 50);
  assert.equal(evaluateScrobbleRule({ durationSec: 300, listenedSec: 200 }).remainingSec, 0);
});

test("trackKey is case and whitespace insensitive", () => {
  assert.equal(trackKey("A-ha", "Take On Me"), trackKey(" a-HA ", "take on me"));
});