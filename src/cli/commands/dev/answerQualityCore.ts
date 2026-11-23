/**
 * The pure half of `slopweaver dev answer-quality`: the flag spec, and the rendering of grades and
 * self-test outcomes into the lines the owner actually reads.
 *
 * The report leads with the named reasons rather than the number, because the number is the part they have not
 * reacted to yet. A grade of 0.667 tells them nothing about whether the instrument is measuring what they
 * meant; "caveat dropped: does not claim the staff member's fault was reproduced" does.
 */

import { err, ok, type Result } from "#lib/result.js";
import { type AnswerQualityError, AnswerQualityErrors } from "../../../eval/answerQuality/errors.js";
import type { AnswerGrade } from "../../../eval/answerQuality/score.js";
import type { PropertyOutcome } from "../../../eval/answerQuality/selftest.js";
import { type FlagSpec, type ParsedFlags, parseFlags } from "../../parseFlags.js";

export const DEV_ANSWER_QUALITY_USAGE =
  "usage: slopweaver dev answer-quality --cases <path> (--candidates <path> | --selftest)\n" +
  "       [--artifact <path>] [--json]\n" +
  "  Grade a candidate answer against a frozen golden's rubric — the claims, caveats and source\n" +
  "  attributions the golden carries — never against its wording. --selftest runs the ordering properties\n" +
  "  that prove the scorer does not reward token overlap, and is what `dev gate` runs as its answer-quality\n" +
  "  check. --artifact writes that run's per-case output as markdown carrying synthetic ids and numbers\n" +
  "  only, so a reviewer who may not see the goldens can still check the claim. Offline and deterministic;\n" +
  "  grading itself gates nothing.";

const STRING_FLAGS = ["cases", "candidates", "artifact"] as const;
const BOOLEAN_FLAGS = ["json", "selftest"] as const;
const FLAGS: FlagSpec = { boolean: BOOLEAN_FLAGS, string: STRING_FLAGS };

/** `--`-prefixed, for the help-truth ratchet. */
export const DEV_ANSWER_QUALITY_FLAG_NAMES: readonly string[] = [...STRING_FLAGS, ...BOOLEAN_FLAGS]
  .map((name) => `--${name}`)
  .toSorted();

/**
 * Parse `dev answer-quality` flags. Exported so the help-truth ratchet probes the REAL parser.
 *
 * @param rest the argv tail after the verb
 * @returns the parsed flags, or the parse errors
 */
export function parseDevAnswerQualityArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlags> {
  return parseFlags({ args: rest, spec: FLAGS });
}

/** What the verb was asked to do, once the flags agree with each other. */
export interface AnswerQualityScope {
  readonly cases: string;
  readonly candidates: string | undefined;
  readonly artifact: string | undefined;
  readonly selftest: boolean;
  readonly json: boolean;
}

/**
 * Turn parsed flags into a scope, refusing the combinations that mean nothing.
 *
 * `--candidates` and `--selftest` are alternatives rather than options: a self-test grades the golden and
 * its own derived variants, so a candidates file passed beside it would be silently ignored.
 *
 * `--artifact` publishes a self-test's per-case output, so it is refused beside `--candidates` for the same
 * reason rather than quietly writing a grading run's table — a grade's reasons are built from expectation
 * labels and could not be redacted the way a property outcome can.
 *
 * @param flags the parsed flags
 * @returns the scope, or the reasons the combination was refused
 */
export function scopeFromFlags({ flags }: { flags: ParsedFlags }): Result<AnswerQualityScope, AnswerQualityError> {
  const cases = flags.values["cases"];
  const rawCandidates = flags.values["candidates"];
  const rawArtifact = flags.values["artifact"];
  const selftest = flags.values["selftest"] === true;
  const json = flags.values["json"] === true;
  const artifact = typeof rawArtifact === "string" && rawArtifact.length > 0 ? rawArtifact : undefined;
  if (typeof cases !== "string" || cases.length === 0) {
    return err(AnswerQualityErrors.casesPathMissing());
  }
  if (typeof rawCandidates === "string" && rawCandidates.length > 0) {
    if (selftest) {
      return err(AnswerQualityErrors.modeConflict());
    }
    if (artifact !== undefined) {
      return err(AnswerQualityErrors.artifactWithoutSelftest());
    }
    return ok({ artifact: undefined, candidates: rawCandidates, cases, json, selftest });
  }
  if (!selftest) {
    return err(AnswerQualityErrors.modeMissing());
  }
  return ok({ artifact, candidates: undefined, cases, json, selftest });
}

/** One grade, rendered reasons-first. */
function gradeLines({ grade }: { grade: AnswerGrade }): readonly string[] {
  const dimensions = grade.dimensions
    .map((dimension) => `${dimension.kind} ${String(dimension.met)}/${String(dimension.total)}`)
    .join(" · ");
  return [
    `${grade.caseId}  ${grade.band.toUpperCase().padEnd(9)} ${grade.score.toFixed(3)}  ${grade.candidateLabel}`,
    `    ${dimensions}`,
    ...grade.reasons.map((reason) => `    - ${reason}`),
  ];
}

/**
 * Render a grading run.
 *
 * @param grades every candidate's grade, in candidate order
 * @returns the lines, each grade's named reasons under it
 */
export function renderGrades({ grades }: { grades: readonly AnswerGrade[] }): readonly string[] {
  return [
    "answer-quality — graded against each case's golden rubric, never against its wording",
    "",
    ...grades.flatMap((grade) => [...gradeLines({ grade }), ""]),
    `${String(grades.length)} candidate(s) graded. Grading gates nothing — the --selftest half is what \`dev gate\` runs.`,
  ];
}

/**
 * Render a self-test run.
 *
 * @param outcomes every property's outcome, in case order
 * @returns the lines, failures and skips spelled out rather than summarised into a count
 */
export function renderSelftest({ outcomes }: { outcomes: readonly PropertyOutcome[] }): readonly string[] {
  const failed = outcomes.filter((outcome) => outcome.state === "fail");
  const skipped = outcomes.filter((outcome) => outcome.state === "skip");
  return [
    "answer-quality selftest — the ordering properties that prove the scorer ignores token overlap",
    "",
    ...outcomes.map((outcome) => `  ${outcome.state.toUpperCase().padEnd(4)} ${outcome.caseId}  ${outcome.property}`),
    "",
    ...failed.map((outcome) => `FAIL ${outcome.caseId} · ${outcome.property}: ${outcome.detail}`),
    ...skipped.map((outcome) => `skip ${outcome.caseId} · ${outcome.property}: ${outcome.detail}`),
    `${String(outcomes.length - failed.length - skipped.length)} passed, ${String(failed.length)} failed, ${String(skipped.length)} skipped`,
  ];
}
