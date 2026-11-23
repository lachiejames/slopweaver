/**
 * `spend tasks` — the newest Airwallex task reminder in the owner's inbox, each card expense it lists, and the invoice for
 * each pulled out of their own mailbox, so the card they read is one act: upload this file into Airwallex now.
 *
 * Every read goes through the Gmail door's own functions, injected as {@link TasksMailbox} so this is tested
 * against a plain fake. It reads mail and nothing else: Airwallex itself is read-only and only through the owner's own
 * Chrome, and uploading a receipt there is the owner's act, never this verb's. `spend forward` reads
 * the same way and then drafts, in the owner's own Drafts, a forward of each matched receipt to Airwallex's receipts address
 * (`../../cli/commands/spend/forwardRun.ts`) — the sending stays the owner's.
 */
import { gmailPermalink } from "../../corpus/gmail/project.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { GmailAttachmentCandidate } from "../../live/gmail/attachment.js";
import type { ParsedGmailMessage } from "../../live/gmail/parse.js";
import type { SpendMerchant } from "../merchants/core.js";
import { type TaskReminderError, TaskReminderErrors } from "./errors.js";
import {
  type InvoiceSearch,
  invoiceQuery,
  matchInvoices,
  type ReceiptCandidate,
  type ReceiptPdf,
  receiptOrigin,
} from "./invoiceMatch.js";
import { parseTaskReminder, type TaskExpense, type TaskReminder } from "./reminder.js";

/**
 * Every address Airwallex sends a task reminder from: `support@` on older reminders, `no-reply@` on newer ones
 * (`slopweaver gmail list --query 'from:info.airwallex.com subject:"to complete"'`).
 */
export const REMINDER_SENDERS: readonly string[] = ["support@info.airwallex.com", "no-reply@info.airwallex.com"];

/**
 * Both subject shapes: "You have 1 task to complete" for one open task, "You have 2 tasks to complete" for more.
 * Gmail matches a subject phrase word for word, so `tasks` never finds the singular; the singular is spelled whole
 * because "task to complete" alone would admit any subject carrying that phrase.
 */
export const REMINDER_SUBJECTS: readonly string[] = ["You have 1 task to complete", "tasks to complete"];

/** The Gmail search for the owner's Airwallex task reminders still in the inbox: any sender, either subject shape. */
export const REMINDER_QUERY = [
  `{${REMINDER_SENDERS.map((sender) => `from:${sender}`).join(" ")}}`,
  "in:inbox",
  `{${REMINDER_SUBJECTS.map((subject) => `subject:"${subject}"`).join(" ")}}`,
].join(" ");

/** How many reminders one reading lists — they arrive daily, so this covers a fortnight's backlog and more. */
const REMINDER_LIMIT = 30;
/** How many receipts one expense's window is read for. */
const RECEIPT_LIMIT = 10;

/** One message read in full: its parsed form, and its attachment parts as a fetch addresses them. */
export interface FullMessage {
  readonly message: ParsedGmailMessage;
  readonly parts: readonly GmailAttachmentCandidate[];
}

/** One search hit: the id, and when it was sent. */
interface SearchHit {
  readonly id: string;
  readonly sentAtIso: string | undefined;
}

/** A failure the door reported, by its own message. */
interface DoorFailure {
  readonly message: string;
}

/** The Gmail door's reads, as `spend tasks` needs them. */
export interface TasksMailbox {
  readonly account: string;
  readonly search: (args: { query: string; limit: number }) => Promise<Result<readonly SearchHit[], DoorFailure>>;
  readonly readFull: (args: { id: string }) => Promise<Result<FullMessage, DoorFailure>>;
  /** Save one attachment part owner-only under the home, answering its local path. */
  readonly savePart: (args: { messageId: string; partId: string }) => Promise<Result<string, DoorFailure>>;
}

/** A PDF pulled out of a receipt. */
interface PulledFile {
  readonly filename: string;
  readonly localPath: string;
}

/** What the mailbox says about one expense's invoice, with the receipt's body left behind. */
type TaskInvoice =
  | {
      readonly kind: "matched";
      readonly messageId: string;
      readonly permalink: string;
      readonly subject: string | undefined;
      readonly files: readonly PulledFile[];
    }
  | { readonly kind: "unconfirmed"; readonly candidateIds: readonly string[] }
  | { readonly kind: "none" }
  | { readonly kind: "no-registered-merchant" };

/** One expense and its invoice: the act the card names. */
export interface TaskAct {
  readonly expense: TaskExpense;
  /** The receipt search run, or undefined when the merchant is not registered with a receipt domain. */
  readonly query: string | undefined;
  readonly invoice: TaskInvoice;
}

/** One reminder mail, by its address. */
interface ReminderMail {
  readonly id: string;
  readonly sentAtIso: string;
  readonly permalink: string;
}

/** The whole reading `spend tasks` prints. */
export type TaskReading =
  | { readonly kind: "no-reminder"; readonly account: string; readonly query: string }
  | {
      readonly kind: "reading";
      readonly account: string;
      /** The newest reminder — the live open set. */
      readonly reminder: ReminderMail;
      /** Every older reminder still in the inbox, newest first: each restated a set the newest one replaces. */
      readonly superseded: readonly ReminderMail[];
      readonly open: TaskReminder;
      readonly acts: readonly TaskAct[];
    };

/**
 * Whether an attachment part is a PDF the finance upload takes.
 *
 * @returns true for a PDF with a part id a fetch can address
 */
function isPdf(part: GmailAttachmentCandidate): part is GmailAttachmentCandidate & { partId: string } {
  const pdf = part.mimeType === "application/pdf" || part.filename.toLowerCase().endsWith(".pdf");
  return pdf && part.partId !== undefined;
}

/**
 * Read one expense's receipt window in full.
 *
 * @returns the search and its candidates, or the door's failure
 */
async function searchReceipts({
  mailbox,
  expense,
  merchants,
}: {
  mailbox: TasksMailbox;
  expense: TaskExpense;
  merchants: readonly SpendMerchant[];
}): Promise<Result<InvoiceSearch, TaskReminderError>> {
  const query = invoiceQuery({ expense, merchants });
  if (query === undefined) {
    return ok({ candidates: [], expense, query });
  }
  const hits = await mailbox.search({ limit: RECEIPT_LIMIT, query });
  if (hits.isErr()) {
    return err(TaskReminderErrors.mailboxReadFailed({ cause: hits.error, step: `receipt search ${query}` }));
  }
  const candidates: ReceiptCandidate[] = [];
  for (const hit of hits.value) {
    const full = await mailbox.readFull({ id: hit.id });
    if (full.isErr()) {
      return err(TaskReminderErrors.mailboxReadFailed({ cause: full.error, step: `receipt ${hit.id}` }));
    }
    const pdfs: ReceiptPdf[] = full.value.parts
      .filter(isPdf)
      .map((part) => ({ filename: part.filename, partId: part.partId }));
    const { body, from, id, labelIds, sentAtIso, subject, to } = full.value.message;
    const { forwarded, originalDay } = receiptOrigin({ body, sentAtIso });
    candidates.push({ body, forwarded, from, id, labelIds, originalDay, pdfs, sentAtIso, subject, to });
  }
  return ok({ candidates, expense, query });
}

/**
 * Pull every PDF a matched receipt carries.
 *
 * @returns the pulled files, or the door's failure
 */
async function pullFiles({
  mailbox,
  receipt,
}: {
  mailbox: TasksMailbox;
  receipt: ReceiptCandidate;
}): Promise<Result<readonly PulledFile[], TaskReminderError>> {
  const files: PulledFile[] = [];
  for (const pdf of receipt.pdfs) {
    const saved = await mailbox.savePart({ messageId: receipt.id, partId: pdf.partId });
    if (saved.isErr()) {
      return err(TaskReminderErrors.mailboxReadFailed({ cause: saved.error, step: `pull ${pdf.filename}` }));
    }
    files.push({ filename: pdf.filename, localPath: saved.value });
  }
  return ok(files);
}

/**
 * Read the newest reminder, its expenses, and each expense's invoice.
 *
 * @param mailbox the Gmail door's reads
 * @param merchants the install's registered merchants, which decide each expense's receipt search
 * @returns the reading, or the first thing that stopped it
 */
export async function readTasks({
  mailbox,
  merchants,
}: {
  mailbox: TasksMailbox;
  merchants: readonly SpendMerchant[];
}): Promise<Result<TaskReading, TaskReminderError>> {
  const listed = await mailbox.search({ limit: REMINDER_LIMIT, query: REMINDER_QUERY });
  if (listed.isErr()) {
    return err(TaskReminderErrors.mailboxReadFailed({ cause: listed.error, step: "reminder search" }));
  }
  const reminders = listed.value
    .filter((hit): hit is SearchHit & { sentAtIso: string } => hit.sentAtIso !== undefined)
    .toSorted((left, right) => right.sentAtIso.localeCompare(left.sentAtIso))
    .map((hit) => ({ id: hit.id, permalink: gmailPermalink({ id: hit.id }), sentAtIso: hit.sentAtIso }));
  const newest = reminders[0];
  if (newest === undefined) {
    return ok({ account: mailbox.account, kind: "no-reminder", query: REMINDER_QUERY });
  }
  const full = await mailbox.readFull({ id: newest.id });
  if (full.isErr()) {
    return err(TaskReminderErrors.mailboxReadFailed({ cause: full.error, step: `reminder ${newest.id}` }));
  }
  const open = parseTaskReminder({ body: full.value.message.body, merchants, sentAtIso: newest.sentAtIso });
  if (open.isErr()) {
    return err(open.error);
  }
  const searches: InvoiceSearch[] = [];
  for (const expense of open.value.expenses) {
    const search = await searchReceipts({ expense, mailbox, merchants });
    if (search.isErr()) {
      return err(search.error);
    }
    searches.push(search.value);
  }
  const acts = await actsFor({ mailbox, searches });
  if (acts.isErr()) {
    return err(acts.error);
  }
  return ok({
    account: mailbox.account,
    acts: acts.value,
    kind: "reading",
    open: open.value,
    reminder: newest,
    superseded: reminders.slice(1),
  });
}

/**
 * Match each expense to its receipt and pull a matched receipt's PDFs, one act per expense in the reminder's order.
 *
 * @param searches each expense's receipt search and what it returned
 * @returns the acts, or the first pull that failed
 */
async function actsFor({
  mailbox,
  searches,
}: {
  mailbox: TasksMailbox;
  searches: readonly InvoiceSearch[];
}): Promise<Result<readonly TaskAct[], TaskReminderError>> {
  const verdicts = matchInvoices({ searches });
  const acts: TaskAct[] = [];
  for (const [index, search] of searches.entries()) {
    const verdict = verdicts[index]!;
    if (verdict.kind !== "matched") {
      acts.push({ expense: search.expense, invoice: verdict, query: search.query });
      continue;
    }
    const files = await pullFiles({ mailbox, receipt: verdict.receipt });
    if (files.isErr()) {
      return err(files.error);
    }
    const { id, subject } = verdict.receipt;
    const invoice: TaskInvoice = {
      files: files.value,
      kind: "matched",
      messageId: id,
      permalink: gmailPermalink({ id }),
      subject,
    };
    acts.push({ expense: search.expense, invoice, query: search.query });
  }
  return ok(acts);
}
