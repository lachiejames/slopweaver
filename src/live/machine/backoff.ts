/**
 * THE FLEET'S RESPONSE TO ITS OWN ALERT — exponential backoff for fleet load balancing,
 * the rule that stops a machine already on its knees being handed one more seat per sample.
 *
 * ## What it gates, and the one thing it must never gate
 *
 * It gates the SEAT. It never gates the ROW.
 *
 * That distinction is the whole design and it is not a refinement — gating the row deadlocks two mechanisms
 * built in the same change. Suppress the row and the sequence is: anomaly fires → backoff active → no row
 * written → `hold` is still true → `../../supervisor/loadDispatchGate.ts` refuses the tick → and the
 * operator's one way out (`slopweaver machine watch --once`) is itself backed off and writes nothing. The
 * supervisor loop would then be wedged by the very pair of mechanisms meant to unwedge it.
 *
 * A row is an append to a JSONL file. It costs nothing, it is the evidence the gate reads, and it is the
 * only thing that makes an unseated dispatch visible rather than silent. So every anomalous reading writes
 * one, and a backed-off row says so in its own `seated: { kind: "none", why }` arm.
 *
 * ## Why an already-RUNNING investigation is not a backoff case
 *
 * Doubling on a signature whose investigation is still live would punish the fleet for working: the reason
 * not to open a second seat is that a first one is open, which is a liveness fact, not a rate limit. So a
 * caller checks for a live seat first and only asks this module about signatures nobody is currently on.
 * {@link backoffFor} counts CONSECUTIVE UNSEATED-OR-UNSETTLED dispatches, which is the population that
 * actually means "we keep alerting and nothing is changing".
 *
 * ## Resets, stated rather than discovered
 *
 * Two, and only two: a SETTLED row on that signature whose subject named something the settler could REMOVE,
 * or a CLEAR reading of that signature (the culprit is gone — the caller simply stops asking about a
 * signature it no longer sees, and the window lapses). The doubling is capped at {@link MAX_DOUBLINGS} so a
 * signature can never become permanently un-investigable, which is the failure a naive exponential produces
 * after a bad night.
 *
 * ## Why ANSWERING a row is not always FIXING it
 *
 * The first reset carries a hidden assumption: that whoever settles a row has removed the thing it blamed.
 * That holds for every row `./anomaly.ts` builds from a culprit — a hog, an overgrown session, an orphan
 * group — because each carries the one command that ends it. It is FALSE of the subject that module's
 * `machineSubject` composes for a machine-wide hold, which blames nobody, carries no `kill` at all, and says
 * in its own words that there is nothing here to kill. An investigation can answer such a row honestly and
 * change nothing about the machine, so resetting on it re-arms one seat per sample for a condition that
 * recurs until the machine itself changes.
 *
 * MEASURED against this install's own register, through these functions rather than a
 * restatement of them: signature `hold|hold on cpu|foreign` carried NINE consecutive unsettled dispatches
 * spanning about a day, window at its 9600s cap. Injecting the settlement the seated
 * investigation was about to write returned `{ consecutive: 0, maySeat: true, windowSeconds: 300 }`, and
 * `./watchDecision.ts` then returned `seat: { kind: "open" }` — a fresh seat on the very next sample, on a
 * machine holding for reasons no session can touch (the fleet read 2.8 of 12.0 busy cores; every one of the
 * seven processes `top` hides on it is the endpoint sensor, whose CPU no unprivileged reading attributes).
 * Reproduce with `slopweaver machine dispatches --all --json`.
 *
 * So {@link consecutiveUnsettled} ends its run only at a settled row that was ACTIONABLE, and
 * `subject.kill === undefined` is the marker. That is structural rather than a convention:
 * `./fleetCulprit.ts`'s `FleetCulprit.kill` is a non-optional `string`, so every culprit-bearing arm of
 * `machineAnomaly` sets one, bar a culprit whose `endedBy` is `owner` (a root daemon's relief, carried in prose);
 * that arm, `daemonSubject` and `machineSubject` are the only producers of its absence. Nothing goes quiet — a
 * machine-wide row is still WRITTEN on every reading, still refuses `../../supervisor/loadDispatchGate.ts`'s
 * tick until somebody narrates a `hold-rationale`, and is still seatable once the cap elapses. Only the seat
 * is rate-limited, which is the whole of what this module gates.
 */
import type { DispatchRow } from "./dispatchRow.js";

/** The first window. One sample-and-seat per signature per this long, before any doubling. */
export const BASE_BACKOFF_SECONDS = 300;

/**
 * How many times the window may double. 300s × 2^5 is 2h40m — long enough that a signature nobody settles
 * stops costing seats, short enough that it is re-investigated the same working day.
 */
export const MAX_DOUBLINGS = 5;

/** What the backoff says about one signature right now. */
export interface BackoffVerdict {
  /** Whether a seat may be opened on this signature at this instant. */
  readonly maySeat: boolean;
  /** The window currently in force, in seconds. */
  readonly windowSeconds: number;
  /** How many consecutive dispatches that never earned a reset drove it — see {@link consecutiveUnsettled}. */
  readonly consecutive: number;
  /**
   * When a seat becomes allowed again; `undefined` both when one is allowed NOW and when the newest row
   * carried an instant that could not be parsed. {@link maySeat} is what separates those two.
   */
  readonly nextSeatIso: string | undefined;
}

/** The window for a given run of consecutive unsettled dispatches, doubling and then capped. */
function windowFor({ consecutive }: { consecutive: number }): number {
  const doublings = Math.min(Math.max(0, consecutive - 1), MAX_DOUBLINGS);
  return BASE_BACKOFF_SECONDS * 2 ** doublings;
}

/**
 * Whether settling this row could plausibly have ended the condition that produced it — which is true
 * exactly when the row named something to remove. This module's header § "Why ANSWERING a row is not always
 * FIXING it" carries why the absence of a `kill` is the structural marker for the case where it could not.
 */
function wasActionable({ row }: { row: DispatchRow }): boolean {
  return row.subject.kill !== undefined;
}

/**
 * How many dispatches on this signature, counting back from the newest, still leave the window earned.
 * A settled row ends the run — that is the reset — so a signature answered once starts again from the base
 * window rather than inheriting a night's worth of doubling. A settled row that named NOTHING to remove
 * does not end it: answering a machine-wide hold cannot clear one, so its doubling is kept rather than
 * handed back.
 */
function consecutiveUnsettled({ rows }: { rows: readonly DispatchRow[] }): number {
  let count = 0;
  for (const row of rows) {
    if (row.settled !== undefined && wasActionable({ row })) {
      return count;
    }
    count += 1;
  }
  return count;
}

/**
 * Whether a seat may be opened on one signature now, and the window that decided it.
 *
 * @param rows every dispatch carrying this signature, NEWEST FIRST — the caller selects them, so this stays
 *   pure arithmetic over a list rather than a store read
 * @param nowIso the instant being judged
 * @returns the verdict, including the window in force and when seating reopens
 */
export function backoffFor({ rows, nowIso }: { rows: readonly DispatchRow[]; nowIso: string }): BackoffVerdict {
  const consecutive = consecutiveUnsettled({ rows });
  const windowSeconds = windowFor({ consecutive });
  const newest = rows[0];
  if (consecutive === 0 || newest === undefined) {
    return { consecutive, maySeat: true, nextSeatIso: undefined, windowSeconds };
  }
  const since = Date.parse(newest.observedIso);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(since) || !Number.isFinite(now)) {
    // An unreadable instant must not silently license a seat — the one direction that costs a stampede on a
    // machine already holding. So refuse, and report NO reopening instant rather than echoing the string that
    // could not be parsed: a caller that renders it gets \"next seat at \" and nothing when the row carried \"\".
    // `maySeat: false` with no `nextSeatIso` is the shape that says refused-and-cannot-say-when.
    return { consecutive, maySeat: false, nextSeatIso: undefined, windowSeconds };
  }
  const reopensMs = since + windowSeconds * 1000;
  if (now >= reopensMs) {
    return { consecutive, maySeat: true, nextSeatIso: undefined, windowSeconds };
  }
  return {
    consecutive,
    maySeat: false,
    nextSeatIso: new Date(reopensMs).toISOString(),
    windowSeconds,
  };
}
