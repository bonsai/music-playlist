import { STORAGE_KEY } from "../shared/constants";
import type { PersistedState, Settings } from "../shared/types";

export const DEFAULT_SETTINGS: Settings = {
  apiKey: "",
  apiSecret: "",
  sessionKey: "",
  sessionName: null,
  enabled: true,
  submitNowPlaying: true,
  submitScrobbles: true,
  authRedirectUri: "https://www.last.fm/",
  queueTtlMs: 1000 * 60 * 60 * 24 * 14,
  queueLimit: 500,
  logLimit: 400,
  playLogLimit: 2000,
  debug: false,
};

function emptyState(): PersistedState {
  return {
    settings: { ...DEFAULT_SETTINGS },
    sessionKey: "",
    queue: [],
    log: [],
    plays: [],
    nowPlaying: {
      meta: null,
      report: null,
      bridgeAlive: false,
      updatedAt: 0,
      lastNpAttemptAt: 0,
    },
    lastFlushAt: null,
  };
}

export class Store {
  private state: PersistedState = emptyState();
  private loaded = false;
  /** Serialises writes so concurrent callers cannot clobber each other. */
  private tail: Promise<unknown> = Promise.resolve();

  async load(): Promise<PersistedState> {
    if (this.loaded) return this.state;
    const raw = await chrome.storage.local.get(STORAGE_KEY);
    const stored = raw[STORAGE_KEY] as PersistedState | undefined;
    this.state = stored
      ? {
          ...emptyState(),
          ...stored,
          settings: { ...DEFAULT_SETTINGS, ...(stored.settings ?? {}) },
        }
      : emptyState();
    this.loaded = true;
    return this.state;
  }

  peek(): PersistedState {
    return this.state;
  }

  /** Mutate in place, then persist. Mutations run eagerly on the cached object. */
  async update<T>(mutator: (state: PersistedState) => T): Promise<T> {
    await this.load();
    const result = mutator(this.state);
    await this.flush();
    return result;
  }

  /** Read-modify-write without awaiting the flush (hot paths). */
  mutate<T>(mutator: (state: PersistedState) => T): T {
    const result = mutator(this.state);
    void this.flush();
    return result;
  }

  flush(): Promise<unknown> {
    const snapshot = this.state;
    this.tail = this.tail.then(
      () => chrome.storage.local.set({ [STORAGE_KEY]: snapshot }),
      () => chrome.storage.local.set({ [STORAGE_KEY]: snapshot }),
    );
    return this.tail;
  }

  reset(): Promise<PersistedState> {
    this.state = emptyState();
    return this.flush().then(() => this.state);
  }
}

export const store = new Store();