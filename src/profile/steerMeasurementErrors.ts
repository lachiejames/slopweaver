/**
 * Why the owner's steer measurements, or one appended to them, do not read — scoped to that one register: its one-time
 * import from the home journal, and the store it lives in. A journal line that does not parse is NOT here: it is a
 * measurement kept as it was and read back as unparsed, never a refusal.
 */

/** The home journal the register is imported from would not be read: unreadable, linked, or not a regular file. */
export interface SteerHomeFileUnreadableError {
  readonly code: "STEER_HOME_FILE_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** The home journal is there and is not the bytes its import recorded, so an append after the import would be lost. */
export interface SteerHomeFileChangedAfterImportError {
  readonly code: "STEER_HOME_FILE_CHANGED_AFTER_IMPORT";
  readonly message: string;
  readonly path: string;
}

/** The home selects no store, and the operation needs one. */
export interface SteerStoreUnselectedError {
  readonly code: "STEER_STORE_UNSELECTED";
  readonly message: string;
  /** The store's own sentence on how a home selects one. */
  readonly selection: string;
}

/** The selected store could not finish a step. */
export interface SteerStoreUnavailableError {
  readonly code: "STEER_STORE_UNAVAILABLE";
  readonly message: string;
}

/** The import marker claims a different number of imported lines than the table holds. */
export interface SteerImportMarkerInconsistentError {
  readonly code: "STEER_IMPORT_MARKER_INCONSISTENT";
  readonly message: string;
  readonly expected: number;
  readonly observed: number;
}

/** A row carrying a legacy id is not the line its id was minted from, so the table was written behind its checks. */
export interface SteerImportedRowAlteredError {
  readonly code: "STEER_IMPORTED_ROW_ALTERED";
  readonly message: string;
  readonly journalSeq: number;
}

/** A racing append met the sequence's unique index first, so nothing was written. */
export interface SteerAppendConflictError {
  readonly code: "STEER_APPEND_CONFLICT";
  readonly message: string;
}

/** A verdict whose line the register's own reader would not read back, so nothing was written. */
export interface SteerWriteUnreadableError {
  readonly code: "STEER_WRITE_UNREADABLE";
  readonly message: string;
}

/** Every way the steer-measurement register fails. */
export type SteerMeasurementError =
  | SteerHomeFileUnreadableError
  | SteerHomeFileChangedAfterImportError
  | SteerStoreUnselectedError
  | SteerStoreUnavailableError
  | SteerImportMarkerInconsistentError
  | SteerImportedRowAlteredError
  | SteerAppendConflictError
  | SteerWriteUnreadableError;

export const SteerMeasurementErrors = {
  appendConflict: ({ reason }: { reason: string }): SteerAppendConflictError => ({
    code: "STEER_APPEND_CONFLICT",
    message: `another steer measurement landed first, so this one wrote nothing — run it again: ${reason}`,
  }),
  importMarkerInconsistent: ({
    expected,
    observed,
  }: {
    expected: number;
    observed: number;
  }): SteerImportMarkerInconsistentError => ({
    code: "STEER_IMPORT_MARKER_INCONSISTENT",
    expected,
    message: `the steer-measurement import marker says ${String(expected)} line(s) were imported, and the table holds ${String(observed)}`,
    observed,
  }),
  homeFileChanged: ({ path }: { path: string }): SteerHomeFileChangedAfterImportError => ({
    code: "STEER_HOME_FILE_CHANGED_AFTER_IMPORT",
    message:
      `${path} is not the file the store imported its steer measurements from, so something wrote to it after the ` +
      "import — an append there would be lost; move it aside and judge what it adds again with `profile steers judge`",
    path,
  }),
  importedRowAltered: ({ journalSeq }: { journalSeq: number }): SteerImportedRowAlteredError => ({
    code: "STEER_IMPORTED_ROW_ALTERED",
    journalSeq,
    message:
      `the steer measurement at sequence ${String(journalSeq)} is not the line its legacy id was minted from, so ` +
      "the table was written behind its own checks — restore the store from a backup rather than read it",
  }),
  homeFileUnreadable: ({ path, reason }: { path: string; reason: string }): SteerHomeFileUnreadableError => ({
    code: "STEER_HOME_FILE_UNREADABLE",
    message: `the steer-kind journal ${path} would not read: ${reason}`,
    path,
  }),
  storeUnavailable: ({ doing, reason }: { doing: string; reason: string }): SteerStoreUnavailableError => ({
    code: "STEER_STORE_UNAVAILABLE",
    message: `the store could not ${doing}: ${reason}`,
  }),
  storeUnselected: ({ needed, selection }: { needed: string; selection: string }): SteerStoreUnselectedError => ({
    code: "STEER_STORE_UNSELECTED",
    message: `steer measurements ${needed}, and this home selects no store: ${selection}`,
    selection,
  }),
  writeUnreadable: ({ why }: { why: string }): SteerWriteUnreadableError => ({
    code: "STEER_WRITE_UNREADABLE",
    message: `this verdict would record a line the register cannot read back, so it wrote nothing: ${why}`,
  }),
} as const;
