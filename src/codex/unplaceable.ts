/**
 * A pass that recorded no tree, as the branch ledger lists it, and which supersession row may retire which kind
 * of ledger row.
 *
 * Split from `./ledger.ts` along the one seam the owner's no-tree ruling added: the register now
 * holds two row kinds, and each retires exactly one kind of ledger row. A fallback review forged both
 * crossings — a wording row keyed by a no-tree record's id retired it with no replacement, and a no-tree row
 * taken on one branch retired it on every branch — so the pairing lives here, in two small functions, rather
 * than inline in the fold.
 */

import type { Supersession, UnplaceableSupersession, WordingSupersession } from "./supersession.js";
import type { CodexArtifactRecord, CodexPassId, CodexPassScope } from "./types.js";

/** A pass in this checkout that recorded no usable tree, so it cannot be placed on any branch. */
export interface UnplaceableRecord {
  readonly artifactId: string;
  /** The checkout it ran in — the landing floor folds several, and `codex supersede --repo` needs this one. */
  readonly repoRoot: string;
  readonly pass: CodexPassId;
  readonly mode: CodexPassScope["mode"];
  /** The property id for a review; `undefined` for a plan. */
  readonly propertyId: string | undefined;
  readonly verdict: string;
  readonly createdAtIso: string;
  /** The `codex supersede` row retiring it, when one stands; it then stops counting in `unknowable`. */
  readonly superseded: Supersession | undefined;
}

/**
 * The row retiring a PLACED pass or receipt: a wording row only. A `no-tree` row is proof about a record that
 * named no branch, never about one that did.
 *
 * @param row the register's row for the artifact id, if any
 * @returns the wording retirement, or `undefined`
 */
export function wordingRetirement({ row }: { row: Supersession | undefined }): WordingSupersession | undefined {
  if (row === undefined || row.kind === "no-tree") {
    return undefined;
  }
  return row;
}

/**
 * The row retiring a no-tree record when the ledger is judged for `branch`: a `no-tree` row taken on that
 * branch, and nothing else.
 *
 * @param row the register's row for the artifact id, if any
 * @param branch the branch being judged, which the row's replacement must have stood on
 * @returns the retirement, or `undefined` so the record keeps counting
 */
function noTreeRetirement({
  row,
  branch,
}: {
  row: Supersession | undefined;
  branch: string;
}): UnplaceableSupersession | undefined {
  if (row?.kind !== "no-tree" || row.branch !== branch) {
    return undefined;
  }
  return row;
}

/**
 * One no-tree record as the row `codex status` names and `codex supersede` can retire.
 *
 * @param record the pass record that carries no usable tree
 * @param verdict its verdict, read by the ledger's own reader so both halves print one wording
 * @param branch the branch the ledger is judged for
 * @param row the register's row for the artifact id, if any
 * @returns the listed record, marked retired only by a `no-tree` row taken on `branch`
 */
export function toUnplaceable({
  record,
  verdict,
  branch,
  row,
}: {
  record: CodexArtifactRecord;
  verdict: string;
  branch: string;
  row: Supersession | undefined;
}): UnplaceableRecord {
  return {
    artifactId: record.artifactId,
    createdAtIso: record.createdAtIso,
    mode: record.scope.mode,
    pass: record.scope.pass,
    propertyId: record.scope.mode === "review" ? record.scope.property.id : undefined,
    repoRoot: record.repoRoot,
    superseded: noTreeRetirement({ branch, row }),
    verdict,
  };
}
