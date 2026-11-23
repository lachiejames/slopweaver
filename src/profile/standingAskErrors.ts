/**
 * Why the standing-ask register, or one write to it, does not read — `./standingAsks.ts`'s own union, scoped to
 * that one register: the journal's grammar, its one-time import from the home file, and the store it lives in.
 */

/** A journal line that is not one event: not JSON, not a known kind, or a field that will not read. */
export interface LineUnreadableError {
  readonly code: "LINE_UNREADABLE";
  readonly message: string;
  readonly line: number;
}

/** A `recorded` event for an id another active ask already holds. */
export interface DuplicateIdError {
  readonly code: "DUPLICATE_ID";
  readonly message: string;
  readonly id: string;
}

/** A `withdrawn` event naming no active ask. */
export interface UnknownWithdrawalError {
  readonly code: "UNKNOWN_WITHDRAWAL";
  readonly message: string;
  readonly id: string;
}

/** A coverage another active ask already holds, so a card it covers would have two asks to quote. */
export interface CoverageOverlapError {
  readonly code: "COVERAGE_OVERLAP";
  readonly message: string;
  readonly coverage: string;
  readonly held: string;
}

/** A coverage outside the grammar {@link ./standingAsks.ts} names. */
export interface CoverageUnknownError {
  readonly code: "COVERAGE_UNKNOWN";
  readonly message: string;
  readonly coverage: string;
}

/** The home file the register is imported from would not be read: unreadable, linked, or not a regular file. */
export interface StandingAskHomeFileUnreadableError {
  readonly code: "STANDING_ASK_HOME_FILE_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** The home file is there and is not the bytes its import recorded, so an append after the import would be lost. */
export interface StandingAskHomeFileChangedError {
  readonly code: "STANDING_ASK_HOME_FILE_CHANGED_AFTER_IMPORT";
  readonly message: string;
  readonly path: string;
}

/** The home selects no store, and the operation needs one. */
export interface StandingAskStoreUnselectedError {
  readonly code: "STANDING_ASK_STORE_UNSELECTED";
  readonly message: string;
  /** The store's own sentence on how a home selects one. */
  readonly selection: string;
}

/** The selected store could not finish a step. */
export interface StandingAskStoreUnavailableError {
  readonly code: "STANDING_ASK_STORE_UNAVAILABLE";
  readonly message: string;
}

/** What the store holds does not read as one register: a row the journal's fold disagrees with. */
export interface StandingAskRowUnreadableError {
  readonly code: "STANDING_ASK_ROW_UNREADABLE";
  readonly message: string;
}

/** The import marker claims a different number of imported events than the journal table holds. */
export interface StandingAskImportMarkerInconsistentError {
  readonly code: "STANDING_ASK_IMPORT_MARKER_INCONSISTENT";
  readonly message: string;
  readonly expected: number;
  readonly observed: number;
}

/** A racing write met a unique index first, so nothing was written. */
export interface StandingAskWriteConflictError {
  readonly code: "STANDING_ASK_WRITE_CONFLICT";
  readonly message: string;
}

/** A write whose line the register's own reader would refuse or read differently, so nothing was written. */
export interface StandingAskWriteUnreadableError {
  readonly code: "STANDING_ASK_WRITE_UNREADABLE";
  readonly message: string;
}

/**
 * An imported ask would withdraw live asks while being written inactive: only a `take-imported` answer withdraws, and
 * that answer writes the import active, so the pair names no answer at all.
 */
export interface StandingAskImportAnswerContradictoryError {
  readonly code: "STANDING_ASK_IMPORT_ANSWER_CONTRADICTORY";
  readonly message: string;
  readonly id: string;
}

/** Every way the standing-ask register fails. */
export type StandingAskError =
  | LineUnreadableError
  | DuplicateIdError
  | UnknownWithdrawalError
  | CoverageOverlapError
  | CoverageUnknownError
  | StandingAskHomeFileUnreadableError
  | StandingAskHomeFileChangedError
  | StandingAskStoreUnselectedError
  | StandingAskStoreUnavailableError
  | StandingAskRowUnreadableError
  | StandingAskImportMarkerInconsistentError
  | StandingAskWriteConflictError
  | StandingAskWriteUnreadableError
  | StandingAskImportAnswerContradictoryError;

export const StandingAskErrors = {
  coverageOverlap: ({ coverage, held }: { coverage: string; held: string }): CoverageOverlapError => ({
    code: "COVERAGE_OVERLAP",
    coverage,
    held,
    message: `standing ask ${held} already covers ${coverage}; one card quotes one standing ask, so withdraw it first`,
  }),
  coverageUnknown: ({ coverage }: { coverage: string }): CoverageUnknownError => ({
    code: "COVERAGE_UNKNOWN",
    coverage,
    message: `${coverage} is not a coverage — findings, registered-rows, bot-replies, unlinked-cards or act:<kind>`,
  }),
  duplicateId: ({ id }: { id: string }): DuplicateIdError => ({
    code: "DUPLICATE_ID",
    id,
    message: `standing ask ${id} is already recorded and not withdrawn`,
  }),
  homeFileChanged: ({ path }: { path: string }): StandingAskHomeFileChangedError => ({
    code: "STANDING_ASK_HOME_FILE_CHANGED_AFTER_IMPORT",
    message:
      `${path} is not the file the store imported its standing asks from, so something wrote to it after the ` +
      "import — an append there would be lost; move it aside and re-record what it adds with `profile standing add`",
    path,
  }),
  homeFileUnreadable: ({ path, reason }: { path: string; reason: string }): StandingAskHomeFileUnreadableError => ({
    code: "STANDING_ASK_HOME_FILE_UNREADABLE",
    message: `the standing-ask journal ${path} would not read: ${reason}`,
    path,
  }),
  importAnswerContradictory: ({ id }: { id: string }): StandingAskImportAnswerContradictoryError => ({
    code: "STANDING_ASK_IMPORT_ANSWER_CONTRADICTORY",
    id,
    message: `the import would withdraw live asks for ${id} while writing it inactive, which no answer asks for; nothing was written`,
  }),
  importMarkerInconsistent: ({
    expected,
    observed,
  }: {
    expected: number;
    observed: number;
  }): StandingAskImportMarkerInconsistentError => ({
    code: "STANDING_ASK_IMPORT_MARKER_INCONSISTENT",
    expected,
    message: `the standing-ask import marker says ${String(expected)} event(s) were imported, and the journal table holds ${String(observed)}`,
    observed,
  }),
  lineUnreadable: ({ line, why }: { line: number; why: string }): LineUnreadableError => ({
    code: "LINE_UNREADABLE",
    line,
    message: `standing-ask journal line ${String(line)} does not read: ${why}`,
  }),
  rowUnreadable: ({ why }: { why: string }): StandingAskRowUnreadableError => ({
    code: "STANDING_ASK_ROW_UNREADABLE",
    message: `the stored standing asks do not read as one register: ${why}`,
  }),
  storeUnavailable: ({ doing, reason }: { doing: string; reason: string }): StandingAskStoreUnavailableError => ({
    code: "STANDING_ASK_STORE_UNAVAILABLE",
    message: `the store could not ${doing}: ${reason}`,
  }),
  storeUnselected: ({ needed, selection }: { needed: string; selection: string }): StandingAskStoreUnselectedError => ({
    code: "STANDING_ASK_STORE_UNSELECTED",
    message: `standing asks ${needed}, and this home selects no store: ${selection}`,
    selection,
  }),
  unknownWithdrawal: ({ id }: { id: string }): UnknownWithdrawalError => ({
    code: "UNKNOWN_WITHDRAWAL",
    id,
    message: `no active standing ask ${id} to withdraw`,
  }),
  writeConflict: ({ reason }: { reason: string }): StandingAskWriteConflictError => ({
    code: "STANDING_ASK_WRITE_CONFLICT",
    message: `another standing-ask write landed first, so this one wrote nothing — run it again: ${reason}`,
  }),
  writeUnreadable: ({ why }: { why: string }): StandingAskWriteUnreadableError => ({
    code: "STANDING_ASK_WRITE_UNREADABLE",
    message: `this standing-ask write would record a line the register cannot read back, so it wrote nothing: ${why}`,
  }),
} as const;
