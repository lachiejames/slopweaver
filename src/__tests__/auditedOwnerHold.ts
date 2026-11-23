/**
 * A row as the audited view returns it, for a test that needs an owner hold read as the owner's. The audit is the only way
 * to get an `anchored` hold, by construction (`src/live/automation/ownerHoldPlacedBy.ts`), so a test takes the same
 * path: the owner's record is a plain seam answering `record` at every anchor, never a mock.
 */
import { ok } from "#lib/result.js";

import type { RecipeDefinition } from "../live/automation/definition.js";
import { withOwnerHoldPlacedByState } from "../live/automation/ownerHoldPlacedBy.js";

/** A well-formed owner-words anchor: the audit refuses one its scheme's parser does not take, before reading it. */
export const HIS_ANCHOR = "talk-call:a0000048-0000-4000-8000-000000000051#turn_000000000000000000025";

/**
 * The row with its standing owner hold audited against `record`.
 *
 * @param definition the row, its hold carrying the `placedBy` to judge
 * @param record the owner's words at the hold's anchor
 * @returns the audited row
 */
export function auditedAgainst({
  definition,
  record,
}: {
  readonly definition: RecipeDefinition;
  readonly record: string;
}): RecipeDefinition {
  return withOwnerHoldPlacedByState({
    definition,
    resolveOwnerWords: () =>
      ok({
        atIso: "2026-10-19T11:48:00.000Z",
        context: { kind: "call-segment", open: undefined },
        headKnown: true,
        headLost: false,
        tailKnown: true,
        tailLost: false,
        text: record,
        where: "call",
      }),
  });
}
