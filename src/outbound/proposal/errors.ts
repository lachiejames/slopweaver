/**
 * The failure kinds reading a proposal intake record (`./intakeStore.ts`) can produce, as a typed
 * discriminated union scoped to this directory — no shared base type with any other domain
 * (`.claude/rules/error-handling.md`).
 *
 * Callers branch on these rather than on text: an id that could never name a file is the caller's typo, a
 * record that is absent is one to seed, and one that is present but malformed must never be overwritten.
 */

/** The file parsed, but carries no string `id` or `brief`, so it is not an intake at all. */
export interface IntakeMissingIdOrBriefError {
  readonly code: "INTAKE_MISSING_ID_OR_BRIEF";
  readonly message: string;
}

/** The record has no `questions` array, so nothing can say whether it may advance. */
export interface IntakeNoQuestionsError {
  readonly code: "INTAKE_NO_QUESTIONS";
  readonly message: string;
  readonly id: string;
}

/** One question in the record is not a `{ key, question }` pair; refused rather than dropped. */
export interface IntakeMalformedQuestionError {
  readonly code: "INTAKE_MALFORMED_QUESTION";
  readonly message: string;
  readonly id: string;
}

/** The id is not lowercase alphanumeric-with-dashes, and it would reach a filename. */
export interface IntakeIdInvalidError {
  readonly code: "INTAKE_ID_INVALID";
  readonly message: string;
  readonly id: string;
}

/** No record exists at the id's path. */
export interface IntakeNotFoundError {
  readonly code: "INTAKE_NOT_FOUND";
  readonly message: string;
  readonly id: string;
  /** Where the record was looked for. */
  readonly path: string;
}

/** Reading or parsing the record's file threw. */
export interface IntakeUnreadableError {
  readonly code: "INTAKE_UNREADABLE";
  readonly message: string;
  readonly id: string;
  /** The thrown error's own message, or `unknown` when what was thrown was not an `Error`. */
  readonly detail: string;
}

/**
 * The record's published address is malformed, or it carries both the current `address` and a legacy Notion
 * page field. Refused rather than read either way: a wrong address is exactly the input that makes the next
 * publish overwrite somebody else's page or create a duplicate.
 */
export interface IntakeAddressInvalidError {
  readonly code: "INTAKE_ADDRESS_INVALID";
  readonly message: string;
  readonly id: string;
}

/** Every way narrowing parsed JSON into an intake can fail. */
export type IntakeParseError =
  IntakeMissingIdOrBriefError | IntakeNoQuestionsError | IntakeMalformedQuestionError | IntakeAddressInvalidError;

/** Every way reading one intake record can fail. */
export type ProposalIntakeError = IntakeParseError | IntakeIdInvalidError | IntakeNotFoundError | IntakeUnreadableError;

/** Construct each intake failure the same way the real code does. */
export const ProposalIntakeErrors = {
  addressInvalid: ({ id, why }: { id: string; why: string }): IntakeAddressInvalidError => ({
    code: "INTAKE_ADDRESS_INVALID",
    id,
    message: `intake ${id} has an unreadable published address (${why}); refusing rather than guessing where it published`,
  }),
  idInvalid: ({ id }: { id: string }): IntakeIdInvalidError => ({
    code: "INTAKE_ID_INVALID",
    id,
    message: `${JSON.stringify(id)} is not a valid intake id, and it would reach a filename`,
  }),
  malformedQuestion: ({ id }: { id: string }): IntakeMalformedQuestionError => ({
    code: "INTAKE_MALFORMED_QUESTION",
    id,
    message: `intake ${id} has a malformed question; refusing rather than dropping it`,
  }),
  missingIdOrBrief: (): IntakeMissingIdOrBriefError => ({
    code: "INTAKE_MISSING_ID_OR_BRIEF",
    message: "the intake file is missing its id or brief",
  }),
  noQuestions: ({ id }: { id: string }): IntakeNoQuestionsError => ({
    code: "INTAKE_NO_QUESTIONS",
    id,
    message: `intake ${id} has no questions array, so nothing can say whether it may advance`,
  }),
  notFound: ({ id, path }: { id: string; path: string }): IntakeNotFoundError => ({
    code: "INTAKE_NOT_FOUND",
    id,
    message: `no intake found for ${id} (looked at ${path})`,
    path,
  }),
  unreadable: ({ id, cause }: { id: string; cause: unknown }): IntakeUnreadableError => {
    const detail = cause instanceof Error ? cause.message : "unknown";
    return { code: "INTAKE_UNREADABLE", detail, id, message: `intake ${id} could not be read: ${detail}` };
  },
} as const;
