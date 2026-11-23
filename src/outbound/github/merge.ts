/**
 * The surgical merge: apply a {@link PrFormEdit} to the form a live description recovers to.
 *
 * ## The bug this file exists to prevent
 *
 * Updating a pull-request description replaces the entire body. So an update flow that asks the caller for a
 * complete form silently destroys every field the caller did not think to re-supply — in practice the proof slots and
 * their screenshots, the most expensive part to rebuild and the part nobody notices is gone until later.
 *
 * The fix: an update names ONLY what changes, and everything else is carried from the recovered form. An unmentioned
 * field is preserved by construction rather than by the caller remembering it.
 *
 * ## The operations
 *
 * A set field replaces its section whole; an optional section is dropped by setting it to `[]`. `appendChecks` and
 * `appendNotChecked` add after what is there, because adding one line is the commonest update. `./schema.ts`'s
 * `prFormEditSchema` refuses a field both set and appended to, so the order below never has to break a tie.
 *
 * The result is a DRAFT: the door re-validates it through the write schema, so an edit that is fine alone but breaks
 * a rule once merged is refused before anything renders.
 */
import type { PrFormDraft, PrFormEdit } from "./types.js";

/**
 * Apply an edit to the recovered form.
 *
 * Pure: the caller supplies the form the live body recovered to and gets back the draft to re-validate, render and
 * store. Nothing here touches the network, the filesystem or a clock.
 *
 * @param form the form the live description recovers to
 * @param edit the named fields to change; absent fields are left untouched
 * @returns the merged draft
 */
export function applyEdit({ form, edit }: { form: PrFormDraft; edit: PrFormEdit }): PrFormDraft {
  // A field the edit leaves absent keeps the recovered value: the destructuring default says so at the read.
  const {
    checkGroups = form.checkGroups,
    checks = form.checks,
    explainer = form.explainer,
    notChecked = form.notChecked,
    problemProof = form.problemProof,
    problemSeen = form.problemSeen,
    rerun = form.rerun,
    risk = form.risk,
    solutionProof = form.solutionProof,
    title = form.title,
    visualProof = form.visualProof,
  } = edit;
  return {
    // Only a body that has groups carries the field, so one with none (or groups dropped with `[]`) reads back
    // exactly as it was.
    ...(checkGroups === undefined || checkGroups.length === 0 ? {} : { checkGroups }),
    checks: edit.appendChecks === undefined ? checks : [...checks, ...edit.appendChecks],
    // Always the recovered value: draft is not in {@link PrFormEdit} because REST cannot change it.
    draft: form.draft,
    explainer,
    notChecked: edit.appendNotChecked === undefined ? notChecked : [...notChecked, ...edit.appendNotChecked],
    problemProof,
    problemSeen,
    rerun,
    risk,
    solutionProof,
    // The target is deliberately NOT editable: a different base or head is a different pull request.
    target: form.target,
    title,
    visualProof,
  };
}
