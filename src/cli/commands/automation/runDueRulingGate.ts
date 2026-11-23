/**
 * The PRECISE half of the ruling gate, asked once per due row by `automation run-due`.
 *
 * A gate on `automation run-due` scoped to one automation id is not matched at the dispatch boundary by a
 * scheduled tick: its argv names no row, so `../../rulingGateDoor.ts` sees nothing to match the subject against
 * and lets the tick through — correctly, since every OTHER row should still run. The row id is only known here,
 * inside the tick, so this is where `rulingGateVerdict` asks about it (without this check, a ruling holding one automation
 * would be carried by nothing).
 *
 * The boundary's whole-token match is unchanged, so a tick whose argv DOES carry the held id as a token — a
 * `--recipe held-row`, or a `--claim-id` that happens to equal it — is refused whole there, siblings included.
 * That is the blunt half over-refusing, the safe direction, and loosening it is not this file's to do.
 *
 * A held row is NOT a failure. It is not admitted, takes no firing, runs nothing and is not stamped, so it is
 * due again on the first tick after the gate lifts; reporting it failed would exit the tick non-zero and, once
 * settled, place a failure hold and file a finding for a row the owner deliberately stopped.
 */
import { rulingGateVerdict, type StandingGate } from "../../../handover/rulingGate.js";
import type { RowOutcome } from "./rowRunners.js";

/**
 * The outcome of a due row a standing ruling holds, or `null` when none does.
 *
 * The summary names every holding gate's id and the first one's words; the detail carries each gate's id, words
 * and anchor, so the reader's next act is to go and check the ruling rather than to believe the line.
 *
 * @param gates the unexpired standing gates this tick read
 * @param recipeId the row about to run
 * @returns the held outcome, or `null` when the row may run
 */
export function rulingHeldOutcome({
  gates,
  recipeId,
}: {
  gates: readonly StandingGate[];
  recipeId: string;
}): RowOutcome | null {
  const holding = rulingGateVerdict({ gates, noun: "automation", subject: recipeId, verb: "run-due" });
  const first = holding[0];
  if (first === undefined) {
    return null;
  }
  const ids = holding.map((gate) => gate.id).join(", ");
  return {
    detail: holding.flatMap((gate) => [
      `  ruling gate ${gate.id}`,
      `    they said: ${gate.words}`,
      `    where: ${gate.anchor}`,
    ]),
    exitCode: null,
    failed: false,
    line: `recipe ${recipeId} · HELD · ruling gate ${ids} · they said: ${first.words}`,
    ran: false,
    recipeId,
  };
}
