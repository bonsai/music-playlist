import type { RuntimeMessage, StateSnapshot } from "../shared/types";

interface Envelope<T> {
  ok: boolean;
  result?: T;
  error?: string;
}

/** Single round-trip to the service worker, unwrapping the response envelope. */
export async function rpc<T>(msg: RuntimeMessage): Promise<T> {
  const reply = (await chrome.runtime.sendMessage(msg)) as Envelope<T> | undefined;
  if (!reply) throw new Error("no response from the service worker");
  if (!reply.ok) throw new Error(reply.error ?? "unknown error");
  return reply.result as T;
}

export const getState = (): Promise<StateSnapshot> => rpc({ type: "get-state" });

export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
}

export function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`
    : `${m}:${String(r).padStart(2, "0")}`;
}

export function fmtClock(epochMs: number): string {
  const d = new Date(epochMs);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

export function setText(el: HTMLElement, text: string): void {
  el.textContent = text;
}

/** Wires a button to an async action with a busy state and inline errors. */
export function onClick(
  el: HTMLElement,
  status: HTMLElement | null,
  fn: () => Promise<void>,
): void {
  el.addEventListener("click", () => {
    el.setAttribute("disabled", "true");
    if (status) setText(status, "…");
    void fn()
      .then(() => status && setText(status, ""))
      .catch((err: unknown) => {
        if (status) setText(status, err instanceof Error ? err.message : String(err));
      })
      .finally(() => el.removeAttribute("disabled"));
  });
}