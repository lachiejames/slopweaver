/**
 * Read one pasted Airwallex card-page export into a {@link CardSnapshot}. Pure: text in, snapshot out.
 *
 * ## What this reads
 *
 * The input is a page the owner copied out of their own Airwallex console and pasted, saved as markdown. The
 * other way in is `spend capture` (`../cli/commands/spend/capture.ts`), a read-only visit of the card page in
 * the owner's own Chrome through the browser relay — never the Airwallex API and never an API key. Today it reports the backend's shape and stores nothing, so a stored snapshot is
 * still a paste.
 *
 * ## The lines it needs, each refused by name when absent
 *
 * `Organisation:`, `Card: "<nickname>", … ending <4 digits>`, a `Limits` heading with `- Monthly: <used> of <limit>
 * (…), resets <Mon> <D>` and `- Transaction limit: <amount>` in the unbroken block under it, and the transaction
 * table (`./exportTable.ts`, which refuses a table that could have lost a row). `Merchant control: Allow …` is
 * optional — a card without one is a real card. A table with no rows under it is a real month.
 */
import { err, ok, type Result } from "../lib/result.js";
import { type SpendError, SpendErrors } from "./errors.js";
import { amountOn, atMostOneLine, dayAfter, isIsoDay, type NumberedLine, onlyLine, onlyLineIn } from "./exportLines.js";
import { parseTransactions } from "./exportTable.js";
import type { CardSnapshot, Money } from "./types.js";

/** The month abbreviations the page's "resets <Mon> <day>" is written in. */
const MONTHS: readonly string[] = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Milliseconds in one UTC day. */
const DAY_MS = 86_400_000;

/**
 * Resolve the page's "resets <Mon> <day>" to the year that puts it nearest the capture day. Nearest rather than "on or
 * after": the reset lands the FOLLOWING day, so a page copied on the 1st of the next month still prints the earlier reset.
 *
 * @param month the three-letter month
 * @param day the day of the month
 * @param asOf the capture day, `YYYY-MM-DD`
 * @returns the reset day, or undefined when the month or day is not real
 */
export function resolveResetDay({
  asOf,
  day,
  month,
}: {
  asOf: string;
  day: number;
  month: string;
}): string | undefined {
  const index = MONTHS.indexOf(month);
  if (index < 0) {
    return undefined;
  }
  const year = Number(asOf.slice(0, 4));
  const monthDay = `${String(index + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const asOfMs = Date.parse(`${asOf}T00:00:00Z`);
  const candidates = [year - 1, year, year + 1]
    .map((candidate) => `${String(candidate)}-${monthDay}`)
    .filter((text) => isIsoDay({ text }));
  const distance = ({ text }: { text: string }): number => Math.abs(Date.parse(`${text}T00:00:00Z`) - asOfMs) / DAY_MS;
  return candidates.toSorted((a, b) => distance({ text: a }) - distance({ text: b }) || b.localeCompare(a)).at(0);
}

/**
 * Read the `- Monthly:` line: what is used, the limit, and the reset day resolved against the capture day.
 *
 * @param line the monthly line and its number
 * @param asOf the capture day, which must fall inside the month the reset closes
 * @returns the used figure, the limit and the reset day, or the refusal naming the line
 */
function parseMonthly({
  asOf,
  line,
}: {
  asOf: string;
  line: NumberedLine;
}): Result<{ limit: Money; resetsOn: string; used: Money }, SpendError> {
  const { lineNumber, text } = line;
  const monthly = /^- Monthly: (.+?) of (.+?) \([^)]*\), resets ([A-Z][a-z]{2}) (\d{1,2})$/.exec(text.trim());
  if (monthly === null) {
    return err(SpendErrors.exportLineMalformed({ line: "Monthly limit", lineNumber, text }));
  }
  const used = amountOn({ lineNumber, text: monthly[1]! });
  if (used.isErr()) {
    return err(used.error);
  }
  const limit = amountOn({ lineNumber, text: monthly[2]! });
  if (limit.isErr()) {
    return err(limit.error);
  }
  const resetsOn = resolveResetDay({ asOf, day: Number(monthly[4]!), month: monthly[3]! });
  if (resetsOn === undefined) {
    return err(SpendErrors.dateInvalid({ lineNumber, text: `${monthly[3]!} ${monthly[4]!}` }));
  }
  // A monthly reset is at most a month after the capture day, and the page is copied at most the day after it
  // resets (the reset lands the following day). A capture day outside that would set rows from another period
  // against this period's used figure; inside it, no row can postdate the reset by more than a day either.
  const daysToReset = (Date.parse(`${resetsOn}T00:00:00Z`) - Date.parse(`${asOf}T00:00:00Z`)) / DAY_MS;
  const afterReset = asOf > dayAfter({ day: resetsOn });
  if (afterReset || daysToReset > 31) {
    return err(SpendErrors.captureOutsidePeriod({ asOf, resetsOn }));
  }
  return ok({ limit: limit.value, resetsOn, used: used.value });
}

/**
 * Find the `Limits` heading and the block under it. The block is the unbroken run of lines under the heading; a
 * limit line anywhere else is not the card's limit.
 *
 * @param lines the export's lines
 * @returns the heading's line number, the blank line ending the block, and the heading's reset note
 */
function limitsBlock({
  lines,
}: {
  lines: readonly NumberedLine[];
}): Result<{ from: number; resetNote: string | null; to: number }, SpendError> {
  const heading = onlyLine({ line: "Limits", lines, prefix: "Limits" });
  if (heading.isErr()) {
    return err(heading.error);
  }
  const headingMatch = /^Limits(?: \((.+)\))?:?$/.exec(heading.value.text.trim());
  if (headingMatch === null) {
    const { lineNumber, text } = heading.value;
    return err(SpendErrors.exportLineMalformed({ line: "Limits", lineNumber, text }));
  }
  let resetNote: string | null = null;
  if (headingMatch[1] !== undefined) {
    resetNote = headingMatch[1];
  }
  const from = heading.value.lineNumber;
  const blankAfter = lines.find((line) => line.lineNumber > from && line.text.trim() === "");
  let to = lines.length + 1;
  if (blankAfter !== undefined) {
    to = blankAfter.lineNumber;
  }
  return ok({ from, resetNote, to });
}

/**
 * Read the `Limits` block: its heading's reset note, the monthly line and the transaction-limit line.
 *
 * @param lines the export's lines
 * @param asOf the capture day, which the monthly reset date is resolved against
 * @returns the monthly limit and the transaction limit, or the first refusal
 */
function parseLimits({
  asOf,
  lines,
}: {
  asOf: string;
  lines: readonly NumberedLine[];
}): Result<Pick<CardSnapshot, "monthly" | "transactionLimit">, SpendError> {
  const block = limitsBlock({ lines });
  if (block.isErr()) {
    return err(block.error);
  }
  const { from, resetNote, to } = block.value;
  const monthlyLine = onlyLineIn({ from, line: "Monthly limit", lines, prefix: "- Monthly:", to });
  if (monthlyLine.isErr()) {
    return err(monthlyLine.error);
  }
  const monthly = parseMonthly({ asOf, line: monthlyLine.value });
  if (monthly.isErr()) {
    return err(monthly.error);
  }
  const { limit, resetsOn, used } = monthly.value;
  const perTransactionLine = onlyLineIn({
    from,
    line: "Transaction limit",
    lines,
    prefix: "- Transaction limit:",
    to,
  });
  if (perTransactionLine.isErr()) {
    return err(perTransactionLine.error);
  }
  const perTransaction = amountOn({
    lineNumber: perTransactionLine.value.lineNumber,
    text: perTransactionLine.value.text.slice("- Transaction limit:".length),
  });
  if (perTransaction.isErr()) {
    return err(perTransaction.error);
  }
  const currencies = [...new Set([used.currency, limit.currency, perTransaction.value.currency])];
  if (currencies.length > 1) {
    return err(SpendErrors.limitCurrencyMismatch({ currencies }));
  }
  return ok({
    monthly: { limit, resetNote, resetsOn, used },
    transactionLimit: perTransaction.value,
  });
}

/**
 * The merchants the card's merchant control allows, or null when the page printed no control.
 *
 * @param lines the export's lines
 * @returns the allowed merchants in page order, null, or the refusal of a control line in another shape
 */
function parseMerchantAllow({ lines }: { lines: readonly NumberedLine[] }): Result<string[] | null, SpendError> {
  const control = atMostOneLine({ line: "Merchant control", lines, prefix: "Merchant control:" });
  if (control.isErr()) {
    return err(control.error);
  }
  if (control.value === undefined) {
    return ok(null);
  }
  const { lineNumber, text } = control.value;
  // The list ends at the full stop before the next "Label:" sentence or the line's end, so "OpenAI Inc.," and
  // "Anthropic Pty. Ltd," stay whole.
  const allow = /^Merchant control: Allow (.+?)\.(?:\s+[A-Z][\w ]*:|\s*$)/.exec(text);
  const merchants = allow?.[1]!.split(",").map((merchant) => merchant.trim());
  if (merchants === undefined || merchants.includes("")) {
    return err(SpendErrors.exportLineMalformed({ line: "Merchant control", lineNumber, text }));
  }
  return ok(merchants);
}

/**
 * Parse one pasted card-page export.
 *
 * @param text the export's whole text
 * @param asOf the day the page was captured, `YYYY-MM-DD`
 * @param sourcePath where the export was read from, recorded on the snapshot
 * @param importedAt when the import ran, ISO-8601
 * @returns the snapshot, or the first line the export gets wrong
 */
export function parseCardExport({
  asOf,
  importedAt,
  sourcePath,
  text,
}: {
  asOf: string;
  importedAt: string;
  sourcePath: string;
  text: string;
}): Result<CardSnapshot, SpendError> {
  const lines = text.split(/\r?\n/).map((line, index) => ({ lineNumber: index + 1, text: line }));
  const organisationLine = onlyLine({ line: "Organisation", lines, prefix: "Organisation:" });
  if (organisationLine.isErr()) {
    return err(organisationLine.error);
  }
  const organisation = organisationLine.value.text.slice("Organisation:".length).trim();
  if (organisation === "") {
    const { lineNumber, text: lineText } = organisationLine.value;
    return err(SpendErrors.exportLineMalformed({ line: "Organisation", lineNumber, text: lineText }));
  }
  const cardLine = onlyLine({ line: "Card", lines, prefix: "Card:" });
  if (cardLine.isErr()) {
    return err(cardLine.error);
  }
  const card = /^Card: "([^"]+)",.*\bending (\d{4})\b/.exec(cardLine.value.text);
  if (card === null || cardLine.value.text.match(/\bending \d{4}\b/g)?.length !== 1) {
    const { lineNumber, text: lineText } = cardLine.value;
    return err(SpendErrors.exportLineMalformed({ line: "Card", lineNumber, text: lineText }));
  }
  const limits = parseLimits({ asOf, lines });
  if (limits.isErr()) {
    return err(limits.error);
  }
  const merchantAllow = parseMerchantAllow({ lines });
  if (merchantAllow.isErr()) {
    return err(merchantAllow.error);
  }
  const transactions = parseTransactions({ asOf, lines });
  if (transactions.isErr()) {
    return err(transactions.error);
  }
  return ok({
    asOf,
    last4: card[2]!,
    merchantAllow: merchantAllow.value,
    monthly: limits.value.monthly,
    nickname: card[1]!,
    organisation,
    provider: "airwallex",
    schemaVersion: 1,
    source: { importedAt, kind: "pasted", path: sourcePath },
    transactionLimit: limits.value.transactionLimit,
    transactions: transactions.value,
  });
}
