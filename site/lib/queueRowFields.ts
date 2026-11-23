/**
 * The small readers more than one of the queue's row builders shares: a field the record may not carry, a row's
 * workspace, and the basis and form a card is judged by. Split from `./queueRows.ts`, which folds every register into
 * one list, so that file stays under the 300-line cap.
 */

import type { BriefingCardBasis, FieldBasis, QueueCardForm } from "./briefingCardForm";
import type { Workspace, WorkspacePlacement } from "./workspacePlacement";
import { workspaceOfPlacement } from "./workspacePlacementContext";

/**
 * A field the record may not carry, as text for a context hint: absent is the empty string.
 *
 * @returns the value, or nothing
 */
export function hint({ value }: { value: string | undefined }): string {
  if (value === undefined) {
    return "";
  }
  return value;
}

/**
 * Whether a placement puts its row in one workspace, by the one rule the switcher draws it by.
 *
 * @returns true only for a row drawn in `workspace`
 */
export function placedIn({ placement, workspace }: { placement: WorkspacePlacement; workspace: Workspace }): boolean {
  return workspaceOfPlacement({ placement }) === workspace;
}

/**
 * The basis of a card whose record gives it a `what` and at most one value its lean is drawn from — a held reply's
 * reason, a refused pull request's action detail, a naming card's sentence.
 *
 * @param what the record values the `what` is drawn from, joined
 * @param lean the record value the lean is drawn from
 * @returns the basis
 */
export function whatAndLeanOf({
  what,
  lean,
}: {
  what: string | undefined;
  lean: string | undefined;
}): BriefingCardBasis {
  return { lean: heldOf({ value: lean }), problem: "absent", stakes: "absent", what: heldOf({ value: what }) };
}

/**
 * Whether a record holds a value for a field — an empty or whitespace-only string holds none.
 *
 * @returns `present` or `absent`
 */
export function heldOf({ value }: { value: string | undefined }): FieldBasis {
  if (value === undefined || value.trim().length === 0) {
    return "absent";
  }
  return "present";
}

/**
 * The first refusal among several forms, or `drawn` when none refuses — the lookup's own refusal first.
 *
 * @param forms the forms, in the order their refusals outrank each other
 * @returns the first refusal, else `drawn`
 */
export function firstRefusal({ forms }: { forms: readonly QueueCardForm[] }): QueueCardForm {
  const refused = forms.find((form) => form.kind === "refused");
  if (refused === undefined) {
    return { kind: "drawn" };
  }
  return refused;
}
