/**
 * What the stop gate is allowed to SAY: a re-checked probe tally, and the delta since it last looked.
 *
 * ## The defect this exists for
 *
 * Every firing in one session said the identical sentence: *"6 probe(s) unmet (unverified: from the journal, not
 * re-checked)"*. Each time it was re-checked by hand against the worktree the real answer was different, and
 * moving — 2 of 6 passing, then 3 of 6, then **6 of 6**. The gate labelled its own number `unverified` and then
 * presented it as the reason to block a turn.
 *
 * That is this repo's own named failure class, in the object whose whole justification is preventing it. Probes
 * are file-and-substring reads; re-running them costs milliseconds. There is no defensible reason to read a
 * tally off the journal at gate time, so {@link recheckTally} only ever takes freshly-evaluated results and
 * there is no function here that reads a `probed` entry.
 *
 * ## Why the gate records what it saw
 *
 * A gate that cannot remember can only restate the present, which is how the same sentence arrived nine times
 * and taught the reader to skip it. So each firing appends a `gated` observation — the tally it re-checked and
 * the branch head it saw — and the NEXT one leads with the difference. Two consequences fall out of the same
 * record:
 *
 *  - **A progressing run is not an abandoned one.** A branch that gained a commit, or a tally that improved, is
 *    evidence of a session doing its job. Silence is the correct output, and {@link progressSince} says so.
 *  - **The first line is the delta.** {@link deltaLine} never restates; when nothing moved it says nothing
 *    moved, which is itself the useful fact.
 *
 * The baseline is per-run and lives in the run's own journal, so it survives session death exactly as the rest
 * of the ledger does, and a run held by another session is never written to.
 *
 * Pure: the caller supplies the evaluated results, the journal's events, and the head it observed.
 */

import { currentCycle, type RunEvent } from "./ledger.js";
import type { ProbeOutcome, ProbeResult } from "./probe.js";

/** How many of a doc's probes passed, failed, and were never actually examined. */
export interface ProbeTally {
  readonly passed: number;
  readonly failed: number;
  /**
   * Probes nothing could evaluate — an unreadable file, a `command:` probe the gate declined to run.
   *
   * Kept apart from `failed` because the shipped handover code already draws that line and collapsing it here
   * would let the gate report a blind check as a failing one. See {@link ./probe}'s `not-evaluated`.
   */
  readonly notEvaluated: number;
}

/** A run whose probes could not be looked at at all. Distinct from one whose probes all failed. */
export const NOTHING_CHECKED: ProbeTally = { failed: 0, notEvaluated: 0, passed: 0 };

/** How many probe counts are shown as a total. */
function totalOf({ tally }: { tally: ProbeTally }): number {
  return tally.passed + tally.failed + tally.notEvaluated;
}

/**
 * How many of a doc's declared conditions the repository still cannot show.
 *
 * A `not-evaluated` probe counts, exactly as `finish`'s residue counts it: "nothing looked" is not evidence of
 * doneness. This is the number a refusal quotes, and it must mean the same thing there as it does in `finish`.
 *
 * @param tally the re-checked tally
 * @returns failing plus unexamined probes
 */
export function unmetOf({ tally }: { tally: ProbeTally }): number {
  return tally.failed + tally.notEvaluated;
}

/**
 * Tally probe results the caller has just evaluated.
 *
 * Named for the rule rather than the arithmetic: the gate RE-CHECKS. There is deliberately no sibling that
 * derives a tally from a journal entry, because that function existing at all is what made the gate lie.
 *
 * @param results probe results evaluated at this moment, never read from a journal
 * @returns the tally
 */
export function recheckTally({ results }: { results: readonly ProbeResult[] }): ProbeTally {
  const of = ({ outcome }: { outcome: ProbeOutcome }): number =>
    results.filter((result) => result.outcome === outcome).length;
  return {
    failed: of({ outcome: "fail" }),
    notEvaluated: of({ outcome: "not-evaluated" }),
    passed: of({ outcome: "pass" }),
  };
}

/**
 * Whether any probe actually returned an answer.
 *
 * A run whose every probe was `not-evaluated` — no `repo:`, an unreadable tree — is one the gate examined and
 * learned nothing from, and blocking a turn on that is blocking on ignorance.
 *
 * @param tally the re-checked tally
 * @returns true when at least one probe passed or failed
 */
export function anythingChecked({ tally }: { tally: ProbeTally }): boolean {
  return tally.passed + tally.failed > 0;
}

/** What the gate saw the last time it looked at a run. */
export interface GateObservation {
  readonly atIso: string;
  readonly tally: ProbeTally;
  /** The branch head at that moment, when it could be read. */
  readonly head: string | undefined;
}

/**
 * The most recent thing the gate recorded seeing for this run.
 *
 * @param events the journal's events, in order — sliced to the current cycle here
 * @returns the last observation, or `undefined` when the gate has never looked at this cycle
 */
export function lastGateObservation({ events }: { events: readonly RunEvent[] }): GateObservation | undefined {
  let seen: GateObservation | undefined;
  for (const event of currentCycle({ events })) {
    if (event.kind === "gated") {
      seen = {
        atIso: event.atIso,
        head: event.head,
        tally: { failed: event.failed, notEvaluated: event.notEvaluated, passed: event.passed },
      };
    }
  }
  return seen;
}

/**
 * Whether a run has moved on since the gate last looked.
 *
 * `first-look` is deliberately not `moved`: the gate has no baseline, so it cannot claim progress, and the run
 * may genuinely have been abandoned before the gate ever ran. It is the one case where interrupting on no
 * evidence of movement is right.
 */
export type Progress =
  { readonly kind: "first-look" } | { readonly kind: "moved"; readonly because: string } | { readonly kind: "static" };

/** A head short enough to print, without pretending git resolved an abbreviation. */
function shortHead({ head }: { head: string | undefined }): string {
  return head === undefined ? "(unknown)" : head.slice(0, 7);
}

/**
 * Whether the run progressed since the last observation.
 *
 * A commit is checked before the tally, because it is the stronger signal: a session can commit work that
 * satisfies no declared probe, and calling that "no progress" is what makes a gate feel adversarial. Both a new
 * commit and an improved tally count as movement.
 *
 * @param previous what the gate recorded seeing last time, or `undefined` on a first look
 * @param tally the tally re-checked now
 * @param head the branch head observed now, or `undefined` when it could not be read
 * @returns the verdict, carrying the printable reason when it moved
 */
export function progressSince({
  previous,
  tally,
  head,
}: {
  previous: GateObservation | undefined;
  tally: ProbeTally;
  head: string | undefined;
}): Progress {
  if (previous === undefined) {
    return { kind: "first-look" };
  }
  // BOTH heads must be known for a difference to mean anything. An unreadable head compared against a recorded
  // one differs on every firing, which would silence the gate permanently on the strength of a git failure.
  if (head !== undefined && previous.head !== undefined && head !== previous.head) {
    return {
      because: `the branch moved ${shortHead({ head: previous.head })} → ${shortHead({ head })}`,
      kind: "moved",
    };
  }
  const wasUnmet = unmetOf({ tally: previous.tally });
  const nowUnmet = unmetOf({ tally });
  if (nowUnmet < wasUnmet) {
    return { because: `probes improved, ${String(wasUnmet)} unmet → ${String(nowUnmet)}`, kind: "moved" };
  }
  return { kind: "static" };
}

/**
 * The first line of any interrupt: what changed since last time.
 *
 * Leads with the delta rather than the state, because a restatement is what the reader has already learned to
 * skip. When the gate has never looked it says so, which is honest and is also the one case where the present
 * state IS the news.
 *
 * @param slug the run's slug
 * @param previous what the gate recorded seeing last time, or `undefined` on a first look
 * @param tally the tally re-checked now
 * @param head the branch head observed now, or `undefined` when it could not be read
 * @returns one line, always naming a difference or the absence of one
 */
export function deltaLine({
  slug,
  previous,
  tally,
  head,
}: {
  slug: string;
  previous: GateObservation | undefined;
  tally: ProbeTally;
  head: string | undefined;
}): string {
  const now = `${String(unmetOf({ tally }))} of ${String(totalOf({ tally }))} probe(s) unmet (re-checked just now)`;
  if (previous === undefined) {
    return `${slug} — first look at this run: ${now}.`;
  }
  const progress = progressSince({ head, previous, tally });
  if (progress.kind === "moved") {
    return `${slug} — since ${previous.atIso}: ${progress.because}.`;
  }
  return `${slug} — NOTHING has changed since ${previous.atIso}: still ${now}, branch still at ${shortHead({ head })}.`;
}
