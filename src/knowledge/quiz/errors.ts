/**
 * The quiz ledger's own typed failure union.
 *
 * Separate from `../voice/errors.ts` and from `../errors.ts` on `.claude/rules/error-handling.md`'s
 * instruction — no shared base type across domains, ever. A proposal can have a quote its unit does not
 * contain; a quiz can have a sweep that already asked something else; neither vocabulary has anything to
 * say about the other, and a union spanning both would force every caller to branch on codes that cannot
 * reach it.
 *
 * A union rather than `readonly string[]` because these kinds are BRANCHED ON: `knowledge quiz` returns the
 * EXISTING question on a sweep that already has one and refuses nothing, while the same verb exits non-zero
 * when the ledger will not read. Conflating them would make a re-run of a sweep look like a failure.
 */

/** A field is absent, empty, too long, or outside its closed vocabulary. */
export interface QuizFieldError {
  readonly code: "QUIZ_FIELD";
  readonly message: string;
  readonly field: string;
}

/** No question carries that id. */
export interface QuizNotFoundError {
  readonly code: "QUIZ_NOT_FOUND";
  readonly message: string;
  readonly quizId: string;
}

/** The question has already been answered, and the queue never overwrites what they said. */
export interface QuizAlreadyAnsweredError {
  readonly code: "QUIZ_ALREADY_ANSWERED";
  readonly message: string;
  readonly quizId: string;
}

/** A stored ledger line could not be decoded. Carries the line number so the file can be inspected. */
export interface QuizCorruptError {
  readonly code: "QUIZ_CORRUPT";
  readonly message: string;
  readonly lineNumber: number;
}

/** The ledger could not be read or appended to. Never conflated with an EMPTY ledger. */
export interface QuizUnreadableError {
  readonly code: "QUIZ_UNREADABLE";
  readonly message: string;
  readonly path: string;
  readonly cause?: unknown;
}

/** Every way this domain fails. */
export type QuizError =
  QuizFieldError | QuizNotFoundError | QuizAlreadyAnsweredError | QuizCorruptError | QuizUnreadableError;

/** Constructors for {@link QuizError}. The only place a quiz error is built. */
export const QuizErrors = {
  field: ({ field, why }: { field: string; why: string }): QuizFieldError => ({
    code: "QUIZ_FIELD",
    field,
    message: `${field} ${why}`,
  }),
  notFound: ({ quizId }: { quizId: string }): QuizNotFoundError => ({
    code: "QUIZ_NOT_FOUND",
    message:
      `the ledger holds no question ${quizId}. Read the id off the briefing's quiz block, or run ` +
      "`slopweaver knowledge quiz --sweep <tick-id>` to cut this sweep's question first",
    quizId,
  }),
  alreadyAnswered: ({ quizId }: { quizId: string }): QuizAlreadyAnsweredError => ({
    code: "QUIZ_ALREADY_ANSWERED",
    message:
      `question ${quizId} has already been answered, and what they said is never overwritten. The next sweep ` +
      "asks the next question",
    quizId,
  }),
  corrupt: ({ lineNumber }: { lineNumber: number }): QuizCorruptError => ({
    code: "QUIZ_CORRUPT",
    lineNumber,
    message: `line ${String(lineNumber)} of the quiz ledger is not a decodable row`,
  }),
  unreadable: ({ path, cause }: { path: string; cause: unknown }): QuizUnreadableError => ({
    cause,
    code: "QUIZ_UNREADABLE",
    message: `could not read the quiz ledger at ${path} — refusing rather than reporting it empty`,
    path,
  }),
} as const;
