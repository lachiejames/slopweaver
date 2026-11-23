/**
 * Who this pass is scoped to, selected from the store's identity roster.
 *
 * Selects over the roster's records rather than going through `slopweaver identity resolve`, and that is a
 * measured decision rather than a shortcut: on the real 7.6 GB corpus that verb REFUSES, because it loads
 * the whole of bronze to answer a question the identity roster already holds. Reproduce with
 * `slopweaver identity resolve <a slack id>` against a full home.
 *
 * Pure: the records arrive already read through the roster port and decoded by its strict decoder, so there
 * is no file and no permissive parse here — an entry the store could not hold never reaches this function.
 */

import { type CycleError, CycleErrors } from "../../../cycle/errors.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { IdentityRecord } from "../../../silver/identity.js";

/**
 * The canonical person a reconcile is about.
 *
 * @internal — the shape {@link selectOwner} returns; no caller outside this noun names it.
 */
export interface ReconcileOwner {
  readonly linearId: string;
  readonly name: string;
}

/**
 * The FIRST canonical person in the identity roster carrying a Linear id.
 *
 * First rather than a named lookup because the roster is the owner's own and they are its first entry by
 * construction; a multi-person scope is a different feature and would take the person as an argument.
 *
 * @param records the store's identity roster records, in stored order
 * @returns the owner, or a typed reason nothing could be scoped
 */
export function selectOwner({ records }: { records: readonly IdentityRecord[] }): Result<ReconcileOwner, CycleError> {
  for (const record of records) {
    const linear = record.identities?.find((identity) => identity.source === "linear");
    if (linear !== undefined) {
      return ok({ linearId: linear.nativeId, name: record.name });
    }
  }
  return err(CycleErrors.noLinearIdentity());
}
