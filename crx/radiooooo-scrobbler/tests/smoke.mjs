/**
 * Smoke test: loads the built extension into a real Chromium, opens
 * Radiooooo, and asserts that
 *   1. the service worker starts and persists state,
 *   2. both content scripts evaluate without throwing,
 *   3. the MAIN-world bridge reports metadata into that state.
 *
 * Radiooooo needs a login to actually play, so a full Now Playing round-trip is
 * out of scope here; a synthetic track payload stands in for the real
 * `/track/play/<id>` response.
 *
 *   node tests/smoke.mjs
 */

import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { ROOT, findChromium } from "./helpers/bundle.mjs";

const DIST = path.join(ROOT, "dist");
if (!existsSync(path.join(DIST, "manifest.json"))) {
  throw new Error("dist/manifest.json missing — run `npm run build` first");
}

const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
};

const userDataDir = mkdtempSync(path.join(tmpdir(), "rs-smoke-"));
const browser = await chromium.launchPersistentContext(userDataDir, {
  executablePath: findChromium(),
  headless: true,
  args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
});

const readState = () =>
  browser
    .serviceWorkers()[0]
    .evaluate(async () => {
      const key = "radioooo-scrobbler.state.v1";
      return (await chrome.storage.local.get(key))[key] ?? null;
    });

/** Playback ticks are debounced, so wait for the first persist rather than guessing. */
async function waitForState(timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await readState();
    if (state) return state;
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

try {
  let worker = browser.serviceWorkers()[0];
  if (!worker) worker = await browser.waitForEvent("serviceworker", { timeout: 20_000 });
  check("service worker registered", Boolean(worker), worker.url());

  const page = await browser.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  await page.goto("https://app.radiooooo.com/", {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.waitForTimeout(6_000);

  check(
    "MAIN world bridge installed",
    await page.evaluate(() => Boolean(window.__radiooooScrobblerBridge)),
  );
  check("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));

  const initial = await waitForState();
  check("state persisted", Boolean(initial), JSON.stringify(initial?.settings?.enabled));
  check("content script reported in", initial?.nowPlaying?.updatedAt > 0);

  // Radiooooo plays a track on load, so the network tier is exercised for real —
  // no login needed for the free tier.
  await new Promise((r) => setTimeout(r, 2_000));
  const live = (await readState()) ?? initial;
  const meta = live?.nowPlaying?.meta;
  check("real track captured from the network tier", Boolean(meta?.artist && meta?.track), JSON.stringify(meta));
  check(
    "album, duration and id survived normalisation",
    typeof meta?.album === "string" && typeof meta?.duration === "number" && Boolean(meta?.id),
    `${meta?.album} / ${meta?.duration}s / ${meta?.id}`,
  );
  check("bridge reported alive", live?.nowPlaying?.bridgeAlive === true);

  // A synthetic payload proves the same path with a known track.
  await page.evaluate(() => {
    document.dispatchEvent(
      new CustomEvent("radioooo-scrobbler:bridge", {
        detail: JSON.stringify({
          kind: "track",
          payload: {
            _id: "smoke-1",
            title: "Che Che",
            artist: "Simple Symmetry",
            album: "Sorry! We Did Something Wrong",
            length: 176,
            year: 2022,
            country: "US",
            links: { "1": { url: "https://example.invalid/a.mp3" } },
          },
        }),
      }),
    );
  });
  await page.waitForTimeout(3_000);

  const after = await readState();
  check(
    "injected track was accepted",
    after?.log?.some((e) => e.kind === "track-detected" && e.track?.includes("Simple Symmetry")),
    JSON.stringify(after?.log?.slice(-1)),
  );
  check(
    "no content script errors",
    consoleErrors.filter((l) => /radioooo|content|detector|bridge/i.test(l)).length === 0,
    consoleErrors.filter((l) => /radioooo|content|detector|bridge/i.test(l)).slice(0, 2).join(" | "),
  );

  await page.close();
} finally {
  await browser.close();
  rmSync(userDataDir, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`\n${failures.length} smoke check(s) failed: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("\nsmoke ok");