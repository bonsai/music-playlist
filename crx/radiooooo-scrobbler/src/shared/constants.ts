export const LASTFM_ENDPOINT = "https://ws.audioscrobbler.com/2.0/";
export const LASTFM_AUTH_PAGE = "https://www.last.fm/api/auth/";

/** Last.fm ignores tracks at or under this length. */
export const MIN_SCROBBLE_LENGTH_SEC = 30;
/** ...or anything at or under four minutes, whichever is shorter. */
export const MAX_SCROBBLE_THRESHOLD_SEC = 240;

/** Last.fm accepts at most 50 scrobbles per request. */
export const SCROBBLE_BATCH_SIZE = 50;

export const FLUSH_ALARM = "radioooo-flush";
export const FLUSH_PERIOD_MINUTES = 1;

export const DEFAULT_AUTH_REDIRECT = "https://www.last.fm/";

export const STORAGE_KEY = "radioooo-scrobbler.state.v1";