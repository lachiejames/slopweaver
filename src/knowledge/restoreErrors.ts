/**
 * The variants of `KnowledgeError` that only `knowledge restore` raises — the default mode's empty-table
 * refusal and every way a `--merge` is refused whole. Shapes only; `./errors.ts` owns the union and the
 * factory that builds each one.
 */

/** The two tables a restore writes, by their database names. */
export type RestoreTable = "memories" | "memory_recalls";

/** A default restore found the table already holding rows. `--merge` is the mode for a live database. */
export interface RestoreNotEmptyError {
  readonly code: "RESTORE_NOT_EMPTY";
  readonly message: string;
  readonly table: RestoreTable;
}

/**
 * A merge met a row the database already holds under a different shape. Carries the KIND of clash and the
 * row's structural id only, never either side's content.
 */
export interface RestoreConflictError {
  readonly code: "RESTORE_CONFLICT";
  readonly message: string;
  readonly table: RestoreTable;
  readonly conflict: "recording-differs" | "recall-differs" | "import-key-taken";
  readonly rowId: string;
}

/** The export holds two rows sharing a key that must be unique — a damaged backup, refused whole. */
export interface RestoreDuplicateKeyError {
  readonly code: "RESTORE_DUPLICATE_KEY";
  readonly message: string;
  readonly table: RestoreTable;
  readonly key: "recordingId" | "importKey" | "seq" | "recallId";
  readonly value: string;
}

/**
 * A merged row would link to nothing: a `supersedes` naming no claim of its kind, or a recall naming a
 * recording that is absent or belongs to another claim. Carries the incoming row's id and which link broke.
 */
export interface RestoreClosureBrokenError {
  readonly code: "RESTORE_CLOSURE_BROKEN";
  readonly message: string;
  readonly table: RestoreTable;
  readonly link: "supersedes" | "recall-recording" | "recall-claim";
  readonly rowId: string;
}

/**
 * Another session kept writing to one of the two tables through every ask for their locks. A restore asks
 * without waiting, so it never holds one table while queued on the other; this is it giving up, holding nothing.
 */
export interface RestoreLockBusyError {
  readonly code: "RESTORE_LOCK_BUSY";
  readonly message: string;
  readonly attempts: number;
}

/**
 * A merge would renumber past `Number.MAX_SAFE_INTEGER`, where two sequence values round to one. The column is
 * a `bigserial` read as a JavaScript number, so the plan refuses rather than hand out a value it cannot hold.
 */
export interface RestoreSeqExhaustedError {
  readonly code: "RESTORE_SEQ_EXHAUSTED";
  readonly message: string;
  readonly table: RestoreTable;
  readonly floor: number;
}
