/**
 * The console window's tabs, as data: which pages are open, in what order, which one the owner is on, and what each key
 * and click on the strip does to them. Pure; `tabsShell.ts` applies it to Electron.
 *
 * A link opened from a viewer page (a briefing's Pull requests, a card's pull request or board row) must not replace
 * the Queue the owner is reading, and the owner needs a way back to it: the Queue in one tab, a briefing opened
 * ad hoc, a few tabs scattered for those. So a link a page opens in a new window is a new tab, the Queue's tab is
 * pinned first and never closes, and every tab keeps its own history.
 */
import { deepLinkTarget } from "./deepLink";
import { isRecord } from "./desktopBridge";
import { tabIcon } from "./tabPages";

/** One open tab. */
export interface Tab {
  readonly id: string;
  /** The console page it is on, or will load when first shown: path, query and hash. */
  readonly path: string;
  /** The page's own title, as the strip shows it; the path until the page has said. */
  readonly title: string;
  /** The tab it was opened from, which its back goes to when its own history is empty. */
  readonly opener: string | undefined;
}

/** Every open tab in strip order — the first is the pinned one — and the one showing. */
export interface TabStrip {
  readonly tabs: readonly Tab[];
  readonly active: string;
}

/**
 * A strip of the pinned tab alone.
 *
 * @returns the strip, that tab showing
 */
export function pinnedStrip({ id, path, title }: { id: string; path: string; title: string }): TabStrip {
  return { active: id, tabs: [{ id, opener: undefined, path, title }] };
}

/**
 * The tab carrying an id.
 *
 * @returns the tab, or `undefined` when none does
 */
export function tabOf({ strip, id }: { strip: TabStrip; id: string }): Tab | undefined {
  return strip.tabs.find((tab) => tab.id === id);
}

/**
 * The tab showing.
 *
 * @returns the active tab — a strip always has one
 */
export function activeTab({ strip }: { strip: TabStrip }): Tab {
  return tabOf({ id: strip.active, strip })!;
}

/**
 * The pinned tab, the Queue's: first, and never closed or moved.
 *
 * @returns the first tab
 */
export function pinnedTab({ strip }: { strip: TabStrip }): Tab {
  return strip.tabs[0]!;
}

/**
 * Open a tab the way a browser does: after the tab that opened it and the tabs that tab already opened, so a run of
 * links read off one page stays together in the order the owner opened them.
 *
 * @param tab the new tab; its `opener` places it, and with none it goes last
 * @param foreground whether it becomes the tab showing — a ⌘-click opens behind
 * @returns the strip with the tab in it
 */
export function openTab({ strip, tab, foreground }: { strip: TabStrip; tab: Tab; foreground: boolean }): TabStrip {
  let at = strip.tabs.length;
  const opener = strip.tabs.findIndex((candidate) => candidate.id === tab.opener);
  if (opener !== -1) {
    at = opener + 1;
    while (at < strip.tabs.length && strip.tabs[at]!.opener === tab.opener) {
      at += 1;
    }
  }
  const tabs = [...strip.tabs.slice(0, at), tab, ...strip.tabs.slice(at)];
  return { active: foreground ? tab.id : strip.active, tabs };
}

/**
 * Close a tab. The pinned one never closes. Closing the tab showing shows the tab it was opened from when that is
 * still open, else its right-hand neighbour, else its left — as a browser does, so closing a page the owner opened off the
 * Queue lands them back on the Queue.
 *
 * @returns the strip without the tab; the same strip for the pinned tab or an id not in it
 */
export function closeTab({ strip, id }: { strip: TabStrip; id: string }): TabStrip {
  const at = strip.tabs.findIndex((tab) => tab.id === id);
  if (at <= 0) {
    return strip;
  }
  const closing = strip.tabs[at]!;
  // A tab it opened now goes back to whatever opened it.
  const tabs = strip.tabs
    .filter((tab) => tab.id !== id)
    .map((tab) => (tab.opener === id ? { ...tab, opener: closing.opener } : tab));
  if (strip.active !== id) {
    return { active: strip.active, tabs };
  }
  const opener = tabs.find((tab) => tab.id === closing.opener);
  let next = tabs[Math.min(at, tabs.length - 1)]!;
  if (opener !== undefined) {
    next = opener;
  }
  return { active: next.id, tabs };
}

/**
 * Move a tab to another place in the strip, as a drag does. The pinned tab stays first: it never moves, and nothing
 * moves in front of it.
 *
 * @param to the index it should end at
 * @returns the reordered strip; the same strip when nothing can move
 */
export function moveTab({ strip, id, to }: { strip: TabStrip; id: string; to: number }): TabStrip {
  const at = strip.tabs.findIndex((tab) => tab.id === id);
  if (at <= 0 || !Number.isInteger(to)) {
    return strip;
  }
  const target = Math.min(Math.max(to, 1), strip.tabs.length - 1);
  if (target === at) {
    return strip;
  }
  const without = strip.tabs.filter((tab) => tab.id !== id);
  return { active: strip.active, tabs: [...without.slice(0, target), strip.tabs[at]!, ...without.slice(target)] };
}

/**
 * Show a tab.
 *
 * @returns the strip with that tab showing; the same strip for an id not in it
 */
export function activateTab({ strip, id }: { strip: TabStrip; id: string }): TabStrip {
  if (tabOf({ id, strip }) === undefined) {
    return strip;
  }
  return { active: id, tabs: strip.tabs };
}

/**
 * Change what a tab says about its page.
 *
 * @param change the new path or title
 * @returns the strip with the tab changed
 */
export function updateTab({
  strip,
  id,
  change,
}: {
  strip: TabStrip;
  id: string;
  change: { readonly path?: string; readonly title?: string };
}): TabStrip {
  return { active: strip.active, tabs: strip.tabs.map((tab) => (tab.id === id ? { ...tab, ...change } : tab)) };
}

/**
 * Where back goes in a tab: its own history while it has some, else the tab that opened it while that is still open.
 * So a pull request opened off a Queue card always has a way back to the Queue, even though its tab has no page
 * before it.
 *
 * @param canGoBack the tab's own history has a page before this one
 * @returns `history` to go back in the tab, the opener's id to show it, or `undefined` when back goes nowhere
 */
export function backTarget({
  strip,
  id,
  canGoBack,
}: {
  strip: TabStrip;
  id: string;
  canGoBack: boolean;
}): "history" | { readonly tab: string } | undefined {
  if (canGoBack) {
    return "history";
  }
  const opener = tabOf({ id, strip })?.opener;
  if (opener === undefined || tabOf({ id: opener, strip }) === undefined) {
    return undefined;
  }
  return { tab: opener };
}

/**
 * The history entries back must never reach: a holding page ("Starting Slopweaver", "The console is not serving") a
 * tab showed while the console was down, which stays in its history under the page that replaced it. Measured on the
 * first build of the strip: a restored Queue tab's history read `[data:…, /queue]`, so ‹ was lit on its first page
 * and went to the holding page.
 *
 * @param urls the tab's history, oldest first
 * @param current the index of the page it shows
 * @returns the indices to remove, highest first so each removal leaves the next index where it was
 */
export function holdingEntries({ urls, current }: { urls: readonly string[]; current: number }): readonly number[] {
  return urls
    .map((url, index) => ({ index, url }))
    .filter(({ url, index }) => index !== current && url.startsWith("data:"))
    .map(({ index }) => index)
    .toReversed();
}

/**
 * What the strip page sends: a click on a tab, its close, a drop, the back and forward arrows, or the new-tab button
 * with the point under it, in the strip's own coordinates, where its menu of pages opens.
 */
export type TabCommand =
  | { readonly kind: "activate"; readonly id: string }
  | { readonly kind: "close"; readonly id: string }
  | { readonly kind: "move"; readonly id: string; readonly to: number }
  | { readonly kind: "back" }
  | { readonly kind: "forward" }
  | { readonly kind: "new-tab"; readonly x: number; readonly y: number };

/** A tab id as the shell mints them. */
const TAB_ID = /^tab-[0-9]{1,9}$/u;

/**
 * A place in the strip, or a coordinate on it: a whole number, never negative.
 *
 * @returns true when it is one
 */
function isPlace(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * One command off the strip page, exactly — anything else is dropped.
 *
 * @param value what the strip's preload sent
 * @returns the command, or `undefined`
 */
export function parseTabCommand({ value }: { value: unknown }): TabCommand | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const { kind, id, to, x, y } = value;
  const keys = Object.keys(value).length;
  if ((kind === "back" || kind === "forward") && keys === 1) {
    return { kind };
  }
  if (kind === "new-tab" && keys === 3 && isPlace(x) && isPlace(y)) {
    return { kind, x, y };
  }
  if (typeof id !== "string" || !TAB_ID.test(id)) {
    return undefined;
  }
  if ((kind === "activate" || kind === "close") && keys === 2) {
    return { id, kind };
  }
  if (kind === "move" && keys === 3 && isPlace(to)) {
    return { id, kind, to };
  }
  return undefined;
}

/**
 * Text made safe inside HTML, element content and a quoted attribute alike.
 *
 * @returns the escaped text
 */
function escapeHtml({ text }: { text: string }): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** The longest title the strip draws; the tab truncates long before this, and the tooltip carries the rest. */
const MAX_TITLE = 200;

/**
 * The strip's contents, as Chrome draws its own: back and forward, then each tab — its page's icon on its left
 * (`tabIcon`), its title truncated to the width the tabs share, a close on every one but the pinned Queue — with the
 * showing tab selected, then the new-tab button right after the last tab. The strip page's preload puts this in place
 * and turns clicks and drops into {@link TabCommand}s.
 *
 * @param canGoBack back goes somewhere in the showing tab ({@link backTarget})
 * @param canGoForward the showing tab has a page after this one
 * @returns the markup
 */
export function stripMarkup({
  strip,
  canGoBack,
  canGoForward,
}: {
  strip: TabStrip;
  canGoBack: boolean;
  canGoForward: boolean;
}): string {
  const arrow = ({ kind, glyph, enabled }: { kind: string; glyph: string; enabled: boolean }): string =>
    `<button class="nav" type="button" data-command="${kind}" aria-label="${kind}"${enabled ? "" : " disabled"}>${glyph}</button>`;
  const tabs = strip.tabs.map((tab, index) => {
    const title = escapeHtml({ text: tab.title.slice(0, MAX_TITLE) });
    const selected = tab.id === strip.active;
    const pinned = index === 0;
    const close = pinned
      ? ""
      : `<button class="close" type="button" data-close="${tab.id}" aria-label="close ${title}">×</button>`;
    const icon = `<span class="icon" aria-hidden="true">${escapeHtml({ text: tabIcon({ path: tab.path }) })}</span>`;
    return `<div class="tab${selected ? " selected" : ""}${pinned ? " pinned" : ""}" role="tab" aria-selected="${String(selected)}" data-tab="${tab.id}" data-index="${String(index)}" draggable="${String(!pinned)}" title="${title}">${icon}<span class="title">${title}</span>${close}</div>`;
  });
  const add = `<button class="new-tab" type="button" data-command="new-tab" aria-label="new tab" title="New tab">+</button>`;
  return `${arrow({ enabled: canGoBack, glyph: "‹", kind: "back" })}${arrow({ enabled: canGoForward, glyph: "›", kind: "forward" })}<div class="tabs" role="tablist">${tabs.join("")}${add}</div>`;
}

/**
 * The console's ` · <name>` title suffix: the last middle dot set off by spaces, and what follows it. The em dash is
 * the spelling the console used before, still read so a window restored with an older title keeps its label. The
 * lookahead's own lookbehind lets a later delimiter share this one's space (`one — · two` keeps `one —`), as
 * `lastIndexOf` did.
 */
const CONSOLE_SUFFIX = /(?<=.) (?:·|—) (?!.*(?<= )(?:·|—) ).*$/su;

/** A local page's address inside the viewer: `/api/page/<slug>/…`. */
const LOCAL_PAGE = /^\/api\/page\/([^/]+)\//u;

/**
 * What a tab is called: a briefing or other local page in the viewer by its own name, any other page by its document
 * title without the console's ` · <name>` suffix, and a page that has said nothing by its address.
 *
 * @param title the document's title, as the page set it
 * @param path the tab's page
 * @returns the label
 */
export function tabTitle({ title, path }: { title: string; path: string }): string {
  const address = new URL(path, "http://localhost:1");
  const src = address.pathname === "/view" ? address.searchParams.get("src") : null;
  const slug = src === null ? undefined : LOCAL_PAGE.exec(src)?.[1];
  if (slug !== undefined) {
    return slug.replaceAll("-", " ");
  }
  const own = title.replace(CONSOLE_SUFFIX, "").trim();
  if (own === "") {
    return path;
  }
  return own;
}

/** One tab as the saved state keeps it: the page and its title, in strip order, the pinned one first. */
export interface SavedTab {
  readonly path: string;
  readonly title: string;
}

/**
 * The tabs to save.
 *
 * @returns every tab's page and title, in strip order
 */
export function savedTabs({ strip }: { strip: TabStrip }): readonly SavedTab[] {
  return strip.tabs.map((tab) => ({ path: tab.path, title: tab.title }));
}

/**
 * The strip a relaunch opens with: every saved tab back in its place, the pinned one showing — the owner lands on the
 * Queue when they open the app, and the rest wait behind it, each loading the first time it is shown. With nothing
 * saved it is the pinned tab alone, on `home`.
 *
 * A saved tab beside the pinned one on the Queue itself is not restored: the Queue has one tab, the pinned one, so a
 * duplicate opened for the voice's Queue link would otherwise come back on every launch. The criterion is the deep link's own
 * (`deepLinkTarget`), so the tab a Queue address lands in and the tab that survives a relaunch are the same one.
 *
 * @param saved the saved tabs, the pinned one first, or `undefined` from a state written before tabs
 * @param mint the id for the tab at an index
 * @param home the pinned tab's page when nothing was saved
 * @returns the strip
 */
export function restoredStrip({
  saved,
  mint,
  home,
}: {
  saved: readonly SavedTab[] | undefined;
  mint: (place: { readonly index: number }) => string;
  home: string;
}): TabStrip {
  if (saved === undefined || saved.length === 0) {
    return pinnedStrip({ id: mint({ index: 0 }), path: home, title: home });
  }
  const kept = saved.filter((tab, index) => index === 0 || deepLinkTarget({ path: tab.path }) === "new");
  const tabs = kept.map((tab, index) => ({
    id: mint({ index }),
    opener: undefined,
    path: tab.path,
    title: tab.title,
  }));
  return { active: tabs[0]!.id, tabs };
}
