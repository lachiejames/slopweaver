/**
 * Projecting the hand register onto the Fleet Briefing. Pure — open steps in, one typed section out, no
 * filesystem and no clock.
 *
 * ## Why the command belongs on a page and not only on a floating note
 *
 * A floating macOS note cannot be clicked, copied from or pressed, and can claim a command was copied to the
 * clipboard when it was not. Those are defects with their own fixes. What this section answers is the failure
 * mode UNDER them: a note is a process. It dies with a logout, it can end up off a display whose shape
 * changed, and a build that lands after it was drawn cannot reach it — a note can be running a program two hours
 * and fifty minutes older than the fix for the very complaint it prompted. A page is bytes, re-rendered every sweep, and it
 * cannot go stale in a way the owner has no way to notice.
 *
 * So the note and this section are deliberately two surfaces over one register, not one surface with a
 * backup. Neither is authoritative: `slopweaver hand list` is.
 *
 * ## What it does NOT do
 *
 * It does not re-order and it does not judge. The register is append-only and `../hand/store.ts` folds it in
 * posting order, so the oldest open step leads — which is the one that has been waiting longest, and the
 * question this section answers. Re-sorting here would let the page disagree with `slopweaver hand list`
 * about which step is at the top.
 *
 * It also never substitutes a command. A step with no `literal` reaches the page with no paste block; the
 * witness is NOT promoted into one, because the witness is the verb that SETTLES the step and handing the owner
 * that at the moment they are looking for the thing to do is worse than handing them nothing.
 */
import { type HandStep, handStepTier } from "../hand/step.js";
import type { BriefingHandStepRow, BriefingHandSteps } from "../outbound/briefing/types.js";

import { rankWaiting } from "../waiting/rank.js";

import { HAND_STEPS_MAX_ROWS } from "./caps.js";

/** The empty section: what a page renders when nothing is waiting on the owner's hands, or no register was read. */
export const NO_HAND_STEPS: BriefingHandSteps = { notShown: 0, rows: [], unreadable: 0 };

/**
 * Project one open step into the row the page carries.
 *
 * The three optionals are ATTACHED rather than always present, because `exactOptionalPropertyTypes` makes
 * the difference between "this step named no place" and "this step named `undefined`" a real one, and the
 * schema reads the first as absent rather than as a field to validate. The same call
 * `./autonomy.ts`'s `projectAutonomyRow` makes about an act's `run`.
 *
 * @internal — one step of {@link projectHandSteps}; no caller outside this file names it.
 *
 * @param step one open step, straight off the register
 * @returns the typed row
 */
export function projectHandStepRow({ step }: { step: HandStep }): BriefingHandStepRow {
  const base: BriefingHandStepRow = {
    id: step.id,
    postedIso: step.postedIso,
    tier: handStepTier({ step }),
    unblocks: step.unblocks,
    what: step.what,
    witness: step.witness,
  };
  const withWhere = step.where === undefined ? base : { ...base, where: step.where };
  const withUrl = step.url === undefined ? withWhere : { ...withWhere, url: step.url };
  const withLiteral = step.literal === undefined ? withUrl : { ...withUrl, literal: step.literal };
  return step.checklist === undefined ? withLiteral : { ...withLiteral, checklist: step.checklist };
}

/**
 * Project the register's open steps into the page's section.
 *
 * `notShown` is what keeps this a view rather than a truncation, exactly as it is on the owner's own list and on the
 * autonomy ledger: the register holds every open step and the page shows `top` of them, so a page silent
 * about the remainder would read as "this is everything waiting on you".
 *
 * `unreadable` is the same property about a different gap — a line the register could not parse is a step
 * that may be open with no row here covering it. The reader is told, and the section renders on that alone.
 *
 * @param steps every open step the register holds, in posting order
 * @param unreadable how many register lines could not be parsed at all
 * @param top how many to show; defaults to {@link HAND_STEPS_MAX_ROWS}
 * @returns the typed section, empty when nothing is open
 */
export function projectHandSteps({
  steps,
  unreadable = 0,
  top = HAND_STEPS_MAX_ROWS,
}: {
  steps: readonly HandStep[];
  unreadable?: number;
  top?: number;
}): BriefingHandSteps {
  // Ranked BEFORE the cap, so a check-in can never hold a slot a step blocking a colleague is cut out of.
  const shown = rankWaiting({ items: steps, tierOf: (step) => handStepTier({ step }) }).slice(0, top);
  return {
    notShown: steps.length - shown.length,
    rows: shown.map((step) => projectHandStepRow({ step })),
    unreadable,
  };
}
