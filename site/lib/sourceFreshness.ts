/**
 * What the console says about how current a provider's stored data is — the line a Slack panel carries beside its
 * own "read" receipt (`SourceFreshnessLine`).
 *
 * The owner can see drift between the console and Slack itself, and the fix is to be upfront when syncing a provider
 * has a problem. The sidebar carries no per-source strip or notice, since a section reading "GitHub unscheduled, Slack unscheduled, linear unscheduled" was noise; the panel line
 * is what remains.
 *
 * Every decision is the verb's (`slopweaver automation freshness --json`, `src/briefing/sourceFreshness.ts`); this
 * module only words it, against a `nowMs` the caller passes so a test fixes the clock, and escalates a quiet row
 * to late once that clock carries it past its window (`agedRow`), never the reverse.
 */

import type { SourceFreshnessRow } from "./sourceFreshnessReport";
import { type FreshnessWords, STATE_TONE } from "./sourceFreshnessTones";

const MINUTE_MS = 60_000;

/** How often the page's clock moves (`useMinuteClock`), and so how far behind a fresh report it can be. */
export const FRESHNESS_CLOCK_TICK_MS = MINUTE_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** A duration in the console's short vocabulary: `just now`, `12m`, `4.2h`, `3.1d`. */
function spanWords({ ms }: { ms: number }): string {
  if (ms < MINUTE_MS) {
    return "just now";
  }
  if (ms < HOUR_MS) {
    return `${String(Math.floor(ms / MINUTE_MS))}m`;
  }
  if (ms < DAY_MS) {
    return `${(ms / HOUR_MS).toFixed(1)}h`;
  }
  return `${(ms / DAY_MS).toFixed(1)}d`;
}

/** How long ago an instant was, or `undefined` when it will not parse. */
function agoMs({ iso, nowMs }: { iso: string | undefined; nowMs: number }): number | undefined {
  if (iso === undefined) {
    return undefined;
  }
  const then = Date.parse(iso);
  if (Number.isNaN(then)) {
    return undefined;
  }
  return Math.max(0, nowMs - then);
}

/** `12m ago` / `just now`, never `just now ago`. */
function agoWords({ ms }: { ms: number }): string {
  const span = spanWords({ ms });
  return span === "just now" ? span : `${span} ago`;
}

/**
 * One source's sentence and colour.
 *
 * @param row the verb's row
 * @param nowMs the instant ages are measured against
 * @returns the words
 */
export function freshnessWordsOf({ row, nowMs }: { row: SourceFreshnessRow; nowMs: number }): FreshnessWords {
  const shown = agedRow({ nowMs, row });
  let failure: string | undefined;
  if (shown.state === "failing") {
    failure = shown.problems.at(0);
  }
  return { failure, sentence: stateSentence({ nowMs, row: shown }), tone: STATE_TONE[shown.state] };
}

/**
 * The row as of `nowMs`: a `current` or `unverified` row whose last verified sync has since passed its window
 * reads `late`, and a `current` one whose newest stored record has reads `unverified`.
 *
 * The report is as old as its last poll, and polls hold during a voice call while the page's clock keeps ageing
 * every row, so without this a source could cross its window on screen and still read current. It only ever
 * ESCALATES, by the verb's own criterion (behind its declared window), so it can never call a source the verb
 * judged late anything milder; the next report replaces it either way.
 */
function agedRow({ row, nowMs }: { row: SourceFreshnessRow; nowMs: number }): SourceFreshnessRow {
  // A verified sync later than the page's clock allows cannot be believed — it would age as zero and read "synced
  // just now" however old the data is. One tick of slack, because a report polled since the last tick is newer
  // than the clock.
  const syncedAtMs = row.lastVerifiedSyncAtIso === undefined ? undefined : Date.parse(row.lastVerifiedSyncAtIso);
  if (syncedAtMs !== undefined && syncedAtMs > nowMs + FRESHNESS_CLOCK_TICK_MS) {
    return { ...row, state: "unreadable" };
  }
  const synced = agoMs({ iso: row.lastVerifiedSyncAtIso, nowMs });
  const quiet = row.state === "current" || row.state === "unverified";
  if (quiet && synced !== undefined && synced > row.windowMs) {
    return { ...row, state: "late" };
  }
  // The verb's other criterion (`clockLagsWindow`): a newest stored record older than the window, or none at all,
  // reads unverified.
  const newest = agoMs({ iso: row.newestRecordAtIso, nowMs });
  if (row.state === "current" && (newest === undefined || newest > row.windowMs)) {
    return { ...row, state: "unverified" };
  }
  return row;
}

/** The sentence for one row's state. */
function stateSentence({ row, nowMs }: { row: SourceFreshnessRow; nowMs: number }): string {
  const synced = agoMs({ iso: row.lastVerifiedSyncAtIso, nowMs });
  const when = synced === undefined ? "at an unknown time" : agoWords({ ms: synced });
  const stale = `Stored ${row.label} data may be out of date.`;
  switch (row.state) {
    case "current":
      return `${row.label} synced ${when}.`;
    case "unverified":
      return `${row.label} synced ${when}, but its newest stored record is old, so whether it is current cannot be checked.`;
    case "late": {
      // Measured here from the sync time and the window, never read off the wire, so it ages with the page and no
      // report field can contradict it.
      const lateByMs = synced === undefined ? 0 : synced - row.windowMs;
      const past =
        lateByMs <= 0 ? "" : `, ${spanWords({ ms: lateByMs })} past its ${spanWords({ ms: row.windowMs })} window`;
      return `${row.label}'s last verified sync was ${when}${past}. ${stale}`;
    }
    // The verb's own reason is `FreshnessWords.failure`, drawn under this sentence with its raw folded (steer 7).
    case "failing":
      return `${row.label}'s last sync failed. ${stale}`;
    case "blocked": {
      const why = row.blocker === undefined ? "see the steps" : row.blocker.reason;
      return `${row.label} cannot sync until something only you can do is done: ${why}. ${stale}`;
    }
    // Paused and unscheduled outrank lateness in the verb, so a row in either may already be late: the sentence
    // names the last verified sync and the stale warning rather than implying the data goes stale only later.
    case "paused":
      return `${row.label}'s sync is paused, and its last verified sync was ${when}. ${stale}`;
    case "unscheduled":
      return `Nothing is scheduled to sync ${row.label}, and its last verified sync was ${when}. ${stale}`;
    case "never-synced":
      return `${row.label} has no verified successful sync. ${stale}`;
    case "unreadable":
      return `Can't tell how current ${row.label} is: its sync record is unreadable. ${stale}`;
    default: {
      const unknown: never = row.state;
      return unknown;
    }
  }
}
