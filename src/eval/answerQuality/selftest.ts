/**
 * The self-test — the ordering properties that make "this scorer does not reward token overlap" a thing the
 * instrument PROVES about itself rather than a claim in its own documentation.
 *
 * Five properties run over every case:
 *
 * 1. **The verbatim golden scores `top`.** The floor. A rubric its own golden fails is a wrong rubric.
 * 2. **The paraphrase really is one** — its token overlap with the golden is below
 *    {@link PARAPHRASE_MAX_OVERLAP}. Without this the next property proves nothing: an author who writes
 *    both the anchors and the "paraphrase" can produce a near-copy and call it a restatement, which is
 *    precisely the good faith this property exists to remove from the argument.
 * 3. **That paraphrase also scores `top`.** Different words, same substance, same grade.
 * 4. **Every anchor is droppable** — `ineffectiveDrops` is empty, so each caveat and attribution names
 *    something specific enough that deleting its sentences removes it.
 * 5. **Every degraded variant grades STRICTLY DOWN**, and the invented-certainty one is additionally capped
 *    at `degraded`. Properties 4 and 5 together are the pair no overlap scorer can pass: the dropped-caveat
 *    variant keeps nearly every word of the golden and must fall, and the certainty variant ADDS words — its
 *    overlap rises while its grade drops.
 *
 * A case with no `paraphrase` skips properties 2 and 3 and is reported as skipped rather than passed, so an
 * unexercised case never reads as a green one.
 *
 * ## Every outcome is produced twice: once for a reader, once for anything published
 *
 * `property` and `detail` are prose and may quote the golden — a failing detail joins `grade.reasons`, which
 * are built from expectation labels. `redacted` ({@link RedactedFacts}) is the same outcome as closed-set
 * tokens, synthetic ids and numbers, and it exists because the per-case output of a run over the REAL ten
 * goldens has to be readable by a reviewer who may not see those goldens. Before this split the degradation
 * property was named `degrades-down · <variant.label>`, so a golden-derived caveat reached the property name
 * on a PASS: the local sample at `$SLOPWEAVER_HOME/eval/answer-quality-sample.md` carries exactly that and
 * can never be committed. `src/eval/answerQuality/artifact.ts` reads `redacted` and nothing else.
 */

import type { AnswerQualityCase } from "./caseSchema.js";
import { type DegradationKind, degradeGolden, ineffectiveDrops } from "./degrade.js";
import { type AnswerGrade, type QualityBand, scoreAnswer } from "./score.js";

/**
 * The most token overlap with the golden a `paraphrase` may have and still count as one.
 *
 * Jaccard over whole token sets, stop words included. 0.5 is a loose bound on purpose — a genuine
 * restatement of a technical answer shares its nouns, and a bound tight enough to be impressive would only
 * force authors to write unnatural prose. What matters is that it is a MEASUREMENT: a near-copy labelled a
 * paraphrase sits well above it.
 */
export const PARAPHRASE_MAX_OVERLAP = 0.5;

/**
 * The five property families, as a closed union rather than free text.
 *
 * `property` on an outcome is a human-facing STRING and the degradation ones interpolate an id into it. This
 * is the machine-facing half, and being a union is the point: `src/eval/answerQuality/artifact.ts` publishes
 * a family and can therefore never publish a sentence.
 */
export type PropertyFamily =
  | "verbatim-golden-scores-top"
  | "paraphrase-is-measurably-a-paraphrase"
  | "paraphrase-scores-top"
  | "anchors-are-droppable"
  | "degrades-down";

/** The numbers a property can report, keyed by a closed set so no free-text key reaches an artifact. */
export type MetricName = "score" | "golden-score" | "token-overlap" | "overlap-bound" | "ineffective-drops";

/**
 * One number a property measured.
 *
 * @internal — the element type of {@link RedactedFacts.metrics}; only `artifact.ts` names it, to render a row.
 */
export interface RedactedMetric {
  readonly name: MetricName;
  readonly value: number;
}

/**
 * Which expectation a degradation property targeted — a closed-set kind and a synthetic id.
 *
 * @internal — the field type of {@link RedactedFacts.target}; nothing outside this file names it.
 */
export interface RedactedTarget {
  readonly kind: DegradationKind;
  readonly expectationId: string;
}

/**
 * Everything about one outcome that carries no golden text, by CONSTRUCTION rather than by filtering.
 *
 * Every string in here is either a closed union the compiler owns or a synthetic id out of the case file. So
 * an artifact builder that reads only this — plus `caseId` and `state` — cannot leak a golden's words even if
 * it tries, which is why the redaction lives in the type instead of in a scan over rendered bytes. A scan has
 * no pattern for "this English sentence is a caveat mined from a sensitive thread"; a union has no room for
 * one. The two free strings left over, `caseId` and `target.expectationId`, are the case file's OWN ids, and
 * `src/eval/answerQuality/artifact.ts` publishes a label it mints rather than either of them.
 *
 * @internal — the field type of {@link PropertyOutcome.redacted}; the artifact builder declares the narrower
 *   shape it reads, so nothing outside this file names this one.
 */
export interface RedactedFacts {
  readonly family: PropertyFamily;
  readonly target?: RedactedTarget | undefined;
  readonly band?: QualityBand | undefined;
  readonly metrics: readonly RedactedMetric[];
}

/**
 * One property's outcome for one case.
 *
 * `property` and `detail` are for a reader at a terminal and MAY carry a golden's own words — a failing
 * detail joins `grade.reasons`, which are built from expectation labels. `redacted` is the same outcome with
 * nothing but closed-set tokens, synthetic ids and numbers, and it is the only half anything published is
 * allowed to read.
 */
export interface PropertyOutcome {
  readonly caseId: string;
  readonly property: string;
  readonly state: "pass" | "fail" | "skip";
  readonly detail: string;
  readonly redacted: RedactedFacts;
}

/** The lowercase alphanumeric tokens of a text, deduplicated. */
function tokenSet({ text }: { text: string }): ReadonlySet<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 0),
  );
}

/**
 * Jaccard overlap of two texts' token sets — the measure that decides whether a paraphrase is one.
 *
 * @param left one text
 * @param right the other
 * @returns the shared fraction of the two token sets, 0 when both are empty
 */
export function tokenOverlap({ left, right }: { left: string; right: string }): number {
  const a = tokenSet({ text: left });
  const b = tokenSet({ text: right });
  const shared = [...a].filter((token) => b.has(token)).length;
  const union = new Set([...a, ...b]).size;
  if (union === 0) {
    return 0;
  }
  return shared / union;
}

/** Score one text against a case, under a label that names what the text is. */
function gradeOf({
  answerCase,
  label,
  text,
}: {
  answerCase: AnswerQualityCase;
  label: string;
  text: string;
}): AnswerGrade {
  return scoreAnswer({ answerCase, candidate: { caseId: answerCase.id, label, text } });
}

/** Property 1 — the golden must grade top against its own rubric. */
function verbatimOutcome({ answerCase }: { answerCase: AnswerQualityCase }): PropertyOutcome {
  const grade = gradeOf({ answerCase, label: "golden", text: answerCase.goldenText });
  const ok = grade.band === "top";
  return {
    caseId: answerCase.id,
    detail: ok
      ? "golden scores top against its own rubric"
      : `golden scored ${grade.score.toFixed(3)} (${grade.band}) — ${grade.reasons.join("; ")}`,
    property: "verbatim-golden-scores-top",
    redacted: {
      band: grade.band,
      family: "verbatim-golden-scores-top",
      metrics: [{ name: "score", value: grade.score }],
    },
    state: ok ? "pass" : "fail",
  };
}

/** Properties 2 and 3 — the paraphrase is measurably one, and it grades top too. */
function paraphraseOutcomes({ answerCase }: { answerCase: AnswerQualityCase }): readonly PropertyOutcome[] {
  const { paraphrase } = answerCase;
  if (paraphrase === undefined) {
    const detail = "case declares no paraphrase — the anti-overlap property is NOT exercised here";
    return [
      {
        caseId: answerCase.id,
        detail,
        property: "paraphrase-is-measurably-a-paraphrase",
        redacted: { family: "paraphrase-is-measurably-a-paraphrase", metrics: [] },
        state: "skip",
      },
      {
        caseId: answerCase.id,
        detail,
        property: "paraphrase-scores-top",
        redacted: { family: "paraphrase-scores-top", metrics: [] },
        state: "skip",
      },
    ];
  }
  const overlap = tokenOverlap({ left: answerCase.goldenText, right: paraphrase });
  const grade = gradeOf({ answerCase, label: "paraphrase", text: paraphrase });
  const topped = grade.band === "top";
  return [
    {
      caseId: answerCase.id,
      detail: `token overlap with the golden is ${overlap.toFixed(3)} (bound ${String(PARAPHRASE_MAX_OVERLAP)})`,
      property: "paraphrase-is-measurably-a-paraphrase",
      redacted: {
        family: "paraphrase-is-measurably-a-paraphrase",
        metrics: [
          { name: "token-overlap", value: overlap },
          { name: "overlap-bound", value: PARAPHRASE_MAX_OVERLAP },
        ],
      },
      state: overlap < PARAPHRASE_MAX_OVERLAP ? "pass" : "fail",
    },
    {
      caseId: answerCase.id,
      detail: topped
        ? "a restatement in different words scores top, so the grade is not surface similarity"
        : `paraphrase scored ${grade.score.toFixed(3)} (${grade.band}) — ${grade.reasons.join("; ")}`,
      property: "paraphrase-scores-top",
      redacted: {
        band: grade.band,
        family: "paraphrase-scores-top",
        metrics: [{ name: "score", value: grade.score }],
      },
      state: topped ? "pass" : "fail",
    },
  ];
}

/** Property 4 — every caveat and attribution names something a sentence deletion can actually remove. */
function droppableOutcome({ answerCase }: { answerCase: AnswerQualityCase }): PropertyOutcome {
  const stuck = ineffectiveDrops({ answerCase });
  return {
    caseId: answerCase.id,
    detail:
      stuck.length === 0
        ? "every caveat and attribution anchor is specific enough to drop"
        : `anchors survive their own sentences being deleted — too generic to measure: ${stuck.join("; ")}`,
    property: "anchors-are-droppable",
    redacted: {
      family: "anchors-are-droppable",
      metrics: [{ name: "ineffective-drops", value: stuck.length }],
    },
    state: stuck.length === 0 ? "pass" : "fail",
  };
}

/** Property 5 — each degraded variant must score strictly below the golden, certainty capped at degraded. */
function degradationOutcomes({ answerCase }: { answerCase: AnswerQualityCase }): readonly PropertyOutcome[] {
  const goldenScore = gradeOf({ answerCase, label: "golden", text: answerCase.goldenText }).score;
  return degradeGolden({ answerCase }).map((variant) => {
    const grade = gradeOf({ answerCase, label: variant.label, text: variant.text });
    const fell = grade.score < goldenScore;
    const capped = variant.kind !== "certainty-invented" || grade.band === "degraded" || grade.band === "unsound";
    return {
      caseId: answerCase.id,
      detail:
        fell && capped
          ? `graded down to ${grade.score.toFixed(3)} (${grade.band}) from ${goldenScore.toFixed(3)} · ${variant.label}`
          : `scored ${grade.score.toFixed(3)} (${grade.band}) against the golden's ${goldenScore.toFixed(3)} · ${variant.label}`,
      property: `degrades-down · ${variant.kind} · ${variant.expectationId}`,
      redacted: {
        band: grade.band,
        family: "degrades-down",
        metrics: [
          { name: "score", value: grade.score },
          { name: "golden-score", value: goldenScore },
        ],
        target: { expectationId: variant.expectationId, kind: variant.kind },
      },
      state: fell && capped ? "pass" : "fail",
    };
  });
}

/**
 * Run every ordering property over every case.
 *
 * @param cases the loaded rubrics
 * @returns one outcome per property per case, in case order
 */
export function runSelftest({ cases }: { cases: readonly AnswerQualityCase[] }): readonly PropertyOutcome[] {
  return cases.flatMap((answerCase) => [
    verbatimOutcome({ answerCase }),
    ...paraphraseOutcomes({ answerCase }),
    droppableOutcome({ answerCase }),
    ...degradationOutcomes({ answerCase }),
  ]);
}

/**
 * Whether any property failed.
 *
 * @param outcomes the whole self-test run
 * @returns true when at least one outcome failed — a skip is not a failure, and never a pass either
 */
export function selftestFailed({ outcomes }: { outcomes: readonly PropertyOutcome[] }): boolean {
  return outcomes.some((outcome) => outcome.state === "fail");
}
