/*
 * What the execution doors refuse, said once off the composed model and once off a doc plus its journal.
 *
 * Two shapes for two callers, deliberately: {@link executionRefusal} reads a finished {@link BoardModel},
 * which only a caller that composed the whole board holds, while {@link finishedRunRefusal} takes the doc
 * and the journal a door actually has in its hand. `finishedRunRefusal`'s own header carries the measured
 * incident that made the second shape necessary.
 *
 * This module reads the vocabulary and nothing else of the family. It cannot compute a placement, so it can
 * never disagree with the rules about one.
 */

import { type BoardModel, type BoardSection, type RunDisposition } from "./boardTypes.js";
import { type HandoverDoc } from "./doc.js";

/**
 * The break-glass that lets an execution door open a SECOND cycle on a run whose journal already reads
 * `finished`. One variable per risk, this repo's standing shape for a break-glass — see
 * `../cli/commands/handover/lifecycle.ts`'s note beside `SLOPWEAVER_ALLOW_UNREVIEWED`, which this one is
 * deliberately separate from: "a probe still fails" and "this work already closed once" are different claims,
 * and a session overriding one must not silently override the other.
 */
export const ALLOW_RERUN = "SLOPWEAVER_ALLOW_RERUN";

/**
 * Why an execution door must not open a fresh cycle on a run the journal says already FINISHED, or
 * `undefined` when it may proceed.
 *
 * ## The measured defect
 *
 * MEASURED by joining every `runs/*.jsonl` carrying a `finished` event to its doc's `status:`
 * line: 78 finished docs still read `ready` or `in-progress`, six of them signed off. Re-measure it with:
 *
 * ```bash
 * cd "$SLOPWEAVER_HOME" && grep -l '"kind":"finished"' runs/*.jsonl |
 *   while read -r f; do awk '/^status:/{print $2; exit}' "handovers/$(basename "$f" .jsonl).md"; done |
 *   sort | uniq -c
 * ```
 *
 * The cost was not the stale line. It was that both execution doors read that line and nothing else about
 * closure: `handover start` refuses on `isTerminalDocStatus(doc.status)` and its own `landedRefusal`, which
 * fires only when every declared probe currently PASSES, and `cmux spawn` refuses on the same status plus
 * `settlement:` and `pausedOn:`. A run that finished with a failing or waived probe — the ordinary shape for
 * work whose outcome is a measurement rather than an assertion — satisfied none of them. One
 * corpus-compaction row, finished AND signed off, was read as open by two sessions an hour apart and nearly
 * re-landed.
 *
 * ## Why this is derived and no verb writes `status:` instead
 *
 * The obvious repair — have `handover finish` flip `status:` in the same write — mints a second source of a
 * fact the journal already owns, which is the exact reasoning `./askRow.ts`'s `settledAskRefusal` gives for
 * leaving a settled ask at `status: ready`, and `./doc.ts` gives for refusing to let a doc DECLARE `blocked`
 * when `blockedBy:` derives it. It is also not TRUE: `done` on a doc means the work shipped, `finish` closes a
 * run before any pull request has merged, and `./consistency.ts` already grades `ready` beside a just-finished
 * cycle a `transition` rather than a defect for precisely that reason. So the journal stays the one authority
 * on closure and the doors ask it, exactly as they were already made to ask `settlement:`.
 *
 * {@link executionRefusal} says the same thing off a composed {@link BoardModel}, and would have caught this
 * — it maps `AWAITING SHIP` to "the run already finished". It had no production caller at all. This is the
 * same refusal in the form the two doors can actually reach: they hold a doc and a journal, never probe
 * states for the whole board.
 *
 * @param doc the doc an execution door was pointed at
 * @param run its current cycle's disposition, from {@link runDisposition}
 * @returns the sentence refusing it, or `undefined` when it may proceed
 */
export function finishedRunRefusal({ doc, run }: { doc: HandoverDoc; run: RunDisposition }): string | undefined {
  if (run.kind === "closed") {
    return (
      `${doc.slug}'s run recorded that the work SHIPPED at ${run.atIso}: ${run.summary} — ` +
      `a closed row is not work to pick up. Read what it did: \`slopweaver handover resume ${doc.slug}\`. ` +
      "If there is genuinely more to do, register a new row; to re-open THIS one deliberately, " +
      `\`${ALLOW_RERUN}=1\` on the same command.`
    );
  }
  if (run.kind !== "finished") {
    return undefined;
  }
  const residue = run.residue.length === 0 ? "" : `, forced through with ${String(run.residue.length)} probe(s) unmet`;
  return (
    `${doc.slug}'s run already finished at ${run.atIso}${residue} — a closed run is not work to pick up, ` +
    `whatever \`status:\` still says. Read what it did: \`slopweaver handover resume ${doc.slug}\`. ` +
    "If there is genuinely more to do, register a new row; to re-open THIS one deliberately, " +
    `\`${ALLOW_RERUN}=1\` on the same command.`
  );
}

/**
 * Whether execution (`handover start`, cmux spawn) should be refused, or `undefined` when it may proceed.
 *
 * @param model the doc's composed board model
 * @returns the refusal message, or `undefined` when execution may proceed
 */
export function executionRefusal({ model }: { model: BoardModel }): string | undefined {
  switch (model.section) {
    case "CONTRADICTION":
      return `refused — the board state is contradictory: ${model.reason}`;
    case "CLOSED — NOT SHIPPED":
      return `refused — ${model.doc.slug} is ${model.derived.status}: ${model.reason}`;
    case "DONE":
      return `refused — ${model.doc.slug} is already done`;
    case "LOOKS SHIPPED":
      return "refused — every declared probe already passes; confirm before re-running";
    case "AWAITING SHIP":
      return "refused — the run already finished; it is awaiting independent confirmation, not a fresh start";
    case "NOT YET":
      return `refused — ${model.reason}`;
    case "PAUSED":
      // Refused, and the refusal is the feature. A pause is a decision that the work waits on a person, so
      // resuming it has to be a decision too — never a side effect of somebody typing the slug into `start`
      // or `cmux spawn`. `../handover/paused.ts`'s `pausedRefusal` is the same sentence at the doors that
      // never reach a `BoardModel`.
      return `refused — ${model.reason}. Unpausing is a decision: \`slopweaver handover unpause ${model.doc.slug}\``;
    case "WAITING ON OWNER":
    case "IN FLIGHT":
    case "RUN NOW":
      return undefined;
  }
}

/**
 * Whether a section is one of the two the board hides by default.
 *
 * @param section a board section
 * @returns whether it is `DONE` or `CLOSED — NOT SHIPPED`
 */
export function isClosedBoardSection({ section }: { section: BoardSection }): boolean {
  return section === "DONE" || section === "CLOSED — NOT SHIPPED";
}
