/**
 * Which receipt mail in the owner's mailbox is the invoice for one Airwallex card expense. Pure: the searches' results in,
 * one verdict per expense out.
 *
 * A receipt is claimed only when its body NAMES the charged amount. Merchant and date alone would pair a 22.00 USD
 * charge with whichever receipt from that merchant landed that week, and a wrong file uploaded to finance is worse
 * than none — so a window holding receipts that do not name the amount is reported as exactly that, with their ids.
 * One receipt answers one expense: a reminder in the owner's inbox once listed two charges from one merchant, of one
 * amount, on one day, and two charges need two receipts.
 *
 * ## Where a merchant's receipts come from is the install's own register
 *
 * The domains a merchant's billing mail is sent from are a row of the install's card-merchant register
 * (`../merchants/core.ts`), never a list here: an expense whose merchant is not registered, or is registered with no
 * receipt domain, has nothing to search for and says so.
 *
 * ## The owner's own forward is how a receipt reaches this mailbox
 *
 * A plan may bill to a sign-up address the grant cannot read, so a receipt arrives here only when the owner forwards it
 * from that mailbox. A forward is FROM the owner, so the search also takes the merchant's
 * domain as free text, which the forwarded header block carries. Two consequences are the rules below:
 *
 * - **The search window is wide and the match window is not.** A forward lands days after the charge, so the
 *   query reaches {@link QUERY_AFTER_DAYS} past it; but the day a receipt is judged on is the ORIGINAL receipt's,
 *   read off the forwarded `Date:` line, and it must sit within {@link WINDOW_BEFORE_DAYS} before to
 *   {@link WINDOW_AFTER_DAYS} after the charge. Judged on the forward's own send time, a later same-amount charge's
 *   receipt forwarded in a batch would answer an earlier charge.
 * - **Nothing already on its way to Airwallex is a receipt.** The forward the fleet drafts, and the owner's sent copy of it,
 *   carry the same merchant text, amount and PDF — so a draft, a sent message, anything addressed to Airwallex's
 *   receipts address and anything from Airwallex is dropped before matching, or the next run forwards the forward.
 */
import { registeredMerchantOf, type SpendMerchant } from "../merchants/core.js";
import { formatMoney } from "../money.js";
import type { Money } from "../types.js";
import type { TaskExpense } from "./reminder.js";

/** Airwallex's receipt-matching mailbox — a receipt mailed here is matched to the card expense it answers. */
export const AIRWALLEX_RECEIPTS_ADDRESS = "receipts@expenses.airwallex.com";

/** How many days before the charge a receipt may be dated — the card's day is Airwallex's, a receipt's is UTC. */
const WINDOW_BEFORE_DAYS = 2;
/** How many days after the charge a receipt may be dated. */
const WINDOW_AFTER_DAYS = 3;
/** How many days after the charge the SEARCH reaches, for a forward the owner makes after the reminder lands. */
const QUERY_AFTER_DAYS = 14;

/** The line a forwarded message's header block opens with — Gmail's, or Apple Mail's — every occurrence. */
const FORWARD_MARKERS = /-{5,}\s*Forwarded message\s*-{5,}|Begin forwarded message:/giu;

/** Three-letter month prefixes, in calendar order, for the forwarded `Date:` line. */
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** One PDF part a receipt carries. */
export interface ReceiptPdf {
  readonly partId: string;
  readonly filename: string;
}

/** One receipt mail a search returned, read in full. */
export interface ReceiptCandidate {
  readonly id: string;
  readonly sentAtIso: string | undefined;
  readonly subject: string | undefined;
  /** The text body; searched for the amount, and never printed. */
  readonly body: string;
  readonly pdfs: readonly ReceiptPdf[];
  /** The sender as the mailbox holds it — for a forward, the owner. */
  readonly from: string | undefined;
  readonly to: readonly string[];
  readonly labelIds: readonly string[];
  /** Whether the body carries a forwarded header block, so the receipt inside it is somebody else's mail. */
  readonly forwarded: boolean;
  /** `YYYY-MM-DD` the receipt itself is dated: a forward's `Date:` line, else the send day; undefined when unread. */
  readonly originalDay: string | undefined;
}

/** What the mailbox says about one expense's invoice. */
export type InvoiceVerdict =
  /** A receipt names the amount and carries at least one PDF. */
  | { readonly kind: "matched"; readonly receipt: ReceiptCandidate }
  /** Receipts in the window, none of them naming the amount (or every one naming it already claimed). */
  | { readonly kind: "unconfirmed"; readonly candidateIds: readonly string[] }
  /** No receipt mail at all in the window. */
  | { readonly kind: "none" }
  /** The merchant is not registered with a receipt domain, so there was nothing to search for. */
  | { readonly kind: "no-registered-merchant" };

/** One expense's search and what it returned. */
export interface InvoiceSearch {
  readonly expense: TaskExpense;
  /** The Gmail query run, or undefined when the merchant is not registered with a receipt domain. */
  readonly query: string | undefined;
  readonly candidates: readonly ReceiptCandidate[];
}

/**
 * A `YYYY-MM-DD` day offset by whole days.
 *
 * @param day the anchor day
 * @param offset whole days to add, negative for earlier
 * @returns the moved day
 */
function shiftDay({ day, offset }: { day: string; offset: number }): string {
  const moved = new Date(`${day}T00:00:00.000Z`);
  moved.setUTCDate(moved.getUTCDate() + offset);
  return moved.toISOString().slice(0, 10);
}

/**
 * A `YYYY/MM/DD` day offset from a `YYYY-MM-DD` one, as Gmail's `after:`/`before:` take it.
 *
 * @param day the anchor day
 * @param offset whole days to add, negative for earlier
 * @returns the Gmail-shaped day
 */
function gmailDay({ day, offset }: { day: string; offset: number }): string {
  return shiftDay({ day, offset }).replaceAll("-", "/");
}

/**
 * The Gmail search that finds one expense's receipt: mail from the merchant's registered receipt domains, or naming
 * them (the owner's forward), with an attachment, never already addressed to Airwallex, in a window reaching past the charge.
 *
 * @param expense one charge the reminder listed, its merchant and day deciding the search
 * @param merchants the install's registered merchants — a Gmail `from:` term on a domain matches its subdomains
 * @returns the query, or undefined when the merchant is not registered or is registered with no receipt domain
 */
export function invoiceQuery({
  expense,
  merchants,
}: {
  expense: TaskExpense;
  merchants: readonly SpendMerchant[];
}): string | undefined {
  const registered = registeredMerchantOf({ identity: expense.identity, merchants });
  if (registered === undefined || registered.receiptDomains.length === 0) {
    return undefined;
  }
  const domains = registered.receiptDomains;
  const from = domains.join(" OR ");
  const named = domains.map((domain) => `"${domain}"`).join(" OR ");
  const after = gmailDay({ day: expense.day, offset: -WINDOW_BEFORE_DAYS });
  const before = gmailDay({ day: expense.day, offset: QUERY_AFTER_DAYS + 1 });
  const excluded = `-to:${AIRWALLEX_RECEIPTS_ADDRESS}`;
  return `(from:(${from}) OR ${named}) has:attachment ${excluded} after:${after} before:${before}`;
}

/**
 * The day a forwarded `Date:` value names — `Sat, <Mon> <D>, <YYYY> at <h:mm> PM`, `Sat, <D> <Mon> <YYYY> at <HH:mm>`, or
 * `<D> <Month> <YYYY> at <h:mm:ss> pm <zone>`. The sender's local day, which the match window's tolerance absorbs.
 *
 * @param value the text after `Date:`
 * @returns `YYYY-MM-DD`, or undefined when no day, month and year can be read from it
 */
function dayFromDateLine({ value }: { value: string }): string | undefined {
  const dayFirst = /\b(\d{1,2})\s+([A-Za-z]{3,})\.?,?\s+(\d{4})\b/u.exec(value);
  const monthFirst = /\b([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})\b/u.exec(value);
  let parts: { day: string; month: string; year: string } | undefined;
  if (dayFirst !== null) {
    parts = { day: dayFirst[1]!, month: dayFirst[2]!, year: dayFirst[3]! };
  } else if (monthFirst !== null) {
    parts = { day: monthFirst[2]!, month: monthFirst[1]!, year: monthFirst[3]! };
  }
  if (parts === undefined) {
    return undefined;
  }
  const month = MONTHS.indexOf(parts.month.slice(0, 3).toLowerCase());
  const day = Number(parts.day);
  if (month === -1 || day < 1 || day > 31) {
    return undefined;
  }
  return `${parts.year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Where a receipt mail's own day comes from: the first `Date:` line under the INNERMOST forwarded header block,
 * or, for a receipt the vendor sent straight here, the day it was sent. Innermost, because a receipt forwarded
 * twice — plan mailbox to another address, then on here — opens with the intermediate forward's header, whose
 * day is the owner's, not the receipt's.
 *
 * @param body the text body
 * @param sentAtIso when this copy was sent — for a forward, when the owner forwarded it
 * @returns whether the body is a forward, and the receipt's day when it can be read
 */
export function receiptOrigin({ body, sentAtIso }: { body: string; sentAtIso: string | undefined }): {
  readonly forwarded: boolean;
  readonly originalDay: string | undefined;
} {
  const marker = [...body.matchAll(FORWARD_MARKERS)].at(-1);
  if (marker === undefined) {
    return { forwarded: false, originalDay: sentAtIso?.slice(0, 10) };
  }
  // Line by line rather than one multiline pattern: the header block is mail a sender wrote, and a single regex
  // over it with an optional prefix and a greedy tail backtracks polynomially on a crafted line.
  for (const raw of body.slice(marker.index).split("\n")) {
    const line = raw.trim().replace(/^\*/u, "").trimStart();
    if (line.toLowerCase().startsWith("date:")) {
      return { forwarded: true, originalDay: dayFromDateLine({ value: line.slice("date:".length).trim() }) };
    }
  }
  return { forwarded: true, originalDay: undefined };
}

/**
 * Whether a body names an amount — `340.00` or a grouped `1,234.00`, never as the tail of a longer number.
 *
 * @param text the body
 * @param amount the charged amount
 * @returns true when the digits stand on their own in the text
 */
export function namesAmount({ text, amount }: { text: string; amount: Money }): boolean {
  const grouped = formatMoney({ money: { currency: "", minor: Math.abs(amount.minor) } }).trim();
  const plain = grouped.replaceAll(",", "");
  return [...new Set([grouped, plain])].some((figure) => {
    let from = text.indexOf(figure);
    while (from !== -1) {
      const before = text[from - 1];
      const after = text[from + figure.length];
      const standsAlone =
        (before === undefined || !/[\d.,]/u.test(before)) && (after === undefined || !/\d/u.test(after));
      if (standsAlone) {
        return true;
      }
      from = text.indexOf(figure, from + 1);
    }
    return false;
  });
}

/**
 * Whether a candidate is a receipt at all, rather than a forward already on its way to Airwallex, the owner's sent copy of
 * one, or Airwallex's own mail.
 *
 * @returns true for mail that could be a vendor receipt
 */
function isReceiptMail({ receipt }: { receipt: ReceiptCandidate }): boolean {
  if (receipt.labelIds.includes("DRAFT") || receipt.labelIds.includes("SENT")) {
    return false;
  }
  if (receipt.to.some((address) => address.toLowerCase().includes(AIRWALLEX_RECEIPTS_ADDRESS))) {
    return false;
  }
  return !(receipt.from !== undefined && /airwallex\.com>?\s*$/iu.test(receipt.from));
}

/**
 * Whole days from the charge to a receipt's own day.
 *
 * @returns the signed distance in days, or undefined for a receipt whose day was not read
 */
function daysFrom({ day, receipt }: { day: string; receipt: ReceiptCandidate }): number | undefined {
  if (receipt.originalDay === undefined) {
    return undefined;
  }
  const millis =
    new Date(`${receipt.originalDay}T00:00:00.000Z`).getTime() - new Date(`${day}T00:00:00.000Z`).getTime();
  return Math.round(millis / 86_400_000);
}

/** How near a receipt sits to its charge, for ordering: an undated one sorts after every dated one. */
function sortKey({ distance }: { distance: number | undefined }): number {
  if (distance === undefined) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.abs(distance);
}

/** A subject with any leading `Fwd:`/`Fw:` taken off, for telling a forward of a receipt from the receipt itself. */
function bareSubject({ subject }: { subject: string | undefined }): string | undefined {
  if (subject === undefined) {
    return undefined;
  }
  let bare = subject.trim();
  while (/^fwd?:/iu.test(bare)) {
    bare = bare.replace(/^fwd?:/iu, "").trimStart();
  }
  return bare;
}

/**
 * Drop a forward that is only a copy of a receipt the vendor also sent here — same day, same subject — keeping the
 * vendor's own mail, so one receipt is never counted as two for two identical charges.
 *
 * @returns the candidates, each receipt once
 */
function dropForwardedCopies({ candidates }: { candidates: readonly ReceiptCandidate[] }): readonly ReceiptCandidate[] {
  const direct = candidates.filter((receipt) => !receipt.forwarded);
  return candidates.filter(
    (receipt) =>
      !receipt.forwarded ||
      !direct.some(
        (original) =>
          original.originalDay === receipt.originalDay &&
          bareSubject({ subject: original.subject }) === bareSubject({ subject: receipt.subject }),
      ),
  );
}

/**
 * Pair each expense with its invoice, in the reminder's order, one receipt per expense.
 *
 * @param searches each expense's search and its results
 * @returns one verdict per search, in the same order
 */
export function matchInvoices({ searches }: { searches: readonly InvoiceSearch[] }): readonly InvoiceVerdict[] {
  const claimed = new Set<string>();
  return searches.map(({ expense, query, candidates }): InvoiceVerdict => {
    if (query === undefined) {
      return { kind: "no-registered-merchant" };
    }
    const receipts = dropForwardedCopies({ candidates: candidates.filter((receipt) => isReceiptMail({ receipt })) });
    if (receipts.length === 0) {
      return { kind: "none" };
    }
    const naming = receipts
      .filter((receipt) => !claimed.has(receipt.id) && receipt.pdfs.length > 0)
      .filter((receipt) => namesAmount({ amount: expense.amount, text: receipt.body }))
      .map((receipt) => ({ distance: daysFrom({ day: expense.day, receipt }), receipt }))
      .filter(
        ({ distance }) => distance === undefined || (distance >= -WINDOW_BEFORE_DAYS && distance <= WINDOW_AFTER_DAYS),
      )
      .toSorted((left, right) => sortKey({ distance: left.distance }) - sortKey({ distance: right.distance }));
    const best = naming[0];
    // A receipt whose own day could not be read is taken only when it is the one candidate: beside another, which of
    // them answers this charge is a guess.
    const undatedAmongMany = best !== undefined && best.distance === undefined && naming.length > 1;
    if (best === undefined || undatedAmongMany) {
      return { candidateIds: receipts.map((candidate) => candidate.id), kind: "unconfirmed" };
    }
    claimed.add(best.receipt.id);
    return { kind: "matched", receipt: best.receipt };
  });
}
