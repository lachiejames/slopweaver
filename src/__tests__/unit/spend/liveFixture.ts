/**
 * A synthetic capture of the Airwallex card page, built from the field paths discovery recorded.
 * Every value is invented; none is the owner's card's.
 */
import type { CapturedResponse } from "../../../browser/pageTransport.js";
import type { CardSnapshot, CardTransaction } from "../../../spend/types.js";

/** Synthetic values only, built from the discovered field paths — none of them is the owner's card's. */
export const CARD_ID = "card-synthetic-1";
export const OTHER_CARD_ID = "card-synthetic-2";
export const NICKNAME = "Synthetic AI card";
export const ENTITY = "Synthetic Pty Ltd";
export const MERCHANT = "Synthetic Vendor Inc";
export const REASON = "Synthetic decline reason";

/** The decline the stored snapshot also holds, so a live row on its day calibrates the rows' unit. */
export const STORED_DECLINE: CardTransaction = {
  amount: { currency: "AUD", minor: 15500 },
  date: "2026-09-25",
  merchant: "Synthetic Vendor San Francisco",
  ordinal: 0,
  status: "declined",
};

/**
 * The snapshot already stored for the card, as `spend import` wrote it.
 *
 * @param transactions the stored rows a live row is checked against
 * @returns the calibration snapshot
 */
export const calibration = ({
  transactions = [STORED_DECLINE],
}: { transactions?: readonly CardTransaction[] } = {}): CardSnapshot => ({
  asOf: "2026-09-28",
  last4: "0042",
  merchantAllow: ["Synthetic Vendor"],
  monthly: {
    limit: { currency: "AUD", minor: 250000 },
    resetNote: null,
    resetsOn: "2026-09-30",
    used: { currency: "AUD", minor: 100000 },
  },
  nickname: NICKNAME,
  organisation: ENTITY,
  provider: "airwallex",
  schemaVersion: 1,
  source: { importedAt: "2026-09-28T01:00:00.000Z", kind: "pasted", path: "/tmp/card.md" },
  transactionLimit: { currency: "AUD", minor: 100000 },
  transactions,
});

/**
 * One answered card operation.
 *
 * @returns the captured response
 */
const answer = ({ body, operation }: { body: unknown; operation: string }): CapturedResponse => ({
  body,
  method: "POST",
  statusCode: 200,
  url: `https://www.airwallex.com/app/graphql/cards/${operation}`,
});

/**
 * `GetExpandedCardDetails` for one card, carrying a card number the mapper must never read.
 *
 * @returns the captured response
 */
export const details = ({
  entities = [ENTITY],
  id = CARD_ID,
  nickname = NICKNAME,
}: { entities?: readonly string[]; id?: string; nickname?: string } = {}): CapturedResponse =>
  answer({
    body: {
      data: {
        getCard: {
          cardExtension: {
            allCardholders: entities.map((name) => ({ userOrgEnrollment: { employmentEntityName: name } })),
          },
          cardNumber: "0000 0000 0000 0000",
          id,
          nickname,
        },
      },
    },
    operation: "GetExpandedCardDetails",
  });

/**
 * `GetCardLimits` for one card, major units unless the amounts say otherwise.
 *
 * @returns the captured response
 */
export const limits = ({
  currency = "AUD",
  id = CARD_ID,
  limitAmount = 2500,
  spendAmount = 1234.5,
  windowType = "CALENDAR_MONTH",
}: {
  currency?: string;
  id?: string;
  limitAmount?: number | null;
  spendAmount?: number | string;
  windowType?: string;
} = {}): CapturedResponse =>
  answer({
    body: {
      data: {
        getCard: {
          id,
          monthly: { currency, currencyValue: currency, limitAmount, spendAmount, windowType },
          perTransactionLimit: 1000,
        },
      },
    },
    operation: "GetCardLimits",
  });

/**
 * One transaction row, declined with a reason unless told otherwise.
 *
 * @returns the row as the backend answers it
 */
export const row = ({
  amount = 155,
  cardId = CARD_ID,
  date = "2026-09-25",
  failureReason = REASON,
  id,
  status = "DECLINED",
}: {
  amount?: number;
  cardId?: string;
  date?: string;
  failureReason?: string | null;
  id: string;
  status?: string;
}): Record<string, unknown> => ({
  cardId,
  cardNumber: "0000 0000 0000 0000",
  date,
  failureReason,
  id,
  merchantDetails: { cleanMerchantName: MERCHANT },
  status,
  transactionAmount: amount,
  transactionCurrency: "AUD",
});

/**
 * `TransactionSearchByCardId` holding the rows given.
 *
 * @returns the captured response
 */
export const transactions = ({
  rows,
  totalCount,
}: {
  rows: readonly unknown[];
  totalCount: number;
}): CapturedResponse =>
  answer({
    body: { data: { spendCardTransactionsByCardId: { pageInfo: { totalCount }, transactions: rows } } },
    operation: "TransactionSearchByCardId",
  });

/** When the synthetic capture settled. */
export const CAPTURED_AT = "2026-09-29T02:00:00.000Z";
/** The zone the synthetic page prints days in. */
export const ZONE = "Australia/Sydney";
