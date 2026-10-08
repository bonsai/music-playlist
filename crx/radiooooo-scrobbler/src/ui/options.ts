import { download, playToJsonl, queuedToJsonl, stamp, toJsonl } from "../shared/jsonl";
import type { LogEntry, PlayRecord, StateSnapshot } from "../shared/types";
import { $, fmtClock, fmtTime, getState, onClick, rpc, setText } from "./rpc";

const $input = $<HTMLInputElement>("api-key");
const $secret = $<HTMLInputElement>("api-secret");
const $redirect = $<HTMLInputElement>("redirect");
const $token = $<HTMLInputElement>("token");
const $enabled = $<HTMLInputElement>("enabled");
const $np = $<HTMLInputElement>("np");
const $scrobble = $<HTMLInputElement>("scrobble");
const $debug = $<HTMLInputElement>("debug");
const $ttl = $<HTMLInputElement>("queue-ttl");
const $limit = $<HTMLInputElement>("queue-limit");
const $playLimit = $<HTMLInputElement>("play-log-limit");
const $playsSearch = $<HTMLInputElement>("plays-search");
const status = $("status");
const logBox = $("log");
const playsBox = $("plays");

let snapshot: StateSnapshot | null = null;

/* ----------------------------------------------------------------- render */

function renderAuth(state: StateSnapshot): void {
  const pill = $("auth-state");
  setText(pill, state.authenticated ? `認証済み（${state.queue.length} 件待機）` : "未認証");
  setText($("auth-user"), state.sessionName ?? "—");
}

function renderDiagnostics(state: StateSnapshot): void {
  const np = state.nowPlaying;
  const meta = np.meta;
  setText($("d-source"), meta?.source ?? "—");
  setText($("d-track"), meta ? `${meta.artist} — ${meta.track}` : "—");
  setText(
    $("d-state"),
    np.report
      ? `${np.report.state} / ${fmtTime(np.report.listenedSec)} 再生`
      : "—",
  );
  setText($("d-bridge"), np.bridgeAlive ? "alive" : "no signal");
  setText(
    $("d-queue"),
    state.queue.length > 0
      ? `${state.queue.length} 件（最古 ${fmtClock(Math.min(...state.queue.map((q) => q.createdAt)))}）`
      : "0",
  );
  setText($("d-flush"), state.lastFlushAt ? fmtClock(state.lastFlushAt) : "—");
}

function renderLog(entries: LogEntry[]): void {
  logBox.replaceChildren(
    ...entries
      .slice(-200)
      .reverse()
      .map((e) => {
        const div = document.createElement("div");
        div.className = e.ok ? "good" : "bad";
        const track = e.track ? ` | ${e.track}` : "";
        const detail = e.detail ? ` — ${e.detail}` : "";
        div.textContent = `${fmtClock(e.at)} ${e.kind}${track}${detail}`;
        return div;
      }),
  );
}

/* ------------------------------------------------------------ play history */

const PLAY_PAGE = 100;

function playMatches(p: PlayRecord, needle: string): boolean {
  if (!needle) return true;
  const q = needle.toLowerCase();
  return (
    p.artist.toLowerCase().includes(q) ||
    p.track.toLowerCase().includes(q) ||
    (p.album ?? "").toLowerCase().includes(q)
  );
}

function fmtDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ");
}

function renderPlays(state: StateSnapshot): void {
  const plays = state.plays;
  const scrobbled = plays.filter((p) => p.scrobbled).length;
  setText($("p-count"), `${plays.length} 件（scrobbled ${scrobbled} / 上限 ${state.settings.playLogLimit}）`);
  setText($("p-path"), "chrome.storage.local → radioooo-scrobbler.state.v1 / plays[]");

  if (plays.length === 0) {
    setText($("p-range"), "—");
  } else {
    setText($("p-range"), `${fmtDay(plays[0]!.startedAt)} 〜 ${fmtDay(plays[plays.length - 1]!.startedAt)}`);
  }

  const needle = $playsSearch.value.trim();
  const filtered = plays.filter((p) => playMatches(p, needle)).slice(-PLAY_PAGE).reverse();

  if (filtered.length === 0) {
    playsBox.replaceChildren(Object.assign(document.createElement("div"), { className: "muted", textContent: "該当する曲がありません" }));
    return;
  }

  playsBox.replaceChildren(
    ...filtered.map((p) => {
      const row = document.createElement("div");
      row.className = "play";

      const when = document.createElement("time");
      when.textContent = fmtDay(p.startedAt);
      row.append(when);

      const title = document.createElement("span");
      title.className = "play-title";
      title.textContent = `${p.artist} — ${p.track}`;
      row.append(title);

      const album = document.createElement("span");
      album.className = "muted play-album";
      album.textContent = p.album ?? `(${p.tier})`;
      row.append(album);

      const mark = document.createElement("span");
      mark.className = p.scrobbled ? "good" : p.queued ? "warn" : "muted";
      mark.textContent = p.scrobbled
        ? `scrobbled ${fmtTime(p.listenedSec)}`
        : p.queued
          ? "queued"
          : `${fmtTime(p.listenedSec)} / ${fmtTime(p.duration ?? 0)}`;
      row.append(mark);

      return row;
    }),
  );
}

async function refresh(): Promise<void> {
  snapshot = await getState();
  if (!snapshot) return;
  const s = snapshot.settings;
  $input.value = s.apiKey;
  $secret.value = s.apiSecret;
  $redirect.value = s.authRedirectUri;
  $enabled.checked = s.enabled;
  $np.checked = s.submitNowPlaying;
  $scrobble.checked = s.submitScrobbles;
  $debug.checked = s.debug;
  $ttl.value = String(Math.round(s.queueTtlMs / 86_400_000));
  $limit.value = String(s.queueLimit);
  $playLimit.value = String(s.playLogLimit);
  renderAuth(snapshot);
  renderDiagnostics(snapshot);
  renderLog(snapshot.log);
  renderPlays(snapshot);
}

/* ---------------------------------------------------------------- actions */

async function saveToggles(): Promise<void> {
  await rpc({
    type: "save-settings",
    patch: {
      enabled: $enabled.checked,
      submitNowPlaying: $np.checked,
      submitScrobbles: $scrobble.checked,
      debug: $debug.checked,
      queueTtlMs: Math.max(1, Number($ttl.value) || 14) * 86_400_000,
      queueLimit: Math.max(10, Number($limit.value) || 500),
      playLogLimit: Math.max(100, Number($playLimit.value) || 2000),
    },
  });
}

for (const el of [$enabled, $np, $scrobble, $debug, $ttl, $limit, $playLimit]) {
  el.addEventListener("change", () => {
    void saveToggles()
      .then(refresh)
      .catch((err: unknown) => setText(status, String(err)));
  });
}

$playsSearch.addEventListener("input", () => {
  if (snapshot) renderPlays(snapshot);
});

onClick($("save-credentials"), status, async () => {
  await rpc({
    type: "save-settings",
    patch: {
      apiKey: $input.value.trim(),
      apiSecret: $secret.value.trim(),
      authRedirectUri: $redirect.value.trim(),
    },
  });
  setText(status, "保存しました");
  await refresh();
});

onClick($("request-token"), status, async () => {
  await saveToggles();
  await rpc({ type: "request-token" });
  setText(status, "Last.fm のタブを開きました。許可して戻ってきてください");
  setTimeout(() => void refresh(), 3_000);
});

onClick($("complete-auth"), status, async () => {
  await rpc({ type: "complete-auth", token: $token.value.trim() });
  $token.value = "";
  setText(status, "接続しました");
  await refresh();
});

onClick($("test-auth"), status, async () => {
  await rpc({ type: "test-auth" });
  setText(status, "接続確認 OK");
  await refresh();
});

onClick($("logout"), status, async () => {
  await rpc({ type: "logout" });
  setText(status, "ログアウトしました");
  await refresh();
});

onClick($("refresh"), status, refresh);
onClick($("flush"), status, async () => {
  await rpc({ type: "flush-now" });
  setText(status, "再送しました");
  await refresh();
});

onClick($("clear"), status, async () => {
  await rpc({ type: "clear-log" });
  await refresh();
});

onClick($("export"), status, async () => {
  const state = snapshot ?? (await getState());
  if (!state) return;
  const rows = [
    ...state.plays.map(playToJsonl),
    ...state.queue.map(queuedToJsonl),
  ];
  download(`radioooo-scrobbler-${stamp()}.jsonl`, toJsonl(rows));
  setText(status, `${rows.length} 行を出力しました（履歴 ${state.plays.length} / 未送信 ${state.queue.length}）`);
});

/* ------------------------------------------------------- play history I/O */

onClick($("refresh-plays"), status, refresh);

onClick($("export-plays"), status, async () => {
  const state = snapshot ?? (await getState());
  if (!state) return;
  if (state.plays.length === 0) {
    setText(status, "履歴が空です");
    return;
  }
  const text = toJsonl(state.plays.map(playToJsonl));
  download(`radioooo-plays-${stamp()}.jsonl`, text);
  setText(status, `${state.plays.length} 行を JSONL で書き出しました`);
});

onClick($("copy-plays"), status, async () => {
  const state = snapshot ?? (await getState());
  if (!state || state.plays.length === 0) {
    setText(status, "履歴が空です");
    return;
  }
  await navigator.clipboard.writeText(toJsonl(state.plays.map(playToJsonl)));
  setText(status, `${state.plays.length} 行をクリップボードへコピーしました`);
});

onClick($("clear-plays"), status, async () => {
  const state = snapshot ?? (await getState());
  if (!state || state.plays.length === 0) return;
  if (!confirm(`${state.plays.length} 件の再生履歴を消去します。よろしいですか？`)) return;
  await rpc({ type: "clear-plays" });
  setText(status, "再生履歴を消去しました");
  await refresh();
});

void refresh().catch((err: unknown) => setText(status, String(err)));