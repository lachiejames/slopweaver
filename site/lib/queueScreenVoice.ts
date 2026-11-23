/**
 * The Queue on screen, as the voice's window reads it in the desktop shell.
 *
 * Measured: the voice's window answered `action_items` from its own copy of the registers, read once when the call
 * began and held quiet through it (`../components/live/liveQuiet.ts`), so it listed cards the Queue in the console
 * window had stopped drawing hours before. The console window draws the Queue from live readings; the voice's window
 * is a second document with channels of its own.
 *
 * A Queue tool answers from the RECORD, read fresh at the call
 * (`./voiceRecordQueue.ts`), never a page's copy — this window's or the console window's. What the console window still
 * hands over is what is on SCREEN: the cards it draws, the keys and order the Queue drew (`drawnKeys`,
 * `./queueVoice.ts`), and the counts it prints. The record is checked against that, so the voice never says a count
 * or opens a card the screen does not show.
 *
 * The snapshot crosses the shell as one JSON string under a bound, so the shell carries it without reading it, as it
 * carries a page's reading (`./desktopPageReading.ts`). Pure.
 */
import { isRecord } from "./desktopShellWire";
import type { QueueFocus } from "./queueFocus";
import type { QueueRow } from "./queueRows";
import type { QueueShownCounts } from "./queueShownCounts";
import type { QueueView } from "./queueViews";
import type { RecentlyLeftCard } from "./recentQueueDepartures";
import { isWorkContext, type WorkContext } from "./workContext";

/** The longest snapshot the shell carries, in UTF-16 code units (`desktop/src/desktopBridge.ts`, the same bound). */
export const QUEUE_SCREEN_WIRE_MAX_CHARS = 8 * 1024 * 1024;

/**
 * How long the voice's window waits on the shell's answer before saying it did not arrive, whatever the shell does:
 * main asks the console tab at most twice, each under its own 2000 ms deadline (`desktop/src/voiceQueueWire.ts`
 * `VOICE_QUEUE_DEADLINE_MS`), so a shell that has not answered past both and the IPC either side is one that never
 * will. A judgement value over that arithmetic.
 */
export const SCREEN_ASK_DEADLINE_MS = 6000;

/** The source an answer names when the Queue on screen did not reach the voice, or draws other than the record. */
export const SCREEN_QUEUE_SOURCE = "the Queue on screen";

/** What the console window on screen holds of the owner's Queue, at the moment the voice's window asked. */
export interface QueueScreenSnapshot {
  /** The console page it was taken on, path and query. */
  readonly path: string;
  /** Every key the Queue page drew, in its order — absent off the Queue. */
  readonly drawnKeys?: readonly string[];
  /** The cards that window draws, from its own readings: what the record is checked against. */
  readonly cards: {
    readonly rows: readonly QueueRow[];
    readonly recentlyLeft: readonly RecentlyLeftCard[];
    readonly focuses: readonly QueueFocus[];
    readonly acts: readonly QueueRow[];
  };
  /** The counts that window prints. */
  readonly shown: QueueShownCounts;
}

/**
 * The drawn keys a Queue page's reading carries.
 *
 * @param shows what the page body registered for `read_page`
 * @returns every key the Queue draws, in its order, or `undefined` for any page that is not the Queue's reading
 */
export function drawnKeysOf({ shows }: { shows: unknown }): readonly string[] | undefined {
  if (!isRecord(shows)) {
    return undefined;
  }
  const keys = shows["drawnKeys"];
  if (!Array.isArray(keys) || !keys.every((key): key is string => typeof key === "string")) {
    return undefined;
  }
  return keys;
}

/**
 * The rows an `action_items` answer lists: on the Queue, exactly the cards it drew, in its order; anywhere else, the
 * Queue's own order over the rows the context shows.
 *
 * @param drawn the keys the Queue page drew, or `undefined` off the Queue
 * @param ordered the Queue's order over the rows the context shows
 * @param live every row the Queue holds, in both contexts — a card a view draws from the other workspace included
 * @returns the rows, and every drawn key no row answered to, which the answer names rather than drops
 */
export function screenOrdered({
  drawn,
  ordered,
  live,
}: {
  drawn: readonly string[] | undefined;
  ordered: readonly QueueRow[];
  live: readonly QueueRow[];
}): { readonly rows: readonly QueueRow[]; readonly missing: readonly string[] } {
  if (drawn === undefined) {
    return { missing: [], rows: ordered };
  }
  const byKey = new Map(live.map((row) => [row.key, row]));
  const rows: QueueRow[] = [];
  const missing: string[] = [];
  for (const key of drawn) {
    const row = byKey.get(key);
    if (row === undefined) {
      missing.push(key);
    } else {
      rows.push(row);
    }
  }
  return { missing, rows };
}

/**
 * Why the drawn keys an answer could not resolve are missing from it, as an unread source.
 *
 * @param missing the keys
 * @returns the sentence
 */
export function missingDrawnWhy({ missing }: { missing: readonly string[] }): string {
  return `the Queue draws ${String(missing.length)} card(s) this answer's readings do not hold (${missing.join(", ")})`;
}

/**
 * The snapshot as it crosses the shell.
 *
 * @param snapshot what the console window holds
 * @returns the wire string, or `undefined` when it is past the bound — the voice's window then says it did not arrive
 */
export function screenSnapshotWire({ snapshot }: { snapshot: QueueScreenSnapshot }): string | undefined {
  const wire = JSON.stringify(snapshot);
  if (wire.length > QUEUE_SCREEN_WIRE_MAX_CHARS) {
    return undefined;
  }
  return wire;
}

/**
 * A snapshot off the shell. Its shape is checked to the depth the voice's window branches on; the rows inside are the
 * console window's own, drawn by the same build, and carried as it sent them.
 *
 * @param value what the shell handed back
 * @returns the snapshot, or `undefined` for anything that is not one
 */
export function screenSnapshotOf({ value }: { value: unknown }): QueueScreenSnapshot | undefined {
  if (typeof value !== "string" || value.length > QUEUE_SCREEN_WIRE_MAX_CHARS) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || typeof parsed["path"] !== "string") {
    return undefined;
  }
  const { cards, drawnKeys, shown } = parsed;
  if (drawnKeys !== undefined && drawnKeysOf({ shows: { drawnKeys } }) === undefined) {
    return undefined;
  }
  if (!isRecord(cards) || !["rows", "recentlyLeft", "focuses", "acts"].every((key) => Array.isArray(cards[key]))) {
    return undefined;
  }
  if (!isRecord(shown) || !isRecord(shown["views"]) || typeof shown["view"] !== "string") {
    return undefined;
  }
  // The other context's id names the field its hidden count is read under; an unread count drops out of the JSON.
  const other = shown["otherContext"];
  if (!isRecord(other) || !isWorkContext(other["context"])) {
    return undefined;
  }
  // oxlint-disable-next-line no-unsafe-type-assertion -- every field the voice reads was checked above; the rows inside are the console tab's own, already typed where it built them
  return parsed as unknown as QueueScreenSnapshot;
}

/** The page a path names, without its query or fragment. */
function pathnameOf({ path }: { path: string }): string {
  const cut = path.search(/[?#]/);
  if (cut === -1) {
    return path;
  }
  return path.slice(0, cut);
}

/**
 * Whether a console path is the Queue's page, the one page whose answer is held to the cards it drew.
 *
 * @param path the console page, path and query, or `undefined` before one arrived
 * @returns true on `/queue`, whatever its query
 */
export function onQueuePath({ path }: { path: string | undefined }): boolean {
  if (path === undefined) {
    return false;
  }
  return pathnameOf({ path }) === "/queue";
}

/** What the voice's window holds of the Queue on screen: nothing asked yet, the console window's, or why not. */
export type ScreenHeld =
  | { readonly kind: "unasked" }
  | { readonly kind: "served"; readonly snapshot: QueueScreenSnapshot }
  | { readonly kind: "unreached"; readonly why: string };

/**
 * What the shell handed back for one ask (`desktop/src/voiceQueueWire.ts` `VoiceQueueAnswer`), as the voice holds it.
 *
 * @param value the shell's answer
 * @returns the snapshot, or why there is none — a malformed answer included, never read as an empty Queue
 */
export function screenHeldOf({ value }: { value: unknown }): ScreenHeld {
  if (!isRecord(value)) {
    return { kind: "unreached", why: "the desktop app answered the ask for the Queue with something that is not one" };
  }
  if (value["kind"] === "unreached" && typeof value["why"] === "string") {
    return { kind: "unreached", why: value["why"] };
  }
  if (value["kind"] !== "served") {
    return { kind: "unreached", why: "the desktop app answered the ask for the Queue with something that is not one" };
  }
  const snapshot = screenSnapshotOf({ value: value["snapshot"] });
  if (snapshot === undefined) {
    return { kind: "unreached", why: "the console window's Queue arrived malformed or past the bound" };
  }
  return { kind: "served", snapshot };
}

/**
 * Which Queue a tool reads: the console window's snapshot when one is held for the page on screen; an ask that failed,
 * on any page, nothing but its reason; on the Queue with nothing asked yet, likewise; off the Queue, with nothing asked
 * or a snapshot of another page, the voice window's own projection.
 *
 * @param held what the voice's window holds
 * @param carriedPath the console page the owner is on now, path and query, or `undefined` before one arrived
 * @returns the snapshot to read, why there is none, or `local` for the voice window's own projection
 */
export function screenSourceOf({
  held,
  carriedPath,
}: {
  held: ScreenHeld;
  carriedPath: string | undefined;
}):
  | { readonly kind: "snapshot"; readonly snapshot: QueueScreenSnapshot }
  | { readonly kind: "unreached"; readonly why: string }
  | { readonly kind: "local" } {
  // A snapshot of a page the owner has since left describes a screen no one is looking at.
  const samePage =
    held.kind === "served" &&
    (carriedPath === undefined || pathnameOf({ path: held.snapshot.path }) === pathnameOf({ path: carriedPath }));
  if (held.kind === "served" && samePage) {
    return { kind: "snapshot", snapshot: held.snapshot };
  }
  // An ask that failed is said on every page: off the Queue too, the voice window's own projection is the copy held
  // quiet through the call.
  if (held.kind === "unreached") {
    return { kind: "unreached", why: held.why };
  }
  if (!onQueuePath({ path: carriedPath })) {
    return { kind: "local" };
  }
  return { kind: "unreached", why: "the console window's Queue has not reached the voice's window for this page yet" };
}

/**
 * Every count unread: what the voice's window holds while the console window's Queue has not reached it.
 *
 * @param view the view the carried page has open
 * @param otherContext the context the page is NOT showing, whose hidden count is unread too — never said as zero
 * @returns the counts, each unread
 */
export function unreadShown({ view, otherContext }: { view: QueueView; otherContext: WorkContext }): QueueShownCounts {
  return {
    everything: undefined,
    otherContext: { context: otherContext, count: undefined },
    view,
    views: {
      all: undefined,
      "check-in": undefined,
      colleague: undefined,
      finding: undefined,
      fleet: undefined,
      review: undefined,
      slack: undefined,
      urgent: undefined,
    },
    waiting: undefined,
  };
}
