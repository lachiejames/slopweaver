/**
 * The answer-quality lane's own error union — the failures that stop a grading run before any grade exists.
 *
 * Every variant here stops a run rather than describing one: a flag missing, two flags that cannot both be
 * meant, a file that is not there, a candidate naming a case the rubric file does not hold, or a redacted
 * artifact that could not be published safely. None of them is a grade; a candidate that scores badly is an
 * `AnswerGrade`, not an error, and conflating the two would make "this answer was poor" indistinguishable
 * from "the run never happened".
 *
 * `ARTIFACT_UNHYGIENIC` is the only one that fires AFTER a run succeeded — the properties ran, and it is the
 * publishing of their per-case output that was refused. It names the leak classes it hit (`labels`) because a
 * redaction that silently dropped something would leave a reviewer unable to tell. `ARTIFACT_WITHOUT_SELFTEST`
 * is an ordinary flag refusal and fires before anything is read.
 *
 * **Why a union and not the default `readonly string[]`.** `.claude/rules/error-handling.md` leaves
 * display-only failures on the plain shape, and these are display-only today. The `error-shape-threshold`
 * gate decided otherwise: `src/cli/commands/dev/` sat exactly at its four-shape threshold, and this lane's
 * four new messages pushed it past. Routing them through a union takes those four sites out of the count —
 * a union site is not a shape — and leaves the directory's pre-existing four where they were. The gate made
 * the call, which is the way that rule is written to work.
 */

/** `--cases <path>` was not given, so there is no rubric to grade against. */
export interface CasesPathMissingError {
  readonly code: "CASES_PATH_MISSING";
  readonly message: string;
}

/** Both `--candidates` and `--selftest` were given; they are alternatives, and one would be ignored. */
export interface ModeConflictError {
  readonly code: "MODE_CONFLICT";
  readonly message: string;
}

/** Neither `--candidates` nor `--selftest` was given, so the verb was asked to do nothing. */
export interface ModeMissingError {
  readonly code: "MODE_MISSING";
  readonly message: string;
}

/** A path the run needs could not be read. */
export interface FileUnreadableError {
  readonly code: "FILE_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** A candidate names a `caseId` no case in the rubric file carries. */
export interface UnknownCaseError {
  readonly code: "UNKNOWN_CASE";
  readonly message: string;
  readonly caseId: string;
  readonly candidateLabel: string;
}

/** The artifact was built but the hygiene scanner found something in the rendered bytes. */
export interface ArtifactUnhygienicError {
  readonly code: "ARTIFACT_UNHYGIENIC";
  readonly message: string;
  readonly labels: readonly string[];
}

/** `--artifact` was passed without `--selftest`, so there is no per-case run to publish. */
export interface ArtifactWithoutSelftestError {
  readonly code: "ARTIFACT_WITHOUT_SELFTEST";
  readonly message: string;
}

/** Every way an answer-quality run can be refused before it grades anything. */
export type AnswerQualityError =
  | CasesPathMissingError
  | ModeConflictError
  | ModeMissingError
  | FileUnreadableError
  | UnknownCaseError
  | ArtifactUnhygienicError
  | ArtifactWithoutSelftestError;

/** The one place an {@link AnswerQualityError} is built, so a test constructs what the real code does. */
export const AnswerQualityErrors = {
  artifactUnhygienic: ({ labels }: { labels: readonly string[] }): ArtifactUnhygienicError => ({
    code: "ARTIFACT_UNHYGIENIC",
    labels,
    message: `the redacted artifact was not written — the hygiene scanner hit ${labels.join(", ")} in its own rendered bytes`,
  }),
  artifactWithoutSelftest: (): ArtifactWithoutSelftestError => ({
    code: "ARTIFACT_WITHOUT_SELFTEST",
    message: "--artifact publishes a per-case self-test run — pass --selftest with it",
  }),
  casesPathMissing: (): CasesPathMissingError => ({
    code: "CASES_PATH_MISSING",
    message: "--cases <path> is required",
  }),
  fileUnreadable: ({ path }: { path: string }): FileUnreadableError => ({
    code: "FILE_UNREADABLE",
    message: `cannot read ${path}`,
    path,
  }),
  modeConflict: (): ModeConflictError => ({
    code: "MODE_CONFLICT",
    message: "--candidates and --selftest are alternatives — pass one",
  }),
  modeMissing: (): ModeMissingError => ({
    code: "MODE_MISSING",
    message: "pass --candidates <path> to grade answers, or --selftest to check the scorer's properties",
  }),
  unknownCase: ({ caseId, candidateLabel }: { caseId: string; candidateLabel: string }): UnknownCaseError => ({
    candidateLabel,
    caseId,
    code: "UNKNOWN_CASE",
    message: `candidate ${candidateLabel} names unknown case ${caseId}`,
  }),
} as const;
