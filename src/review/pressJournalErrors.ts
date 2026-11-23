/**
 * Why the press register could not be read or written. Its own union, per `.claude/rules/error-handling.md`:
 * the landing read refuses on every one, and the post-press write reports every one as "the press happened and
 * its row is missing", so a caller displays `message` and branches on `code` only to say which.
 */
import { type ImportFileProblem, importProblemText, type StoreStepFailure } from "../store/registerImport.js";

/** The store could not be opened or a statement failed — which presses exist is UNKNOWN, never "none". */
export interface PressStoreUnavailableError {
  readonly code: "PRESS_STORE_UNAVAILABLE";
  readonly message: string;
}

/** The old `landing-presses.jsonl` exists and would not read, so its one-time import cannot happen. */
export interface PressImportUnreadableError {
  readonly code: "PRESS_IMPORT_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** The old file holds a line that is not a press; nothing was imported. */
export interface PressImportInvalidError {
  readonly code: "PRESS_IMPORT_INVALID";
  readonly message: string;
  readonly path: string;
  readonly problems: readonly string[];
}

/** A stored row does not decode — corrupt, never skipped. */
export interface PressRecordInvalidError {
  readonly code: "PRESS_RECORD_INVALID";
  readonly message: string;
  readonly pressKey: string;
}

/** A different press already sits under this press's key. */
export interface PressKeyConflictError {
  readonly code: "PRESS_KEY_CONFLICT";
  readonly message: string;
  readonly pressKey: string;
}

/** Every way the press register refuses. */
export type PressJournalError =
  | PressStoreUnavailableError
  | PressImportUnreadableError
  | PressImportInvalidError
  | PressRecordInvalidError
  | PressKeyConflictError;

/** A press record — a line of the old file or a stored row — that is not an object at all. */
export interface PressNotAnObjectError {
  readonly code: "PRESS_NOT_AN_OBJECT";
  readonly message: string;
}

/** A press record whose named field is absent or malformed. */
export interface PressFieldInvalidError {
  readonly code: "PRESS_FIELD_INVALID";
  readonly field: string;
  readonly message: string;
}

/** Why one record is not a press. Its `message` completes a sentence that names the record. */
export type PressDecodeError = PressNotAnObjectError | PressFieldInvalidError;

/** Constructors for {@link PressDecodeError}. */
export const PressDecodeErrors = {
  fieldInvalid: ({ field, qualifier }: { field: string; qualifier?: string }): PressFieldInvalidError => ({
    code: "PRESS_FIELD_INVALID",
    field,
    message: qualifier === undefined ? `carries no ${field}` : `carries no ${qualifier} ${field}`,
  }),
  notAnObject: (): PressNotAnObjectError => ({ code: "PRESS_NOT_AN_OBJECT", message: "is not an object" }),
} as const;

/** Constructors for {@link PressJournalError}. */
export const PressJournalErrors = {
  importProblem: ({
    problem,
  }: {
    problem: ImportFileProblem;
  }): PressImportUnreadableError | PressImportInvalidError => {
    const message =
      `the press register moved into the store and its old file must be imported once, but ` +
      `${importProblemText({ problem })} — nothing was imported, so which pull requests were pressed is UNKNOWN`;
    if (problem.kind === "unreadable") {
      return { code: "PRESS_IMPORT_UNREADABLE", message, path: problem.path };
    }
    return { code: "PRESS_IMPORT_INVALID", message, path: problem.path, problems: problem.problems };
  },
  keyConflict: ({ pressKey }: { pressKey: string }): PressKeyConflictError => ({
    code: "PRESS_KEY_CONFLICT",
    message: `a different press is already recorded under key ${pressKey}, so this one was not written`,
    pressKey,
  }),
  recordInvalid: ({ pressKey, reason }: { pressKey: string; reason: string }): PressRecordInvalidError => ({
    code: "PRESS_RECORD_INVALID",
    message: `the stored press ${pressKey} ${reason}, so the press register cannot be read`,
    pressKey,
  }),
  storeUnavailable: ({ doing, reason }: StoreStepFailure): PressStoreUnavailableError => ({
    code: "PRESS_STORE_UNAVAILABLE",
    message:
      `the press register lives in the store, and the store could not ${doing}, so which pull requests were ` +
      `pressed is UNKNOWN (\`slopweaver store status\` says what the store is doing). The store said: ${reason}`,
  }),
} as const;
