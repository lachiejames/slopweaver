/**
 * The call leg's own flags for `desktop e2e`: each is refused without `--call`, the leg it configures. Split out of
 * `./e2eRun.ts` along that seam, so the verb's parser reads a flag in one line and these rules sit together.
 */
import { err, ok, type Result } from "#lib/result.js";
import { E2eCallFlagErrors } from "../../../desktop/e2eCallErrors.js";
import {
  CALL_HOLD_DEFAULT_MINUTES,
  CALL_STEP_IDS,
  type DesktopE2ePick,
  parseHoldMinutes,
} from "../../../desktop/e2eCallPlan.js";
import { cardTargetsOf, type E2eCardTargets } from "../../../desktop/e2eCardReadPlan.js";
import { pickSteps } from "../../../desktop/e2ePlan.js";
import { type E2eMicCandidate, parseMicCandidate } from "../../../desktop/e2eTranscriptFidelityCorpus.js";

/**
 * Why a pick cannot run: an `--only` id naming nothing, or a scenario missing the flag it needs, in that order.
 *
 * @param picked what `pickDesktopE2eSteps` chose for the flags
 * @returns the refusal to print before the usage, or `undefined` when the pick can run
 */
export function pickRefusal({ picked }: { picked: DesktopE2ePick }): string | undefined {
  if (picked.unknown.length > 0) {
    const known = [...pickSteps({ only: [] }).steps.map((step) => step.id), ...CALL_STEP_IDS];
    return `--only names no step: ${picked.unknown.join(", ")} (the steps: ${known.join(", ")})`;
  }
  if (picked.needsCall.length > 0) {
    return E2eCallFlagErrors.scenarioWithoutCall({ ids: picked.needsCall }).message;
  }
  if (picked.needsCard.length > 0) {
    return E2eCallFlagErrors.cardScenarioWithoutCard().message;
  }
  if (picked.needsCandidate.length > 0) {
    return E2eCallFlagErrors.fidelityWithoutCandidate().message;
  }
  return undefined;
}

/**
 * Read `--call-hold-minutes`: refused without the leg it configures.
 *
 * @param call whether `--call` was given
 * @param hold the hold's text, `undefined` when not given
 * @returns the minutes, or why the flags are refused
 */
export function holdMinutesOf({ call, hold }: { call: boolean; hold: string | undefined }): Result<number> {
  if (hold === undefined) {
    return ok(CALL_HOLD_DEFAULT_MINUTES);
  }
  if (!call) {
    return err([E2eCallFlagErrors.holdWithoutCall().message]);
  }
  return parseHoldMinutes({ text: hold });
}

/**
 * Read `--call-card`: refused without the leg it configures, and taken as `all` — every open Queue and Alignment
 * card the console draws when the leg starts — or a comma list of card keys exactly as the console names them
 * (`cardTargetsOf`), since the card tools' details open with that key and the witness is judged against them.
 *
 * @param call whether `--call` was given
 * @param card the flag's text, `undefined` when not given
 * @returns the cards, `none` when none was named, or why the flag is refused
 */
export function callCardOf({ call, card }: { call: boolean; card: string | undefined }): Result<E2eCardTargets> {
  if (card === undefined) {
    return ok({ kind: "none" });
  }
  if (!call) {
    return err([E2eCallFlagErrors.cardWithoutCall().message]);
  }
  const targets = cardTargetsOf({ text: card });
  if ("invalid" in targets) {
    return err([E2eCallFlagErrors.cardInvalid({ key: targets.invalid.join(", ") }).message]);
  }
  return ok(targets);
}

/**
 * Read `--call-mic-candidate`: the microphone setting `transcription-fidelity` compares against control, refused
 * without that scenario, the one thing it configures (`--only` naming it is itself refused without `--call`).
 *
 * @param ids every scenario `--only` named, which must include transcription-fidelity
 * @param text the flag's value, `undefined` when not given
 * @returns the candidate, `undefined` when none was named, or why the flag is refused
 */
export function micCandidateOf({
  ids,
  text,
}: {
  ids: readonly string[];
  text: string | undefined;
}): Result<E2eMicCandidate | undefined> {
  if (text === undefined) {
    return ok(undefined);
  }
  if (!ids.includes("transcription-fidelity")) {
    return err([E2eCallFlagErrors.candidateWithoutFidelity().message]);
  }
  const candidate = parseMicCandidate({ text });
  if (candidate === undefined) {
    return err([E2eCallFlagErrors.micCandidateInvalid({ candidate: text }).message]);
  }
  return ok(candidate);
}
