/**
 * Why the store-backed door ledger could not answer — its own union, scoped to this one module
 * (`.claude/rules/error-handling.md`). A store outage, an import that has not run, and a stored row that will not
 * decode are each a distinct refusal, and none of them is ever an empty audit trail or a file fallback.
 */

/** The verb that imports the legacy ledger once. */
const IMPORT_COMMAND = "slopweaver store import-fleet --only door";

/** The store could not be opened, queried or closed. */
export interface DoorStoreUnavailableError {
  readonly code: "DOOR_STORE_UNAVAILABLE";
  readonly message: string;
}

/** The legacy ledger has not been reconciled with the store, so the store is not yet the whole trail. */
export interface DoorNotImportedError {
  readonly code: "DOOR_NOT_IMPORTED";
  readonly message: string;
  readonly sourcePath: string;
}

/** The store has no completed import, and whether the legacy ledger is there could not be told. */
export interface DoorImportStateUnavailableError {
  readonly code: "DOOR_IMPORT_STATE_UNAVAILABLE";
  readonly message: string;
  readonly sourcePath: string;
}

/** A stored row does not decode as a door decision or a pre-door refusal. */
export interface DoorRowUnreadableError {
  readonly code: "DOOR_ROW_UNREADABLE";
  readonly message: string;
  readonly importKey: string;
}

/** A door event cannot be held verbatim by the store (Postgres refuses a NUL byte, an instant did not parse). */
export interface DoorEventUnstorableError {
  readonly code: "DOOR_EVENT_UNSTORABLE";
  readonly message: string;
  readonly runId: string;
}

/** The written key was already taken, so the event was not retried or overwritten. */
export interface DoorWriteKeyTakenError {
  readonly code: "DOOR_WRITE_KEY_TAKEN";
  readonly message: string;
  readonly importKey: string;
}

/** Every refusal the store-backed door ledger can give. */
export type DoorStoreError =
  | DoorStoreUnavailableError
  | DoorNotImportedError
  | DoorImportStateUnavailableError
  | DoorRowUnreadableError
  | DoorEventUnstorableError
  | DoorWriteKeyTakenError;

/** Factories for every {@link DoorStoreError}, so a test builds them the way the real code does. */
export const DoorStoreErrors = {
  eventUnstorable: ({ runId, reason }: { runId: string; reason: string }): DoorEventUnstorableError => ({
    code: "DOOR_EVENT_UNSTORABLE",
    message: `door event ${runId} cannot be stored verbatim: ${reason}, so the external effect was not performed`,
    runId,
  }),
  importStateUnavailable: ({
    reason,
    sourcePath,
  }: {
    reason: string;
    sourcePath: string;
  }): DoorImportStateUnavailableError => ({
    code: "DOOR_IMPORT_STATE_UNAVAILABLE",
    message:
      `the store has no completed door import, and whether ${sourcePath} is there could not be told ` +
      `(${reason}) — refusing rather than treating a possibly incomplete audit trail as the whole one`,
    sourcePath,
  }),
  notImported: ({ sourcePath }: { sourcePath: string }): DoorNotImportedError => ({
    code: "DOOR_NOT_IMPORTED",
    message:
      `the door ledger lives in the store, and ${sourcePath} has not been imported into it yet, so nothing can ` +
      `be recorded or read — run \`${IMPORT_COMMAND}\` once, then try again`,
    sourcePath,
  }),
  rowUnreadable: ({ importKey, reason }: { importKey: string; reason: string }): DoorRowUnreadableError => ({
    code: "DOOR_ROW_UNREADABLE",
    importKey,
    message: `door_event ${importKey} does not decode as a door decision or a pre-door refusal (${reason})`,
  }),
  storeUnavailable: ({ doing, reason }: { doing: string; reason: string }): DoorStoreUnavailableError => ({
    code: "DOOR_STORE_UNAVAILABLE",
    message:
      `the door ledger lives in the store, and the store could not ${doing}; no file stands in for it, so ` +
      `nothing is done unaudited (\`slopweaver store status\` says what the store is doing). The store said: ${reason}`,
  }),
  writeKeyTaken: ({ importKey }: { importKey: string }): DoorWriteKeyTakenError => ({
    code: "DOOR_WRITE_KEY_TAKEN",
    importKey,
    message: `door event key ${importKey} is already present, so the event was neither retried nor overwritten`,
  }),
} as const;
