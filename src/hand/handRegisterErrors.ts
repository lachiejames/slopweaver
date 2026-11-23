/**
 * The hand-step failures of the register itself: a stored line that is not a complete row, a row that would not
 * read back, an id nothing carries, two rows disagreeing under one id, a board row already holding an open card
 * or that cannot be named, a register the check needs whole, a write lock another session holds, and a store
 * that would not read.
 *
 * `./errors.ts` composes this sub-union with the posting and surface groups into the one `HandStepError`, and
 * spreads this factory into the one `HandStepErrors`. A new register or row-store failure goes here.
 */

/** A stored line is not a complete posted or settled row. Carries the line number to inspect. */
export interface CorruptRowError {
  readonly code: "CORRUPT_ROW";
  readonly message: string;
  readonly lineNumber: number;
  readonly why: string;
}

/**
 * The row about to be appended is one this register's own reader would refuse, so it is not written.
 *
 * Its own kind because the caller branches on it as a BUG IN ITSELF rather than as damage on disk: nothing
 * was written, the register is exactly as it was, and what has to change is the value the caller passed.
 * {@link CorruptRowError} is the same rule fired on a line that is already in the file.
 */
export interface UnwritableRowError {
  readonly code: "UNWRITABLE_ROW";
  readonly message: string;
  readonly why: string;
}

/** Nothing open carries that id, so there is nothing to settle or to show. */
export interface UnknownStepError {
  readonly code: "UNKNOWN_STEP";
  readonly message: string;
  readonly id: string;
}

/** Two posted rows share an id and disagree, so one id is naming two different steps. */
export interface StepIdConflictError {
  readonly code: "STEP_ID_CONFLICT";
  readonly message: string;
  readonly id: string;
  readonly field: string;
}

/**
 * An open step already names this board row. One open card per row: a genuine re-cut supersedes the old one,
 * and a second card beside it is the two-cards-for-one-thing queue the owner once met.
 */
export interface RowAlreadyOpenError {
  readonly code: "ROW_ALREADY_OPEN";
  readonly message: string;
  readonly row: string;
  readonly existingId: string;
}

/**
 * The board row a new card names cannot be read whole, or is already finished — judged under the register lock,
 * and only for a write that opens a new card: a card evidence can never read would never leave the owner's queue.
 */
export interface RowNotNameableError {
  readonly code: "ROW_NOT_NAMEABLE";
  readonly message: string;
  readonly row: string;
}

/** The writer's own admission refused a posting against the steps open at the append, judged under the lock. */
export interface PostingNotAdmittedError {
  readonly code: "POSTING_NOT_ADMITTED";
  readonly message: string;
  readonly id: string;
}

/**
 * The register holds a line that did not read, and this posting's check needs the WHOLE register — whether a
 * row already has an open card, or whether the step being superseded is open. The skipped line may be it.
 */
export interface RegisterIncompleteError {
  readonly code: "REGISTER_INCOMPLETE";
  readonly message: string;
  readonly lineNumbers: readonly number[];
}

/** Another session holds the register's write lock. Contention, not corruption — the caller may retry. */
export interface RegisterBusyError {
  readonly code: "REGISTER_BUSY";
  readonly message: string;
}

/** The register could not be read or appended to. Never conflated with an EMPTY register. */
export interface StoreUnreadableError {
  readonly code: "STORE_UNREADABLE";
  readonly message: string;
  readonly path: string;
  readonly cause?: unknown;
}

/** Every failure of the hand-step register and its row store. */
export type HandRegisterError =
  | CorruptRowError
  | UnwritableRowError
  | UnknownStepError
  | StepIdConflictError
  | RowAlreadyOpenError
  | RowNotNameableError
  | PostingNotAdmittedError
  | RegisterIncompleteError
  | RegisterBusyError
  | StoreUnreadableError;

/** Constructors for {@link HandRegisterError}, spread into `HandStepErrors` by `./errors.ts`. */
export const HandRegisterErrors = {
  corruptRow: ({ lineNumber, why }: { lineNumber: number; why: string }): CorruptRowError => ({
    code: "CORRUPT_ROW",
    lineNumber,
    message: `line ${String(lineNumber)} of the hand-step register is not a complete row: ${why}`,
    why,
  }),
  unwritableRow: ({ why }: { why: string }): UnwritableRowError => ({
    code: "UNWRITABLE_ROW",
    message: `the row was NOT written — this register could not read it back: ${why}`,
    why,
  }),
  unknownStep: ({ id }: { id: string }): UnknownStepError => ({
    code: "UNKNOWN_STEP",
    id,
    message: `no open hand step carries the id ${id} — run \`slopweaver hand list\` to see what does`,
  }),
  stepIdConflict: ({ id, field }: { id: string; field: string }): StepIdConflictError => ({
    code: "STEP_ID_CONFLICT",
    field,
    id,
    message:
      `the register already carries a DIFFERENT step under the id ${id} — the two disagree about ${field}. ` +
      "One id names one step, or `hand done` cannot say which it settles",
  }),
  rowAlreadyOpen: ({ row, existingId }: { row: string; existingId: string }): RowAlreadyOpenError => ({
    code: "ROW_ALREADY_OPEN",
    existingId,
    message:
      `the open step ${existingId} already names the board row ${row} — one open card per row. If this step ` +
      `replaces it, pass --supersedes ${existingId}; if the first is finished, settle it first`,
    row,
  }),
  rowNotNameable: ({ row, why }: { row: string; why: string }): RowNotNameableError => ({
    code: "ROW_NOT_NAMEABLE",
    message: why,
    row,
  }),
  postingNotAdmitted: ({ id, why }: { id: string; why: string }): PostingNotAdmittedError => ({
    code: "POSTING_NOT_ADMITTED",
    id,
    message: why,
  }),
  registerIncomplete: ({ lineNumbers }: { lineNumbers: readonly number[] }): RegisterIncompleteError => ({
    code: "REGISTER_INCOMPLETE",
    lineNumbers,
    message:
      `the hand-step register has ${String(lineNumbers.length)} line(s) that did not read (${lineNumbers.join(", ")}), ` +
      "and a posting naming a row or superseding a step needs the whole register — the skipped line may be the " +
      "open card it would collide with. Repair the line, or post --standalone without --supersedes",
  }),
  registerBusy: ({ why }: { why: string }): RegisterBusyError => ({
    code: "REGISTER_BUSY",
    message: `another session is writing the hand-step register right now (${why}) — nothing was written; try again`,
  }),
  storeUnreadable: ({ path, cause }: { path: string; cause: unknown }): StoreUnreadableError => ({
    cause,
    code: "STORE_UNREADABLE",
    message: `could not read the hand-step register at ${path} — refusing rather than reporting it empty`,
    path,
  }),
} as const;
