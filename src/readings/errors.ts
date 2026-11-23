/**
 * The readings ledger's own typed failure union.
 *
 * A union because these kinds are BRANCHED ON: `reading last` exits differently on "no reading yet" (a
 * page shows the honest absence) than on "the index could not be read" (a page must never render that as
 * empty), and `reading record` on a field it could not validate than on a lock it could not take.
 */

/** A field is absent, empty, too long, or not the shape its own rule requires. */
export interface ReadingInvalidFieldError {
  readonly code: "INVALID_FIELD";
  readonly message: string;
  readonly field: string;
}

/** A stored index line is not a complete row. Carries the line number to inspect. */
export interface ReadingCorruptRowError {
  readonly code: "CORRUPT_ROW";
  readonly message: string;
  readonly lineNumber: number;
  readonly why: string;
}

/** The index, a document file or the directory could not be read or written. */
export interface ReadingStoreUnreadableError {
  readonly code: "STORE_UNREADABLE";
  readonly message: string;
  readonly path: string;
  readonly cause: unknown;
}

/** Another writer holds the ledger's lock. Nothing was written. */
export interface ReadingLedgerBusyError {
  readonly code: "LEDGER_BUSY";
  readonly message: string;
}

/** The ledger holds no reading for that producer — a fact a page shows, never an empty document. */
export interface NoReadingError {
  readonly code: "NO_READING";
  readonly message: string;
  readonly producer: string;
}

export type ReadingsError =
  | ReadingInvalidFieldError
  | ReadingCorruptRowError
  | ReadingStoreUnreadableError
  | ReadingLedgerBusyError
  | NoReadingError;

/** The one place every readings-ledger failure is built. */
export const ReadingsErrors = {
  corruptRow: ({ lineNumber, why }: { lineNumber: number; why: string }): ReadingCorruptRowError => ({
    code: "CORRUPT_ROW",
    lineNumber,
    message: `readings index line ${String(lineNumber)} is not a reading row — ${why}`,
    why,
  }),
  invalidField: ({ field, why }: { field: string; why: string }): ReadingInvalidFieldError => ({
    code: "INVALID_FIELD",
    field,
    message: `${field} ${why}`,
  }),
  ledgerBusy: ({ why }: { why: string }): ReadingLedgerBusyError => ({
    code: "LEDGER_BUSY",
    message: `another session is writing the readings ledger right now (${why}) — nothing was written; try again`,
  }),
  noReading: ({ producer }: { producer: string }): NoReadingError => ({
    code: "NO_READING",
    message: `the readings ledger holds no reading by \`${producer}\` yet — record one with \`slopweaver reading record\``,
    producer,
  }),
  storeUnreadable: ({ path, cause }: { path: string; cause: unknown }): ReadingStoreUnreadableError => ({
    cause,
    code: "STORE_UNREADABLE",
    message: `could not read the readings ledger at ${path} — refusing rather than reporting it empty`,
    path,
  }),
} as const;
