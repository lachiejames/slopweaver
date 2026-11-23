/**
 * Read one Airwallex task-reminder mail into the card expenses it asks the owner to submit. Pure: text in, expenses out.
 *
 * The reminders say to go and upload a receipt into Airwallex, so the card has to say WHICH charge — and the mail
 * is the one place that names it without a read of Airwallex itself. Each daily reminder restates the WHOLE open
 * set, so the newest one is the live list and every older one is superseded (measured over four reminders in the
 * owner's inbox:`slopweaver gmail read <id>`).
 *
 * The body's shape as `gmail read` flattens it, blank lines aside — the values here are invented:
 *
 * ```text
 * You have 3 tasks to complete
 * 3 card expenses to submit
 * Transaction date <D> <Mon>
 * Acme Cloud
 * 120.00 AUD
 * Transaction date <D> <Mon>
 * Example Tools
 * New
 * 9.99 USD
 * + 1 more card expense
 * View incomplete expenses
 * ```
 *
 * The date carries no year; the mail's own send date supplies it. Which merchant an expense is grouped under is the
 * install's own register, passed in (`../merchants/core.ts`).
 */
import { err, ok, type Result } from "../../lib/result.js";
import { type MerchantIdentity, merchantIdentityOf, type SpendMerchant } from "../merchants/core.js";
import { parseMoney } from "../money.js";
import type { Money } from "../types.js";
import { type TaskReminderError, TaskReminderErrors } from "./errors.js";

/** One card expense the reminder asks the owner to submit a receipt for. */
export interface TaskExpense {
  /** `YYYY-MM-DD`: the reminder's `Transaction date`, its year taken from the mail. */
  readonly day: string;
  /** The merchant exactly as the reminder printed it. */
  readonly merchant: string;
  readonly amount: Money;
  /** The install's registered merchant this charge falls under, else its own merchant string. */
  readonly identity: MerchantIdentity;
}

/** What one reminder says is open. */
export interface TaskReminder {
  /** The heading's count — every kind of task, not only card expenses. */
  readonly openTasks: number;
  /** The `<n> card expenses to submit` count, or 0 when the mail names no card expenses. */
  readonly cardExpenses: number;
  /** The expenses the mail lists, in its order. */
  readonly expenses: readonly TaskExpense[];
  /** How many more card expenses the `+ <n> more` tail says it did not list. */
  readonly more: number;
}

const HEADING = /^You have (\d+) tasks? to complete$/u;
const CARD_EXPENSES = /^(\d+) card expenses? to submit$/u;
const TRANSACTION_DATE = /^Transaction date (\d{1,2}) ([A-Z][a-z]{2})$/u;
const MORE = /^\+ (\d+) more card expenses?$/u;
/** A marker Airwallex prints between a merchant and its amount on a charge it has not shown before. */
const NEW_MARKER = "New";
/** The link line that closes the list. */
const LIST_END = "View incomplete expenses";

const MONTHS: readonly string[] = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** One day in milliseconds, for the "not after the mail" allowance. */
const DAY_MS = 86_400_000;

/**
 * The `YYYY-MM-DD` a yearless `<D> <Mon>` names, read against the day the mail was sent: the mail's year, or the one
 * before it when that would put the charge more than a day after the mail — a late-December charge in an early-January reminder.
 *
 * @param dayOfMonth the day number the reminder printed
 * @param monthIndex 0 for January
 * @param sentAtIso when the mail was sent
 * @returns the day
 */
function transactionDay({
  dayOfMonth,
  monthIndex,
  sentAtIso,
}: {
  dayOfMonth: number;
  monthIndex: number;
  sentAtIso: string;
}): string {
  const sent = new Date(sentAtIso);
  let year = sent.getUTCFullYear();
  if (Date.UTC(year, monthIndex, dayOfMonth) > sent.getTime() + DAY_MS) {
    year -= 1;
  }
  return new Date(Date.UTC(year, monthIndex, dayOfMonth)).toISOString().slice(0, 10);
}

/**
 * Read one expense block: the merchant, an optional `New`, then the amount.
 *
 * @param block the block's lines after its `Transaction date` line
 * @param day the block's day
 * @param position the block's 1-based position, for a refusal
 * @param merchants the install's registered merchants
 * @returns the expense, or the refusal naming the block
 */
function expenseOf({
  block,
  day,
  merchants,
  position,
}: {
  block: readonly string[];
  day: string;
  merchants: readonly SpendMerchant[];
  position: number;
}): Result<TaskExpense, TaskReminderError> {
  const lines = block.filter((line) => line !== NEW_MARKER);
  const merchant = lines[0];
  const amountText = lines[1];
  const amount = amountText === undefined ? undefined : parseMoney({ text: amountText });
  if (merchant === undefined || amount === undefined || lines.length !== 2) {
    return err(TaskReminderErrors.expenseMalformed({ position, text: block.join(" / ") }));
  }
  return ok({ amount, day, identity: merchantIdentityOf({ merchant, merchants }), merchant });
}

/**
 * Parse one reminder body.
 *
 * @param body the mail's text body, as `gmail read` flattens it
 * @param sentAtIso when the mail was sent — the year every yearless transaction date is read in
 * @param merchants the install's registered merchants, each expense's group read against them
 * @returns the open expenses, or why the body is not a reminder this reads
 */
export function parseTaskReminder({
  body,
  merchants,
  sentAtIso,
}: {
  body: string;
  merchants: readonly SpendMerchant[];
  sentAtIso: string;
}): Result<TaskReminder, TaskReminderError> {
  const lines = body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const heading = lines.findIndex((line) => HEADING.test(line));
  if (heading === -1) {
    return err(TaskReminderErrors.notAReminder());
  }
  const openTasks = Number(HEADING.exec(lines[heading]!)![1]);
  const list = scanList({ lines: lines.slice(heading + 1) });
  const expenses: TaskExpense[] = [];
  for (const [index, block] of list.blocks.entries()) {
    const expense = blockExpense({ block, merchants, position: index + 1, sentAtIso });
    if (expense.isErr()) {
      return err(expense.error);
    }
    expenses.push(expense.value);
  }
  const { cardExpenses, more } = list;
  if (expenses.length + more !== cardExpenses) {
    return err(TaskReminderErrors.countMismatch({ listed: expenses.length + more, stated: cardExpenses }));
  }
  return ok({ cardExpenses, expenses, more, openTasks });
}

/** One `Transaction date` line's match and the lines under it, not yet read as an expense. */
interface DatedBlock {
  readonly dated: RegExpExecArray;
  readonly lines: string[];
}

/** The list's structure: the stated count, the unlisted tail, and each dated block in order. */
interface ScannedList {
  cardExpenses: number;
  more: number;
  readonly blocks: DatedBlock[];
}

/**
 * Split the lines after the heading into the stated count, the `+ <n> more` tail and the dated blocks. Structure
 * only: a block's lines are read, and refused, by {@link blockExpense}.
 *
 * @param lines the body's non-blank lines after the heading
 * @returns the scanned list
 */
function scanList({ lines }: { lines: readonly string[] }): ScannedList {
  const list: ScannedList = { blocks: [], cardExpenses: 0, more: 0 };
  let open: string[] | undefined;
  for (const line of lines) {
    if (line === LIST_END) {
      break;
    }
    const count = CARD_EXPENSES.exec(line);
    const dated = TRANSACTION_DATE.exec(line);
    const tail = MORE.exec(line);
    if (count !== null) {
      list.cardExpenses = Number(count[1]);
    } else if (tail !== null) {
      list.more = Number(tail[1]);
      open = undefined;
    } else if (dated !== null) {
      open = [];
      list.blocks.push({ dated, lines: open });
    } else if (open !== undefined) {
      open.push(line);
    }
  }
  return list;
}

/**
 * Read one dated block as an expense: its month named, then exactly a merchant and an amount.
 *
 * @param block the block's date match and lines
 * @param position the block's 1-based position, for a refusal
 * @param sentAtIso when the mail was sent, for the year
 * @param merchants the install's registered merchants
 * @returns the expense, or the refusal naming the block
 */
function blockExpense({
  block,
  merchants,
  position,
  sentAtIso,
}: {
  block: DatedBlock;
  merchants: readonly SpendMerchant[];
  position: number;
  sentAtIso: string;
}): Result<TaskExpense, TaskReminderError> {
  const monthIndex = MONTHS.indexOf(block.dated[2]!);
  if (monthIndex === -1) {
    return err(TaskReminderErrors.expenseMalformed({ position, text: block.dated[0] }));
  }
  const day = transactionDay({ dayOfMonth: Number(block.dated[1]), monthIndex, sentAtIso });
  return expenseOf({ block: block.lines, day, merchants, position });
}
