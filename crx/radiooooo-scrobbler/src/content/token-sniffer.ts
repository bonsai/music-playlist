/**
 * Last.fm appends the authorised token to whatever `redirect_uri` we sent.
 * This sniffs it off the address bar and completes the handshake so the user
 * never has to copy a URL by hand.
 */

const PARAM = "token";

function readToken(): string | null {
  const url = new URL(location.href);
  const value = url.searchParams.get(PARAM) ?? hashToken();
  return value && value.length > 4 ? value : null;
}

function hashToken(): string | null {
  const hash = location.hash.replace(/^#/, "");
  if (!hash) return null;
  for (const part of hash.split("&")) {
    const [k, v] = part.split("=");
    if (k === PARAM && v) return decodeURIComponent(v);
  }
  return null;
}

function report(token: string): void {
  chrome.runtime.sendMessage({ type: "complete-auth", token }, () => {
    void chrome.runtime.lastError;
  });
}

function cleanUp(): void {
  const url = new URL(location.href);
  url.searchParams.delete(PARAM);
  url.hash = "";
  history.replaceState(null, "", url.toString());
}

const token = readToken();
if (token) {
  report(token);
  cleanUp();
}