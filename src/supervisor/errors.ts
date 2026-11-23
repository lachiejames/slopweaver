/**
 * The typed failures `src/supervisor` authors itself: the intake scope it cannot establish, an owner turn it
 * cannot find, the intake marks and the tick ledger it cannot read or write, the armed sweep prompt it
 * refuses to render, a captured document it will not draft a tick from, and the canon `git log` the chair's hand-off
 * cadence could not run or read.
 *
 * A union of its own per `.claude/rules/error-handling.md`, and deliberately NOT the `SupervisorError` of
 * `src/cli/commands/supervisor`: that one is a verb directory's command-line and state-doc refusals, this one
 * is the supervisor's own ledgers and readers, and a verb that reaches one of these names it through
 * {@link supervisorCoreErrorLines} at its own edge. Every list-carrying variant — a transcript's problems, a
 * prompt's defects, a document's schema issues, a ledger's bad rows — gives each entry back as its own line,
 * exactly as the string list it replaced did.
 */
import type { IngestError } from "../lib/ingestError.js";

/** No supervisor pin is recorded, so there is no session to follow. */
export interface SupervisorPinMissingError {
  readonly code: "PIN_MISSING";
  readonly message: string;
}

/** The pin names a session the live-session registry does not hold. */
export interface SupervisorPinNotLiveError {
  readonly code: "PIN_NOT_LIVE";
  readonly message: string;
  readonly sessionId: string;
}

/** The pin names a Codex chair, whose rollout this single-session read cannot open yet. */
export interface SupervisorPinOnCodexError {
  readonly code: "PIN_ON_CODEX";
  readonly message: string;
  readonly sessionId: string;
}

/** The pin or chain journal would not read cleanly, so the pin's Claude session is not trusted as the chair. */
export interface SupervisorChairUnresolvedError {
  readonly code: "CHAIR_UNRESOLVED";
  readonly message: string;
  readonly why: string;
}

/** An explicit `--session` names a Codex thread the pin or chain records, so no Claude transcript is its chair. */
export interface SupervisorSessionIsCodexError {
  readonly code: "SESSION_IS_CODEX";
  readonly message: string;
  readonly sessionId: string;
}

/** A transcript could not be read completely; `reasons` carries each problem the reader reported. */
export interface SupervisorTranscriptUnreadableError {
  readonly code: "TRANSCRIPT_UNREADABLE";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** A turn pointer names no owner turn in its own transcript. */
export interface SupervisorTurnNotFoundError {
  readonly code: "TURN_NOT_FOUND";
  readonly message: string;
  readonly pointer: string;
}

/** The intake-marks ledger is present and cannot be read. */
export interface SupervisorIntakeMarksUnreadableError {
  readonly code: "INTAKE_MARKS_UNREADABLE";
  readonly message: string;
  readonly path: string;
  readonly cause: unknown;
}

/** The sweep prompt was asked for with no standing-contract path to name. */
export interface SupervisorContractPathMissingError {
  readonly code: "CONTRACT_PATH_MISSING";
  readonly message: string;
}

/** The rendered sweep prompt breaks one or more of its own rules; `reasons` names each. */
export interface SupervisorSweepPromptRefusedError {
  readonly code: "SWEEP_PROMPT_REFUSED";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** A captured document is not its producer's shape; `reasons` is the heading and one indented line per issue. */
export interface SupervisorDocumentRefusedError {
  readonly code: "DOCUMENT_REFUSED";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** `--watch` was given `session watch --json`'s bare row array rather than the report. */
export interface SupervisorWatchBareArrayError {
  readonly code: "WATCH_BARE_ARRAY";
  readonly message: string;
  readonly path: string;
}

/** One tick-ledger line is not readable JSON. */
export interface SupervisorTickLineUnreadableError {
  readonly code: "TICK_LINE_UNREADABLE";
  readonly message: string;
  readonly cause: unknown;
}

/** One tick-ledger row is refused by the row's own checks; `reasons` names each. */
export interface SupervisorTickRowRefusedError {
  readonly code: "TICK_ROW_REFUSED";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** The tick ledger does not end in a newline, so an append would join a torn row. */
export interface SupervisorLedgerTornError {
  readonly code: "LEDGER_TORN";
  readonly message: string;
  readonly path: string;
}

/** Another writer holds the tick ledger's lock — an append or a reseal is under way. */
export interface SupervisorLedgerBusyError {
  readonly code: "LEDGER_BUSY";
  readonly message: string;
  readonly why: string;
}

/** The tick ledger could not be read or written at the filesystem boundary. */
export interface SupervisorLedgerIoFailedError {
  readonly code: "LEDGER_IO_FAILED";
  readonly message: string;
  readonly cause: IngestError;
}

/** The tick ledger holds rows it refuses; `reasons` is one `<ledger>:<line>: …` line per defect. */
export interface SupervisorLedgerDefectiveError {
  readonly code: "LEDGER_DEFECTIVE";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** The tick ledger was asked for and is absent, or holds no rows. */
export interface SupervisorLedgerEmptyError {
  readonly code: "LEDGER_EMPTY";
  readonly message: string;
  readonly label: string;
}

/** `git log` over the chair's canon paths could not be run at all. */
export interface SupervisorCanonLogFailedError {
  readonly code: "CANON_LOG_FAILED";
  readonly message: string;
  readonly cause: unknown;
}

/** One line of that `git log` is not the `<sha>\t<committer iso>\t<subject>` shape asked for. */
export interface SupervisorCanonLogMalformedError {
  readonly code: "CANON_LOG_MALFORMED";
  readonly message: string;
  readonly line: string;
}

/** Every failure `src/supervisor` authors. */
export type SupervisorCoreError =
  | SupervisorPinMissingError
  | SupervisorPinNotLiveError
  | SupervisorPinOnCodexError
  | SupervisorChairUnresolvedError
  | SupervisorSessionIsCodexError
  | SupervisorTranscriptUnreadableError
  | SupervisorTurnNotFoundError
  | SupervisorIntakeMarksUnreadableError
  | SupervisorContractPathMissingError
  | SupervisorSweepPromptRefusedError
  | SupervisorDocumentRefusedError
  | SupervisorWatchBareArrayError
  | SupervisorTickLineUnreadableError
  | SupervisorTickRowRefusedError
  | SupervisorLedgerTornError
  | SupervisorLedgerBusyError
  | SupervisorLedgerIoFailedError
  | SupervisorLedgerDefectiveError
  | SupervisorLedgerEmptyError
  | SupervisorCanonLogFailedError
  | SupervisorCanonLogMalformedError;

/** A zod issue, as far as a document refusal reads one. */
interface DocumentIssue {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}

/**
 * One issue as `path: message`, naming the whole `document` when the issue sits at its root.
 *
 * @param issue the schema issue
 * @returns the issue's line, unindented
 */
function issueLine({ issue }: { issue: DocumentIssue }): string {
  const path = issue.path.join(".");
  if (path === "") {
    return `document: ${issue.message}`;
  }
  return `${path}: ${issue.message}`;
}

/**
 * A heading plus one indented `path: message` line per issue — the shape both document refusals print.
 *
 * @param heading the line naming which document was refused
 * @param issues the schema's own issues
 * @returns the refusal, carrying those exact lines as `reasons`
 */
function documentRefused({
  heading,
  issues,
}: {
  heading: string;
  issues: readonly DocumentIssue[];
}): SupervisorDocumentRefusedError {
  const lines = issues.map((issue) => issueLine({ issue }));
  return {
    code: "DOCUMENT_REFUSED",
    message: `${heading} ${lines.join("; ")}`,
    reasons: [heading, ...lines.map((line) => `  ${line}`)],
  };
}

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const SupervisorCoreErrors = {
  canonLogFailed: ({ cause }: { cause: unknown }): SupervisorCanonLogFailedError => ({
    cause,
    code: "CANON_LOG_FAILED",
    // A failed execFileSync's message carries git's stderr on further lines; a tick note is one line.
    message: `\`git log origin/main\` over the canon paths failed: ${(cause instanceof Error ? cause.message : String(cause)).trim().replace(/\s*\n\s*/gu, " — ")}`,
  }),
  canonLogMalformed: ({ line }: { line: string }): SupervisorCanonLogMalformedError => ({
    code: "CANON_LOG_MALFORMED",
    line,
    message: `a \`git log\` line is not <sha>\\t<committer iso>\\t<subject>: ${JSON.stringify(line)}`,
  }),
  contractPathMissing: (): SupervisorContractPathMissingError => ({
    code: "CONTRACT_PATH_MISSING",
    message: "no contract path — the armed prompt must name the standing contract file it reads",
  }),
  documentNotProduced: ({
    flag,
    path,
    producer,
    issues,
  }: {
    flag: string;
    path: string;
    producer: string;
    issues: readonly DocumentIssue[];
  }): SupervisorDocumentRefusedError =>
    documentRefused({ heading: `--${flag} ${path} is not a \`${producer}\` document:`, issues }),
  intakeMarksUnreadable: ({ path, cause }: { path: string; cause: unknown }): SupervisorIntakeMarksUnreadableError => ({
    cause,
    code: "INTAKE_MARKS_UNREADABLE",
    message: `intake marks at ${path} could not be read: ${cause instanceof Error ? cause.message : String(cause)}`,
    path,
  }),
  ledgerAbsent: ({ path }: { path: string }): SupervisorLedgerEmptyError => ({
    code: "LEDGER_EMPTY",
    label: path,
    message:
      `${path} does not exist. The derived narrative was asked for, so an absent ledger is a refusal rather ` +
      "than an empty history — a page rendered from a missing file would report a quiet fleet.",
  }),
  ledgerBusy: ({ why }: { why: string }): SupervisorLedgerBusyError => ({
    code: "LEDGER_BUSY",
    message: `the tick ledger's lock is held by another writer, so nothing was written — run it again once that writer finishes (${why})`,
    why,
  }),
  ledgerDefective: ({ reasons }: { reasons: readonly string[] }): SupervisorLedgerDefectiveError => ({
    code: "LEDGER_DEFECTIVE",
    message: reasons.join("; "),
    reasons,
  }),
  ledgerIoFailed: ({ cause }: { cause: IngestError }): SupervisorLedgerIoFailedError => ({
    cause,
    code: "LEDGER_IO_FAILED",
    message: cause.message,
  }),
  ledgerNoRows: ({ label }: { label: string }): SupervisorLedgerEmptyError => ({
    code: "LEDGER_EMPTY",
    label,
    message: `${label} holds no tick rows — nothing has been recorded yet, so there is no narrative to derive`,
  }),
  ledgerTorn: ({ path }: { path: string }): SupervisorLedgerTornError => ({
    code: "LEDGER_TORN",
    message:
      `${path} does not end in a newline, so its last record is torn. Repair the file before appending — ` +
      "joining onto a half row would make every later read of this ledger fail.",
    path,
  }),
  notAReconciliation: ({ issues }: { issues: readonly DocumentIssue[] }): SupervisorDocumentRefusedError =>
    documentRefused({ heading: "the document is not a `slopweaver handover reconcile --json` run:", issues }),
  chairUnresolved: ({ why }: { why: string }): SupervisorChairUnresolvedError => ({
    code: "CHAIR_UNRESOLVED",
    message:
      `which session holds the chair could not be read (${why}), so the pin's Claude session is not read as ` +
      "the chair — repair the supervisor pin or chain journal, or name a Claude session with `--session <id>`",
    why,
  }),
  pinMissing: (): SupervisorPinMissingError => ({
    code: "PIN_MISSING",
    message: "no supervisor pin is recorded — run `slopweaver cmux takeover` in the supervisor",
  }),
  pinNotLive: ({ sessionId }: { sessionId: string }): SupervisorPinNotLiveError => ({
    code: "PIN_NOT_LIVE",
    message:
      `the supervisor pin names session ${sessionId.slice(0, 8)}, which is not live — ` +
      "run `slopweaver cmux takeover` in the current supervisor",
    sessionId,
  }),
  pinOnCodex: ({ sessionId }: { sessionId: string }): SupervisorPinOnCodexError => ({
    code: "PIN_ON_CODEX",
    message:
      `the supervisor pin names Codex thread ${sessionId.slice(0, 8)}, and a Codex chair's rollout is not read ` +
      "by this check yet — name a Claude session with `--session <id>` to read one transcript",
    sessionId,
  }),
  sessionIsCodex: ({ sessionId }: { sessionId: string }): SupervisorSessionIsCodexError => ({
    code: "SESSION_IS_CODEX",
    message:
      `session ${sessionId.slice(0, 8)} is a Codex thread the supervisor pin or chain records, and a Codex ` +
      "chair's rollout is not read by this check yet — name a Claude session with `--session <id>`",
    sessionId,
  }),
  sweepPromptRefused: ({ reasons }: { reasons: readonly string[] }): SupervisorSweepPromptRefusedError => ({
    code: "SWEEP_PROMPT_REFUSED",
    message: reasons.join("; "),
    reasons,
  }),
  tickLineUnreadable: ({ cause }: { cause: unknown }): SupervisorTickLineUnreadableError => ({
    cause,
    code: "TICK_LINE_UNREADABLE",
    message: `the line is not readable JSON: ${cause instanceof Error ? cause.message : "unknown error"}`,
  }),
  tickRowRefused: ({ reasons }: { reasons: readonly string[] }): SupervisorTickRowRefusedError => ({
    code: "TICK_ROW_REFUSED",
    message: reasons.join("; "),
    reasons,
  }),
  transcriptUnreadable: ({ reasons }: { reasons: readonly string[] }): SupervisorTranscriptUnreadableError => ({
    code: "TRANSCRIPT_UNREADABLE",
    message: reasons.join("; "),
    reasons,
  }),
  turnNotFound: ({ pointer, sessionId }: { pointer: string; sessionId: string }): SupervisorTurnNotFoundError => ({
    code: "TURN_NOT_FOUND",
    message: `${pointer} names no owner turn in that transcript — list them with \`slopweaver supervisor intake --session ${sessionId}\``,
    pointer,
  }),
  watchBareArray: ({ path }: { path: string }): SupervisorWatchBareArrayError => ({
    code: "WATCH_BARE_ARRAY",
    message:
      `--watch ${path} is \`session watch --json\`'s bare row array, which carries neither the suppressed ` +
      "count nor an instant: capture `slopweaver session watch --json-report` instead",
    path,
  }),
} as const;

/**
 * The lines a {@link SupervisorCoreError} prints, one per problem. A list-carrying variant gives each entry its own
 * line, as the `readonly string[]` it replaced did, rather than the joined `message` a single-line display reads.
 *
 * @returns one line per problem, in the order they were found
 */
export function supervisorCoreErrorLines({ error }: { error: SupervisorCoreError }): readonly string[] {
  if (
    error.code === "TRANSCRIPT_UNREADABLE" ||
    error.code === "SWEEP_PROMPT_REFUSED" ||
    error.code === "DOCUMENT_REFUSED" ||
    error.code === "TICK_ROW_REFUSED" ||
    error.code === "LEDGER_DEFECTIVE"
  ) {
    return error.reasons;
  }
  return [error.message];
}
