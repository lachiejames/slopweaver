/**
 * Every way `slopweaver talk quarantine` refuses to accept a gone call, and every way its ledger cannot be read —
 * its own union, because a refusal here is the difference between a loss accepted on the record and one refused
 * forever, and a caller says which.
 */

/** The id is not a call id the store would ever name a file after. */
export interface QuarantineCallIdInvalidError {
  readonly code: "QUARANTINE_CALL_ID_INVALID";
  readonly message: string;
  readonly callId: string;
}

/** The reason is empty: a quarantine is a witness, and one that says nothing explains no loss. */
export interface QuarantineReasonEmptyError {
  readonly code: "QUARANTINE_REASON_EMPTY";
  readonly message: string;
}

/** Neither the call index nor any reader's cursor names the call, so there is nothing a read refuses to accept. */
export interface QuarantineCallUnknownError {
  readonly code: "QUARANTINE_CALL_UNKNOWN";
  readonly message: string;
  readonly callId: string;
}

/** Something is at the call's path — a file, however damaged, is repaired or read, never accepted as gone. */
export interface QuarantineCallPresentError {
  readonly code: "QUARANTINE_CALL_PRESENT";
  readonly message: string;
  readonly callId: string;
  readonly path: string;
}

/** The ledger already accepts this call; the first row is the witness, and a second would only muddy it. */
export interface QuarantineAlreadyError {
  readonly code: "QUARANTINE_ALREADY";
  readonly message: string;
  readonly callId: string;
}

/** A ledger line the verb never writes, or a tail with no newline — damage, refused rather than skipped. */
export interface QuarantineLedgerMalformedError {
  readonly code: "QUARANTINE_LEDGER_MALFORMED";
  readonly message: string;
  readonly path: string;
}

/** The call index or a reader's cursor could not be read, so whether the call is known cannot be established. */
export interface QuarantineWitnessUnreadableError {
  readonly code: "QUARANTINE_WITNESS_UNREADABLE";
  readonly message: string;
}

/** The row this quarantine would write is one the ledger's reader refuses, so writing it would block every read. */
export interface QuarantineRowInvalidError {
  readonly code: "QUARANTINE_ROW_INVALID";
  readonly message: string;
}

/** The ledger, its lock or the call's lock could not be read or written. */
export interface QuarantineIoError {
  readonly code: "QUARANTINE_IO";
  readonly message: string;
  readonly path: string;
  readonly cause: unknown;
}

/** Every way a quarantine is refused or its ledger unreadable. */
export type CallQuarantineError =
  | QuarantineCallIdInvalidError
  | QuarantineReasonEmptyError
  | QuarantineCallUnknownError
  | QuarantineCallPresentError
  | QuarantineAlreadyError
  | QuarantineLedgerMalformedError
  | QuarantineWitnessUnreadableError
  | QuarantineRowInvalidError
  | QuarantineIoError;

/** The factories every quarantine failure is constructed through. */
export const CallQuarantineErrors = {
  already: ({ callId, atIso }: { callId: string; atIso: string }): QuarantineAlreadyError => ({
    callId,
    code: "QUARANTINE_ALREADY",
    message: `call ${callId} was already quarantined at ${atIso}; that row stands as the witness, so nothing is written`,
  }),
  callIdInvalid: ({ callId }: { callId: string }): QuarantineCallIdInvalidError => ({
    callId,
    code: "QUARANTINE_CALL_ID_INVALID",
    message: `${JSON.stringify(callId)} is not a call id (a v4 UUID, as talk/calls names its files)`,
  }),
  callPresent: ({ callId, path }: { callId: string; path: string }): QuarantineCallPresentError => ({
    callId,
    code: "QUARANTINE_CALL_PRESENT",
    message:
      `something is at ${path}, so call ${callId} is not gone; a quarantine accepts only a file that is absent — ` +
      "a damaged or rewritten one is repaired or read, never accepted unread",
    path,
  }),
  callUnknown: ({ callId }: { callId: string }): QuarantineCallUnknownError => ({
    callId,
    code: "QUARANTINE_CALL_UNKNOWN",
    message:
      `neither the call index nor any talk unread cursor names call ${callId}, so no read refuses it and there is ` +
      "nothing to accept — check the id",
  }),
  io: ({ path, cause }: { path: string; cause: unknown }): QuarantineIoError => ({
    cause,
    code: "QUARANTINE_IO",
    message: `could not read or write ${path}: ${cause instanceof Error ? cause.message : String(cause)}`,
    path,
  }),
  ledgerMalformed: ({ path, why }: { path: string; why: string }): QuarantineLedgerMalformedError => ({
    code: "QUARANTINE_LEDGER_MALFORMED",
    message:
      `${path} is damaged — ${why}; the ledger is what lets a gone call be read past, so a damaged one is refused ` +
      "rather than read as accepting fewer calls",
    path,
  }),
  reasonEmpty: (): QuarantineReasonEmptyError => ({
    code: "QUARANTINE_REASON_EMPTY",
    message: "a quarantine needs --reason: what removed the file and why its words are not the owner's, or are lost",
  }),
  rowInvalid: ({ why }: { why: string }): QuarantineRowInvalidError => ({
    code: "QUARANTINE_ROW_INVALID",
    message: `the row would be refused by every read of the ledger (${why}), so nothing is written`,
  }),
  witnessUnreadable: ({ why }: { why: string }): QuarantineWitnessUnreadableError => ({
    code: "QUARANTINE_WITNESS_UNREADABLE",
    message: `whether the call is known cannot be established: ${why}`,
  }),
} as const;
