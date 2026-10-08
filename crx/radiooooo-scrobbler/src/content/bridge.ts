/**
 * Runs in the page's MAIN world so it can see Radiooooo's own `fetch` traffic.
 *
 * The app fetches `/track/play/<id>` and receives the full track record
 * (artist/title/album/length/cover). Scraping the DOM loses the album and the
 * duration, so this tier is the one that matters; DOM and MediaSession remain
 * as fallbacks when this bridge cannot be installed.
 *
 * Everything is relayed as a JSON string because DOM events are the only
 * channel that reliably crosses the isolated-world boundary.
 */

interface Relay {
  kind: "hello" | "track";
  seen?: number;
  payload?: unknown;
}

const BRIDGE_EVENT = "radioooo-scrobbler:bridge";
const REPLAY_EVENT = "radioooo-scrobbler:replay";
const PING_MS = 5_000;
const CACHE_LIMIT = 20;

type BridgeGlobal = typeof globalThis & { __radiooooScrobblerBridge?: { seen: number } };

function main(): void {
  const win = window as BridgeGlobal;
  if (win.__radiooooScrobblerBridge) return;
  win.__radiooooScrobblerBridge = { seen: 0 };

  const cache: unknown[] = [];
  let seen = 0;

  function post(relay: Relay): void {
    try {
      document.dispatchEvent(
        new CustomEvent(BRIDGE_EVENT, { detail: JSON.stringify(relay) }),
      );
    } catch {
      /* page might be mid-teardown */
    }
  }

  function collectTracks(node: unknown, depth = 0, out: unknown[] = []): unknown[] {
    if (!node || typeof node !== "object" || depth > 3) return out;
    if (Array.isArray(node)) {
      for (const item of node) collectTracks(item, depth + 1, out);
      return out;
    }
    const rec = node as Record<string, unknown>;
    if (typeof rec.artist === "string" && typeof rec.title === "string") out.push(rec);
    for (const key of ["track", "tracks", "data", "result", "item", "playing", "info"]) {
      if (key in rec) collectTracks(rec[key], depth + 1, out);
    }
    return out;
  }

  function remember(raw: unknown): void {
    seen += 1;
    win.__radiooooScrobblerBridge = { seen };
    cache.push(raw);
    if (cache.length > CACHE_LIMIT) cache.splice(0, cache.length - CACHE_LIMIT);
    post({ kind: "track", payload: raw });
  }

  function looksLikeTrackApi(url: string): boolean {
    return /\/(track\/play|play|playlist\/track|island|timeline|worldmap)/.test(url);
  }

  function safeParse(text: unknown): unknown {
    if (typeof text !== "string") return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  /* ------------------------------------------------------------- fetch */

  const nativeFetch = window.fetch.bind(window);

  window.fetch = async function patchedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const res = await nativeFetch(input as RequestInfo, init);
    try {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : (input as Request).url;
      if (!looksLikeTrackApi(url) || !res.ok) return res;
      void res
        .clone()
        .json()
        .then((json: unknown) => {
          for (const track of collectTracks(json)) remember(track);
        })
        .catch(() => undefined);
    } catch {
      /* never let instrumentation break the page */
    }
    return res;
  };

  /* ---------------------------------------------------------------- XHR */

  const xhrOpen = XMLHttpRequest.prototype.open;
  const xhrSend = XMLHttpRequest.prototype.send;
  type TaggedXhr = XMLHttpRequest & { __radiooooUrl?: string };

  XMLHttpRequest.prototype.open = function patchedOpen(
    this: TaggedXhr,
    ...args: Parameters<XMLHttpRequest["open"]>
  ): void {
    this.__radiooooUrl = String(args[1] ?? "");
    Reflect.apply(xhrOpen, this, args);
  } as XMLHttpRequest["open"];

  XMLHttpRequest.prototype.send = function patchedSend(
    this: TaggedXhr,
    ...args: Parameters<XMLHttpRequest["send"]>
  ): void {
    const xhr = this;
    if (xhr.__radiooooUrl && looksLikeTrackApi(xhr.__radiooooUrl)) {
      xhr.addEventListener("load", () => {
        try {
          const raw =
            xhr.responseType === "json"
              ? xhr.response
              : xhr.responseType === ""
                ? safeParse(xhr.responseText)
                : null;
          for (const track of collectTracks(raw)) remember(track);
        } catch {
          /* ignore malformed payloads */
        }
      });
    }
    Reflect.apply(xhrSend, xhr, args);
  } as XMLHttpRequest["send"];

  /* ----------------------------------------------------------- lifetime */

  function ping(): void {
    post({ kind: "hello", seen });
  }

  ping();
  setInterval(ping, PING_MS);

  // Rate-limited: the detector may ask for a replay whenever it starts up, and
  // an unbounded echo would ping-pong between the two worlds forever.
  let lastReplayAt = 0;
  window.addEventListener(REPLAY_EVENT, () => {
    const now = Date.now();
    if (now - lastReplayAt < 1_500) return;
    lastReplayAt = now;
    ping();
    for (const raw of cache) post({ kind: "track", payload: raw });
  });
}

main();