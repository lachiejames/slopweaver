/**
 * The digest's `held:` line — what the board holds beside its ready rows, printed right under the seatable count.
 *
 * A digest that printed only `seatable: NONE of 2 ready row(s)` said nothing about a board of 116 open rows, 84 held
 * only for naming no `repo:`, and the chair told the owner there was nothing to seat (`./heldWork.ts`).
 * A count of ready rows is never the size of the board, so the line that sits beside it says what the rest are.
 */
import { type DigestInputs, jsonOf } from "./digestRead.js";
import { heldWorkLine, heldWorkOf } from "./heldWork.js";

/**
 * The `held:` line for one tick's reconciliation.
 *
 * @returns one `held:` line, or `held: UNKNOWN — <why>` when the reconciliation will not read
 */
export function heldLines({ inputs }: { inputs: DigestInputs }): readonly string[] {
  const read = jsonOf({ inputs, name: "reconcile" });
  if ("line" in read) {
    return [`held: UNKNOWN — ${read.line}`];
  }
  const held = heldWorkOf({ reconciliation: read.value });
  if (held.kind === "unreadable") {
    return [`held: UNKNOWN — ${held.why}`];
  }
  return [`held: ${heldWorkLine({ held: held.value })}`];
}
