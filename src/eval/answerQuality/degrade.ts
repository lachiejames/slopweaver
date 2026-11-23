/**
 * Degraded variants of a golden, generated MECHANICALLY from the case's own rubric.
 *
 * The self-test needs answers that are worse than the golden in one named way each. Authoring them by hand
 * would let them drift from the rubric they are meant to falsify — an author who writes both the anchors and
 * the "degraded" text can, without meaning to, write a variant that fails for a reason the rubric never
 * names. Deriving them from the rubric removes that: a caveat variant is the golden with the sentences
 * carrying that caveat's anchors deleted, so the only thing that changed is the thing being measured.
 *
 * Two of the three are the properties no token-overlap scorer can pass. The caveat and attribution variants
 * keep almost every word of the golden and must still grade DOWN; the certainty variant ADDS words, so its
 * overlap with the golden goes UP while its grade goes down.
 */

import type { AnswerQualityCase, Expectation } from "./caseSchema.js";
import { normaliseForMatching, satisfiesRequires } from "./score.js";

/**
 * The three ways a golden is made worse, each named after what it removed or added.
 *
 * @internal — the field type of {@link DegradedVariant}; nothing outside this file names it.
 */
export type DegradationKind = "caveat-dropped" | "attribution-dropped" | "certainty-invented";

/**
 * One degraded answer, carrying what was done to it and which expectation that targeted.
 *
 * `expectationId` is a SYNTHETIC id and `label` is golden-derived prose — the split matters, because
 * `src/eval/answerQuality/artifact.ts` may publish the former and may never publish the latter. A caveat or
 * attribution supplies its own id from the case file; the invented-certainty variant has no expectation to
 * take one from, so it carries the certainty variant's own synthetic id rather than the phrase itself.
 */
export interface DegradedVariant {
  readonly kind: DegradationKind;
  readonly expectationId: string;
  readonly label: string;
  readonly text: string;
}

/**
 * The id the invented-certainty variant reports, since `inventedCertainty` is a bare list of phrases.
 *
 * It names the FIRST phrase, which is the only one {@link degradeGolden} uses — a case declaring several
 * still produces one certainty variant. The phrase itself is never the id: it is a sentence mined from the
 * golden, so using it would put golden text in every downstream field that carries an id.
 *
 * @internal — the value {@link degradeGolden} puts on its certainty variant; nothing outside this file names
 *   it, and a test asserts the literal so a rename is visible rather than silently absorbed.
 */
const CERTAINTY_EXPECTATION_ID = "k1";

/**
 * Split prose into sentences on terminal punctuation and hard line breaks.
 *
 * Deliberately naive: a golden here is Slack prose, and the only property that matters is that deleting the
 * sentences carrying an anchor leaves the rest readable and intact. No abbreviation handling, because
 * over-splitting deletes slightly more than needed and under-splitting slightly less — neither changes
 * whether the expectation survives.
 *
 * One asymmetry is deliberate and is why {@link ineffectiveDrops} exists: the SCORER collapses whitespace
 * before matching, so an anchor split by a hard line break still satisfies its expectation — while a split
 * here makes that anchor undroppable. The self-test fails on it by name rather than letting the variant
 * quietly grade the same as the golden.
 *
 * @returns each non-empty sentence, trimmed, in order
 */
export function splitSentences({ text }: { text: string }): readonly string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

/**
 * The golden with every sentence carrying one of `requires`' anchors removed.
 *
 * @param text the golden
 * @param requires the expectation's anchors — any alternative from any group marks a sentence for deletion
 * @returns the surviving sentences, rejoined with a space
 */
export function dropSentencesCarrying({
  text,
  requires,
}: {
  text: string;
  requires: readonly (readonly string[])[];
}): string {
  const anchors = requires.flat().map((alternative) => normaliseForMatching({ text: alternative }));
  return splitSentences({ text })
    .filter((sentence) => {
      const normalised = normaliseForMatching({ text: sentence });
      return !anchors.some((anchor) => normalised.includes(anchor));
    })
    .join(" ");
}

/** One dropped-expectation variant, or `undefined` when the drop did not actually remove the expectation. */
function dropVariant({
  answerCase,
  expectation,
  kind,
}: {
  answerCase: AnswerQualityCase;
  expectation: Expectation;
  kind: DegradationKind;
}): DegradedVariant | undefined {
  const text = dropSentencesCarrying({ requires: expectation.requires, text: answerCase.goldenText });
  if (satisfiesRequires({ requires: expectation.requires, text: normaliseForMatching({ text }) })) {
    return undefined;
  }
  return { expectationId: expectation.id, kind, label: `${kind}: ${expectation.label}`, text };
}

/**
 * Every degraded variant a case's rubric can produce.
 *
 * A drop that leaves the expectation still satisfied is OMITTED rather than returned as a variant that will
 * not grade down. That is not a silent pass: `ineffectiveDrops` names those, and the self-test fails on them,
 * because an anchor whose sentences cannot be removed is an anchor too generic to measure anything.
 *
 * @param answerCase the case to degrade
 * @returns one variant per caveat, one per attribution, and one carrying the first invented-certainty phrase
 */
export function degradeGolden({ answerCase }: { answerCase: AnswerQualityCase }): readonly DegradedVariant[] {
  const dropped = [
    ...answerCase.caveats.map((expectation) => dropVariant({ answerCase, expectation, kind: "caveat-dropped" })),
    ...answerCase.attributions.map((expectation) =>
      dropVariant({ answerCase, expectation, kind: "attribution-dropped" }),
    ),
  ].filter((variant): variant is DegradedVariant => variant !== undefined);
  const phrase = answerCase.inventedCertainty[0];
  if (phrase === undefined) {
    return dropped;
  }
  return [
    ...dropped,
    {
      expectationId: CERTAINTY_EXPECTATION_ID,
      kind: "certainty-invented",
      label: `certainty-invented: "${phrase}"`,
      text: `${answerCase.goldenText}\n\n${phrase}.`,
    },
  ];
}

/**
 * The caveats and attributions whose anchors could not be removed from the golden by deleting sentences.
 *
 * @param answerCase the case to check
 * @returns one label per expectation whose drop left it still satisfied
 */
export function ineffectiveDrops({ answerCase }: { answerCase: AnswerQualityCase }): readonly string[] {
  const all: readonly { readonly expectation: Expectation; readonly kind: DegradationKind }[] = [
    ...answerCase.caveats.map((expectation) => ({ expectation, kind: "caveat-dropped" as const })),
    ...answerCase.attributions.map((expectation) => ({ expectation, kind: "attribution-dropped" as const })),
  ];
  return all
    .filter(({ expectation, kind }) => dropVariant({ answerCase, expectation, kind }) === undefined)
    .map(({ expectation }) => expectation.label);
}
