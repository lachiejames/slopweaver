/**
 * Projecting the autonomy register onto the Fleet Briefing. Pure — folded acts in, one typed section out, no
 * filesystem and no clock.
 *
 * ## Why this is a projection and not a composed section
 *
 * The same call `./yourList.ts` and `./openArtifacts.ts` make, and here it is the whole point of the feature.
 * This section exists so the owner can steer the fleet retroactively, on something they would have been fine
 * with that the fleet did not do, or something it did that they were not fine with. A supervisor free to
 * retype a row could disagree with what the acting session recorded, and the owner would then be judging the
 * supervisor's account of an act rather than the act. So every field here comes from the register one at a time, the three visible
 * labels are derived by `../autonomy/label.ts`, and `../cli/commands/briefing/renderCore.ts` refuses a form
 * that writes the section itself.
 *
 * ## What it does NOT do
 *
 * It does not re-order and it does not judge. The register's own fold (`../autonomy/query.ts`) already put
 * the acts newest first with the owner's latest word on each, and re-sorting here would let this page disagree with
 * `slopweaver autonomy list` about which act is at the top — which is the row the owner names when giving a steer.
 * It also never normalises a REFUSED act into a successful one: `press-merge-when-ready-refused` reaches the
 * page saying exactly that, because an act the fleet tried and could not complete is one of the things the
 * owner can steer.
 */
import { autonomyKindLabel, autonomySessionLabel, autonomySubjectLabel } from "../autonomy/label.js";
import { steerOf } from "../autonomy/query.js";
import type { AutonomyAction } from "../autonomy/types.js";
import type { BriefingAutonomy, BriefingAutonomyRow } from "../outbound/briefing/types.js";
import { AUTONOMY_MAX_ROWS } from "./caps.js";

/** The empty section: what a page renders when nothing has been done autonomously, or no register was read. */
export const NO_AUTONOMY: BriefingAutonomy = { notShown: 0, rows: [] };

/**
 * Project one folded act into the row the page carries.
 *
 * `said`, `run` and `steer` are attached rather than always present, because `exactOptionalPropertyTypes`
 * makes the difference between "this act named no board row" and "this act named `undefined`" a real one, and
 * the schema reads the first as absent rather than as a field to validate. For `said` that difference is the
 * whole point: an act recorded before the register asked for a plain-words line has none, and the renderer
 * has to be able to say so rather than print an empty paragraph where the owner's own sentence should be.
 *
 * One step of {@link projectAutonomy}, and what `./autonomyActRefs.ts` renders an act through before it is
 * written, so the act it judges is the one the page will show.
 *
 * @param entry one act, already folded with the owner's latest word on it
 * @returns the typed row
 */
export function projectAutonomyRow({ entry }: { entry: AutonomyAction }): BriefingAutonomyRow {
  const { action } = entry;
  const base: BriefingAutonomyRow = {
    actionId: action.actionId,
    bySession: action.bySession,
    doneIso: action.doneIso,
    kindLabel: autonomyKindLabel({ kind: action.kind }),
    sessionLabel: autonomySessionLabel({ bySession: action.bySession }),
    subject: action.subject,
    subjectLabel: autonomySubjectLabel({ subject: action.subject }),
    why: action.why,
    witness: action.witness,
  };
  const withSaid = action.said === undefined ? base : { ...base, said: action.said };
  const withRun = action.run === undefined ? withSaid : { ...withSaid, run: action.run };
  const word = steerOf({ action: entry });
  return word === undefined ? withRun : { ...withRun, steer: word };
}

/**
 * Project the register's folded acts into the page's section.
 *
 * `notShown` is what keeps this a view rather than a truncation, exactly as it is on the owner's own list: the
 * register keeps every act forever and the page shows `top` of them, so a page silent about the remainder
 * would read as "this is everything the fleet did for you". There is no unread-row count beside it: the ledger
 * read refuses whole on one unreadable row (`../autonomy/port.ts`), so an act is never silently missing here.
 *
 * @param actions every act the register holds, already folded newest-first
 * @param top how many to show; defaults to {@link AUTONOMY_MAX_ROWS}
 * @returns the typed section, empty when the register gave it nothing
 */
export function projectAutonomy({
  actions,
  top = AUTONOMY_MAX_ROWS,
}: {
  actions: readonly AutonomyAction[];
  top?: number;
}): BriefingAutonomy {
  const shown = actions.slice(0, top);
  return {
    notShown: actions.length - shown.length,
    rows: shown.map((entry) => projectAutonomyRow({ entry })),
  };
}
