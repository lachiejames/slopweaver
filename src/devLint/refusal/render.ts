/**
 * The ONE function that ends a `dev lint` refusal. Every gate's policy failure is these four lines or it is
 * a defect, and `./scan.ts` refuses a gate that writes its own.
 *
 * Lines one, three and four are owned here. A gate supplies only what it OBSERVED — how many findings, in
 * which file — and can neither word the exceptions, the correction, nor the judgement note. That last one is
 * the same constant the outbound refusals use (`../../hatch/render.ts`), for the same reason: a line a gate
 * could word itself would eventually be worded as "do not override", and judgement is first class.
 *
 * The per-finding `path:line` diagnostics a gate streams above this block are untouched. They are the part a
 * reader acts on file by file; this is the part that says what the rule was and what to do about it.
 */
import { exceptionClause, JUDGEMENT_NOTE } from "../../hatch/render.js";
import type { LintGateDeclaration } from "./types.js";

/**
 * Render one lint gate's refusal.
 *
 * @param declaration the gate's standing copy
 * @param detail what THIS run observed, in a clause that reads inside brackets — "7 violations", "AGENTS.md
 *   at 206 lines against a 200-line cap"
 * @returns the four lines, newline-joined, with no trailing newline
 */
export function lintGateRefusal({ declaration, detail }: { declaration: LintGateDeclaration; detail: string }): string {
  return [
    `Passing dev lint is blocked because the \`${declaration.gate}\` gate ${declaration.caught} (${detail}).`,
    `Legitimate exceptions may include ${exceptionClause({ exceptions: declaration.exceptions })}.`,
    `There is no override for this lint gate at run time. The designated way through is to correct the source: ${declaration.correction}`,
    JUDGEMENT_NOTE,
  ].join("\n");
}

/**
 * The same refusal as separate lines, for a caller that writes line by line rather than one block.
 *
 * @param declaration the gate's standing copy
 * @param detail what THIS run observed
 * @returns the refusal's four lines, in order
 */
export function lintGateRefusalLines({
  declaration,
  detail,
}: {
  declaration: LintGateDeclaration;
  detail: string;
}): readonly string[] {
  return lintGateRefusal({ declaration, detail }).split("\n");
}

/**
 * Which of the three endings a gate run has earned, decided in one place rather than by the order of a
 * gate's `if`s.
 *
 * The distinction is the whole point of the classification: a gate that could not READ one of its inputs has
 * a FACT to report, and rendering the four-line policy block over it says the rule caught something it did
 * not. That defect was found twice by adversarial review in the work that introduced these declarations —
 * once in `register-hygiene`, once in `git-in-tests` — because each gate spelled the branch order itself.
 * A gate now asks this and switches on the answer, so the ordering cannot be got wrong one file at a time.
 */
export type GateOutcome = "clean" | "incomplete" | "refused";

/**
 * Classify a gate run from what it counted.
 *
 * @param refused how many findings the gate's own criterion caught — the POLICY count, never a read failure
 * @param unseen how many of ITS OWN inputs the gate never judged: a file it could not read, or its own file
 *   filter selecting none. Either way the gate has a FACT to report and no verdict to give. Not to be
 *   confused with the RUNNER's empty selection (`EMPTY_SELECTION`, `../devLint.ts`), which is a POLICY
 *   refusal: there every gate named was real and the LANE's rule excluded them all, so a rule did say no
 * @returns `refused` when the criterion caught anything, `incomplete` when it caught nothing but could not
 *   see everything, `clean` only when it saw everything and caught nothing
 */
export function gateOutcome({ refused, unseen }: { refused: number; unseen: number }): GateOutcome {
  if (refused > 0) {
    return "refused";
  }
  if (unseen > 0) {
    return "incomplete";
  }
  return "clean";
}
