/**
 * Every way the autonomy ledger's store can refuse — the typed union `./port.ts` answers in.
 *
 * Judging a record (`INVALID_FIELD`, `UNKNOWN_ACTION`, `ACTION_ID_CONFLICT`, …) stays an `AutonomyError`
 * (`./errors.ts`): that is a verdict on the record. This domain answers which rows exist and whether a write
 * landed. A message here never carries the connection string.
 */

/** The store could not be opened, queried or closed — selection, connection, a foreign schema or a statement. */
export interface AutonomyStoreUnavailableError {
  readonly code: "AUTONOMY_STORE_UNAVAILABLE";
  readonly message: string;
}

/** The home still holds a register file and the store has no record of importing it. */
export interface AutonomyNotImportedError {
  readonly code: "AUTONOMY_NOT_IMPORTED";
  readonly message: string;
  readonly sourcePath: string;
}

/** The store has no import record, and whether the register file is there could not be told either way. */
export interface AutonomyImportStateUnavailableError {
  readonly code: "AUTONOMY_IMPORT_STATE_UNAVAILABLE";
  readonly message: string;
  readonly sourcePath: string;
}

/** A stored `record` that does not validate as an act, a steer or a class steer. */
export interface AutonomyRowUnreadableError {
  readonly code: "AUTONOMY_ROW_UNREADABLE";
  readonly message: string;
  readonly importKey: string;
}

/** An insert lost on its own key with no act in the store to explain it — never an outage, never retried. */
export interface AutonomyWriteKeyTakenError {
  readonly code: "AUTONOMY_WRITE_KEY_TAKEN";
  readonly message: string;
  readonly actionId: string;
}

/** A validated record the store cannot hold verbatim — a NUL byte, or an instant that is not one. */
export interface AutonomyRecordUnstorableError {
  readonly code: "AUTONOMY_RECORD_UNSTORABLE";
  readonly message: string;
  readonly actionId: string;
}

/** A revision's compare-and-swap matched no row: the act changed, or went, between the read and the write. */
export interface AutonomyRevisionLostError {
  readonly code: "AUTONOMY_REVISION_LOST";
  readonly message: string;
  readonly actionId: string;
}

/** Every failure the autonomy ledger's store answers. */
export type AutonomyStoreError =
  | AutonomyRevisionLostError
  | AutonomyStoreUnavailableError
  | AutonomyNotImportedError
  | AutonomyImportStateUnavailableError
  | AutonomyRowUnreadableError
  | AutonomyWriteKeyTakenError
  | AutonomyRecordUnstorableError;

/** The command that imports a home's register, named in every refusal that needs it run. */
const IMPORT_COMMAND = "slopweaver store import-fleet --only autonomy";

/** The factories every autonomy store failure is built through. */
export const AutonomyStoreErrors = {
  importStateUnavailable: ({
    reason,
    sourcePath,
  }: {
    reason: string;
    sourcePath: string;
  }): AutonomyImportStateUnavailableError => ({
    code: "AUTONOMY_IMPORT_STATE_UNAVAILABLE",
    message:
      `the store holds no record of importing this home's autonomy register, and whether ${sourcePath} is there ` +
      `could not be told (${reason}) — refusing rather than reading the ledger as possibly empty`,
    sourcePath,
  }),
  notImported: ({ sourcePath }: { sourcePath: string }): AutonomyNotImportedError => ({
    code: "AUTONOMY_NOT_IMPORTED",
    message:
      `the autonomy ledger lives in the store, and ${sourcePath} has not been imported into it yet, so the store ` +
      `cannot answer what was done without asking — run \`${IMPORT_COMMAND}\` once, then try again`,
    sourcePath,
  }),
  recordUnstorable: ({ actionId, reason }: { actionId: string; reason: string }): AutonomyRecordUnstorableError => ({
    actionId,
    code: "AUTONOMY_RECORD_UNSTORABLE",
    message: `the record for ${actionId} cannot be stored verbatim: ${reason}`,
  }),
  revisionLost: ({ actionId }: { actionId: string }): AutonomyRevisionLostError => ({
    actionId,
    code: "AUTONOMY_REVISION_LOST",
    message:
      `the act ${actionId} changed in the store between this repair's read and its write, so nothing was ` +
      "written — run it again and read the new row",
  }),
  rowUnreadable: ({ importKey, why }: { importKey: string; why: string }): AutonomyRowUnreadableError => ({
    code: "AUTONOMY_ROW_UNREADABLE",
    importKey,
    message:
      `autonomy_event ${importKey} holds a record that is not an act, a steer or a class steer (${why}), so the ` +
      `ledger is refused whole rather than read with a row missing`,
  }),
  storeUnavailable: ({ doing, reason }: { doing: string; reason: string }): AutonomyStoreUnavailableError => ({
    code: "AUTONOMY_STORE_UNAVAILABLE",
    message:
      `the autonomy ledger lives in the store, and the store could not ${doing}, so nothing can be read or ` +
      `recorded — refusing rather than reading a home file that stopped being the record ` +
      `(\`slopweaver store status\` says what the store is doing). The store said: ${reason}`,
  }),
  writeKeyTaken: ({ actionId }: { actionId: string }): AutonomyWriteKeyTakenError => ({
    actionId,
    code: "AUTONOMY_WRITE_KEY_TAKEN",
    message: `the write for ${actionId} collided with a stored row's key, so nothing was written — record it again`,
  }),
} as const;
