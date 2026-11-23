/**
 * The decision a `handover register` row carries, judged before anything is written: its shape, whether its ask
 * can head the card the owner answers, and the concrete scenes that card leads with. Split from `./askRowRun.ts` under the
 * file-size ratchet, along the line between judging a row's decision and resolving the rest of its flags.
 */
import type { AskExampleSet } from "../../../handover/askExamples.js";
import type { AskShape } from "../../../handover/askShape.js";
import { registerAlignmentVerdict } from "../../../handover/cardAlignment.js";
import { type AdmittedExamples, admittedExamples } from "./askExampleFlags.js";
import { optionalString, shapeVerdictFor } from "./askRowArgs.js";

/**
 * The decision a row carries, judged: its shape, and whether its ask can head the card the owner answers.
 *
 * A shape is mandatory only on rows that WAIT ON THE OWNER'S WORD; a finding and a dispatch row are read
 * INDEPENDENTLY — conflating them refuses every `github landing --register` row. A finding that carries
 * a shape reaches the owner's Queue as a decision too, so its ask is judged like any other that heads their card.
 *
 * @param finding whether the row is a `--finding`
 * @param dispatch whether the row is a `--dispatch`
 * @param rest the verb's argv tail, where every repeated `--example` is read
 * @returns the shape and scenes to record, or the refusal lines to print
 */
export function decisionVerdict({
  ask,
  dispatch,
  env,
  finding,
  rest,
  values,
}: {
  ask: string;
  dispatch: boolean;
  env: NodeJS.ProcessEnv;
  finding: boolean;
  rest: readonly string[];
  values: Readonly<Record<string, unknown>>;
}):
  | { readonly refusalLines: readonly string[] }
  | { readonly shape: AskShape | undefined; readonly examples: AskExampleSet | undefined } {
  const waitsOnOwner = !finding && !dispatch;
  const verdict = shapeVerdictFor({ env, required: waitsOnOwner, values });
  if (verdict.kind === "refused") {
    return { refusalLines: verdict.lines };
  }
  const headsOwnerCard = waitsOnOwner || verdict.shape !== undefined;
  const aligned = registerAlignmentVerdict({ ask, env, waitsOnOwner: headsOwnerCard });
  if (aligned.kind === "refused") {
    return { refusalLines: aligned.lines };
  }
  const examples = registerExamples({ headsOwnerCard, rest, values });
  if (examples.kind === "refused") {
    return { refusalLines: examples.lines };
  }
  return { examples: examples.set, shape: verdict.shape };
}

/**
 * The concrete examples a row carries: required on every row that heads the owner's card, read
 * when passed on one that does not — an unshaped finding — and absent otherwise. A `--dispatch` row passing
 * either flag is refused earlier, by `dispatchConflicts`.
 *
 * @param headsOwnerCard whether the row's ask is the one the owner's Queue card leads with
 * @param rest the verb's argv tail, where every repeated `--example` is read
 * @returns the admitted set — `undefined` on a row that neither needs nor passed one — or the refusal
 */
export function registerExamples({
  headsOwnerCard,
  rest,
  values,
}: {
  headsOwnerCard: boolean;
  rest: readonly string[];
  values: Readonly<Record<string, unknown>>;
}): AdmittedExamples | { readonly kind: "admitted"; readonly set: undefined } {
  const gap = optionalString({ name: "example-gap", values });
  const passed = gap !== undefined || values["example"] !== undefined;
  if (!headsOwnerCard && !passed) {
    return { kind: "admitted", set: undefined };
  }
  return admittedExamples({ command: "handover register", env: process.env, gap, rest });
}
