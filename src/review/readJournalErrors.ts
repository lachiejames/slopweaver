/**
 * Why the landing-read cursor could not be read or written. Its own union, per `.claude/rules/error-handling.md`:
 * `github landing --if-due` refuses on every read failure before any GitHub request, and a failed write after a
 * completed read is a diagnostic and a non-zero exit, so a caller displays `message` and branches on `code`.
 */
import { type ImportFileProblem, importProblemText, type StoreStepFailure } from "../store/registerImport.js";

/** The store could not be opened or a statement failed — when the last read ran is UNKNOWN, never "never". */
export interface ReadStoreUnavailableError {
  readonly code: "READ_STORE_UNAVAILABLE";
  readonly message: string;
}

/** The old `landing-reads.json` exists and would not read, so its one-time import cannot happen. */
export interface ReadImportUnreadableError {
  readonly code: "READ_IMPORT_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** The old file holds an entry that is not a read; nothing was imported. */
export interface ReadImportInvalidError {
  readonly code: "READ_IMPORT_INVALID";
  readonly message: string;
  readonly path: string;
  readonly problems: readonly string[];
}

/** A stored row does not decode — corrupt, never skipped. */
export interface ReadRecordInvalidError {
  readonly code: "READ_RECORD_INVALID";
  readonly message: string;
  readonly selection: string;
}

/** Another writer moved this selection's cursor between this writer's read and its compare-and-set. */
export interface ReadRevisionConflictError {
  readonly code: "READ_REVISION_CONFLICT";
  readonly message: string;
  readonly selection: string;
  /** The revision this writer pinned to; `0` when it expected no row at all. */
  readonly expectedRevision: number;
}

/** Every way the landing-read cursor refuses. */
export type ReadJournalError =
  | ReadStoreUnavailableError
  | ReadImportUnreadableError
  | ReadImportInvalidError
  | ReadRecordInvalidError
  | ReadRevisionConflictError;

/** A read entry — of the old file or a stored row — that is not an object at all. */
export interface ReadNotAnObjectError {
  readonly code: "READ_NOT_AN_OBJECT";
  readonly message: string;
}

/** A read entry whose named field is absent or malformed. */
export interface ReadFieldInvalidError {
  readonly code: "READ_FIELD_INVALID";
  readonly field: string;
  readonly message: string;
}

/** A read entry filed under the empty selection key. */
export interface ReadSelectionEmptyError {
  readonly code: "READ_SELECTION_EMPTY";
  readonly message: string;
}

/** A read entry filed under a key `selectionKey` never spells — a lookup would miss it and read "never". */
export interface ReadSelectionNotCanonicalError {
  readonly code: "READ_SELECTION_NOT_CANONICAL";
  readonly message: string;
}

/** A read entry claiming more dispatchable pull requests than it judged. */
export interface ReadCountsInconsistentError {
  readonly code: "READ_COUNTS_INCONSISTENT";
  readonly message: string;
}

/** The old file's whole document is not an object keyed by selection. */
export interface ReadDocumentNotAnObjectError {
  readonly code: "READ_DOCUMENT_NOT_AN_OBJECT";
  readonly message: string;
}

/** Why one entry is not a read. Its `message` completes a sentence that names the entry. */
export type ReadDecodeError =
  | ReadNotAnObjectError
  | ReadFieldInvalidError
  | ReadSelectionEmptyError
  | ReadSelectionNotCanonicalError
  | ReadCountsInconsistentError
  | ReadDocumentNotAnObjectError;

/** Constructors for {@link ReadDecodeError}. */
export const ReadDecodeErrors = {
  countsInconsistent: (): ReadCountsInconsistentError => ({
    code: "READ_COUNTS_INCONSISTENT",
    message: "claims more dispatchable rows than rows",
  }),
  documentNotAnObject: (): ReadDocumentNotAnObjectError => ({
    code: "READ_DOCUMENT_NOT_AN_OBJECT",
    message: "the document is not an object",
  }),
  fieldInvalid: ({ field, qualifier }: { field: string; qualifier: string }): ReadFieldInvalidError => ({
    code: "READ_FIELD_INVALID",
    field,
    message: `carries no ${qualifier} ${field}`,
  }),
  notAnObject: (): ReadNotAnObjectError => ({ code: "READ_NOT_AN_OBJECT", message: "is not an object" }),
  selectionEmpty: (): ReadSelectionEmptyError => ({
    code: "READ_SELECTION_EMPTY",
    message: "is filed under an empty selection",
  }),
  selectionNotCanonical: (): ReadSelectionNotCanonicalError => ({
    code: "READ_SELECTION_NOT_CANONICAL",
    message: "is filed under a selection no invocation spells, so no lookup would ever find it",
  }),
} as const;

/** Constructors for {@link ReadJournalError}. */
export const ReadJournalErrors = {
  importProblem: ({ problem }: { problem: ImportFileProblem }): ReadImportUnreadableError | ReadImportInvalidError => {
    const message =
      `the landing-read cursor moved into the store and its old file must be imported once, but ` +
      `${importProblemText({ problem })} — nothing was imported, so when each selection was last read is UNKNOWN`;
    if (problem.kind === "unreadable") {
      return { code: "READ_IMPORT_UNREADABLE", message, path: problem.path };
    }
    return { code: "READ_IMPORT_INVALID", message, path: problem.path, problems: problem.problems };
  },
  recordInvalid: ({ selection, reason }: { selection: string; reason: string }): ReadRecordInvalidError => ({
    code: "READ_RECORD_INVALID",
    message: `the stored landing read for ${selection} ${reason}, so the cadence cannot be judged`,
    selection,
  }),
  revisionConflict: ({
    selection,
    expectedRevision,
  }: {
    selection: string;
    expectedRevision: number;
  }): ReadRevisionConflictError => ({
    code: "READ_REVISION_CONFLICT",
    expectedRevision,
    message:
      `the landing read for ${selection} was recorded by another writer while this one was being written (read ` +
      `at revision ${String(expectedRevision)}), so nothing was written; the newer read stands`,
    selection,
  }),
  storeUnavailable: ({ doing, reason }: StoreStepFailure): ReadStoreUnavailableError => ({
    code: "READ_STORE_UNAVAILABLE",
    message:
      `the landing-read cursor lives in the store, and the store could not ${doing}, so whether this read is ` +
      `due is UNKNOWN (\`slopweaver store status\` says what the store is doing). The store said: ${reason}`,
  }),
} as const;
