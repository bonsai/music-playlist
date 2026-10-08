import { download, playToJsonl, queuedToJsonl, stamp, toJsonl } from "../shared/jsonl";
import { evaluateScrobbleRule } from "../shared/scrobble";
import type { LogEntry, StateSnapshot } from "../shared/types";
import { $, fmtTime, getState, onClick, rpc, setText } from "./rpc";

const authPill = $("auth-pill");
const user = $("user");
const trackEl = $("track");
const detail = $("detail");
const bar = $("bar");
const progress = $("progress");
const queueEl = $("queue");
const bridgeEl = $("bridge");
const sQueueEl = $("s-queue");
const status = $("status");

// ── tab state ─────────────────────────────────────────────────────────────

const tabs = new Map<string, HTMLElement>();
const tabContent = new Map<string, HTMLElement>();
let currentTab = "nowplaying";

function showTab(name: string): void {
  for (const [key, el] of tabs) {
    el.classList.toggle("active", key === name);
  }
  for (const [key, el] of tabContent) {
    el.classList.toggle("hide", key !== name);
  }
  currentTab = name;
  refreshIfNeeded();
}

window.addEventListener("DOMContentLoaded", () => {
  for (const tab of document.querySelectorAll(".tab") as NodeListOf<HTMLButtonElement>) {
    const key = tab.getAttribute("data-tab")!;
    tabs.set(key, tab);
    tab.addEventListener("click", () => showTab(key));
  }
  for (const content of document.querySelectorAll(
    ".tab-content",
  ) as NodeListOf<HTMLElement>) {
    tabContent.set(content.id, content);
  }
});

// ── rendering ──────────────────────────────────────────────────────────────

function render(state: StateSnapshot): void {
  authPill.className = `pill ${state.authenticated ? "ok" : "err"}`;
  setText(authPill, state.authenticated ? "認証済み" : "未認証");
  setText(user, state.settings.sessionName ?? "");
  setText(queueEl, String(state.queue.length));
  setText(sQueueEl, String(state.queue.length));

  const np = state.nowPlaying;
  bridgeEl.className = "mono";
  setText(
    bridgeEl,
    np.bridgeAlive
      ? "network"
      : np.meta
        ? "media-session / dom"
        : "—",
  );

  const meta = np.meta;
  if (!meta) {
    setText(trackEl, "再生中の曲なし");
    setText(detail, "Radioooo を開くと検出されます");
    setText(progress, "");
    bar.style.width = "0%";
    return;
  }

  setText(trackEl, `${meta.artist} — ${meta.track}`);
  const bits = [
    meta.album ? `album: ${meta.album}` : "album: —",
    meta.year ? String(meta.year) : null,
    meta.country ? meta.country : null,
    meta.id ? `id: ${meta.id}` : null,
  ].filter(Boolean);
  setText(detail, bits.join(" · "));

  const report = np.report;
  const listened = report?.listenedSec ?? 0;
  const verdict = evaluateScrobbleRule({ durationSec: meta.duration, listenedSec: listened });
  const pct = Math.min(100, (listened / Math.max(1, verdict.thresholdSec || 1)) * 100);
  bar.style.width = `${pct.toFixed(1)}%`;

  const playing = report?.state === "playing";
  setText(
    progress,
    [
      playing ? "▶ 再生中" : "⏸ 停止中",
      `${fmtTime(listened)} / ${fmtTime(verdict.thresholdSec)}`,
      verdict.thresholdSec === 0
        ? "対象外"
        : verdict.scrobble
          ? "送信済み"
          : `あと ${fmtTime(verdict.remainingSec)}`,
    ].join("  ·  "),
  );
}

function renderSettings(state: StateSnapshot): void {
  const s = state.settings;
  const el = $("s-api-key") as HTMLInputElement;
  const secret = $("s-api-secret") as HTMLInputElement;
  el.value = s.apiKey;
  secret.value = s.apiSecret;
  const npCb = $("s-np") as HTMLInputElement;
  const scCb = $("s-scrobble") as HTMLInputElement;
  npCb.checked = s.submitNowPlaying;
  scCb.checked = s.submitScrobbles;
}

function renderLogs(entries: LogEntry[]): void {
  const logList = $("log-list");
  logList.replaceChildren(
    ...entries
      .slice(-50)
      .reverse()
      .map((e) => {
        const div = document.createElement("div");
        div.className = e.ok ? "good" : "bad";
        const track = e.track ? ` | ${e.track}` : "";
        const detail = e.detail ? ` — ${e.detail}` : "";
        div.textContent = `${fmtTime(e.at)} ${e.kind}${track}${detail}`;
        return div;
      }),
  );
}

// ── actions ────────────────────────────────────────────────────────────────

let snapshot: StateSnapshot | null = null;

async function refresh(): Promise<void> {
  try {
    snapshot = await getState();
    render(snapshot);
  } catch (err) {
    setText(status, err instanceof Error ? err.message : String(err));
  }
}

function refreshIfNeeded(): void {
  if (!snapshot) {
    void refresh();
  } else {
    switch (currentTab) {
      case "nowplaying":
        render(snapshot);
        break;
      case "settings":
        renderSettings(snapshot);
        break;
      case "logs":
        renderLogs(snapshot.log);
        break;
    }
  }
}

// settings tab
onClick($("s-save"), status, async () => {
  const patch = {
    apiKey: ($("s-api-key") as HTMLInputElement).value.trim(),
    apiSecret: ($("s-api-secret") as HTMLInputElement).value.trim(),
    submitNowPlaying: ($("s-np") as HTMLInputElement).checked,
    submitScrobbles: ($("s-scrobble") as HTMLInputElement).checked,
  };
  await rpc({ type: "save-settings", patch });
  setText(status, "保存しました");
  refreshIfNeeded();
});

onClick($("s-export"), status, async () => {
  const state = snapshot ?? (await getState());
  if (!state) return;
  const rows = [
    ...state.plays.map(playToJsonl),
    ...state.queue.map(queuedToJsonl),
  ];
  download(`radioooo-popup-${stamp()}.jsonl`, toJsonl(rows));
  setText(status, `${rows.length} 行を出力しました`);
});

// logs tab
let logRefreshTimer: number | undefined;

async function refreshLogs(): Promise<void> {
  try {
    const state = await getState();
    renderLogs(state.log);
  } catch (err) {
    setText(status, err instanceof Error ? err.message : String(err));
  }
}

onClick($("s-refresh"), status, async () => {
  await refreshLogs();
  await refresh();
  setText(status, "更新しました");
});

onClick($("s-copy"), status, async () => {
  const entries = snapshot?.log ?? [];
  const text = entries
    .slice(-50)
    .reverse()
    .map((e) => {
      const track = e.track ? ` | ${e.track}` : "";
      const detail = e.detail ? ` — ${e.detail}` : "";
      return `${fmtTime(e.at)} ${e.kind}${track}${detail}`;
    })
    .join("\n");
  await navigator.clipboard.writeText(text);
  setText(status, `${entries.length} 行をコピーしました`);
});

onClick($("s-clear"), status, async () => {
  if (!snapshot || snapshot.log.length === 0) return;
  if (!confirm(`${snapshot.log.length} 件のログを消去しますか？`)) return;
  await rpc({ type: "clear-log" });
  await refreshLogs();
  setText(status, "ログを消去しました");
});

// popup header actions
$("open-options").addEventListener("click", () => {
  void chrome.runtime.openOptionsPage();
});

onClick($("retry"), status, async () => {
  await rpc({ type: "flush-now" });
  await refresh();
  setText(status, "再送しました");
});

// ── init ───────────────────────────────────────────────────────────────────

void refresh();
let timer: number | undefined;
timer = window.setInterval(() => void refresh(), 2_000);
window.addEventListener("unload", () => window.clearInterval(timer));