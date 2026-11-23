/**
 * The PURE half of `slopweaver slack saved` — what their own Slack Later list holds, read off the call their own
 * client makes when it opens that list.
 *
 * ## Why the client's call, and not the API
 *
 * MEASURED: `slack probe --method stars.list --scopes` answers ok under their user token, which
 * already holds `stars:read`, and returns three rows of which three are `type: channel` — starred CHANNELS.
 * Later is not on the published Web API at all. The web client reads it through an internal `saved.list` call
 * the Slack atlas already records (`atlas/slackApi/browser.ts`, `publicSurface: false`). So the narrowest read
 * is to open `/later` in their own Chrome and keep the one response the client fetched for itself: no request
 * is replayed, no cursor is followed, nothing is clicked, scrolled or photographed, and no item is touched.
 *
 * ## What it says about completeness, and what it cannot
 *
 * One visit sees only what the client asks for on its first load. A non-empty `next_cursor`, or a `counts`
 * total above the rows returned, is printed as a gap. An empty cursor proves the observed call had no next
 * page, never that no other Later view (a filter, a tab) holds more.
 *
 * ## Pointers, not content
 *
 * Each row is a conversation id, a timestamp and the list's own state, plus a built permalink. Message TEXT
 * is never fetched here: `slack read-thread <permalink>` is the door for that, called deliberately per item.
 *
 * No fs, no clock, no network, no browser here; `./savedRun.ts` does every read, and `./savedList.ts` holds the
 * wire shape of one answer and how several reconcile.
 */
import type { PageCapture, ResponseAccounting } from "../../../browser/pageTransport.js";
import { err, ok } from "../../../lib/result.js";
import { parseFlags } from "../../parseFlags.js";
import { SlackArgumentErrors, type SlackParsed } from "./argumentErrors.js";
import {
  countsAgainstRows,
  countsExceedRows,
  itemOf,
  parseSavedListBodies,
  reconcile,
  SAVED_LIST_PATH,
  type SavedListError,
  type SlackSavedCounts,
  type SlackSavedItem,
} from "./savedList.js";

/** How long the client is given to load its Later list before the capture returns, when the caller states none. */
export const SLACK_SAVED_DEFAULT_SETTLE_MS = 8_000;

/** The longest settle a caller may ask for — the same ceiling `slack shot` keeps, for the same reason. */
export const SLACK_SAVED_MAX_SETTLE_MS = 60_000;

/** The validated invocation. */
export interface SlackSavedOptions {
  readonly settleMs: number;
  readonly json: boolean;
  readonly home: string | undefined;
}

/** Where a read ended up, named — never a silence. */
export type SlackSavedOutcome =
  /** At least one `saved.list` response was kept and read. An empty list is still `read`. */
  | "read"
  /** The page loaded, every response it made was kept, and none was `saved.list`. */
  | "not-observed"
  /** A response the page made was lost, so its absence proves nothing. */
  | "capture-incomplete"
  /** A `saved.list` body was kept and its shape is not the one this version reads. */
  | "response-invalid"
  | "navigation-failed"
  | "relay-unavailable"
  | "session-lost"
  | "off-lease-origin";

/** What one read produced, as the verb reports it. */
export interface SlackSavedReport {
  readonly schemaVersion: 1;
  readonly kind: "slack-saved";
  readonly outcome: SlackSavedOutcome;
  readonly requestedUrl: string;
  readonly finalUrl: string | null;
  /** The origins that answered the kept `saved.list` calls. */
  readonly responseOrigins: readonly string[];
  readonly callsObserved: number;
  readonly items: readonly SlackSavedItem[];
  readonly counts: SlackSavedCounts | null;
  readonly nextCursorPresent: boolean;
  /** True when the cursor or the counts say the first load did not hold everything. */
  readonly firstLoadTruncated: boolean;
  readonly responseAccounting: ResponseAccounting | null;
  readonly because: string | null;
}

/**
 * The path of a captured response's URL, or `null` when the URL does not parse.
 *
 * @param url the response's own URL
 * @returns its pathname
 */
function pathOf({ url }: { url: string }): string | null {
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

/**
 * How many bodies the capture wanted and did not keep — two disjoint losses ADDED, never the larger of them:
 * the eligible bodies never counted as kept (the failures it recorded, or more when some were neither kept
 * nor recorded as failed), plus the bodies it counted as kept that are not among its responses.
 */
function lostBodies({ capture }: { capture: PageCapture }): number {
  const accounting: ResponseAccounting = capture.responseAccounting;
  const neverKept = Math.max(accounting.bodyFailed, accounting.eligible - accounting.bodySucceeded);
  const keptButNotHeld = Math.max(0, accounting.bodySucceeded - capture.responses.length);
  return neverKept + keptButNotHeld;
}

/** The fields every report from one capture shares. */
function baseOf({
  capture,
}: {
  capture: PageCapture;
}): Omit<
  SlackSavedReport,
  | "outcome"
  | "items"
  | "counts"
  | "nextCursorPresent"
  | "firstLoadTruncated"
  | "because"
  | "responseOrigins"
  | "callsObserved"
> {
  return {
    finalUrl: capture.finalUrl,
    kind: "slack-saved",
    requestedUrl: capture.requestedUrl,
    responseAccounting: capture.responseAccounting,
    schemaVersion: 1,
  };
}

/**
 * Read a capture of `/later` into a report.
 *
 * Precedence is fixed: a kept body that will not parse or reconcile is `response-invalid`; a kept, valid
 * `saved.list` is `read`, with any OTHER body the load lost stated in `because`; with none kept, a lost body is
 * `capture-incomplete` (its absence proves nothing) and a complete capture is `not-observed`.
 *
 * MEASURED: every load of `/later` lost exactly one JSON body the accounting cannot name, so
 * holding `read` hostage to a perfect capture would never have read the list at all.
 *
 * @param capture what the one visit observed
 * @param workspaceUrl the workspace's base URL, for the permalinks
 * @returns the report
 */
export function savedReportFromCapture({
  capture,
  workspaceUrl,
}: {
  capture: PageCapture;
  workspaceUrl: string;
}): SlackSavedReport {
  const matching = capture.responses.filter((response) => pathOf({ url: response.url }) === SAVED_LIST_PATH);
  const responseOrigins = [...new Set(matching.map((response) => new URL(response.url).origin))].toSorted();
  const base = { ...baseOf({ capture }), callsObserved: matching.length, responseOrigins };
  const empty = { counts: null, firstLoadTruncated: false, items: [], nextCursorPresent: false } as const;
  const lost = lostBodies({ capture });
  const parsed = parseSavedListBodies({ bodies: matching.map((response) => response.body) });
  if (parsed.isErr()) {
    return { ...base, ...empty, ...invalidOutcome({ error: parsed.error, lost }) };
  }
  if (parsed.value.length === 0) {
    return { ...base, ...empty, ...absentOutcome({ lost }) };
  }
  const reconciled = reconcile({ parsed: parsed.value });
  if (reconciled.isErr()) {
    return { ...base, ...empty, ...invalidOutcome({ error: reconciled.error, lost }) };
  }
  const { counts, nextCursorPresent, raws, rowsPerCall } = reconciled.value;
  const items = raws.map((raw) => itemOf({ raw, workspaceUrl }));
  const notes = readNotes({ counts, items, lost, observedAt: capture.observedAt, rowsPerCall });
  return {
    ...base,
    because: notes.length === 0 ? null : notes.join("; "),
    counts,
    firstLoadTruncated: nextCursorPresent || countsExceedRows({ counts, items, observedAt: capture.observedAt }),
    items,
    nextCursorPresent,
    outcome: "read",
  };
}

/**
 * A kept answer that cannot be read, with any other body the load lost kept beside it so neither hides the other.
 *
 * @param error why the kept answers cannot be read
 * @param lost how many bodies the load lost
 * @returns the outcome and why
 */
function invalidOutcome({ error, lost }: { error: SavedListError; lost: number }): {
  outcome: SlackSavedOutcome;
  because: string;
} {
  if (lost === 0) {
    return { because: error.message, outcome: "response-invalid" };
  }
  return {
    because: `${error.message}; ${String(lost)} other response body(ies) were also lost on this load`,
    outcome: "response-invalid",
  };
}

/**
 * What a load that kept no `saved.list` answer amounts to: proof of absence only when nothing was lost.
 *
 * @param lost how many bodies the load lost
 * @returns the outcome and why
 */
function absentOutcome({ lost }: { lost: number }): { outcome: SlackSavedOutcome; because: string } {
  if (lost === 0) {
    return {
      because: "the Later page loaded and every response it made was kept, and none of them was saved.list",
      outcome: "not-observed",
    };
  }
  return {
    because: `the page lost ${String(lost)} response body(ies), so an absent saved.list call proves nothing`,
    outcome: "capture-incomplete",
  };
}

/**
 * Every qualification a `read` carries: a lost body, calls that held different rows, and counts against rows.
 *
 * @param counts what saved.list says the whole list holds
 * @param items the rows this load holds, merged
 * @param lost how many bodies the load lost
 * @param observedAt when the page was read
 * @param rowsPerCall how many rows each kept call held
 * @returns one line per qualification, empty for an unqualified read
 */
function readNotes({
  counts,
  items,
  lost,
  observedAt,
  rowsPerCall,
}: {
  counts: SlackSavedCounts;
  items: readonly SlackSavedItem[];
  lost: number;
  observedAt: string;
  rowsPerCall: readonly number[];
}): string[] {
  const notes: string[] = [];
  if (lost > 0) {
    notes.push(
      `${String(lost)} other response body(ies) were lost on this load — if ` +
        "one was a second saved.list call, this list is short of what the client saw",
    );
  }
  // No call repeats a row inside itself (reconcile refuses that), so a call shorter than the union held
  // different rows from another, and the list is a merge no single answer returned.
  if (rowsPerCall.some((rows) => rows !== items.length)) {
    notes.push(
      `the ${String(rowsPerCall.length)} saved.list calls on this load held different rows ` +
        `(${rowsPerCall.join(", ")} item(s)) — this list is their union, which no single call returned`,
    );
  }
  return [...notes, ...countsAgainstRows({ counts, items, observedAt })];
}

/**
 * One item as a reader's line: its state, its due date when it has one, when it was saved, and where it is.
 *
 * @param item one saved item
 * @returns the indented line
 */
function itemLine({ item }: { item: SlackSavedItem }): string {
  let due = "";
  if (item.dueAtIso !== null) {
    due = ` due ${item.dueAtIso}`;
  }
  let saved = "?";
  if (item.savedAtIso !== null) {
    saved = item.savedAtIso;
  }
  let where = `${item.channel} ${item.ts} (${item.unlinkableBecause!})`;
  if (item.permalink !== null) {
    where = item.permalink;
  }
  return `  [${item.state}]${due} saved ${saved} ${where}`;
}

/**
 * The GAP line for a first load that did not hold the whole list, with every number it has.
 *
 * @param report a report whose first load was truncated
 * @returns the indented line
 */
function gapLine({ report }: { report: SlackSavedReport }): string {
  let held = `${String(report.items.length)} item(s)`;
  if (report.counts !== null) {
    held =
      `${String(report.items.length)} of ${String(report.counts.total)} item(s) ` +
      `(${String(report.counts.uncompleted)} open)`;
  }
  const cursor = report.nextCursorPresent ? ", and Slack offered a next page" : "";
  return `  GAP: the first load held ${held}${cursor} — this verb follows no cursor and scrolls nothing, so the rest is unread`;
}

/**
 * Render a report for a reader: one line per item, then the counts and every gap.
 *
 * @param report what the read produced
 * @returns the lines to print
 */
export function renderSlackSavedReport({ report }: { report: SlackSavedReport }): readonly string[] {
  const lines = [`slack saved: ${report.outcome} — ${String(report.items.length)} item(s) from ${report.requestedUrl}`];
  lines.push(...report.items.map((item) => itemLine({ item })));
  if (report.counts !== null) {
    const c = report.counts;
    lines.push(
      `  counts: ${String(c.total)} total, ${String(c.uncompleted)} open (${String(c.uncompletedOverdue)} overdue), ` +
        `${String(c.completed)} completed, ${String(c.archived)} archived`,
    );
  }
  if (report.firstLoadTruncated) {
    lines.push(gapLine({ report }));
  }
  if (report.callsObserved > 1) {
    lines.push(
      `  the client called saved.list ${String(report.callsObserved)} times on this load — any row two calls ` +
        "shared agreed and is listed once",
    );
  }
  if (report.because !== null) {
    lines.push(`  ${report.because}`);
  }
  if (report.items.length > 0) {
    lines.push("  no message text was fetched — read one deliberately with `slopweaver slack read-thread <permalink>`");
  }
  return lines;
}

/**
 * Every flag `slack saved` accepts, as the help/flag ratchet reads them.
 */
export const SLACK_SAVED_FLAG_NAMES: readonly string[] = ["--home", "--json", "--settle"];

/**
 * Parse `slack saved`'s argv tail. It takes no positional: the only list it reads is their own.
 *
 * @param rest the verb's own argv tail
 * @returns the validated invocation, or every rejection
 */
export function parseSlackSavedArgs({ rest }: { rest: readonly string[] }): SlackParsed<SlackSavedOptions> {
  const parsed = parseFlags({
    allowPositionals: true,
    args: rest,
    spec: { boolean: ["json"], string: ["settle", "home"] },
  });
  if (parsed.isErr()) {
    return err(SlackArgumentErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const { values, positionals } = parsed.value;
  if (positionals.length > 0) {
    return err(SlackArgumentErrors.savedPositionalCount({ count: positionals.length }));
  }
  const settle = values["settle"];
  const home = values["home"];
  let settleMs = SLACK_SAVED_DEFAULT_SETTLE_MS;
  if (typeof settle === "string") {
    if (!/^\d+$/.test(settle)) {
      return err(SlackArgumentErrors.settleNotWhole({ got: settle }));
    }
    settleMs = Number(settle);
    if (settleMs > SLACK_SAVED_MAX_SETTLE_MS) {
      return err(SlackArgumentErrors.settleTooLong({ got: settle, max: SLACK_SAVED_MAX_SETTLE_MS }));
    }
  }
  return ok({ home: typeof home === "string" ? home : undefined, json: values["json"] === true, settleMs });
}
