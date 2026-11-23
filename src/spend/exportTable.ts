/**
 * The transaction table of a pasted card-page export: its header, its `|---|` separator, and one unbroken run
 * of rows. Pure.
 *
 * A paste that lost a line must not become a snapshot that quietly lacks a row, because a missing decline reads
 * as "none on the page". So the run must end at a blank line or the end of the file, nothing before the header or
 * after the run may look like a row (a line opening with `|`, or any line carrying a day then a `|`, whatever
 * marker is in front of it), the heading directly above the table is held to its `(N rows …)` count when it
 * states one, and a row dated after the capture day is refused.
 */
import { err, ok, type Result } from "../lib/result.js";
import { type SpendError, SpendErrors } from "./errors.js";
import { amountOn, isIsoDay, type NumberedLine } from "./exportLines.js";
import type { CardTransaction, TransactionStatus } from "./types.js";

/** The page's Status column, mapped to the register's words. The blank status is a charge. */
const STATUSES: ReadonlyMap<string, TransactionStatus> = new Map([
  ["", "charged"],
  ["Declined", "declined"],
  ["Cancelled", "cancelled"],
  ["Card verification", "card-verification"],
]);

/** The exact header of the transaction table. */
const TABLE_HEADER = "| Date | Merchant | Amount | Status |";

/** The markdown separator row that must sit directly under {@link TABLE_HEADER}. */
const TABLE_SEPARATOR = /^\|(?:\s*:?-+:?\s*\|){4}$/;

/** The table's heading, when it states how many rows the page listed. */
const ROW_COUNT_HEADING = /^#+ Transactions \((\d+) rows?\b/;

/**
 * A line that is a table row: it opens with a pipe, or carries a day followed by a pipe ANYWHERE — so a row that
 * lost its leading pipe, or sits behind any quote, list or code marker, is still seen rather than dropped.
 */
const ROW_LIKE = /^\||\d{4}-\d{2}-\d{2}\s*\|/;

/**
 * Read one table row.
 *
 * @param line the row and its line number
 * @param asOf the capture day, which no row may be dated after
 * @param ordinal the row's position on the page
 * @returns the transaction, or the refusal naming the line
 */
function parseRow({
  asOf,
  line,
  ordinal,
}: {
  asOf: string;
  line: NumberedLine;
  ordinal: number;
}): Result<CardTransaction, SpendError> {
  const { lineNumber, text } = line;
  const cells = /^\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|$/.exec(text.trim());
  if (cells === null) {
    return err(SpendErrors.exportLineMalformed({ line: "transaction row", lineNumber, text }));
  }
  const date = cells[1]!.trim();
  const merchant = cells[2]!.trim();
  const amountText = cells[3]!.trim();
  const statusText = cells[4]!.trim();
  if (merchant === "") {
    return err(SpendErrors.exportLineMalformed({ line: "transaction row", lineNumber, text }));
  }
  if (!isIsoDay({ text: date })) {
    return err(SpendErrors.dateInvalid({ lineNumber, text: date }));
  }
  if (date > asOf) {
    return err(SpendErrors.rowAfterCapture({ asOf, date, lineNumber }));
  }
  const amount = amountOn({ lineNumber, text: amountText });
  if (amount.isErr()) {
    return err(amount.error);
  }
  const status = STATUSES.get(statusText);
  if (status === undefined) {
    return err(SpendErrors.statusUnknown({ lineNumber, status: statusText }));
  }
  return ok({ amount: amount.value, date, merchant, ordinal, status });
}

/**
 * The refusal of anything after the run of rows that shows a row was lost, or undefined when nothing does.
 *
 * @param rest the lines after the run of rows
 * @returns the refusal, or undefined
 */
function strayAfterTable({ rest }: { rest: readonly NumberedLine[] }): SpendError | undefined {
  const next = rest[0];
  if (next !== undefined && next.text.trim() !== "") {
    const { lineNumber, text } = next;
    return SpendErrors.exportLineMalformed({ line: "table's closing blank", lineNumber, text });
  }
  const stray = rest.find((line) => ROW_LIKE.test(line.text.trim()));
  if (stray !== undefined) {
    const { lineNumber, text } = stray;
    return SpendErrors.exportLineMalformed({ line: "transaction row after the table ended", lineNumber, text });
  }
  return undefined;
}

/**
 * Read the transaction table: the header, its separator, then one unbroken run of rows.
 *
 * @param lines the export's lines
 * @param asOf the capture day, which no row may be dated after
 * @returns the rows in page order, or the first refusal
 */
export function parseTransactions({
  asOf,
  lines,
}: {
  asOf: string;
  lines: readonly NumberedLine[];
}): Result<CardTransaction[], SpendError> {
  const headerAt = lines.findIndex((line) => line.text.trim() === TABLE_HEADER);
  if (headerAt < 0) {
    return err(SpendErrors.exportLineMissing({ line: `transaction table header ${TABLE_HEADER}` }));
  }
  const strayAbove = lines.slice(0, headerAt).find((line) => ROW_LIKE.test(line.text.trim()));
  if (strayAbove !== undefined) {
    const { lineNumber, text } = strayAbove;
    return err(SpendErrors.exportLineMalformed({ line: "transaction row above the table header", lineNumber, text }));
  }
  const separator = lines[headerAt + 1];
  if (separator === undefined || !TABLE_SEPARATOR.test(separator.text.trim())) {
    const lineNumber = lines[headerAt]!.lineNumber + 1;
    return err(
      SpendErrors.exportLineMalformed({ line: "table separator", lineNumber, text: "no |---| row under the header" }),
    );
  }
  const rows: CardTransaction[] = [];
  const after = lines.slice(headerAt + 2);
  let end = after.findIndex((line) => !line.text.trim().startsWith("|"));
  if (end < 0) {
    end = after.length;
  }
  for (const line of after.slice(0, end)) {
    const row = parseRow({ asOf, line, ordinal: rows.length });
    if (row.isErr()) {
      return err(row.error);
    }
    rows.push(row.value);
  }
  const stray = strayAfterTable({ rest: after.slice(end) });
  if (stray !== undefined) {
    return err(stray);
  }
  const heading = lines
    .slice(0, headerAt)
    .findLast((line) => line.text.trim().startsWith("#"))
    ?.text.trim()
    .match(ROW_COUNT_HEADING);
  if (heading != null && Number(heading[1]!) !== rows.length) {
    return err(SpendErrors.rowCountMismatch({ parsed: rows.length, stated: Number(heading[1]!) }));
  }
  return ok(rows);
}
