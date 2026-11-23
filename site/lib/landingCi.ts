/**
 * The words and tone a landing row's CI draws in, from the verb's own classification of a red rollup.
 *
 * A bare "red" hid the distinction that decides the act: measured once, 7 of 31 acme-admin rows read
 * `ci: red` where every failing check carried `required: false`. So a red row says WHAT it is red on —
 * a required check, advisory checks only, or a requirement the read could not establish — and unknown is
 * never drawn as advisory. One module so the chip, the fold, the slide-over and the voice say the same words.
 */
import type { LandingCiFailure, LandingRow } from "../components/live/readLanding";
import { pullRequestCiTone, type SemanticTone } from "./consoleTone";

/**
 * The row's CI as a phrase: the rollup's own word, qualified when it is red.
 *
 * @returns `red · required`, `red · advisory`, `red · requirement unknown`, or the verb's word for any other rollup
 */
export function landingCiWord({ row }: { row: Pick<LandingRow, "ci" | "ciFailure"> }): string {
  if (row.ciFailure.kind === "not-red") {
    return row.ci;
  }
  return `red · ${checkRequirementWord({ required: row.ciFailure.required })}`;
}

/**
 * What a failing check's requirement says, in the word every surface prints.
 *
 * @param required the base branch's requirement for the check, `undefined` when the read could not tell
 * @returns `required`, `advisory`, or `requirement unknown`
 */
export function checkRequirementWord({ required }: { required: boolean | undefined }): string {
  if (required === true) {
    return "required";
  }
  if (required === false) {
    return "advisory";
  }
  return "requirement unknown";
}

/**
 * The tone of a row's CI chip. A required or unknown red is danger — unknown is never softened into advisory
 * — and an advisory-only red is warning, because it holds nothing up on its own.
 *
 * @param ciFailure the verb's classification of the rollup
 * @param ci the rollup's own word, which decides the tone of a row that is not red, as `pullRequestCiTone` does
 * @returns the semantic tone
 */
export function landingCiTone({ ci, ciFailure }: { ci: string; ciFailure: LandingCiFailure }): SemanticTone {
  if (ciFailure.kind === "red") {
    if (ciFailure.required === false) {
      return "warning";
    }
    return "danger";
  }
  return pullRequestCiTone({ ci });
}
