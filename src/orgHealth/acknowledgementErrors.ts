/**
 * The incident-acknowledgement module's typed errors — its own union, never shared (`.claude/rules/error-handling.md`).
 *
 * Kept apart from `./errors.ts`, whose every variant is a reason the snapshot is written `unmeasurable`; none of
 * these is.
 */

/** The acknowledgement ledger could not be read or written, or holds a line that will not read. */
export interface AcknowledgementLedgerIoError {
  readonly code: "LEDGER_IO";
  readonly message: string;
  readonly path: string;
}

/** The incident snapshot cannot be believed, so there is no state to say the owner acknowledged. */
export interface AcknowledgementNotMeasuredError {
  readonly code: "NOT_MEASURED";
  readonly message: string;
  readonly because: string;
}

/** The reference names no incident the snapshot holds open. */
export interface AcknowledgementNotOpenError {
  readonly code: "NOT_OPEN";
  readonly message: string;
  readonly ref: string;
}

/** The snapshot holds more than one open incident under the reference, so a row naming it would describe neither. */
export interface AcknowledgementAmbiguousRefError {
  readonly code: "AMBIGUOUS_REF";
  readonly message: string;
  readonly ref: string;
}

/**
 * The store holding the acknowledgement rows could not be opened or answered. Never a file fallback: with the rows
 * unknown, no incident can be called acknowledged, or not.
 */
export interface AcknowledgementStoreUnavailableError {
  readonly code: "STORE_UNAVAILABLE";
  readonly message: string;
}

/**
 * A stored acknowledgement row does not decode — or a press to record would not, so it is never stored. The newest
 * row for an incident may be that very one, so the ledger is refused whole, exactly as a line of the old file that
 * would not read was.
 */
export interface AcknowledgementStoredInvalidError {
  readonly code: "STORED_INVALID";
  readonly message: string;
}

/** Every way acknowledging an incident, or reading the acknowledgements, fails. */
export type AcknowledgementError =
  | AcknowledgementAmbiguousRefError
  | AcknowledgementLedgerIoError
  | AcknowledgementNotMeasuredError
  | AcknowledgementNotOpenError
  | AcknowledgementStoreUnavailableError
  | AcknowledgementStoredInvalidError;

/** The one place each variant's message is worded. */
export const AcknowledgementErrors = {
  ambiguousRef: ({ ref, because }: { ref: string; because: string }): AcknowledgementAmbiguousRefError => ({
    code: "AMBIGUOUS_REF",
    message: `nothing was acknowledged: ${because}`,
    ref,
  }),
  ledgerIo: ({ path, cause }: { path: string; cause: unknown }): AcknowledgementLedgerIoError => ({
    code: "LEDGER_IO",
    message: `the incident-acknowledgement ledger at ${path} could not be used: ${cause instanceof Error ? cause.message : String(cause)}`,
    path,
  }),
  notMeasured: ({ because }: { because: string }): AcknowledgementNotMeasuredError => ({
    because,
    code: "NOT_MEASURED",
    message: `nothing to acknowledge against: the incident snapshot is not measured (${because})`,
  }),
  notOpen: ({ ref }: { ref: string }): AcknowledgementNotOpenError => ({
    code: "NOT_OPEN",
    message: `${ref} is not an open incident in the current snapshot, so there is nothing to acknowledge`,
    ref,
  }),
  storeUnavailable: ({ doing, reason }: { doing: string; reason: string }): AcknowledgementStoreUnavailableError => ({
    code: "STORE_UNAVAILABLE",
    message:
      `the incident acknowledgements live in the store, and the store could not ${doing}, so which incidents the owner ` +
      "acknowledged is UNKNOWN — refusing rather than reading a file that stopped being the authority " +
      `(\`slopweaver store status\` says what the store is doing). The store said: ${reason}`,
  }),
  storedInvalid: ({ detail }: { detail: string }): AcknowledgementStoredInvalidError => ({
    code: "STORED_INVALID",
    message: `the stored incident acknowledgements cannot be trusted: ${detail}`,
  }),
} as const;
