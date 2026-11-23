/**
 * What one whole sweep SAYS when it is done — the summary line, and nothing else.
 *
 * Its own module because the ORDER of that line is a decision rather than a format, and because
 * `../../cli/commands/turn/dispatchSweep.ts` sits at the file-size ratchet. Pure, so every arm is a plain
 * call.
 */

/**
 * Every finding one sweep can reach, counted. MUTABLE, because the sweep increments these in place as each
 * pass reports — the one place in this module that is not a value.
 */
export interface SweepCounts {
  checklistUpdateFailed: number;
  expired: number;
  failed: number;
  ignored: number;
  inReview: number;
  phantom: number;
  ready: number;
  undispatched: number;
  unrouted: number;
  working: number;
}

/**
 * A fresh set of counters, all zero — what a sweep starts from.
 *
 * @returns every counter at zero
 */
export function emptySweepCounts(): SweepCounts {
  return {
    checklistUpdateFailed: 0,
    expired: 0,
    failed: 0,
    ignored: 0,
    inReview: 0,
    phantom: 0,
    ready: 0,
    undispatched: 0,
    unrouted: 0,
    working: 0,
  };
}

/**
 * The one line that closes every sweep — counts in the order a reader should care about them, with the two
 * unrouted findings LEADING when either fired.
 *
 * A sweep's summary used to
 * open on `ready` and `still working` — the two healthy readings — and put `never-dispatched` sixth, so a
 * board with one ask carded in a public channel and nobody behind it opened with two reassuring zeroes. The
 * counts themselves never move; which one a reader's eye lands on does.
 *
 * The zero case keeps the old wording and ORDER — a steady, familiar line is what makes the alarmed one
 * legible, and re-ordering a clean board would cost that for nothing.
 *
 * `ignored` sits in the TAIL rather than the healthy group, and like every other counter it is printed at
 * zero. It is not a finding — it counts asks a permanent ignore registry answered for before the sweep
 * judged anything (`./sweepIgnored.ts`), so it belongs beside `checklist-update-failed` rather than among
 * the readings a supervisor acts on. Printed always for the same reason `in-review` is, and because
 * `listen recover` — the entrance this sweep was made to match — states its own exclusion counts at zero
 * too (`../listen/recover.ts`'s `excludedBy`, a record with every exclusion key initialised).
 *
 * `in-review` joins the healthy group rather than the leading one, and it is printed even at zero. It is a
 * reading of an UNROUTED ask — no dispatch is journalled for it — but what it reports is that a session is
 * inside the turn and the never-dispatched bound was held, which is work in flight rather than something a
 * reader must act on; putting it beside `still working` is where that belongs. Printing it only when
 * non-zero was rejected: a count that appears sometimes leaves a reader unable to tell "nothing was held"
 * from "this build does not say".
 *
 * @internal — exported for its own unit tests; `../../cli/commands/turn/dispatchSweep.ts` is the only
 *   production caller.
 * @param counts every finding this sweep reached
 * @returns the summary line
 */
export function sweepSummaryLine({ counts }: { counts: SweepCounts }): string {
  const healthy =
    `${String(counts.ready)} ready, ${String(counts.working)} still working, ${String(counts.inReview)} in-review, ` +
    `${String(counts.failed)} worker-failed, ${String(counts.phantom)} phantom, ` +
    `${String(counts.expired)} lease-expired`;
  const outstanding = counts.undispatched + counts.unrouted;
  const tail = `${String(counts.checklistUpdateFailed)} checklist-update-failed, ${String(counts.ignored)} ignored`;
  if (outstanding === 0) {
    return `sweep: ${healthy}, ${String(counts.undispatched)} never-dispatched, ${tail}`;
  }
  return (
    `sweep: ${String(counts.unrouted)} UNROUTED, ${String(counts.undispatched)} NEVER-DISPATCHED — ` +
    `${String(outstanding)} ask(s) above need routing NOW; ${healthy}, ${tail}`
  );
}
