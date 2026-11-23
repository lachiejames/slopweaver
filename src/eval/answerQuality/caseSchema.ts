/**
 * The typed shape of an answer-quality case file, and its loader.
 *
 * ## What a case is, and what it is not
 *
 * A case pairs one of the frozen eval set's PROPOSED GOLDEN answers with a rubric derived from it: the
 * claims it asserts, the caveats it carries, the sources it attributes to, and the certainty it does NOT
 * claim. `src/eval/answerQuality/score.ts` grades a candidate answer against that rubric.
 *
 * This is the OFFLINE eval lane. It is not `src/admit/answerQualityGate.ts`, which judges an outbound form
 * before it is sent — the two share a name and nothing else, and confusing them is the mis-description the
 * handover doc this lane came from names explicitly.
 *
 * ## The rubric is authored by a session reading the golden, and then FROZEN
 *
 * Nothing here calls a model. Deciding what a golden claims is judgement, and judgement is done once, in a
 * visible session, and written down — after which a grade is reproducible byte for byte. Grading a model's
 * output with a second live model call is the shape `eval/judgementAssertion.ts` already refuses, because it
 * makes a red result unreproducible.
 *
 * ## Why `requires` has the shape it has
 *
 * `requires` is an ALL-OF list of ANY-OF groups. Every group must hit; within a group any alternative will
 * do. That is the one shape that lets a paraphrase satisfy an expectation while still refusing an answer
 * that dropped the concept — which is the whole point of the instrument, since a scorer that rewarded
 * surface overlap would grade a caveat-stripped copy of the golden top.
 *
 * ## The real rubrics are NOT committed
 *
 * The frozen set's goldens name real people and carry sensitive context, so rubrics derived from them live at
 * `$SLOPWEAVER_HOME/eval/answer-quality-cases.json`. `eval/answer-quality.fixture.json` is the synthetic
 * file that ships, and it is what the self-test probe runs on.
 */

import { z } from "zod";
import { err, ok, type Result } from "#lib/result.js";
import { safeJsonParse } from "#lib/safeJson.js";

const requiresSchema = z.array(z.array(z.string().min(1)).min(1)).min(1);

const expectationSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  requires: requiresSchema,
});

const attributionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  requires: requiresSchema,
  source: z.string().min(1),
});

const caseSchema = z.object({
  attributions: z.array(attributionSchema).default([]),
  caveats: z.array(expectationSchema).default([]),
  claims: z.array(expectationSchema).default([]),
  goldenText: z.string().min(1),
  id: z.string().min(1),
  inventedCertainty: z.array(z.string().min(1)).default([]),
  paraphrase: z.string().min(1).optional(),
});

const caseFileSchema = z.object({
  cases: z.array(caseSchema).min(1),
  schemaVersion: z.literal(1),
});

const candidateSchema = z.object({
  caseId: z.string().min(1),
  label: z.string().min(1),
  text: z.string(),
});

const candidateFileSchema = z.object({
  candidates: z.array(candidateSchema).min(1),
  schemaVersion: z.literal(1),
});

/** One expectation the golden carries: a label a reader recognises, and the anchors that witness it. */
export interface Expectation {
  readonly id: string;
  readonly label: string;
  readonly requires: readonly (readonly string[])[];
}

/** An expectation whose point is WHERE the claim came from — the Notion-vs-self half of the dimension. */
export interface Attribution extends Expectation {
  readonly source: string;
}

/** One golden answer and the rubric derived from it. */
export interface AnswerQualityCase {
  readonly id: string;
  readonly goldenText: string;
  readonly paraphrase?: string | undefined;
  readonly claims: readonly Expectation[];
  readonly caveats: readonly Expectation[];
  readonly attributions: readonly Attribution[];
  readonly inventedCertainty: readonly string[];
}

/** One answer to be graded against a case. */
export interface AnswerCandidate {
  readonly caseId: string;
  readonly label: string;
  readonly text: string;
}

/** A file that is not JSON at all is a reason to report, never a stack trace out of the verb. */
function parseJson({ raw, label }: { raw: string; label: string }): Result<unknown> {
  try {
    return ok(safeJsonParse({ label, text: raw }));
  } catch (error) {
    const detail = error instanceof Error ? error.message : "not valid JSON";
    return err([`${label}: ${detail}`]);
  }
}

/**
 * Whether a case declares anything at all that could be graded.
 *
 * A case with no claims, no caveats and no attributions is not a strict rubric — it is a golden that carries
 * no gradeable answer, and two of the frozen set's ten mined goldens are exactly that (one is a follow-up
 * QUESTION, one discusses a different subject from its own thread). Refusing them at load is what surfaces
 * them, rather than scoring every candidate 1.0 over an empty rubric and calling the lane green.
 *
 * @returns true when the case declares at least one claim, caveat or attribution
 */
export function isGradeable({ answerCase }: { answerCase: AnswerQualityCase }): boolean {
  return answerCase.claims.length + answerCase.caveats.length + answerCase.attributions.length > 0;
}

/**
 * Parse and validate an answer-quality case file.
 *
 * @param raw the file's raw JSON text
 * @param label what to call the file in an error message
 * @returns every case in file order, or the reasons the file was refused
 */
export function loadAnswerQualityCases({
  raw,
  label,
}: {
  raw: string;
  label: string;
}): Result<readonly AnswerQualityCase[]> {
  const json = parseJson({ label, raw });
  if (json.isErr()) {
    return err(json.error);
  }
  const parsed = caseFileSchema.safeParse(json.value);
  if (!parsed.success) {
    return err(parsed.error.issues.map((issue) => `${label}: ${issue.path.join(".")} ${issue.message}`));
  }
  const cases: readonly AnswerQualityCase[] = parsed.data.cases;
  const ungradeable = cases.filter((answerCase) => !isGradeable({ answerCase }));
  if (ungradeable.length > 0) {
    return err(
      ungradeable.map(
        (answerCase) =>
          `${label}: case ${answerCase.id} declares no claim, caveat or attribution — its golden carries no gradeable answer`,
      ),
    );
  }
  return ok(cases);
}

/**
 * Parse and validate a candidate-answers file.
 *
 * @param raw the file's raw JSON text
 * @param label what to call the file in an error message
 * @returns every candidate in file order, or the reasons the file was refused
 */
export function loadAnswerCandidates({
  raw,
  label,
}: {
  raw: string;
  label: string;
}): Result<readonly AnswerCandidate[]> {
  const json = parseJson({ label, raw });
  if (json.isErr()) {
    return err(json.error);
  }
  const parsed = candidateFileSchema.safeParse(json.value);
  if (!parsed.success) {
    return err(parsed.error.issues.map((issue) => `${label}: ${issue.path.join(".")} ${issue.message}`));
  }
  return ok(parsed.data.candidates);
}
