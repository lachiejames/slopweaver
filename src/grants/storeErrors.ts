/**
 * Every way the grant journal's store can refuse — the typed union `./port.ts` answers in.
 *
 * Judging a row (`ROW_MISSING`, `ALREADY_PERFORMED`, …) stays a `GrantCheckError` (`./errors.ts`): that is a
 * session's verdict on a row it read. This domain answers which rows exist and whether a write landed. The two
 * meet in exactly one place — a lost performance insert is `GRANT_ALREADY_PERFORMED` here because the database,
 * not a read, is what decided it. A message here never carries the connection string.
 */

/** The store could not be opened, queried or closed — selection, connection, a foreign schema or a statement. */
export interface GrantStoreUnavailableError {
  readonly code: "GRANT_STORE_UNAVAILABLE";
  readonly message: string;
}

/** A stored row whose `entry` will not decode back into a grant, performance or refusal. */
export interface GrantRowUnreadableError {
  readonly code: "GRANT_ROW_UNREADABLE";
  readonly message: string;
  readonly importKey: string;
}

/** A grant insert lost: that id is already a recorded grant. */
export interface GrantIdTakenError {
  readonly code: "GRANT_ID_TAKEN";
  readonly message: string;
  readonly grantId: string;
}

/** A performance insert lost: that grant already has its one performance. */
export interface GrantAlreadyPerformedError {
  readonly code: "GRANT_ALREADY_PERFORMED";
  readonly message: string;
  readonly grantId: string;
}

/** A refusal insert lost on its own generated key — never an outage, and never retried. */
export interface GrantRefusalKeyTakenError {
  readonly code: "GRANT_REFUSAL_KEY_TAKEN";
  readonly message: string;
  readonly grantId: string;
}

/** An entry the store cannot hold verbatim: a NUL byte, or an instant that is not one. */
export interface GrantEntryUnstorableError {
  readonly code: "GRANT_ENTRY_UNSTORABLE";
  readonly message: string;
  readonly grantId: string;
}

/** Every failure the grant journal's store answers. */
export type GrantStoreError =
  | GrantStoreUnavailableError
  | GrantRowUnreadableError
  | GrantIdTakenError
  | GrantAlreadyPerformedError
  | GrantRefusalKeyTakenError
  | GrantEntryUnstorableError;

/** The factories every grant store failure is built through. */
export const GrantStoreErrors = {
  alreadyPerformed: ({ grantId }: { grantId: string }): GrantAlreadyPerformedError => ({
    code: "GRANT_ALREADY_PERFORMED",
    grantId,
    message: `grant ${grantId} already has its one performance in the store — one row is one change, so nothing was journalled`,
  }),
  entryUnstorable: ({ grantId, reason }: { grantId: string; reason: string }): GrantEntryUnstorableError => ({
    code: "GRANT_ENTRY_UNSTORABLE",
    grantId,
    message: `the entry for grant ${grantId} cannot be stored verbatim: ${reason}`,
  }),
  idTaken: ({ grantId }: { grantId: string }): GrantIdTakenError => ({
    code: "GRANT_ID_TAKEN",
    grantId,
    message: `grant id ${grantId} is already recorded in the store, so nothing was written — record again for a fresh id`,
  }),
  refusalKeyTaken: ({ grantId }: { grantId: string }): GrantRefusalKeyTakenError => ({
    code: "GRANT_REFUSAL_KEY_TAKEN",
    grantId,
    message: `the refusal of grant ${grantId} collided with a stored row's key, so nothing was written — run the refusal again`,
  }),
  rowUnreadable: ({ importKey }: { importKey: string }): GrantRowUnreadableError => ({
    code: "GRANT_ROW_UNREADABLE",
    importKey,
    message:
      `grant_row ${importKey} holds an entry that is not a grant, performance or refusal, so the journal is ` +
      `refused whole rather than read with a row missing`,
  }),
  storeUnavailable: ({ doing, reason }: { doing: string; reason: string }): GrantStoreUnavailableError => ({
    code: "GRANT_STORE_UNAVAILABLE",
    message:
      `the grant journal lives in the store, and the store could not ${doing}, so no row can be checked or ` +
      `written — refusing rather than reading a home file that stopped being the record ` +
      `(\`slopweaver store status\` says what the store is doing). The store said: ${reason}`,
  }),
} as const;
