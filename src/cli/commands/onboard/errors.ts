/**
 * The typed failures the `onboard` verbs author themselves: a required flag not given, a flag given a value
 * it does not accept, the several refusals `onboard plan` collects at once, and an interactive answer that
 * was refused or re-asked until the verb gave up.
 *
 * A union of its own per `.claude/rules/error-handling.md`, scoped to this verb directory. The flag
 * tokeniser's refusals, the backfill parser's and each question's own parser's are not re-authored here:
 * they arrive as their own string lists and ride as `reasons`, printed as they came, one line each — which
 * is what {@link onboardErrorLines} gives back.
 */

/** A flag the verb cannot run without was not given, or was given blank. */
export interface OnboardFlagMissingError {
  readonly code: "FLAG_MISSING";
  readonly message: string;
  readonly flag: string;
}

/** A flag was given a value it does not accept; `flag` names it and `got` is what arrived. */
export interface OnboardInvalidFlagValueError {
  readonly code: "INVALID_FLAG_VALUE";
  readonly message: string;
  readonly flag: string;
  readonly got: string;
}

/** `--sources` named one or more sources outside the onboarding set; one refusal per unknown source. */
export interface OnboardSourcesUnrecognisedError {
  readonly code: "SOURCES_UNRECOGNISED";
  readonly message: string;
  readonly refusals: readonly OnboardInvalidFlagValueError[];
}

/** `onboard plan` refused one or more flags at once, so the caller can fix them together; one line each. */
export interface OnboardPlanRefusedError {
  readonly code: "PLAN_REFUSED";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** Every flag of `onboard plan` validated and the plan still could not be assembled — an invariant breach. */
export interface OnboardPlanInvalidError {
  readonly code: "PLAN_INVALID";
  readonly message: string;
}

/** A flagged or defaulted answer was refused by its question's own parser; `reasons` is that parser's list. */
export interface OnboardAnswerRefusedError {
  readonly code: "ANSWER_REFUSED";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** Every interactive attempt at one question was refused, so the verb stopped asking. */
export interface OnboardAnswersExhaustedError {
  readonly code: "ANSWERS_EXHAUSTED";
  readonly message: string;
  readonly label: string;
  readonly attempts: number;
}

/** Every failure this verb directory authors. */
export type OnboardError =
  | OnboardFlagMissingError
  | OnboardInvalidFlagValueError
  | OnboardSourcesUnrecognisedError
  | OnboardPlanRefusedError
  | OnboardPlanInvalidError
  | OnboardAnswerRefusedError
  | OnboardAnswersExhaustedError;

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const OnboardErrors = {
  answerRefused: ({ reasons }: { reasons: readonly string[] }): OnboardAnswerRefusedError => ({
    code: "ANSWER_REFUSED",
    message: reasons.join("; "),
    reasons,
  }),
  answersExhausted: ({ label, attempts }: { label: string; attempts: number }): OnboardAnswersExhaustedError => ({
    attempts,
    code: "ANSWERS_EXHAUSTED",
    label,
    message: `gave up on "${label}" after ${String(attempts)} invalid answers`,
  }),
  fileFindingsNotNonNegative: ({ got }: { got: string }): OnboardInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag: "--file-findings",
    got,
    message: "--file-findings must be a non-negative integer",
  }),
  flagMissing: ({ flag }: { flag: string }): OnboardFlagMissingError => ({
    code: "FLAG_MISSING",
    flag,
    message: `${flag} is required`,
  }),
  orgNotSlug: ({ got }: { got: string }): OnboardInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag: "--github-org",
    got,
    message: "--github-org must be an organisation slug",
  }),
  planInvalid: (): OnboardPlanInvalidError => ({
    code: "PLAN_INVALID",
    message: "invalid onboarding plan",
  }),
  planRefused: ({ reasons }: { reasons: readonly string[] }): OnboardPlanRefusedError => ({
    code: "PLAN_REFUSED",
    message: reasons.join("; "),
    reasons,
  }),
  repoNotSlug: ({ got }: { got: string }): OnboardInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag: "--repo",
    got,
    message: "--repo must be an owner/repo slug",
  }),
  runMissing: (): OnboardFlagMissingError => ({
    code: "FLAG_MISSING",
    flag: "--run",
    message: "--run is required (or pass --schema to print the run artifact shape)",
  }),
  sourceUnrecognised: ({
    got,
    expected,
  }: {
    got: string;
    expected: readonly string[];
  }): OnboardInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag: "--sources",
    got,
    message: `unrecognised source: ${got} (expected ${expected.join(", ")})`,
  }),
  sourcesEmpty: ({ got }: { got: string }): OnboardInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag: "--sources",
    got,
    message: "--sources must name at least one connected source",
  }),
  sourcesUnrecognised: ({
    refusals,
  }: {
    refusals: readonly OnboardInvalidFlagValueError[];
  }): OnboardSourcesUnrecognisedError => ({
    code: "SOURCES_UNRECOGNISED",
    message: refusals.map((refusal) => refusal.message).join("; "),
    refusals,
  }),
} as const;

/**
 * The lines an {@link OnboardError} prints, one per problem. A list-carrying variant gives each entry its own line, as the
 * `readonly string[]` it replaced did, rather than the joined `message` a single-line display reads.
 *
 * @returns one line per problem, in the order they were found
 */
export function onboardErrorLines({ error }: { error: OnboardError }): readonly string[] {
  if (error.code === "SOURCES_UNRECOGNISED") {
    return error.refusals.map((refusal) => refusal.message);
  }
  if (error.code === "PLAN_REFUSED" || error.code === "ANSWER_REFUSED") {
    return error.reasons;
  }
  return [error.message];
}
