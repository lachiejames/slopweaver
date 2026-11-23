/**
 * The autonomy ledger's own typed failure union.
 *
 * A union rather than `readonly string[]` because these kinds are BRANCHED ON, which is the test
 * `.claude/rules/error-handling.md` sets: `autonomy record` exits differently on a row it could not build
 * than on a register it could not write, `autonomy steer` has to answer "no act carries that id" as its own
 * kind rather than as a sentence, and the briefing's render leg must never mistake an unreadable register
 * for an empty one — a page rendering "nothing was done under autonomy" because a read failed is the silent
 * wrong answer this whole section exists to prevent.
 */
import { SAID_ADVICE, saidRefusal, type UnparsableToken } from "./said.js";

/** A field is absent, empty, too long, or not the shape its own rule requires. */
export interface InvalidFieldError {
  readonly code: "INVALID_FIELD";
  readonly message: string;
  readonly field: string;
}

/** The kind is not a slug — free text or punctuation, which would not project to a checked column. */
export interface InvalidKindError {
  readonly code: "INVALID_KIND";
  readonly message: string;
  readonly kind: string;
}

/** The subject is none of `./subject.ts`'s three forms, so it is not a checkable id a reader can resolve. */
export interface UncheckableSubjectError {
  readonly code: "UNCHECKABLE_SUBJECT";
  readonly message: string;
  readonly subject: string;
}

/**
 * The plain-words line carries a token the owner could not parse — a rule number, a slug or a session id.
 *
 * Its own kind rather than an `INVALID_FIELD`, because a caller BRANCHES: every other field rule is a shape
 * a session got wrong, and this one is a sentence a session has to rewrite. The phrase and the class travel
 * with it so a composer is told which words to change rather than that a field was bad.
 */
export interface UnparsableSaidError {
  readonly code: "UNPARSABLE_SAID";
  readonly message: string;
  /** The class `../autonomy/said.ts` reported — `rule-number`, `session-id`, `slug`. */
  readonly saidClass: string;
  /** The exact phrase the line wrote. */
  readonly used: string;
}

/**
 * A plain-words line is readable but too long for the owner's card to draw whole.
 *
 * Separate from a plain length refusal because the bound is the CARD's rather than the file's: the fold cuts
 * on words and on sentences, so a composer is told which of the two it crossed and by how much. A said the
 * page would truncate is refused here instead of being cut there — `AGENTS.md` rule 7 puts that shape in the
 * schema, never in a reviewer's hands.
 */
export interface SaidPastTheFoldError {
  readonly code: "SAID_PAST_THE_FOLD";
  readonly message: string;
  /** Which budget the line crossed — `words` or `sentences`. */
  readonly budget: "words" | "sentences";
  /** What the line actually measured. */
  readonly measured: number;
  /** The cap it had to stay inside. */
  readonly cap: number;
}

/**
 * The act's prose carries a reference the briefing would render as plain text, which its gate then refuses.
 *
 * Its own kind because the fix is a rewrite of one reference, not of the field's shape: spell it
 * `owner/repo#<number>` or as the full URL. Refused at `slopweaver autonomy record` and `autonomy steer` and nowhere
 * else, since the register's own decoder reruns the builder over every stored line and an old row must still
 * read.
 */
export interface BareReferenceError {
  readonly code: "BARE_REFERENCE";
  readonly message: string;
  /** The page check's own sentence about the reference. */
  readonly reason: string;
}

/** A stored line is neither a complete action nor a complete steer. Carries the line number to inspect. */
export interface CorruptRowError {
  readonly code: "CORRUPT_ROW";
  readonly message: string;
  readonly lineNumber: number;
  /** What the validation actually objected to, so the line can be fixed rather than guessed at. */
  readonly why: string;
}

/**
 * A read skipped lines it could not decode, and the caller needs EVERY line to answer — an absence it would
 * otherwise conclude (no such act, no earlier press) could be sitting on one of them.
 *
 * Its own kind rather than an `UNKNOWN_ACTION`: "no act carries that id" is a confident diagnosis, and it is
 * false when the act may be on a line nobody could read.
 */
export interface RegisterIncompleteError {
  readonly code: "REGISTER_INCOMPLETE";
  readonly message: string;
  /** The 1-based lines that were skipped, in file order. */
  readonly lineNumbers: readonly number[];
}

/** A steer names an act the register does not carry, so there is nothing for it to steer. */
export interface UnknownActionError {
  readonly code: "UNKNOWN_ACTION";
  readonly message: string;
  readonly actionId: string;
}

/**
 * Two action rows share an id and DISAGREE about what happened.
 *
 * Not the same thing as a repeat: an identical row under an id it already carries is an idempotent
 * recording — a session retrying its own append after a crash — and is folded to one act. This fires only
 * when the fields differ, which means one id is being used for two different occurrences and a steer against
 * it could not say which one it judges.
 */
export interface ActionIdConflictError {
  readonly code: "ACTION_ID_CONFLICT";
  readonly message: string;
  readonly actionId: string;
  /** Which field first disagreed, so the two rows can be compared rather than diffed by eye. */
  readonly field: string;
}

/** Another session holds the ledger's write lock. Contention, not corruption — the caller may retry. */
export interface LedgerBusyError {
  readonly code: "LEDGER_BUSY";
  readonly message: string;
}

/** The register could not be read or appended to. Never conflated with an EMPTY register. */
export interface StoreUnreadableError {
  readonly code: "STORE_UNREADABLE";
  readonly message: string;
  readonly path: string;
  readonly cause?: unknown;
}

/**
 * The register's bytes are not the bytes an adoption plan was computed over.
 *
 * Its own kind rather than a `STORE_UNREADABLE` with an explanatory cause, because the caller BRANCHES: the
 * file is perfectly readable and a session appended to it, so the answer is to plan again and look at the new
 * rows rather than to check permissions.
 */
export interface RegisterMovedError {
  readonly code: "REGISTER_MOVED";
  readonly message: string;
  readonly path: string;
  readonly plannedSha256: string;
  readonly currentSha256: string;
}

/**
 * The store stopped awaiting the register between an adoption's plan and its write — an import landed, or the
 * store could not say. Its own kind because the answer is to stop repairing the file, never to plan again.
 */
export interface RegisterNotPendingError {
  readonly code: "REGISTER_NOT_PENDING";
  readonly message: string;
}

/**
 * A repair asked to qualify an act's bare references found none — its own kind, because a repair that would
 * write an identical row is a caller pointed at the wrong act, not a row to rewrite.
 */
export interface NothingToQualifyError {
  readonly code: "NOTHING_TO_QUALIFY";
  readonly message: string;
  readonly actionId: string;
}

/** Every way this domain fails. */
export type AutonomyError =
  | NothingToQualifyError
  | RegisterMovedError
  | RegisterNotPendingError
  | InvalidFieldError
  | InvalidKindError
  | UncheckableSubjectError
  | UnparsableSaidError
  | SaidPastTheFoldError
  | BareReferenceError
  | CorruptRowError
  | RegisterIncompleteError
  | UnknownActionError
  | ActionIdConflictError
  | LedgerBusyError
  | StoreUnreadableError;

/** Constructors for {@link AutonomyError}. The only place an autonomy error is built. */
export const AutonomyErrors = {
  invalidField: ({ field, why }: { field: string; why: string }): InvalidFieldError => ({
    code: "INVALID_FIELD",
    field,
    message: `${field} ${why}`,
  }),
  invalidKind: ({ kind }: { kind: string }): InvalidKindError => ({
    code: "INVALID_KIND",
    kind,
    message:
      `"${kind}" is not an action kind — lowercase letters and digits, separated by single hyphens or ` +
      "dots, 2-60 characters. " +
      "The vocabulary is deliberately open, so name what you actually did rather than the nearest listed thing",
  }),
  uncheckableSubject: ({ subject }: { subject: string }): UncheckableSubjectError => ({
    code: "UNCHECKABLE_SUBJECT",
    message:
      `"${subject}" is not a checkable id. A row's subject names the thing acted on in a form the owner can go and` +
      "resolve, and there are three: an absolute http(s) URL (a pull request, a Slack permalink), a handover " +
      "board row slug (`slopweaver handover resume <slug>`), or `state:<path>` for a file under the state " +
      "home. Never free prose, and never a bare #<number>",
    subject,
  }),
  unparsableSaid: ({ found }: { found: UnparsableToken }): UnparsableSaidError => ({
    code: "UNPARSABLE_SAID",
    message: `said ${saidRefusal({ found })}`,
    saidClass: found.name,
    used: found.used,
  }),
  saidPastTheFold: ({
    budget,
    cap,
    measured,
  }: {
    budget: "words" | "sentences";
    cap: number;
    measured: number;
  }): SaidPastTheFoldError => ({
    budget,
    cap,
    code: "SAID_PAST_THE_FOLD",
    measured,
    message:
      `said runs to ${String(measured)} ${budget} and the owner's card draws at most ${String(cap)} — the page would ` +
      `cut it there with nothing to open, so say it shorter. ${SAID_ADVICE}`,
  }),
  bareReference: ({ reason }: { reason: string }): BareReferenceError => ({
    code: "BARE_REFERENCE",
    message:
      `the act would carry a reference onto the briefing as plain text, which its gate refuses: ${reason} ` +
      "Write it as owner/repo#<number> or as the full URL",
    reason,
  }),
  corruptRow: ({ lineNumber, why }: { lineNumber: number; why: string }): CorruptRowError => ({
    code: "CORRUPT_ROW",
    lineNumber,
    message: `line ${String(lineNumber)} of the autonomy ledger is neither a complete action nor a complete steer: ${why}`,
    why,
  }),
  registerIncomplete: ({ lineNumbers }: { lineNumbers: readonly number[] }): RegisterIncompleteError => ({
    code: "REGISTER_INCOMPLETE",
    lineNumbers,
    message:
      `line(s) ${lineNumbers.join(", ")} of the autonomy ledger could not be read, so what they recorded cannot ` +
      "be ruled out — `slopweaver autonomy list` names each one and why",
  }),
  nothingToQualify: ({ actionId }: { actionId: string }): NothingToQualifyError => ({
    actionId,
    code: "NOTHING_TO_QUALIFY",
    message: `${actionId}'s why and said carry no bare GitHub reference the named repository resolves — nothing to repair`,
  }),
  unknownAction: ({ actionId }: { actionId: string }): UnknownActionError => ({
    actionId,
    code: "UNKNOWN_ACTION",
    message: `no act in the ledger carries the id ${actionId} — run \`slopweaver autonomy list\` to see what does`,
  }),
  actionIdConflict: ({ actionId, field }: { actionId: string; field: string }): ActionIdConflictError => ({
    actionId,
    code: "ACTION_ID_CONFLICT",
    field,
    message:
      `the ledger already carries a DIFFERENT act under the id ${actionId} — the two disagree about ` +
      `${field}. One id must name one occurrence, or a steer against it cannot say which act it judges. ` +
      "Record the second act under its own id",
  }),
  ledgerBusy: ({ why }: { why: string }): LedgerBusyError => ({
    code: "LEDGER_BUSY",
    message: `another session is writing the autonomy ledger right now (${why}) — nothing was written; try again`,
  }),
  registerMoved: ({
    path,
    plannedSha256,
    currentSha256,
  }: {
    path: string;
    plannedSha256: string;
    currentSha256: string;
  }): RegisterMovedError => ({
    code: "REGISTER_MOVED",
    currentSha256,
    message:
      `the register changed while the plan was being read — planned over ${plannedSha256}, now ` +
      `${currentSha256}. A session appended to it, so nothing was written: plan again and look at the new rows`,
    path,
    plannedSha256,
  }),
  registerNotPending: ({ why }: { why: string }): RegisterNotPendingError => ({
    code: "REGISTER_NOT_PENDING",
    message: `${why} — the store changed under this adoption, so nothing was written`,
  }),
  storeUnreadable: ({ path, cause }: { path: string; cause: unknown }): StoreUnreadableError => ({
    cause,
    code: "STORE_UNREADABLE",
    message: `could not read the autonomy ledger at ${path} — refusing rather than reporting it empty`,
    path,
  }),
} as const;
