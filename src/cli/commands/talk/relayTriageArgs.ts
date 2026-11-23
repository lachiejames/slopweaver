/**
 * `talk relay`'s `--triage`, `--label` and `--feedback`: the owner's ruling on the card a triage pass has open
 * (`src/talk/triageVocabulary.ts`). Split from `./relayArgs.ts`, which sits at the file-size ratchet, as
 * `./relayCandidateArgs.ts` was. Pure.
 */
import {
  FEEDBACK_VERDICTS,
  isTriageFeedback,
  isTriageLabel,
  isTriageVerdict,
  TRIAGE_FEEDBACK,
  TRIAGE_LABELS,
  TRIAGE_VERDICTS,
  type TriageRuling,
} from "../../../talk/triageVocabulary.js";
import { stringOf } from "./flagValues.js";

/**
 * The triage ruling a relay carries, or why `--triage`/`--label`/`--feedback` are refused: the verdict is one of the
 * owner's, a label or feedback rides only beside one, feedback only beside a verdict that sends the card back, the
 * ruling is on the card `--about` names, and a relay carries one ruling per turn.
 *
 * @param about the relay's `--about` key, the card the owner's words began over
 * @param feedback `--feedback`, the class of defect the owner named on a card they sent back
 * @param otherRuling whether the relay also carries a check-in or candidate ruling
 * @param problems the parse's running list, which a refusal is appended to
 * @returns the ruling, or `undefined` when the flags were absent or refused
 */
export function triageRulingOf({
  triage,
  label,
  feedback,
  about,
  otherRuling,
  problems,
}: {
  triage: string | boolean | undefined;
  label: string | boolean | undefined;
  feedback: string | boolean | undefined;
  about: string;
  otherRuling: boolean;
  problems: string[];
}): TriageRuling | undefined {
  if (triage === undefined && label === undefined && feedback === undefined) {
    return undefined;
  }
  if (triage === undefined) {
    if (label !== undefined) {
      problems.push("--label rides only beside --triage: the owner's label on the card they ruled");
    }
    if (feedback !== undefined) {
      problems.push("--feedback rides only beside --triage: what was wrong with the card the owner sent back");
    }
    return undefined;
  }
  // `stringOf` reads an empty `--triage=` as absent, so a flag that was GIVEN is told apart from one that was not:
  // an empty value is refused as the wrong word, never skipped.
  const verdict = stringOf({ value: triage });
  const word = stringOf({ value: label });
  const defect = stringOf({ value: feedback });
  const refusals = [
    ...triageRefusals({ about, labelGiven: label !== undefined, otherRuling, verdict, word }),
    ...feedbackRefusals({ defect, feedbackGiven: feedback !== undefined, verdict }),
  ];
  problems.push(...refusals);
  if (refusals.length > 0 || !isTriageVerdict(verdict)) {
    return undefined;
  }
  const named = isTriageFeedback(defect) ? { feedback: defect } : {};
  if (word === undefined) {
    return { label: undefined, verdict, ...named };
  }
  return isTriageLabel(word) ? { label: word, verdict, ...named } : undefined;
}

/**
 * Why a given `--feedback` cannot stand: a class not in the vocabulary, or beside a verdict that does not send the
 * card back — feedback on a card the owner is sending names nothing to fix.
 *
 * @param defect the flag's value, `undefined` when absent or empty
 * @param feedbackGiven whether `--feedback` was passed at all, so an empty one is refused rather than read as absent
 * @param verdict the `--triage` word
 * @returns every refusal, empty when the feedback stands or was not given
 */
function feedbackRefusals({
  defect,
  feedbackGiven,
  verdict,
}: {
  defect: string | undefined;
  feedbackGiven: boolean;
  verdict: string | undefined;
}): string[] {
  if (!feedbackGiven) {
    return [];
  }
  const refusals: string[] = [];
  if (!isTriageFeedback(defect)) {
    refusals.push(`--feedback must be one of ${TRIAGE_FEEDBACK.join(", ")}, got ${gotOf({ given: defect })}`);
  }
  if (isTriageVerdict(verdict) && !FEEDBACK_VERDICTS.includes(verdict)) {
    refusals.push(
      `--feedback names what to fix on a card the owner sent back, so it rides only beside --triage ${FEEDBACK_VERDICTS.join(" or ")}`,
    );
  }
  return refusals;
}

/**
 * Why a given `--triage` cannot stand: a word or a label not in the vocabulary, no card named, or a second ruling
 * beside it.
 *
 * @param labelGiven whether `--label` was passed at all, so an empty one is refused rather than read as absent
 * @param otherRuling whether the relay also carries a check-in or candidate ruling
 * @returns every refusal, empty when the ruling stands
 */
function triageRefusals({
  verdict,
  word,
  labelGiven,
  about,
  otherRuling,
}: {
  verdict: string | undefined;
  word: string | undefined;
  labelGiven: boolean;
  about: string;
  otherRuling: boolean;
}): string[] {
  const refusals: string[] = [];
  if (!isTriageVerdict(verdict)) {
    refusals.push(`--triage must be one of ${TRIAGE_VERDICTS.join(", ")}, got ${gotOf({ given: verdict })}`);
  }
  if (labelGiven && !isTriageLabel(word)) {
    refusals.push(`--label must be one of ${TRIAGE_LABELS.join(", ")}, got ${gotOf({ given: word })}`);
  }
  if (about === "") {
    refusals.push("--triage is the owner's ruling on the card they have open, so it needs --about <kind>:<id>");
  }
  if (otherRuling) {
    refusals.push("talk relay carries one ruling per turn: --triage, --candidate or --covers, never two");
  }
  return refusals;
}

/**
 * The word a refusal says it got: an empty flag (`--triage=`) reads as given with nothing in it.
 *
 * @param given the flag's value, `undefined` when it was empty
 * @returns the word, or "nothing"
 */
function gotOf({ given }: { given: string | undefined }): string {
  if (given === undefined) {
    return "nothing";
  }
  return given;
}
