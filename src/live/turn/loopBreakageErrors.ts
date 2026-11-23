/**
 * The typed refusals of the loop-breakage row writer — a row that would reach the ledger saying nothing.
 *
 * Its own union because `src/live/turn` is already past `error-shape-threshold`, and because the two kinds
 * are distinct to a caller: an empty `cause` is the measured defect this writer exists to close (every one of
 * the measured rows carried `cause: null`), while an empty `atIso`/`what`/`error`/`thread`/`didInstead` is
 * a row that names nothing a reader could chase — a blank `atIso` falls out of every windowed reader. `turn breakage` displays `message`; a test branches on `code`.
 */

/** The row's `cause` was absent or blank — the field every hand-written row of the measured day left null. */
export interface BreakageCauseMissingError {
  readonly code: "CAUSE_MISSING";
  readonly message: string;
}

/** Every field of a row other than `cause` that must be non-blank too. */
export type LoopBreakageRequiredField = "atIso" | "thread" | "what" | "error" | "didInstead";

/** One of the row's other required fields was absent or blank. */
export interface BreakageFieldMissingError {
  readonly code: "FIELD_MISSING";
  readonly message: string;
  readonly field: LoopBreakageRequiredField;
}

/** Every way a loop-breakage row is refused before it is written. */
export type LoopBreakageError = BreakageCauseMissingError | BreakageFieldMissingError;

/** The factory the real code calls, so a test builds a fixture the same way the code does. */
export const LoopBreakageErrors = {
  causeMissing: (): BreakageCauseMissingError => ({
    code: "CAUSE_MISSING",
    message:
      "a loop-breakage row needs a cause — WHY it broke, not what broke; a row without one is refused " +
      "rather than written as null, because a null cause is the row nobody can act on",
  }),
  fieldMissing: ({ field }: { field: LoopBreakageRequiredField }): BreakageFieldMissingError => ({
    code: "FIELD_MISSING",
    field,
    message: `a loop-breakage row needs a non-empty ${field}`,
  }),
} as const;
