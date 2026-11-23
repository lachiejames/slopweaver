/**
 * The card's transaction rows off a live read, as the snapshot's transactions — the row half of
 * `./liveCapture.ts`, which calibrates the card and hands its rows here with the unit it settled.
 *
 * A status code this file does not know, or a date in no shape it reads, is recorded by name rather than
 * guessed, so a new code is added from a real answer.
 */
import { isIsoDay } from "./exportLines.js";
import type { LiveBodies, LiveTransaction } from "./liveBodies.js";
import type { CardTransaction, TransactionStatus } from "./types.js";

/**
 * A transaction status code the backend answers, and what the page's Status column shows for it. A code not
 * here refuses the read by name, so a new one is added from a real answer rather than guessed. The
 * four here are every code the owner's card answered on its first live read, set against the four words
 * the pasted page prints: blank, Declined, Cancelled and Card verification.
 */
const STATUS_OF: Readonly<Record<string, TransactionStatus>> = {
  DECLINED: "declined",
  REVERSED: "cancelled",
  SUCCESSFUL: "charged",
  VERIFIED: "card-verification",
};

/**
 * An amount in integer minor units at the calibrated scale.
 *
 * @param amount the backend's number
 * @param scale the calibrated scale
 * @param problems where a fractional minor amount is recorded
 * @returns the minor units
 */
export function minorOf({ amount, problems, scale }: { amount: number; problems: string[]; scale: number }): number {
  const minor = Math.round(amount * scale);
  if (Math.abs(minor - amount * scale) > 1e-6) {
    problems.push("an amount is not a whole number of minor units at the calibrated scale");
  }
  return minor;
}

/**
 * The card's own rows across every transaction answer, each once, in the order the page first answered them.
 *
 * @param bodies the parsed operations
 * @param cardId the card's backend id, held in memory only
 * @returns the rows, and the largest count the backend gave for a page holding them
 */
export function rowsOf({ bodies, cardId }: { bodies: LiveBodies; cardId: string }): {
  rows: readonly LiveTransaction[];
  rowsOnCard: number;
} {
  const seen = new Set<string>();
  const rows: LiveTransaction[] = [];
  let rowsOnCard = 0;
  for (const body of bodies.transactions) {
    const page = body.data.spendCardTransactionsByCardId;
    const own = page.transactions.filter((row) => row.cardId === cardId);
    if (own.length > 0) {
      rowsOnCard = Math.max(rowsOnCard, page.pageInfo.totalCount);
    }
    for (const row of own.filter((candidate) => !seen.has(candidate.id))) {
      seen.add(row.id);
      rows.push(row);
    }
  }
  return { rows, rowsOnCard };
}

/**
 * The live rows as the snapshot's transactions, every unknown status code and unreadable date recorded.
 *
 * @param rows the card's rows
 * @param scale the calibrated scale
 * @param timeZone the zone the page prints days in
 * @param problems where an unknown code or date is recorded
 * @returns the transactions, newest first as the page answered them
 */
export function transactionsOf({
  problems,
  rows,
  scale,
  timeZone,
}: {
  problems: string[];
  rows: readonly LiveTransaction[];
  scale: number;
  timeZone: string;
}): readonly CardTransaction[] {
  const unknown = new Set<string>();
  let undated = 0;
  const transactions = rows.flatMap((row, ordinal): CardTransaction[] => {
    const status = STATUS_OF[row.status];
    const date = dayOf({ text: row.date, timeZone });
    if (status === undefined) {
      unknown.add(row.status);
    }
    if (date === null) {
      undated += 1;
    }
    if (status === undefined || date === null) {
      return [];
    }
    const amount = {
      currency: row.transactionCurrency,
      minor: minorOf({ amount: row.transactionAmount, problems, scale }),
    };
    const base = { amount, date, merchant: row.merchantDetails.cleanMerchantName, ordinal, status };
    if (row.failureReason === null) {
      return [base];
    }
    return [{ ...base, declineReason: row.failureReason }];
  });
  if (unknown.size > 0) {
    problems.push(
      `status code(s) ${[...unknown].toSorted().join(", ")} are not in STATUS_OF — add each with what the page's Status column shows`,
    );
  }
  if (undated > 0) {
    problems.push(
      `${String(undated)} row(s) carry a date that is neither a YYYY-MM-DD day nor an instant with an offset`,
    );
  }
  return transactions;
}

/**
 * Whether the live rows' amounts are in the limit's unit: a row the stored snapshot also holds on the same day,
 * status and currency must match one of its amounts. A live page with rows and NO such overlap refuses, since
 * nothing then checks the rows' unit — a row stored a hundredfold wrong would read as a real charge.
 *
 * @param transactions the live rows at the calibrated scale
 * @param stored the stored snapshot's rows
 * @param problems where a mismatch is recorded
 */
export function checkAmounts({
  problems,
  stored,
  transactions,
}: {
  problems: string[];
  stored: readonly CardTransaction[];
  transactions: readonly CardTransaction[];
}): void {
  const key = ({ row }: { row: CardTransaction }): string => `${row.date} ${row.status} ${row.amount.currency}`;
  const amounts = new Map<string, Set<number>>();
  for (const row of stored) {
    const held = amounts.get(key({ row }));
    if (held === undefined) {
      amounts.set(key({ row }), new Set([row.amount.minor]));
    } else {
      held.add(row.amount.minor);
    }
  }
  const overlapping = transactions.filter((row) => amounts.has(key({ row })));
  const matching = overlapping.filter((row) => amounts.get(key({ row }))!.has(row.amount.minor));
  if (transactions.length > 0 && overlapping.length === 0) {
    problems.push(
      "no live row shares a day, status and currency with a row the stored snapshot holds, so the rows' unit is " +
        "unchecked — `spend import` a paste of the card from inside this month to recalibrate",
    );
  }
  if (overlapping.length > 0 && matching.length === 0) {
    problems.push(
      `none of the ${String(overlapping.length)} row(s) the stored snapshot also holds matches its amount at the ` +
        "limit's unit, so the rows are in another unit",
    );
  }
}

/**
 * The day a backend date falls on where the page prints it.
 *
 * @param text a `YYYY-MM-DD` day, or an ISO instant carrying `Z` or an offset
 * @param timeZone the zone an instant is read in
 * @returns the `YYYY-MM-DD` day, or null for anything else
 */
export function dayOf({ text, timeZone }: { text: string; timeZone: string }): string | null {
  if (isIsoDay({ text })) {
    return text;
  }
  const hasOffset = /T\d{2}:\d{2}.*(Z|[+-]\d{2}:?\d{2})$/.test(text);
  const ms = Date.parse(text);
  if (!hasOffset || Number.isNaN(ms)) {
    return null;
  }
  return new Intl.DateTimeFormat("en-CA", { day: "2-digit", month: "2-digit", timeZone, year: "numeric" }).format(ms);
}
