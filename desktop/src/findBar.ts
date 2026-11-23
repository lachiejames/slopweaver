/**
 * Find in page, as data: which keys open the find bar and step through its matches, what the bar may send, what its
 * count reads, where it sits, and the bar's own page. Pure; `findShell.ts` applies it to Electron.
 *
 * The owner expects ⌘F to search the page, on the Automations page and every other. It would do
 * nothing by default because Chromium's find bar belongs to the Chrome browser, not to the page: Electron ships only
 * `webContents.findInPage` and its `found-in-page` event, and Electron draws no bar and takes no key. So the
 * shell draws one, a browser's: over the tab showing, a count, next and previous, Esc to close.
 */
import { isRecord } from "./desktopBridge";
import type { KeyPress } from "./tabStripKeys";
import { STRIP_HEIGHT } from "./tabStripLook";

/** What a key the shell takes does to the find bar. */
export type FindShortcut = { readonly kind: "open" } | { readonly kind: "next" } | { readonly kind: "previous" };

/**
 * The find key a key press is, a Mac browser's: ⌘F opens the bar (or selects its text when open), ⌘G the next match,
 * ⌘⇧G the previous one.
 *
 * @param press the key press
 * @returns the shortcut, or `undefined` for a key the page keeps
 */
export function findShortcut({ press }: { press: KeyPress }): FindShortcut | undefined {
  if (press.type !== "keyDown" || !press.meta || press.control || press.alt) {
    return undefined;
  }
  const key = press.key.toLowerCase();
  if (key === "f" && !press.shift) {
    return { kind: "open" };
  }
  if (key === "g") {
    return press.shift ? { kind: "previous" } : { kind: "next" };
  }
  return undefined;
}

/**
 * What the bar's page sends: the text typed, a step, or a close. A query carries the bar's own count of the texts
 * it has sent, which main echoes on every state it draws, so the bar can drop a count that answered older text.
 */
export type FindCommand =
  | { readonly kind: "query"; readonly text: string; readonly seq: number }
  | { readonly kind: "next" }
  | { readonly kind: "previous" }
  | { readonly kind: "close" };

/** The longest text the bar searches for; a paste past this is not a search anybody types. */
export const MAX_QUERY = 500;

/**
 * One command off the bar's page, exactly — anything else is dropped.
 *
 * @param value what the bar's preload sent
 * @returns the command, or `undefined`
 */
export function parseFindCommand({ value }: { value: unknown }): FindCommand | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const { kind, seq, text } = value;
  const keys = Object.keys(value).length;
  if ((kind === "next" || kind === "previous" || kind === "close") && keys === 1) {
    return { kind };
  }
  const counted = typeof seq === "number" && Number.isSafeInteger(seq) && seq >= 1;
  if (kind === "query" && keys === 3 && counted && typeof text === "string" && text.length <= MAX_QUERY) {
    return { kind, seq, text };
  }
  return undefined;
}

/** A page's answer to a search: how many matches it holds, and which one is lit, counted from 1 (0 before one is). */
export interface FindAnswer {
  readonly matches: number;
  readonly active: number;
}

/**
 * Fold one `found-in-page` report into the answer so far. Chromium reports a search in several updates, and a field
 * an update does not carry comes as -1, so a negative count or place keeps the one already known.
 *
 * @param answer the answer so far for this search, or `undefined` before its first report
 * @param result the report, the fields Electron's `found-in-page` carries that this reads
 * @returns the answer, or `undefined` while no report has carried a count
 */
export function foundAnswer({
  answer,
  result,
}: {
  answer: FindAnswer | undefined;
  result: { readonly matches: number; readonly activeMatchOrdinal: number };
}): FindAnswer | undefined {
  let matches = answer?.matches;
  if (result.matches >= 0) {
    matches = result.matches;
  }
  if (matches === undefined) {
    return undefined;
  }
  let active = 0;
  if (answer !== undefined) {
    active = answer.active;
  }
  if (result.activeMatchOrdinal >= 0) {
    active = result.activeMatchOrdinal;
  }
  return { active: Math.min(active, matches), matches };
}

/** Where main sends the keyboard with a redraw: into the field with its text selected, with the caret kept, or nowhere. */
export type FindFocus = "select-all" | "preserve" | "none";

/** What the bar shows: its count, whether that count is "no results", and whether next and previous have a match. */
export interface FindBarState {
  readonly status: string;
  readonly none: boolean;
  readonly canStep: boolean;
}

/**
 * What the bar shows for a search: which match is lit of how many, as a browser shows it.
 *
 * @param query the text in the bar
 * @param answer the page's answer, or `undefined` before it has given one
 * @returns `3 of 12`, `No results` in red, or an empty count while there is no text or no answer yet
 */
export function findStatus({ query, answer }: { query: string; answer: FindAnswer | undefined }): FindBarState {
  if (query === "" || answer === undefined) {
    return { canStep: false, none: false, status: "" };
  }
  if (answer.matches === 0) {
    return { canStep: false, none: true, status: "No results" };
  }
  const lit = Math.min(Math.max(answer.active, 1), answer.matches);
  return { canStep: true, none: false, status: `${String(lit)} of ${String(answer.matches)}` };
}

/** The bar's size in points. */
export const FIND_BAR_WIDTH = 360;
export const FIND_BAR_HEIGHT = 44;
/** The gap between the bar and the window's right edge and the strip. */
const FIND_BAR_MARGIN = 12;

/**
 * Where the bar sits: the top right of the page, just under the tab strip, as a browser's does — pulled left onto a
 * window narrower than it.
 *
 * @param width the window's content width
 * @returns the bar's rectangle in the window
 */
export function findBarBounds({ width }: { width: number }): {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
} {
  const barWidth = Math.min(FIND_BAR_WIDTH, Math.max(0, width - 2 * FIND_BAR_MARGIN));
  return {
    height: FIND_BAR_HEIGHT,
    width: barWidth,
    x: Math.max(0, width - barWidth - FIND_BAR_MARGIN),
    y: STRIP_HEIGHT + FIND_BAR_MARGIN / 2,
  };
}

/**
 * The bar's and its field's opaque fills per system mode (every console surface is at full opacity).
 * The dark field is the old 25% black laid over the dark bar.
 */
export const FIND_BAR_FILL = {
  dark: { field: "#1d1e23", panel: "#26282e" },
  light: { field: "#fff", panel: "#fafafc" },
} as const;

/**
 * The bar's page: a script-free document — the field, the count, previous, next and close — whose look follows the
 * console's light or dark choice like the strip's. Its preload (`findPreload.ts`) turns typing, Enter, ⇧Enter, Esc
 * and the buttons into {@link FindCommand}s and writes the count main sends into `#count`. The bar and its field are
 * opaque, so the console page never reads through them; only the page around the bar's rounded corners is
 * transparent.
 *
 * @returns a `data:` URL
 */
export function findDocument(): string {
  const css = [
    `:root{color-scheme:light dark;--ink:#1d2027;--muted:#6b7180;--line:rgba(0,0,0,.14);--panel:${FIND_BAR_FILL.light.panel};--hover:rgba(0,0,0,.06);--field:${FIND_BAR_FILL.light.field}}`,
    `@media (prefers-color-scheme:dark){:root{--ink:#e7e9ee;--muted:#9aa0ad;--line:rgba(255,255,255,.14);--panel:${FIND_BAR_FILL.dark.panel};--hover:rgba(255,255,255,.08);--field:${FIND_BAR_FILL.dark.field}}}`,
    "html,body{margin:0;height:100%;background:transparent;overflow:hidden;font:13px/1 -apple-system,system-ui,sans-serif;color:var(--ink)}",
    `#bar{display:flex;align-items:center;gap:4px;height:${String(FIND_BAR_HEIGHT)}px;padding:0 6px 0 8px;box-sizing:border-box;border:1px solid var(--line);border-radius:10px;background:var(--panel)}`,
    "#query{flex:1;min-width:0;height:28px;padding:0 8px;box-sizing:border-box;border:1px solid var(--line);border-radius:6px;background:var(--field);color:var(--ink);font:inherit;outline:none}",
    "#query:focus{border-color:#7c6cf0;box-shadow:0 0 0 2px rgba(124,108,240,.25)}",
    "#count{flex:none;min-width:64px;text-align:right;color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}",
    "#count[data-none]{color:#d64545}",
    "button{width:26px;height:26px;flex:none;border:0;border-radius:6px;background:transparent;color:var(--ink);font-size:15px;line-height:1;cursor:default}",
    "button:hover:not([disabled]){background:var(--hover)}button[disabled]{opacity:.35}",
  ].join("");
  const body = [
    `<div id="bar" role="search">`,
    // The field holds no more than a command may carry, so a long paste is cut to fit rather than refused while the
    // last text's count still shows.
    `<input id="query" type="text" maxlength="${MAX_QUERY}" placeholder="Find in page" aria-label="Find in page" spellcheck="false" autocomplete="off">`,
    `<span id="count" aria-live="polite"></span>`,
    `<button type="button" data-find="previous" aria-label="Previous match" title="Previous match (⇧⌘G)" disabled>⌃</button>`,
    `<button type="button" data-find="next" aria-label="Next match" title="Next match (⌘G)" disabled>⌄</button>`,
    `<button type="button" data-find="close" aria-label="Close find bar" title="Close (Esc)">×</button>`,
    `</div>`,
  ].join("");
  // The page loads nothing and runs no script; its one style block is inline.
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`;
  const html = `<!doctype html><meta charset="utf-8">${csp}<title>Find in page</title><style>${css}</style><body>${body}</body>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}
