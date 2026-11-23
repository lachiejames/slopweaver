/**
 * The card-spend register's vocabulary — one company card's snapshot, as a pasted card-page export records it,
 * and the report `spend read` renders from it.
 *
 * A snapshot is a PAGE, not a ledger: it is exactly what the provider's console showed on the day it was
 * captured, so nothing here claims a transaction the page did not show or a reason the page did not give.
 *
 * Which merchant a charge belongs to is the install's own register (`./merchants/core.ts`), never a list here.
 */
import type { MerchantIdentity } from "./merchants/core.js";

/** The card providers a pasted export is understood from. One page shape, one provider. */
type SpendProvider = "airwallex";

/**
 * An amount exactly as the page printed it: integer minor units (cents) and the currency code beside it.
 *
 * Integer so a sum is exact, and never converted: a USD charge on an AUD card is held in USD, because the rate
 * the provider applied is not on the page and inventing one would put a made-up number in every total.
 */
export interface Money {
  readonly minor: number;
  readonly currency: string;
}

/**
 * What the page's Status column said. A blank status is `charged` — the page does not say whether it has
 * settled or is still pending, and neither does this.
 */
export type TransactionStatus = "charged" | "declined" | "cancelled" | "card-verification";

/** One row of the page's transaction table. */
export interface CardTransaction {
  /** `YYYY-MM-DD`, as the page printed it. */
  readonly date: string;
  /** The merchant string verbatim — its group is derived at read time, so a register change reclassifies old imports. */
  readonly merchant: string;
  readonly amount: Money;
  readonly status: TransactionStatus;
  /** The row's position on the page, 0 = the first (newest) row. Rows carry no id of their own. */
  readonly ordinal: number;
  /** Airwallex's own reason for a decline, verbatim — carried by a live read only, since the page prints none. */
  readonly declineReason?: string;
}

/** The card's monthly limit as the page stated it on the capture day. */
interface MonthlyLimit {
  readonly used: Money;
  readonly limit: Money;
  /** `YYYY-MM-DD` — the page's "resets <Mon> <day>", resolved to the first such date on or after the capture day. */
  readonly resetsOn: string;
  /** The page's own words on when a reset takes effect, verbatim, or null when the page printed none. */
  readonly resetNote: string | null;
}

/** One company card, as one pasted export captured it. */
export interface CardSnapshot {
  readonly schemaVersion: 1;
  readonly provider: SpendProvider;
  readonly last4: string;
  readonly nickname: string;
  readonly organisation: string;
  /** `YYYY-MM-DD` — the day the page was captured, given by the importer and never guessed from a file date. */
  readonly asOf: string;
  readonly monthly: MonthlyLimit;
  readonly transactionLimit: Money;
  /**
   * The merchants the card's merchant control allows, or null when the capture named none: a page with no control,
   * or a live read, whose control carries brand ids rather than names.
   */
  readonly merchantAllow: readonly string[] | null;
  readonly transactions: readonly CardTransaction[];
  /**
   * Where the snapshot came from: a `pasted` export at `path`, or a `live` read of the owner's card page, whose `path` is a
   * fixed label because the page's own address carries card and account ids.
   */
  readonly source: { readonly kind: "pasted" | "live"; readonly path: string; readonly importedAt: string };
}

/** One declined charge on the most recent decline date, set against what the page shows about headroom. */
interface DeclineReading {
  readonly merchant: string;
  readonly identity: MerchantIdentity;
  readonly amount: Money;
  /** Airwallex's own reason for the decline, or null when the capture carried none (every pasted page). */
  readonly reason: string | null;
  /**
   * Whether the charge is larger than the headroom on the CAPTURE day — never on the decline day, which the
   * page does not show. `different-currency` when the two cannot be compared without a rate.
   */
  readonly exceedsHeadroomAsOf: "yes" | "no" | "different-currency";
}

/**
 * Whether the page rules the monthly limit out as the cause of the latest declines. `ruled-out` only when every
 * one of them is provably within the headroom the card had; otherwise `possible`, with each reason it is not proven.
 */
export type LimitVerdict =
  { readonly kind: "ruled-out" } | { readonly kind: "possible"; readonly because: readonly string[] };

/** The most recent day the page shows a decline on, and what the page proves about the limit that day. */
export interface LatestDeclines {
  readonly date: string;
  readonly rows: readonly DeclineReading[];
  /**
   * `YYYY-MM-DD` — a decline on or before this day may belong to the monthly period before the capture day's: the
   * later of "a month before the reset" and "the previous month's end", plus a day for a reset that lands "the
   * following day".
   */
  readonly periodOpensAfter: string;
  /** Charges that went THROUGH on a later day than the declines. Each one is headroom the declines still had. */
  readonly chargedAfter: readonly Money[];
  /**
   * Non-zero cancelled and card-verification rows on or before the decline day, from the EARLIEST day the period
   * could have opened. Each may have been holding headroom when the declines happened and been released since, so
   * each LOWERS the floor — an unneeded one only makes the verdict more cautious.
   */
  readonly heldBefore: readonly Money[];
  /**
   * The capture-day headroom, plus every later charge in the limit's currency, minus every earlier hold in it — a
   * floor on the headroom the card had when the declines happened. A later charge in another currency only raises
   * it, so it is left out; a hold in another currency lowers it by an amount the page cannot price, which the
   * verdict names.
   */
  readonly headroomThenAtLeast: Money;
  readonly limitVerdict: LimitVerdict;
}

/** Charged totals for one merchant group, per currency. */
export interface MerchantTotal {
  readonly identity: MerchantIdentity;
  readonly merchants: readonly string[];
  readonly charges: number;
  readonly totals: readonly Money[];
}

/** Charged totals for one merchant group in one calendar month, per currency. */
export interface MonthTotal {
  readonly month: string;
  readonly identity: MerchantIdentity;
  readonly totals: readonly Money[];
}

/** Everything `spend read` says about one card. */
export interface CardReport {
  readonly provider: SpendProvider;
  readonly last4: string;
  readonly nickname: string;
  readonly organisation: string;
  readonly asOf: string;
  readonly source: CardSnapshot["source"];
  readonly transactionLimit: Money;
  readonly merchantAllow: readonly string[] | null;
  readonly monthly: MonthlyLimit & { readonly headroom: Money };
  readonly declineCount: number;
  /** Null when the page shows no decline at all. */
  readonly latestDeclines: LatestDeclines | null;
  readonly byMerchant: readonly MerchantTotal[];
  readonly byMonth: readonly MonthTotal[];
}
