/**
 * The card-spend register's failures — reading a pasted export, and reading or writing a stored snapshot.
 *
 * Each export failure names the LINE it is about, because the fix is always "the page shape changed, or the
 * paste lost a line", and a refusal that does not say where leaves somebody diffing two pastes by eye.
 */

/** A line the export must carry is not there at all. */
export interface ExportLineMissingError {
  readonly code: "EXPORT_LINE_MISSING";
  readonly message: string;
  readonly line: string;
}

/** A line the export carries is there, but not in the shape the page prints it. */
export interface ExportLineMalformedError {
  readonly code: "EXPORT_LINE_MALFORMED";
  readonly message: string;
  readonly line: string;
  readonly lineNumber: number;
  readonly text: string;
}

/** An amount is not `<digits>.<two digits> <CODE>`. */
export interface AmountUnparseableError {
  readonly code: "AMOUNT_UNPARSEABLE";
  readonly message: string;
  readonly lineNumber: number;
  readonly text: string;
}

/** A transaction's Status cell is not one the page is known to print. */
export interface StatusUnknownError {
  readonly code: "STATUS_UNKNOWN";
  readonly message: string;
  readonly lineNumber: number;
  readonly status: string;
}

/** A date is not a real `YYYY-MM-DD` day. */
export interface DateInvalidError {
  readonly code: "DATE_INVALID";
  readonly message: string;
  readonly lineNumber: number;
  readonly text: string;
}

/** A transaction is dated after the day the page was captured, so either the row or `--as-of` is wrong. */
export interface RowAfterCaptureError {
  readonly code: "ROW_AFTER_CAPTURE";
  readonly message: string;
  readonly lineNumber: number;
  readonly date: string;
  readonly asOf: string;
}

/**
 * The capture day is not inside the month the page's reset closes — after the reset, or more than a month before
 * it — so the page's used figure is not the capture day's period.
 */
export interface CaptureOutsidePeriodError {
  readonly code: "CAPTURE_OUTSIDE_PERIOD";
  readonly message: string;
  readonly asOf: string;
  readonly resetsOn: string;
}

/** The table heading states a row count the table under it does not hold — the paste lost or gained rows. */
export interface RowCountMismatchError {
  readonly code: "ROW_COUNT_MISMATCH";
  readonly message: string;
  readonly stated: number;
  readonly parsed: number;
}

/** The monthly used, the monthly limit and the transaction limit are not all in one currency. */
export interface LimitCurrencyMismatchError {
  readonly code: "LIMIT_CURRENCY_MISMATCH";
  readonly message: string;
  readonly currencies: readonly string[];
}

/** A stored snapshot could not be read off disk. */
export interface SnapshotUnreadableError {
  readonly code: "SNAPSHOT_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** A stored snapshot was read but is not a snapshot. */
export interface SnapshotInvalidError {
  readonly code: "SNAPSHOT_INVALID";
  readonly message: string;
  readonly path: string;
  readonly problems: readonly string[];
}

/** A snapshot could not be written. */
export interface SnapshotWriteFailedError {
  readonly code: "SNAPSHOT_WRITE_FAILED";
  readonly message: string;
  readonly path: string;
}

/** The card asked for has never been imported. */
export interface CardNotFoundError {
  readonly code: "CARD_NOT_FOUND";
  readonly message: string;
  readonly last4: string;
  readonly held: readonly string[];
}

/** Every way reading an export or the register can fail. */
export type SpendError =
  | ExportLineMissingError
  | ExportLineMalformedError
  | AmountUnparseableError
  | StatusUnknownError
  | DateInvalidError
  | RowAfterCaptureError
  | CaptureOutsidePeriodError
  | RowCountMismatchError
  | LimitCurrencyMismatchError
  | SnapshotUnreadableError
  | SnapshotInvalidError
  | SnapshotWriteFailedError
  | CardNotFoundError;

/** Build one typed spend failure. */
export const SpendErrors = {
  amountUnparseable: ({ lineNumber, text }: { lineNumber: number; text: string }): AmountUnparseableError => ({
    code: "AMOUNT_UNPARSEABLE",
    lineNumber,
    message: `line ${String(lineNumber)}: "${text}" is not an amount the page prints — expected e.g. "1,234.50 AUD"`,
    text,
  }),
  captureOutsidePeriod: ({ asOf, resetsOn }: { asOf: string; resetsOn: string }): CaptureOutsidePeriodError => {
    let where = "more than a day after";
    if (asOf < resetsOn) {
      where = "more than a month before";
    }
    return {
      asOf,
      code: "CAPTURE_OUTSIDE_PERIOD",
      message: `--as-of ${asOf} is ${where} the reset the page names (${resetsOn}), so the page cannot have been copied then — is --as-of the day it was copied?`,
      resetsOn,
    };
  },
  cardNotFound: ({ held, last4 }: { held: readonly string[]; last4: string }): CardNotFoundError => {
    let heldText = "no card has been imported yet — `slopweaver spend import <path> --as-of <date>`";
    if (held.length > 0) {
      heldText = `imported: ${held.join(", ")}`;
    }
    return { code: "CARD_NOT_FOUND", held, last4, message: `no card ending ${last4} — ${heldText}` };
  },
  dateInvalid: ({ lineNumber, text }: { lineNumber: number; text: string }): DateInvalidError => ({
    code: "DATE_INVALID",
    lineNumber,
    message: `line ${String(lineNumber)}: "${text}" is not a real YYYY-MM-DD day`,
    text,
  }),
  exportLineMalformed: ({
    line,
    lineNumber,
    text,
  }: {
    line: string;
    lineNumber: number;
    text: string;
  }): ExportLineMalformedError => ({
    code: "EXPORT_LINE_MALFORMED",
    line,
    lineNumber,
    message: `line ${String(lineNumber)}: the ${line} line is not in the shape the card page prints: ${text}`,
    text,
  }),
  exportLineMissing: ({ line }: { line: string }): ExportLineMissingError => ({
    code: "EXPORT_LINE_MISSING",
    line,
    message: `the export carries no ${line} line — was the whole card page pasted?`,
  }),
  limitCurrencyMismatch: ({ currencies }: { currencies: readonly string[] }): LimitCurrencyMismatchError => ({
    code: "LIMIT_CURRENCY_MISMATCH",
    currencies,
    message: `the card's limits are in more than one currency (${currencies.join(", ")}) — headroom cannot be computed without a rate the page does not show`,
  }),
  rowAfterCapture: ({
    asOf,
    date,
    lineNumber,
  }: {
    asOf: string;
    date: string;
    lineNumber: number;
  }): RowAfterCaptureError => ({
    asOf,
    code: "ROW_AFTER_CAPTURE",
    date,
    lineNumber,
    message: `line ${String(lineNumber)}: a transaction dated ${date} is after the capture day ${asOf} — is --as-of the day the page was copied?`,
  }),
  rowCountMismatch: ({ parsed, stated }: { parsed: number; stated: number }): RowCountMismatchError => ({
    code: "ROW_COUNT_MISMATCH",
    message: `the transactions heading says ${String(stated)} row(s) but the table holds ${String(parsed)} — the paste lost or split rows`,
    parsed,
    stated,
  }),
  snapshotInvalid: ({ path, problems }: { path: string; problems: readonly string[] }): SnapshotInvalidError => ({
    code: "SNAPSHOT_INVALID",
    message: `${path} is not a card snapshot: ${problems.join("; ")} — re-import the export it came from`,
    path,
    problems,
  }),
  snapshotUnreadable: ({ cause, path }: { cause: string; path: string }): SnapshotUnreadableError => ({
    code: "SNAPSHOT_UNREADABLE",
    message: `could not read ${path}: ${cause}`,
    path,
  }),
  snapshotWriteFailed: ({ cause, path }: { cause: string; path: string }): SnapshotWriteFailedError => ({
    code: "SNAPSHOT_WRITE_FAILED",
    message: `could not write ${path}: ${cause}`,
    path,
  }),
  statusUnknown: ({ lineNumber, status }: { lineNumber: number; status: string }): StatusUnknownError => ({
    code: "STATUS_UNKNOWN",
    lineNumber,
    message: `line ${String(lineNumber)}: status "${status}" is not one the card page is known to print (blank, Declined, Cancelled, Card verification)`,
    status,
  }),
} as const;
