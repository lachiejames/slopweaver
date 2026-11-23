/**
 * WHEN the upload-readiness poll asks again — the whole schedule, as a pure list of sleeps.
 *
 * Separated from the poll itself because the schedule is the part that was wrong. The old loop counted
 * ATTEMPTS at a flat gap, so its real ceiling was 15 serial `files.info` round trips plus 6s of sleep —
 * a duration nobody chose, that moved with Slack's latency, and that two screenshots outlived in two days.
 * A list of gaps bounded by a stated total is assertable in a unit test; an inline `for` loop over a
 * `WebClient` is not.
 *
 * The poll calls once, then sleeps `gaps[0]`, calls, sleeps `gaps[1]`, and so on — so a schedule of N gaps
 * is N+1 calls.
 */

/**
 * The ordered sleeps between polls: doubling from the first gap to the cap, stopping before the total.
 *
 * A gap is only included when the sleep FITS inside what is left of the budget, so the last poll happens at
 * or before `totalMs` rather than after it. That makes the bound a promise about wall-clock sleep rather
 * than an approximation.
 *
 * @param totalMs the whole sleep budget before the wait is spent
 * @param firstGapMs the first gap — short, because most uploads are ready within a second
 * @param maxGapMs the ceiling the doubling stops at
 * @returns the gaps in order; empty when not even the first one fits
 */
export function readinessGaps({
  totalMs,
  firstGapMs,
  maxGapMs,
}: {
  totalMs: number;
  firstGapMs: number;
  maxGapMs: number;
}): readonly number[] {
  const gaps: number[] = [];
  let spent = 0;
  let gap = firstGapMs;
  while (spent + gap <= totalMs) {
    gaps.push(gap);
    spent += gap;
    gap = Math.min(gap * 2, maxGapMs);
  }
  return gaps;
}

/**
 * The whole sleep budget a fresh upload gets before the send gives up on it.
 *
 * Two minutes, and the number IS the fix. The old bound was 15 polls at a flat 400ms — a ~6s sleep budget,
 * tuned when a `files.info` round trip was assumed to cost ~180ms. Measured live on this workspace,
 * one call took 880/1404/1901/2746 ms:
 * `slopweaver slack probe --method files.info file=<id> --bot`. So the real ceiling was whatever 15 serial
 * round trips happened to add up to — an accident rather than a policy — and twice in two days a screenshot
 * outlived it and cost the entire answer (both asks are in the operator's own loop-breakage ledger;
 * no workspace identifier belongs in this repository). A live `files.info` on the second
 * one's file, run from `slopweaver slack probe`, shows it DID finish — mimetype and the whole
 * thumbnail set — so the file was never stuck, only slower than the bound.
 */
const READINESS_TOTAL_MS = 120_000;

/** The first gap. Measured: a small PNG took ~2.9s and five polls; a text file took one. */
const READINESS_FIRST_GAP_MS = 400;

/**
 * The longest gap the doubling grows to.
 *
 * Backoff rather than a flat cadence because the two cases have opposite costs: a file that is nearly ready
 * should be caught within a second, and one that needs a minute should not be asked three hundred times.
 */
const READINESS_MAX_GAP_MS = 5_000;

/** The live poll's own schedule, computed once from the constants above. */
export const SLACK_UPLOAD_READINESS_GAPS: readonly number[] = readinessGaps({
  firstGapMs: READINESS_FIRST_GAP_MS,
  maxGapMs: READINESS_MAX_GAP_MS,
  totalMs: READINESS_TOTAL_MS,
});
