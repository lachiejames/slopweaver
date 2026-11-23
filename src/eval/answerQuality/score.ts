/**
 * The answer-quality scorer — pure, deterministic, and structurally unable to reward surface overlap.
 *
 * ## What a grade means
 *
 * A candidate is graded on four dimensions drawn from the case's own golden: the CLAIMS it asserts, the
 * CAVEATS it carries (the what-it-does-not-prove honesty), the ATTRIBUTIONS it makes to a named source
 * rather than asserting bare, and the CERTAINTY it does not claim. Each declared dimension scores
 * `met / total`; the grade is their mean over the dimensions the case declares, so a case with no
 * attributions is scored over three rather than penalised for a dimension it never had.
 *
 * ## The one asymmetry, and why it is not a weight
 *
 * Any invented-certainty hit CAPS the band at `degraded`, whatever the mean says. Inventing certainty is a
 * different kind of wrong from being incomplete: an incomplete answer leaves a reader short, a falsely
 * certain one sends them somewhere wrong. A mean lets a complete answer bury one, which is exactly the
 * outcome this instrument exists to refuse.
 *
 * ## The failure mode it must never have
 *
 * Rewarding token overlap over substance. Nothing here compares the candidate to the golden's TEXT at all —
 * a grade is computed only from named expectations, so two properties hold that no overlap scorer can pass:
 * the golden with its caveat deleted scores below the golden despite near-total overlap, and the golden with
 * an invented-certainty sentence ADDED scores below it while remaining the CLOSEST variant to the golden by
 * overlap, because appending keeps every one of the golden's own tokens. Over
 * `eval/answer-quality.fixture.json`: golden against itself 1.000, caveat-dropped 0.612,
 * attribution-dropped 0.755, certainty-invented 0.942 — an overlap scorer ranks those three the other way
 * round. Those numbers are asserted by `unit/eval/answerQuality/selftest.test.ts`, not just stated here.
 * `src/eval/answerQuality/selftest.ts` runs both as properties rather than leaving them as a claim.
 *
 * ## The converse does NOT hold, and saying so is the point
 *
 * "Ignores wording" is one direction only. {@link satisfiesRequires} is `includes` over a lowercased,
 * whitespace-collapsed string and nothing else, so a candidate that reworded the golden while carrying
 * identical substance scores BELOW it whenever the rubric's `requires` alternatives did not anticipate that
 * wording. The counterexample is a TEST rather than a comment — `unit/eval/answerQuality/score.test.ts`
 * § "a rewording outside the anchors" — where a one-claim case anchored `[["unrelated"]]` grades its golden
 * `TOP 1.000` and "has nothing to do with the original fault" `UNSOUND 0.000`.
 *
 * That is an authoring bar, not a bug to route around — closing it in the matcher needs a model, which this
 * lane refuses (`eval/judgementAssertion.ts`: a red result graded by a second model is unreproducible). What
 * stops it reaching a grade is `paraphrase-scores-top`, which fails the SELFTEST when a case's anchors are
 * too narrow for its own paraphrase. It fired on the real `case-01` during authoring. So the guarantee this
 * lane actually offers is narrower than "wording-independent": every case carries one paraphrase whose
 * anchors are proven wide enough, and a rewording further out is out of scope rather than graded honestly.
 */

import type { AnswerCandidate, AnswerQualityCase, Attribution, Expectation } from "./caseSchema.js";

/** How well an answer carries its golden's substance, coarse enough to be read rather than computed with. */
export type QualityBand = "top" | "sound" | "degraded" | "unsound";

/**
 * The four things a grade is made of.
 *
 * @internal — the field type of {@link DimensionScore}; nothing outside this file names it.
 */
export type DimensionKind = "claims" | "caveats" | "attributions" | "certainty";

/**
 * One dimension's tally — how many of its expectations the candidate met.
 *
 * @internal — the element type of {@link AnswerGrade.dimensions}; nothing outside this file names it.
 */
export interface DimensionScore {
  readonly kind: DimensionKind;
  readonly met: number;
  readonly total: number;
}

/** One candidate's grade against one case. */
export interface AnswerGrade {
  readonly caseId: string;
  readonly candidateLabel: string;
  readonly score: number;
  readonly band: QualityBand;
  readonly dimensions: readonly DimensionScore[];
  readonly reasons: readonly string[];
}

/** Worst to best. A cap is applied by index, so the order is the definition rather than a lookup table. */
const BAND_ORDER: readonly QualityBand[] = ["unsound", "degraded", "sound", "top"];

/** The mean at or above which a grade is `sound`. */
export const SOUND_THRESHOLD = 0.8;

/** The mean at or above which a grade is `degraded` rather than `unsound`. */
export const DEGRADED_THRESHOLD = 0.5;

/**
 * Lowercase and collapse whitespace, so an anchor matches across a line break the way a reader would.
 *
 * @returns the text, lowercased with every whitespace run collapsed to one space
 */
export function normaliseForMatching({ text }: { text: string }): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Whether normalised `text` satisfies an expectation's `requires` — every group hit by any one alternative.
 *
 * @param text the candidate, already normalised
 * @param requires the all-of list of any-of alternative groups
 * @returns true when every group has at least one alternative present
 */
export function satisfiesRequires({
  text,
  requires,
}: {
  text: string;
  requires: readonly (readonly string[])[];
}): boolean {
  return requires.every((group) =>
    group.some((alternative) => text.includes(normaliseForMatching({ text: alternative }))),
  );
}

/** The expectations of one dimension the candidate did NOT meet. */
function unmet<T extends Expectation>({
  text,
  expectations,
}: {
  text: string;
  expectations: readonly T[];
}): readonly T[] {
  return expectations.filter((expectation) => !satisfiesRequires({ requires: expectation.requires, text }));
}

/** The invented-certainty phrasings present in the candidate. */
function certaintyHits({ text, phrases }: { text: string; phrases: readonly string[] }): readonly string[] {
  return phrases.filter((phrase) => text.includes(normaliseForMatching({ text: phrase })));
}

/**
 * The band a mean falls in, before any cap.
 *
 * @returns `top` at exactly 1, then `sound`, `degraded` and `unsound` by the declared thresholds
 */
export function bandForScore({ score }: { score: number }): QualityBand {
  if (score >= 1) {
    return "top";
  }
  if (score >= SOUND_THRESHOLD) {
    return "sound";
  }
  if (score >= DEGRADED_THRESHOLD) {
    return "degraded";
  }
  return "unsound";
}

/**
 * The lower of two bands.
 *
 * @param band the band the mean earned
 * @param ceiling the highest band something else allows
 * @returns whichever of the two is worse
 */
export function capBand({ band, ceiling }: { band: QualityBand; ceiling: QualityBand }): QualityBand {
  if (BAND_ORDER.indexOf(band) <= BAND_ORDER.indexOf(ceiling)) {
    return band;
  }
  return ceiling;
}

/** The dimension rows a case declares, plus the reason lines for everything unmet. */
function tally({ text, answerCase }: { text: string; answerCase: AnswerQualityCase }): {
  readonly dimensions: readonly DimensionScore[];
  readonly reasons: readonly string[];
} {
  const missedClaims = unmet({ expectations: answerCase.claims, text });
  const missedCaveats = unmet({ expectations: answerCase.caveats, text });
  const missedAttributions: readonly Attribution[] = unmet({ expectations: answerCase.attributions, text });
  const hits = certaintyHits({ phrases: answerCase.inventedCertainty, text });
  const declared: readonly DimensionScore[] = [
    { kind: "claims", met: answerCase.claims.length - missedClaims.length, total: answerCase.claims.length },
    {
      kind: "caveats",
      met: answerCase.caveats.length - missedCaveats.length,
      total: answerCase.caveats.length,
    },
    {
      kind: "attributions",
      met: answerCase.attributions.length - missedAttributions.length,
      total: answerCase.attributions.length,
    },
    {
      kind: "certainty",
      met: answerCase.inventedCertainty.length - hits.length,
      total: answerCase.inventedCertainty.length,
    },
  ];
  return {
    dimensions: declared.filter((dimension) => dimension.total > 0),
    reasons: [
      ...missedClaims.map((expectation) => `claim not carried: ${expectation.label}`),
      ...missedCaveats.map((expectation) => `caveat dropped: ${expectation.label}`),
      ...missedAttributions.map(
        (attribution) => `attribution dropped: ${attribution.label} (source: ${attribution.source})`,
      ),
      ...hits.map((phrase) => `invented certainty: "${phrase}"`),
    ],
  };
}

/**
 * Grade one candidate answer against one case's rubric.
 *
 * A case whose dimensions are all empty cannot happen through `loadAnswerQualityCases`, which refuses one —
 * but the scorer is a pure function anybody may call, so it reports 0 with a named reason rather than
 * dividing by zero.
 *
 * @param answerCase the case whose golden the rubric came from
 * @param candidate the answer being graded
 * @returns the grade, its per-dimension tallies, and one named reason per unmet expectation
 */
export function scoreAnswer({
  answerCase,
  candidate,
}: {
  answerCase: AnswerQualityCase;
  candidate: AnswerCandidate;
}): AnswerGrade {
  const text = normaliseForMatching({ text: candidate.text });
  const { dimensions, reasons } = tally({ answerCase, text });
  if (dimensions.length === 0) {
    return {
      band: "unsound",
      candidateLabel: candidate.label,
      caseId: answerCase.id,
      dimensions,
      reasons: [`case ${answerCase.id} declares no expectations — nothing to grade`],
      score: 0,
    };
  }
  const score = dimensions.reduce((sum, dimension) => sum + dimension.met / dimension.total, 0) / dimensions.length;
  const invented = reasons.some((reason) => reason.startsWith("invented certainty:"));
  const earned = bandForScore({ score });
  return {
    band: invented ? capBand({ band: earned, ceiling: "degraded" }) : earned,
    candidateLabel: candidate.label,
    caseId: answerCase.id,
    dimensions,
    reasons,
    score,
  };
}
