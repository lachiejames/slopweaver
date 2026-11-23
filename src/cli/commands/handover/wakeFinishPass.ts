/**
 * `handover wake`'s second pass, the finish: each due MERGED park offered to the real `handover finish`
 * (`./wakeDueFinish.ts`), reconciled first (`./wakeReconcile.ts`), so a park classed `landed` is finished past the
 * lesson question and then closed. Apart from `./wakeRows.ts`'s judging and reseating, whose order this pass sits
 * between.
 */
import type { ParkedLanding } from "../../../handover/parkedLanding.js";
import type { WakeCandidate } from "../../../handover/wakeCandidates.js";
import { leastRecentlyTried } from "../../../handover/wakeOrder.js";
import { type FinishStep, finishDueRow } from "./wakeDueFinish.js";
import { mergedPark, WAKE_FINISH_ASKS } from "./wakeFinish.js";
import type { DueJudgement } from "./wakeJudge.js";
import { afterFinish, closeLanded, reconcileDueRow } from "./wakeReconcile.js";
import type { HandoverWakeDeps, WakeRowReport } from "./wakeRows.js";

/** A candidate judged due, waiting for its turn among this run's finishes and attempts. */
export interface DueRow {
  readonly index: number;
  readonly slug: string;
  readonly key: string;
  readonly dueSinceIso: string;
  readonly candidate: WakeCandidate;
  readonly judgement: DueJudgement;
}

/** What the finish pass came to, by board index; `asked` lists the keys finish was asked over. */
export interface FinishPassResult {
  readonly settled: Map<number, WakeRowReport>;
  readonly why: Map<number, string>;
  readonly reconciled: Map<number, ParkedLanding>;
  readonly asked: string[];
}

/** What one due merged park's finish came to. */
interface RowOutcome {
  readonly asked: boolean;
  readonly settled: WakeRowReport | undefined;
  readonly why: string | undefined;
  readonly reconciled: ParkedLanding | undefined;
}

/**
 * Offer up to {@link WAKE_FINISH_ASKS} due merged parks to `handover finish`, the longest since its last ask — or
 * since due, never asked — first; every one on a `--settle-only` run. Each is reconciled first
 * (`./wakeReconcile.ts`): a park classed `landed` is finished with the lessons break-glass and then closed, so its
 * row derives `done`; every other class takes the finish it always had, and is reported by name. A tick reconciles
 * at most {@link WAKE_FINISH_ASKS} parks, so its head reads stay inside the reading's budget; a park past that is
 * offered to finish exactly as before. A `--settle-only` run also reconciles every due CLOSED park, which it never
 * reseats.
 *
 * @param lastAsked each park's last finish ask, by key
 * @param settleOnly whether this run reconciles and finishes every ended park and reseats none
 * @returns the rows the finishes settled, by board index, the sentence each unsettled one carries to its reseat, the
 *   class each reconciled park that was not settled came to, and the keys asked
 */
export async function finishPass({
  deps,
  dryRun,
  due,
  home,
  lastAsked,
  settleOnly,
}: {
  deps: HandoverWakeDeps;
  dryRun: boolean;
  due: readonly DueRow[];
  home: string;
  lastAsked: ReadonlyMap<string, string>;
  settleOnly: boolean;
}): Promise<FinishPassResult> {
  const pass: FinishPassResult = {
    asked: [],
    reconciled: new Map<number, ParkedLanding>(),
    settled: new Map<number, WakeRowReport>(),
    why: new Map<number, string>(),
  };
  const merged = due.filter(({ judgement }) => mergedPark({ judgement }));
  const limit = settleOnly ? merged.length : WAKE_FINISH_ASKS;
  // A row's head is read only on one of the first `limit` turns, so a tick's reads stay inside its budget.
  for (const [turn, row] of leastRecentlyTried({ due: merged, lastTried: lastAsked }).entries()) {
    if (pass.asked.length >= limit) {
      break;
    }
    const { landing, step } = await finishOneRow({ deps, dryRun, home, reconcile: turn < limit, row });
    // The close a settled row takes is synchronous and recorded before the next row starts, with no await between.
    recordOutcome({ outcome: rowOutcome({ deps, home, landing, row, step }), pass, row });
  }
  if (settleOnly) {
    await reconcileClosedParks({ deps, due, home, reconciled: pass.reconciled });
  }
  return pass;
}

/**
 * Offer one due merged park to finish: reconciled first when `reconcile`, and finished past the lesson question only
 * when classed `landed`.
 */
async function finishOneRow({
  deps,
  dryRun,
  home,
  reconcile,
  row,
}: {
  deps: HandoverWakeDeps;
  dryRun: boolean;
  home: string;
  reconcile: boolean;
  row: DueRow;
}): Promise<{ readonly landing: ParkedLanding | undefined; readonly step: FinishStep }> {
  const { candidate, judgement } = row;
  const landing = reconcile ? await reconcileDueRow({ candidate, deps, home, judgement }) : undefined;
  const allowNoLessons = landing?.kind === "landed";
  const step = await finishDueRow({ allowNoLessons, candidate, deps, dryRun, home, judgement });
  return { landing, step };
}

/** What one finish came to: a settled row closed when it was classed `landed`, else why it was not settled. */
function rowOutcome({
  deps,
  home,
  landing,
  row,
  step,
}: {
  deps: HandoverWakeDeps;
  home: string;
  landing: ParkedLanding | undefined;
  row: DueRow;
  step: FinishStep;
}): RowOutcome {
  const { candidate, judgement } = row;
  if (step.kind === "settled") {
    const settled = settledRow({ candidate, deps, home, judgement, landing, row: step.row });
    return { asked: step.asked, reconciled: undefined, settled, why: undefined };
  }
  const reconciled = landing === undefined ? undefined : afterFinish({ finishWhy: step.why, landing });
  return { asked: step.asked, reconciled, settled: undefined, why: step.why };
}

/** Fold one row's outcome into the pass. */
function recordOutcome({ outcome, pass, row }: { outcome: RowOutcome; pass: FinishPassResult; row: DueRow }): void {
  if (outcome.settled !== undefined) {
    pass.settled.set(row.index, outcome.settled);
  }
  if (outcome.why !== undefined) {
    pass.why.set(row.index, outcome.why);
  }
  if (outcome.reconciled !== undefined) {
    pass.reconciled.set(row.index, outcome.reconciled);
  }
  if (outcome.asked) {
    pass.asked.push(row.key);
  }
}

/** A `--settle-only` run's reconcile of every due CLOSED park, which it never reseats. */
async function reconcileClosedParks({
  deps,
  due,
  home,
  reconciled,
}: {
  deps: HandoverWakeDeps;
  due: readonly DueRow[];
  home: string;
  reconciled: Map<number, ParkedLanding>;
}): Promise<void> {
  for (const { candidate, index, judgement } of due.filter((row) => closedPark({ judgement: row.judgement }))) {
    const landing = await reconcileDueRow({ candidate, deps, home, judgement });
    if (landing !== undefined) {
      reconciled.set(index, landing);
    }
  }
}

/** Whether a due judgement is a checks wake whose pull request closed without merging. */
function closedPark({ judgement }: { judgement: DueJudgement }): boolean {
  return judgement.observed.kind === "checks" && judgement.observed.prState === "CLOSED";
}

/** A row the finish step settled, closed when it was classed `landed` and carrying its class when it had one. */
function settledRow({
  candidate,
  deps,
  home,
  judgement,
  landing,
  row,
}: {
  candidate: WakeCandidate;
  deps: HandoverWakeDeps;
  home: string;
  judgement: DueJudgement;
  landing: ParkedLanding | undefined;
  row: WakeRowReport;
}): WakeRowReport {
  if (landing === undefined) {
    return row;
  }
  return { ...closeLanded({ candidate, deps, home, judgement, landing, row }), reconciliation: landing };
}

/**
 * A due row a `--settle-only` run leaves where it is: never reseated, carrying why its finish did not close it and
 * what the reconcile classed it as.
 *
 * @param finishWhy why the finish did not close the run, when one was asked
 * @param landing the reconcile's class, when the park's pull request ended
 * @param wake what the row's park waits on
 * @returns the row's report
 */
export function unsettledRow({
  finishWhy,
  judgement,
  landing,
  slug,
  wake,
}: {
  finishWhy: string | undefined;
  judgement: DueJudgement;
  landing: ParkedLanding | undefined;
  slug: string;
  wake: WakeRowReport["wake"];
}): WakeRowReport {
  // No finish was asked over a row the pass reached past its cap, or a closed park: its judgement says why it is due.
  let said = judgement.reason;
  if (finishWhy !== undefined) {
    said = finishWhy;
  }
  return {
    action: "none",
    detail: `settle-only, so not reseated: ${said}`,
    judgement,
    slug,
    wake,
    ...(landing === undefined ? {} : { reconciliation: landing }),
  };
}
