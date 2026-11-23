/**
 * The two contexts the console can be looked at in, and how a row is told to belong to one.
 *
 * An account switcher at the top of the sidebar, Cloudflare's shape, so the owner can switch between Slopweaver and
 * work and always tell which they are looking at — during nine to five the owner should be on work things. A context
 * is a FILTER over every register the console reads, never a second reading: the verbs run exactly as before and the
 * page hides the rows that belong to the other context, and the page says how many it hid.
 *
 * **Which context a row belongs to is `./workspacePlacement.ts`**: one workspace per row, read off structured
 * fields and never off its words, and a row no field places is a finding the default rule puts in self. This module is the
 * view: the switcher, its storage and its addresses.
 */

import { TAG_PARAM } from "./queueTags";
import { VIEW_PARAM } from "./queueViews";

/** Which context the console is showing. */
export type WorkContext = "slopweaver" | "work";

/** One entry in the switcher. */
export interface ContextEntry {
  readonly id: WorkContext;
  /** The name on the switcher. */
  readonly label: string;
  /** What the context covers, said on hover over its switcher row. */
  readonly sub: string;
}

/** The contexts, in the order the switcher lists them. Work first: it is the nine-to-five default. */
export const WORK_CONTEXTS: readonly WorkContext[] = ["work", "slopweaver"];

/**
 * The switcher entry for a context. The work context is named by the organisation the install works for, read from
 * the store (`./placementOrganisation.ts`), so no organisation's name — and no generic stand-in — is written here.
 *
 * @param teamLabel the work context's name: the organisation's display name, off the layout's one reading
 * @returns the entry
 */
export function entryOf({ context, teamLabel }: { context: WorkContext; teamLabel: string }): ContextEntry {
  if (context === "work") {
    return { id: "work", label: teamLabel, sub: "the organisation's work: its repositories, Slack, Linear and Vanta" };
  }
  return { id: "slopweaver", label: "Slopweaver", sub: "this instance's own template repository" };
}

/**
 * The context the console is NOT showing — the one whose rows a page hides and counts.
 *
 * @returns the other of the two contexts
 */
export function otherWorkContext({ context }: { context: WorkContext }): WorkContext {
  if (context === "work") {
    return "slopweaver";
  }
  return "work";
}

/**
 * The label a count of one context's Queue cards is read under by the voice, when that context is the one NOT shown —
 * it names the context, so the number is never said as this one's. The work context is "work" here: the organisation's
 * display name is not in the voice's reading, and is not needed to tell the two apart.
 *
 * @param context the context whose cards are counted
 * @returns e.g. `In the Slopweaver context`
 */
export function otherContextLabel({ context }: { context: WorkContext }): string {
  if (context === "slopweaver") {
    return "In the Slopweaver context";
  }
  return "In the work context";
}

/**
 * Every switcher entry, in {@link WORK_CONTEXTS}' order.
 *
 * @param teamLabel the work context's resolved name
 * @returns the entries
 */
export function contextEntries({ teamLabel }: { teamLabel: string }): readonly ContextEntry[] {
  return WORK_CONTEXTS.map((context) => entryOf({ context, teamLabel }));
}

/** The context a first visit opens in, before a choice is stored. */
export const DEFAULT_CONTEXT: WorkContext = "work";

/** The `localStorage` key the chosen context is kept under. */
export const CONTEXT_STORAGE_KEY = "sw-context";

/** The `localStorage` key the sidebar's collapsed state is kept under. */
export const SIDEBAR_STORAGE_KEY = "sw-sidebar";

/** The sidebar's two shapes: the full rail with labels, or icons only. */
export type SidebarMode = "full" | "icons";

/** The sidebar shape a first visit opens with. */
export const DEFAULT_SIDEBAR: SidebarMode = "full";

/**
 * Whether a stored string is a context this console knows.
 *
 * @returns true for one of the two ids
 */
export function isWorkContext(value: unknown): value is WorkContext {
  return value === "slopweaver" || value === "work";
}

/**
 * Whether a stored string is a sidebar mode.
 *
 * @returns true for `full` or `icons`
 */
export function isSidebarMode(value: unknown): value is SidebarMode {
  return value === "full" || value === "icons";
}

/*
 * Addressing a view choice.
 *
 * Both choices above are kept in `localStorage`, which made two real surfaces unreachable by URL: the
 * Slopweaver context, and the collapsed icon rail. A screenshot pass over "every browser surface" could
 * not photograph either without driving a click, and `slopweaver browser act` correctly refuses a
 * write-capable interaction on an unregistered host — so the pass either skipped them or reached for
 * break-glass, and neither is right for looking at a page. A query parameter makes the choice an address.
 *
 * Merely READING a URL never writes storage: a link pointing at one context must not silently change which
 * context the owner's next visit opens in. A CHOICE writes both — the switcher, or a deep link switching to its
 * row's context — because an address left carrying the old value would override the choice just made and
 * the page would not move (`withParamReplaced`, `withParamSet`).
 *
 * The context is ALWAYS in the address, not only when a link put it there, in case the owner
 * wants to bookmark one context or the other. A context kept only in storage would make a bookmark of `/queue` open
 * whichever context the owner last chose, so a page that arrives without
 * it has it written in (`canonicalSearch`), the switcher always writes it, and the sidebar's links carry it to
 * the next page (`navHref`) — an addressed view survives crossing routes instead of falling back to storage.
 * The rail stays addressed only on demand: nobody bookmarks a sidebar width.
 */

/** Addresses the context: `?context=slopweaver`. */
export const CONTEXT_PARAM = "context";

/** Addresses the sidebar's shape: `?rail=icons`. */
export const SIDEBAR_PARAM = "rail";

/**
 * Which choice a view is showing — the URL's, else the one the browser kept, else the first-visit default.
 *
 * @param accept narrows a candidate to the choice's type; anything else is passed over rather than shown
 * @param fromUrl the query parameter's value, or null when the URL does not carry it
 * @param stored what `localStorage` holds, or null on a first visit
 * @returns the choice to show
 */
export function chooseView<T extends string>({
  accept,
  fallback,
  fromUrl,
  stored,
}: {
  accept: (value: unknown) => value is T;
  fallback: T;
  fromUrl: string | null;
  stored: string | null;
}): T {
  if (accept(fromUrl)) {
    return fromUrl;
  }
  if (accept(stored)) {
    return stored;
  }
  return fallback;
}

/**
 * The words of the line a page prints when the context hid rows — the count, the noun and the verb that
 * AGREE with each other.
 *
 * Pure, and separated from the component that draws it, because the defect this closes is a grammatical
 * one and a component in this tree cannot be unit-tested. Measured: /pull-requests opened on
 * "1 pull requests in the Slopweaver context are not shown" — the same defect as a hand-step count's "1
 * steps on your hands", in the very sentence that exists to stop a reader mistrusting a short list. Repro:
 * `slopweaver browser shot --raw --full-page --url http://localhost:3100/pull-requests`.
 *
 * @param context the context being looked at; the line names the OTHER one
 * @param hidden how many rows the other context holds
 * @param one the rows' name in the singular, for the one-row case
 * @param what the rows' name, plural — "pull requests", "rows"
 * @param teamLabel the work context's resolved name, which the line prints when the work context is the other one
 * @returns the parts, or `undefined` when nothing was hidden and there is no line to draw
 */
export function hiddenNoteParts({
  context,
  hidden,
  one,
  what,
  teamLabel,
}: {
  context: WorkContext;
  hidden: number;
  one: string;
  what: string;
  teamLabel: string;
}): { readonly count: string; readonly name: string; readonly otherLabel: string; readonly verb: string } | undefined {
  if (hidden === 0) {
    return undefined;
  }
  const other = entryOf({ context: otherWorkContext({ context }), teamLabel });
  if (hidden === 1) {
    return { count: "1", name: one, otherLabel: other.label, verb: "is" };
  }
  return { count: String(hidden), name: what, otherLabel: other.label, verb: "are" };
}

/**
 * The words of the line a page prints when the rows the context hid could not be counted yet — a reading that moves a
 * row between contexts has not answered — so an uncounted context is said in words, never drawn as silence that reads
 * like an empty one.
 *
 * @param context the context being looked at; the line names the OTHER one
 * @param what the rows' name, plural — "cards", "pull requests"
 * @param teamLabel the work context's resolved name, which the line prints when the work context is the other one
 * @returns the rows' name opening the sentence, capitalised, and the other context's label
 */
export function uncountedNoteParts({
  context,
  what,
  teamLabel,
}: {
  context: WorkContext;
  what: string;
  teamLabel: string;
}): { readonly name: string; readonly otherLabel: string } {
  const other = entryOf({ context: otherWorkContext({ context }), teamLabel });
  return { name: `${what.charAt(0).toUpperCase()}${what.slice(1)}`, otherLabel: other.label };
}

/**
 * The query string with one addressed choice replaced, or `undefined` when the URL does not address it.
 *
 * A URL carrying `?context=work` overrides storage for that view, so a choice written only to storage left
 * the page exactly where it was — the switcher clicked and nothing moving. Replacing the address in place is
 * how a choice outranks the link that opened the page. A URL that never named the choice is left alone:
 * storage already decides it, and adding the parameter would turn a plain visit into an addressed one.
 *
 * @param search the current query string, with or without its leading `?`
 * @param param the addressed choice's parameter
 * @param value what the choice becomes
 * @returns the new query string with its leading `?`, or `undefined` when there is nothing to replace
 */
export function withParamReplaced({
  search,
  param,
  value,
}: {
  search: string;
  param: string;
  value: string;
}): string | undefined {
  const params = new URLSearchParams(search);
  if (!params.has(param)) {
    return undefined;
  }
  params.set(param, value);
  return `?${params.toString()}`;
}

/**
 * The query string with one addressed choice set, whether or not the URL already named it.
 *
 * The context's setter: a choice of context always lands in the address, so the view the owner just chose is the one a
 * bookmark of the page keeps.
 *
 * @param search the current query string, with or without its leading `?`
 * @param param the addressed choice's parameter
 * @param value what the choice becomes
 * @returns the new query string with its leading `?`, every other parameter kept in order
 */
export function withParamSet({ search, param, value }: { search: string; param: string; value: string }): string {
  const params = new URLSearchParams(search);
  params.set(param, value);
  return `?${params.toString()}`;
}

/**
 * The query string a page's address should carry so it names the context the page is showing, or `undefined`
 * when it already does.
 *
 * A URL with no `context`, or one this console does not know (`?context=acme`, which `chooseView` passes
 * over), gets the shown context written in; a URL naming a known context is left exactly as it is, because
 * that value IS what the page shows.
 *
 * @param search the current query string, with or without its leading `?`
 * @param shown the context the page resolved — the URL's, else storage's, else the default
 * @returns the new query string with its leading `?`, or `undefined` when the address already names a context
 */
export function canonicalSearch({ search, shown }: { search: string; shown: WorkContext }): string | undefined {
  if (isWorkContext(new URLSearchParams(search).get(CONTEXT_PARAM))) {
    return undefined;
  }
  return withParamSet({ param: CONTEXT_PARAM, search, value: shown });
}

/**
 * The context the page at another window's address is showing, resolved exactly as that window resolves it: the
 * address's, else the stored choice, else the default. The desktop shell's voice window is its own document, whose
 * own address may name another context, so a count the voice reads takes the console window's carried page's context,
 * never its own.
 *
 * @param path a page's path with any query of its own — `/queue?context=slopweaver`
 * @param stored what `localStorage` holds for the context, which the two windows share
 * @returns the context the page at `path` is showing
 */
export function contextAddressedBy({ path, stored }: { path: string; stored: string | null }): WorkContext {
  const cut = path.indexOf("?");
  let fromUrl: string | null = null;
  if (cut !== -1) {
    fromUrl = new URLSearchParams(path.slice(cut)).get(CONTEXT_PARAM);
  }
  return chooseView({ accept: isWorkContext, fallback: DEFAULT_CONTEXT, fromUrl, stored });
}

/**
 * A page's path with the context it is showing written in, as `useContextAddress` writes it one effect later: the
 * voice reads a card off the view its path names, and a bare path read before that effect would name the default
 * while the page draws a stored Slopweaver view.
 *
 * @param path a page's path with any query of its own — `/queue`
 * @param stored what `localStorage` holds for the context, which every console window shares
 * @returns the path, naming the context the page at it is showing
 */
export function pathWithContextShown({ path, stored }: { path: string; stored: string | null }): string {
  const cut = path.indexOf("?");
  let search = "";
  let pathname = path;
  if (cut !== -1) {
    search = path.slice(cut);
    pathname = path.slice(0, cut);
  }
  const next = canonicalSearch({ search, shown: contextAddressedBy({ path, stored }) });
  if (next === undefined) {
    return path;
  }
  return `${pathname}${next}`;
}

/**
 * A link to another console page, carrying the context being looked at — the sidebar's, and a panel's link to
 * another page.
 *
 * A bare `/pull-requests` link dropped an addressed context, and the next page fell back to storage — which
 * reading an address never writes — so a bookmarked Slopweaver Queue turned into Team one click later. Only
 * the context rides: the link is drawn from React state, and the rail an address named is not in it.
 *
 * @param href the page's path, with any query of its own, which is kept
 * @param context the context the page is showing
 * @returns the link's href
 */
export function navHref({ href, context }: { href: string; context: WorkContext }): string {
  const cut = href.indexOf("?");
  if (cut === -1) {
    return `${href}${withParamSet({ param: CONTEXT_PARAM, search: "", value: context })}`;
  }
  return `${href.slice(0, cut)}${withParamSet({ param: CONTEXT_PARAM, search: href.slice(cut), value: context })}`;
}

/** Addresses a queue row's panel: `?open=<kind>:<id>`. */
export const OPEN_PARAM = "open";

/**
 * The address of a page with one row's panel open, or with none — keeping the view choices the URL named.
 *
 * Opening or closing a panel used to rebuild the query from `open` alone. Harmless while no link carried a
 * context; once a floating note's link does (`?open=ask%3A<slug>&context=slopweaver`), closing the panel
 * dropped the address and the page fell back to the stored context, hiding the row the link had just shown.
 * The view choices ride along — the context, the sidebar, the Queue's view, and every repeated Queue tag selector, verbatim and in
 * order, malformed ones included, so opening a card never quietly widens the filtered list behind it. Every other
 * parameter is a link's one-shot instruction and is dropped, as before.
 *
 * @param search the current query string
 * @param open the row key to open, or `null` to close
 * @returns the href
 */
export function panelHref({
  pathname,
  search,
  open,
}: {
  pathname: string;
  search: string;
  open: string | null;
}): string {
  const from = new URLSearchParams(search);
  const next = new URLSearchParams();
  if (open !== null) {
    next.set(OPEN_PARAM, open);
  }
  for (const param of [CONTEXT_PARAM, SIDEBAR_PARAM, VIEW_PARAM]) {
    const value = from.get(param);
    if (value !== null) {
      next.set(param, value);
    }
  }
  for (const selector of from.getAll(TAG_PARAM)) {
    next.append(TAG_PARAM, selector);
  }
  const query = next.toString();
  if (query === "") {
    return pathname;
  }
  return `${pathname}?${query}`;
}
