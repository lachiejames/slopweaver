/**
 * The document-level reference facts both JSON producers print — the board's in `./listJson.ts` and one row's in
 * `./rowJson.ts` — in the one wire shape, so a card resolves a bare reference identically off either.
 */
import type { LinearReferenceFacts } from "../../linearReferenceFacts.js";
import type { RecordReferenceFact } from "../../recordReferenceFacts.js";
import type { BoardJsonDocument } from "./listJson.js";

/**
 * The `referenceContext` field: the install's Linear workspace and team keys, and every record a card may name by a
 * bare id.
 *
 * @param linear the install's Linear workspace and team keys
 * @param records every monitor, control and risk the install resolved an address for
 * @returns the `referenceContext` field
 */
export function referenceContextOf({
  linear,
  records,
}: {
  linear: LinearReferenceFacts;
  records: readonly RecordReferenceFact[];
}): BoardJsonDocument["referenceContext"] {
  return { linearTeamKeys: linear.teamKeys, linearWorkspaceSlug: linear.workspaceSlug, records };
}
