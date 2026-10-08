import { LASTFM_AUTH_PAGE, LASTFM_ENDPOINT } from "./constants";
import { md5 } from "./md5";
import type { ScrobbleRecord, Settings } from "./types";

export class LastFmError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly retriable: boolean,
  ) {
    super(message);
    this.name = "LastFmError";
  }
}

export interface Credentials {
  apiKey: string;
  apiSecret: string;
  sessionKey?: string;
}

/** Last.fm's signature: md5 over alphabetically sorted `key+value`, then the secret. */
export function signParams(params: Record<string, string>, secret: string): string {
  const canonical = Object.keys(params)
    .sort()
    .map((k) => `${k}${params[k] ?? ""}`)
    .join("");
  return md5(`${canonical}${secret}`);
}

/**
 * Last.fm signs every parameter except `api_sig` and `format`, sorted by name.
 */
function withSignature(params: Record<string, string>, secret: string): Record<string, string> {
  const signed: Record<string, string> = {};
  for (const key of Object.keys(params)) {
    const value = params[key];
    if (key === "api_sig" || key === "format" || value === undefined) continue;
    signed[key] = value;
  }
  return { ...params, api_sig: signParams(signed, secret) };
}

function qs(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

interface RawEnvelope {
  error?: number | string;
  message?: string;
}

interface CallOptions {
  /** Defaults to true; auth.getToken and track.getInfo send no signature. */
  signed?: boolean;
  /**
   * Whether the method needs a `sk` session key. Last.fm's auth methods take a
   * token instead, and read-only methods need neither — so this cannot be
   * inferred from the presence of `sk`.
   */
  session?: boolean;
}

async function call(
  creds: Credentials,
  params: Record<string, string>,
  opts: CallOptions = {},
): Promise<unknown> {
  const session = opts.session ?? true;
  if (session && !creds.sessionKey) throw new Error("Last.fm session key is missing");
  if (!creds.apiKey) throw new Error("Last.fm API key is missing");

  const body: Record<string, string> = {
    ...params,
    api_key: creds.apiKey,
    format: "json",
  };
  if (session) body.sk = creds.sessionKey as string;
  if (opts.signed !== false) {
    if (!creds.apiSecret) throw new Error("Last.fm shared secret is missing");
    Object.assign(body, withSignature(body, creds.apiSecret));
  }

  let res: Response;
  try {
    res = await fetch(LASTFM_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: qs(body),
    });
  } catch (cause) {
    throw new LastFmError(`network failure: ${(cause as Error).message}`, 0, true);
  }

  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new LastFmError(`HTTP ${res.status}: non-JSON response`, res.status, res.status >= 500);
  }

  const env = json as RawEnvelope;
  if (env.error !== undefined) {
    const code = Number(env.error);
    throw new LastFmError(env.message || `Last.fm error ${code}`, code, code === 8 || code === 27);
  }
  if (!res.ok) throw new LastFmError(`HTTP ${res.status}`, res.status, res.status >= 500);
  return json;
}

export const lastfm = {
  /** Step 1 of the web auth flow. `redirect` is only used to open the browser. */
  async getToken(creds: Credentials): Promise<string> {
    const json = (await call(creds, { method: "auth.getToken" }, {
      signed: false,
      session: false,
    })) as {
      token: string;
    };
    if (!json.token) throw new Error("Last.fm returned no token");
    return json.token;
  },

  authUrl(apiKey: string, token: string, redirectUri?: string): string {
    const url = new URL(LASTFM_AUTH_PAGE);
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("token", token);
    if (redirectUri) url.searchParams.set("redirect_uri", redirectUri);
    return url.toString();
  },

  /** Step 2: trade the approved token for a long-lived session key. */
  async getSession(creds: Credentials, token: string): Promise<{ key: string; name: string }> {
    const json = (await call(creds, { method: "auth.getSession", token }, { session: false })) as {
      session: { key: string; name: string };
    };
    if (!json.session?.key) throw new Error("Last.fm returned no session key");
    return { key: json.session.key, name: json.session.name };
  },

  async validateSession(creds: Credentials): Promise<string> {
    const json = (await call(creds, { method: "auth.getSession" })) as {
      session: { name: string };
    };
    return json.session.name;
  },

  async updateNowPlaying(
    creds: Credentials,
    rec: { artist: string; track: string; album?: string; duration?: number },
  ): Promise<void> {
    const params: Record<string, string> = {
      method: "track.updateNowPlaying",
      artist: rec.artist,
      track: rec.track,
      chosenByUser: "0",
    };
    if (rec.album) params.album = rec.album;
    if (typeof rec.duration === "number") params.duration = String(Math.round(rec.duration));
    await call(creds, params);
  },

  /** Batches are capped at 50 by Last.fm; callers chunk before calling. */
  async scrobble(creds: Credentials, records: ScrobbleRecord[]): Promise<string[]> {
    if (records.length === 0) return [];
    const params: Record<string, string> = { method: "track.scrobble" };
    records.forEach((r, i) => {
      const n = String(i);
      params[`artist[${n}]`] = r.artist;
      params[`track[${n}]`] = r.track;
      params[`timestamp[${n}]`] = String(r.timestamp);
      params[`chosenByUser[${n}]`] = String(r.chosenByUser);
      if (r.album) params[`album[${n}]`] = r.album;
      if (typeof r.duration === "number") {
        params[`duration[${n}]`] = String(Math.round(r.duration));
      }
      params[`streamId[${n}]`] = r.id;
    });
    const json = (await call(creds, params)) as {
      "scrobbles": { "@attr"?: { accepted: number }; _: Array<{ artist: { corrected?: string } }> };
    };
    const attr = json.scrobbles?.["@attr"];
    return Array.isArray(json.scrobbles?._) ? json.scrobbles._.map(() => "ok") : [];
  },

  /**
   * Canonical metadata lookup. Used only to *offer* a correction to the user —
   * Last.fm's own guidance is that automatic correction needs consent.
   */
  async getInfo(
    creds: Credentials,
    q: { artist: string; track: string; album?: string },
  ): Promise<
    | {
        artist: string;
        track: string;
        album: string | null;
        mbid: string | null;
        duration: number | null;
        corrected: boolean;
        url: string;
      }
    | null
  > {
    const params: Record<string, string> = {
      method: "track.getInfo",
      artist: q.artist,
      track: q.track,
      autocorrect: "0",
    };
    if (q.album) params.album = q.album;
    const json = (await call(creds, params, { signed: false, session: false })) as {
      track?: Record<string, unknown>;
    };
    const t = json.track;
    if (!t || typeof t !== "object") return null;
    const text = (v: unknown): string => (typeof v === "string" ? v : "");
    return {
      artist: text(t.artist),
      track: text(t.name),
      album: typeof t.album === "string" ? t.album : null,
      mbid: typeof t.mbid === "string" ? t.mbid : null,
      duration: typeof t.duration === "number" ? t.duration : null,
      corrected: Boolean((t as { corrected?: string }).corrected),
      url: text(t.url),
    };
  },
};

export function credsFrom(settings: Settings, sessionKey?: string): Credentials {
  return {
    apiKey: settings.apiKey,
    apiSecret: settings.apiSecret,
    ...(sessionKey !== undefined ? { sessionKey } : {}),
  };
}

export const debugUrl = LASTFM_ENDPOINT;