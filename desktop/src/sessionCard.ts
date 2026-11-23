/**
 * One app-hosted session's card, as a page: what it is, where it runs, what it was last told and last said, and the
 * Stop control. Pure: a snapshot in, a `data:` URL out. The window that shows it (`sessionWindow.ts`) runs with
 * JavaScript OFF, so the page's only way to ask for anything is a `slopweaver-session:` link the window intercepts —
 * the same shape as the fleet's own pages (`fleetWindows.ts`).
 *
 * Every string a session or its agent supplies is HTML-escaped: the agent's words are untrusted text, never markup.
 */
import type { AppSessionSnapshot } from "./sessionControlProtocol";

/** The scheme of a card's links. */
export const SESSION_LINK_SCHEME = "slopweaver-session:";

/**
 * Where the Stop control sits in the card's viewport, in CSS pixels from its bottom-left corner. Fixed, so it stands at
 * the same place over any length of text, and a press of it (`sessionWindow.ts`'s `pressSessionStop`) clicks the real
 * control where the owner would rather than calling what it leads to.
 */
export const STOP_CONTROL_BOX = Object.freeze({ bottom: 16, height: 30, left: 16, width: 64 });

/**
 * Where a click lands on the card's Stop control, in the window's content coordinates: the middle of the control,
 * measured from the bottom of the content the way the page pins it.
 *
 * @param contentHeight the card window's content height
 * @returns the point to click
 */
export function stopControlPoint({ contentHeight }: { contentHeight: number }): { x: number; y: number } {
  return {
    x: STOP_CONTROL_BOX.left + Math.floor(STOP_CONTROL_BOX.width / 2),
    y: contentHeight - STOP_CONTROL_BOX.bottom - Math.floor(STOP_CONTROL_BOX.height / 2),
  };
}

/** What a card's link asks for. */
export interface SessionLink {
  readonly act: "stop";
  readonly sessionId: string;
}

const STATE_WORDS: Readonly<Record<AppSessionSnapshot["state"], string>> = {
  closed: "Closed",
  failed: "Failed",
  idle: "Waiting for a message",
  running: "Working",
  starting: "Starting",
  stopping: "Stopping",
};

const VENDOR_WORDS: Readonly<Record<AppSessionSnapshot["vendor"], string>> = { claude: "Claude", codex: "Codex" };

/**
 * Escape text for an HTML body or a double-quoted attribute.
 *
 * @param text untrusted text
 * @returns the text with every markup character replaced by its entity
 */
export function escapeHtml({ text }: { text: string }): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * The link a card's Stop control navigates to.
 *
 * @param sessionId the control plane's id
 * @returns the link
 */
export function stopLink({ sessionId }: { sessionId: string }): string {
  return `${SESSION_LINK_SCHEME}stop/${encodeURIComponent(sessionId)}`;
}

/**
 * Read a link a card navigated to. Only the exact link {@link stopLink} draws counts: nothing is decoded, so an
 * escaped spelling of the same id is not a Stop, and a malformed escape cannot throw inside a navigation handler.
 *
 * @param url where the page tried to go
 * @returns the ask, or `undefined` for anything that is not exactly a card link
 */
export function sessionLinkOf({ url }: { url: string }): SessionLink | undefined {
  if (!url.startsWith(`${SESSION_LINK_SCHEME}stop/`)) {
    return undefined;
  }
  const sessionId = url.slice(`${SESSION_LINK_SCHEME}stop/`.length);
  return /^[0-9a-f-]{36}$/u.test(sessionId) ? { act: "stop", sessionId } : undefined;
}

function row({ label, value }: { label: string; value: string | undefined }): string {
  if (value === undefined || value.length === 0) {
    return "";
  }
  return `<dt>${escapeHtml({ text: label })}</dt><dd>${escapeHtml({ text: value })}</dd>`;
}

/**
 * The card's whole page.
 *
 * @param snapshot the session as the control plane holds it now
 * @param note a line under the state, when the control plane has one — a Stop that could not reach the ledger, say
 * @returns the HTML document
 */
export function sessionCardHtml({
  snapshot,
  note,
}: {
  snapshot: AppSessionSnapshot;
  note: string | undefined;
}): string {
  const live = snapshot.state !== "closed" && snapshot.state !== "failed" && snapshot.state !== "stopping";
  const stop = live
    ? `<a class="stop" href="${escapeHtml({ text: stopLink({ sessionId: snapshot.sessionId }) })}">Stop</a>`
    : "";
  const noteLine = note === undefined ? "" : `<p class="note">${escapeHtml({ text: note })}</p>`;
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'\">",
    `<title>${escapeHtml({ text: snapshot.title })}</title>`,
    "<style>body{font:13px -apple-system,system-ui,sans-serif;background:#0f1115;color:#e6e6e6;margin:16px;",
    `padding-bottom:${String(STOP_CONTROL_BOX.height + STOP_CONTROL_BOX.bottom)}px}`,
    "h1{font-size:15px;margin:0 0 4px}.state{color:#9aa4b2;margin:0 0 12px}dl{margin:0}dt{color:#9aa4b2;margin-top:8px}",
    "dd{margin:2px 0 0;white-space:pre-wrap;word-break:break-word}.note{color:#f0b429}",
    `.stop{position:fixed;left:${String(STOP_CONTROL_BOX.left)}px;bottom:${String(STOP_CONTROL_BOX.bottom)}px;`,
    `width:${String(STOP_CONTROL_BOX.width)}px;height:${String(STOP_CONTROL_BOX.height)}px;line-height:${String(STOP_CONTROL_BOX.height)}px;`,
    "box-sizing:border-box;text-align:center;border-radius:6px;background:#c2410c;color:#fff;",
    "text-decoration:none;font-weight:600}</style></head><body>",
    `<h1>${escapeHtml({ text: snapshot.title })}</h1>`,
    `<p class="state">${escapeHtml({ text: STATE_WORDS[snapshot.state] })} · ${VENDOR_WORDS[snapshot.vendor]} · ${escapeHtml({ text: snapshot.handle })}</p>`,
    noteLine,
    "<dl>",
    row({ label: "Run", value: snapshot.ledgerKey }),
    row({ label: "Directory", value: snapshot.directory }),
    row({ label: "Last message", value: snapshot.lastSubmittedText }),
    row({ label: "Agent", value: snapshot.lastAgentText }),
    "</dl>",
    stop,
    "</body></html>",
  ].join("");
}

/**
 * The card as a URL a window loads.
 *
 * @param snapshot the session
 * @param note the control plane's line, if any
 * @returns a `data:` URL
 */
export function sessionCardUrl({ snapshot, note }: { snapshot: AppSessionSnapshot; note: string | undefined }): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(sessionCardHtml({ note, snapshot }))}`;
}

/**
 * The card as it would read with no streamed agent text, so two documents whose frames match differ only in that text
 * and the redraw may wait (`sessionCardRedraw.ts`).
 *
 * @param snapshot the session
 * @param note the control plane's line, if any
 * @returns the `data:` URL of the card without its agent text
 */
export function sessionCardFrameUrl({
  snapshot,
  note,
}: {
  snapshot: AppSessionSnapshot;
  note: string | undefined;
}): string {
  const { lastAgentText, ...framed } = snapshot;
  return lastAgentText === undefined ? sessionCardUrl({ note, snapshot }) : sessionCardUrl({ note, snapshot: framed });
}

/**
 * Whether a point of the card's content lies on its Stop control, so a mouse press there holds the card still.
 *
 * @param x the point's distance from the content's left edge
 * @param y the point's distance from the content's top edge
 * @param contentHeight the card window's content height
 * @returns true inside {@link STOP_CONTROL_BOX}
 */
export function withinStopControl({ x, y, contentHeight }: { x: number; y: number; contentHeight: number }): boolean {
  const top = contentHeight - STOP_CONTROL_BOX.bottom - STOP_CONTROL_BOX.height;
  const across = x >= STOP_CONTROL_BOX.left && x < STOP_CONTROL_BOX.left + STOP_CONTROL_BOX.width;
  return across && y >= top && y < top + STOP_CONTROL_BOX.height;
}
