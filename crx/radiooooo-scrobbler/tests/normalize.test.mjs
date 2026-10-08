import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { importTs } from "./helpers/bundle.mjs";

const N = await importTs("shared/normalize.ts", "normalize");
const {
  mergeMeta,
  normaliseFromDom,
  normaliseMediaSession,
  normaliseTrackPayload,
  splitArtistAlbum,
  stripRadioooooTitleSuffix,
} = N;

const ASSET = "https://app.radiooooo.com/asset/image/track/large";

/** A real `/track/play/<id>` response, trimmed to the fields the player reads. */
const trackPayload = {
  _id: "5f2b9c",
  title: "Che Che",
  artist: "Simple Symmetry",
  album: "Sorry! We Did Something Wrong",
  length: 176,
  year: 2022,
  country: "US",
  mood: "Balearic Beat",
  songwriter: "Emily Balfe",
  decade: "2020",
  likes: 12,
  liked: 0,
  cover: { path: "5f2b9c/", filename: "cover.png" },
  links: { "1": { url: "https://asset.radiooooo.com/…" } },
};

test("keeps every field from a track/play payload", () => {
  const meta = normaliseTrackPayload(trackPayload, ASSET);
  assert.ok(meta);
  assert.equal(meta.artist, "Simple Symmetry");
  assert.equal(meta.track, "Che Che");
  assert.equal(meta.album, "Sorry! We Did Something Wrong");
  assert.equal(meta.duration, 176);
  assert.equal(meta.year, 2022);
  assert.equal(meta.country, "US");
  assert.equal(meta.id, "5f2b9c");
  assert.equal(meta.source, "network");
  assert.equal(meta.coverUrl, `${ASSET}/5f2b9c/medium/cover.png`);
});

test("rejects payloads that are not tracks", () => {
  assert.equal(normaliseTrackPayload({ error: "no track" }, ASSET), null);
  assert.equal(normaliseTrackPayload({ artist: "A", links: {} }, ASSET), null);
  assert.equal(normaliseTrackPayload({ artist: "A", title: "B" }, ASSET), null);
  assert.equal(normaliseTrackPayload(null, ASSET), null);
  assert.equal(normaliseTrackPayload("Che Che", ASSET), null);
});

test("a payload with only artist/title/length is still a track", () => {
  const meta = normaliseTrackPayload({ artist: "A", title: "B", length: 200 }, ASSET);
  assert.equal(meta?.track, "B");
});

test("strips the ` | COUNTRY YEAR` suffix Radiooooo puts in MediaSession titles", () => {
  assert.equal(stripRadioooooTitleSuffix("Che Che | US 2022"), "Che Che");
  assert.equal(stripRadioooooTitleSuffix("Wonderwall | GB 1995"), "Wonderwall");
  assert.equal(stripRadioooooTitleSuffix("An Ordinary Song"), "An Ordinary Song");
  assert.equal(stripRadioooooTitleSuffix("| leading pipe"), "| leading pipe");
});

test("normalises a MediaMetadata object", () => {
  const meta = normaliseMediaSession({
    artist: "Simple Symmetry",
    title: "Che Che | US 2022",
    album: "Sorry! We Did Something Wrong",
    duration: 176,
    artwork: [{ src: "https://app.radiooooo.com/…/cover.png" }],
  });
  assert.ok(meta);
  assert.equal(meta.track, "Che Che");
  assert.equal(meta.album, "Sorry! We Did Something Wrong");
  assert.equal(meta.duration, 176);
  assert.equal(meta.source, "media-session");
  assert.equal(normaliseMediaSession(null), null);
  assert.equal(normaliseMediaSession({ artist: "A", title: "" }), null);
});

test("splits `Artist — Album` the way the bottom bar renders it", () => {
  assert.deepEqual(splitArtistAlbum("Simple Symmetry — Sorry! We Did Something Wrong"), {
    artist: "Simple Symmetry",
    album: "Sorry! We Did Something Wrong",
  });
  assert.deepEqual(splitArtistAlbum("Simple Symmetry"), { artist: "Simple Symmetry" });
  assert.deepEqual(splitArtistAlbum("Simple Symmetry - 2022"), { artist: "Simple Symmetry" });
});

test("scrapes the desktop track container", () => {
  const dom = new JSDOM(`<!doctype html><body>
    <div class="track-container">
      <div class="inner"><div class="body"><div class="info">
        <div class="title">Che Che</div>
        <div class="artist">Simple Symmetry — Sorry! We Did Something Wrong</div>
        <div class="progress"><span class="duration">2:56</span></div>
      </div></div></div>
    </div></body>`);
  const meta = normaliseFromDom(dom.window.document);
  assert.ok(meta);
  assert.equal(meta.artist, "Simple Symmetry");
  assert.equal(meta.track, "Che Che");
  assert.equal(meta.album, "Sorry! We Did Something Wrong");
  assert.equal(meta.duration, 176);
  assert.equal(meta.source, "dom");
});

test("ignores the player settings panel, which also uses .title", () => {
  const dom = new JSDOM(`<!doctype html><body>
    <div class="player"><div class="head"><div class="title">Player</div></div></div>
  </body>`);
  assert.equal(normaliseFromDom(dom.window.document), null);
});

test("the network tier wins and lower tiers only fill gaps", () => {
  const net = normaliseTrackPayload(trackPayload, ASSET);
  const dom = normaliseFromDom(
    new JSDOM(`<!doctype html><body><div class="track-container"><div class="title">Che Che</div><div class="artist">Simple Symmetry</div></div></body>`)
      .window.document,
  );
  assert.ok(net && dom);
  const merged = mergeMeta(net, dom);
  assert.equal(merged.source, "network");
  assert.equal(merged.album, "Sorry! We Did Something Wrong");
  assert.equal(merged.duration, 176);
  assert.equal(merged.id, "5f2b9c");
});

test("a DOM-only reading still contributes its duration", () => {
  const dom = normaliseFromDom(
    new JSDOM(`<!doctype html><body><aside class="now"><div class="title">Take On Me</div><div class="artist">a-ha</div><span class="duration">3:47</span></aside></body>`)
      .window.document,
  );
  assert.ok(dom);
  const merged = mergeMeta({ artist: "a-ha", track: "Take On Me", source: "media-session" }, dom);
  assert.equal(merged.duration, 227);
  assert.equal(merged.source, "media-session");
});