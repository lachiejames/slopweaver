/**
 * The lookup surface over every lint gate's standing refusal copy. The rows themselves are one table that
 * `./declarations.ts` composes from its category files — they ARE the data, this one is what a gate calls.
 *
 * Split because `file-size-ratchet` refused the single file at 582 code lines against its cap
 * of 580, and its correction is the right one here: a table that gains six lines per gate has no ceiling of
 * its own, so the seam is data against API rather than a slice taken to fit. Nothing outside moved —
 * `lintDeclarationFor`, `LintGateRefusalId` and `DECLARED_LINT_GATES` are still imported from this module by
 * every gate, and `LINT_GATE_DECLARATIONS` is re-exported for the parity check that iterates it.
 */
import { LINT_GATE_DECLARATIONS } from "./declarations.js";
import type { LintGateDeclaration } from "./types.js";

export { LINT_GATE_DECLARATIONS } from "./declarations.js";

/** Every declared refusal id, derived rather than restated. */
export type LintGateRefusalId = keyof typeof LINT_GATE_DECLARATIONS;

/**
 * One gate's declaration, by id.
 *
 * @param id the refusal id
 * @returns the declaration
 */
export function lintDeclarationFor({ id }: { id: LintGateRefusalId }): LintGateDeclaration {
  return LINT_GATE_DECLARATIONS[id];
}

/** Every gate name that carries at least one declaration, for the parity check in `../gateRegistration.ts`. */
export const DECLARED_LINT_GATES: readonly string[] = [
  ...new Set(Object.values(LINT_GATE_DECLARATIONS).map((declaration) => declaration.gate)),
].toSorted();
