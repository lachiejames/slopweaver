/**
 * The three card-page operations a live snapshot is built from, as schemas that name ONLY the fields it reads.
 *
 * Each schema is the discovery report cut down to what the snapshot needs (`spend capture
 * --discover`). A Zod object drops every key it does not declare, so the card
 * number both `GetExpandedCardDetails` and every transaction carry is never read out of the body at all. Zod's
 * type messages name a path and an expected type, never the value, so a refusal built from them leaks nothing.
 */
import { z } from "zod";

import type { CapturedResponse } from "../browser/pageTransport.js";
import { err, ok, type Result } from "../lib/result.js";
import { type LiveCaptureError, LiveCaptureErrors } from "./liveErrors.js";

/** Where the console's card GraphQL operations answer, the operation name its last segment. */
const CARD_GRAPHQL_PATH = "/app/graphql/cards/";

/** One limit window of `GetCardLimits`. */
const LIMIT_WINDOW = z.object({
  currency: z.string(),
  limitAmount: z.number().nullable(),
  spendAmount: z.number(),
  windowType: z.string(),
});

/** `GetCardLimits` — the monthly window and the per-charge limit. */
const CARD_LIMITS = z.object({
  data: z.object({ getCard: z.object({ id: z.string(), monthly: LIMIT_WINDOW, perTransactionLimit: z.number() }) }),
});

/** `GetExpandedCardDetails` — the nickname and the cardholders' entity. */
const CARD_DETAILS = z.object({
  data: z.object({
    getCard: z.object({
      cardExtension: z.object({
        allCardholders: z.array(z.object({ userOrgEnrollment: z.object({ employmentEntityName: z.string() }) })),
      }),
      id: z.string(),
      nickname: z.string(),
    }),
  }),
});

/** One row of `TransactionSearchByCardId`. */
const TRANSACTION = z.object({
  cardId: z.string(),
  date: z.string(),
  failureReason: z.string().nullable(),
  id: z.string(),
  merchantDetails: z.object({ cleanMerchantName: z.string() }),
  status: z.string(),
  transactionAmount: z.number(),
  transactionCurrency: z.string(),
});

/** `TransactionSearchByCardId` — one page of the card's transactions. */
const TRANSACTIONS = z.object({
  data: z.object({
    spendCardTransactionsByCardId: z.object({
      pageInfo: z.object({ totalCount: z.number() }),
      transactions: z.array(TRANSACTION),
    }),
  }),
});

/** A parsed `GetCardLimits` body. */
export type CardLimitsBody = z.infer<typeof CARD_LIMITS>;
/** A parsed `GetExpandedCardDetails` body. */
export type CardDetailsBody = z.infer<typeof CARD_DETAILS>;
/** A parsed `TransactionSearchByCardId` body. */
type TransactionsBody = z.infer<typeof TRANSACTIONS>;
/** One parsed transaction row. */
export type LiveTransaction = z.infer<typeof TRANSACTION>;

/** Every operation's parsed bodies, in the order the page answered them. */
export interface LiveBodies {
  readonly limits: readonly CardLimitsBody[];
  readonly details: readonly CardDetailsBody[];
  readonly transactions: readonly TransactionsBody[];
}

/**
 * Every successful answer to one operation, parsed.
 *
 * @param operation the GraphQL operation name
 * @param responses what the page heard
 * @param schema the fields read off each body, and nothing else
 * @returns the parsed bodies, `LIVE_OPERATION_MISSING` when none answered, or `LIVE_BODY_INVALID` naming each
 *   field path that did not match
 */
function bodiesOf<Body>({
  operation,
  responses,
  schema,
}: {
  operation: string;
  responses: readonly CapturedResponse[];
  schema: z.ZodType<Body>;
}): Result<readonly Body[], LiveCaptureError> {
  const answered = responses.filter(
    (response) => response.statusCode === 200 && pathOf({ url: response.url }) === `${CARD_GRAPHQL_PATH}${operation}`,
  );
  if (answered.length === 0) {
    return err(LiveCaptureErrors.operationMissing({ operation }));
  }
  const parsed: Body[] = [];
  for (const response of answered) {
    const body = schema.safeParse(response.body);
    if (!body.success) {
      const problems = body.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
      return err(LiveCaptureErrors.bodyInvalid({ operation, problems }));
    }
    parsed.push(body.data);
  }
  return ok(parsed);
}

/**
 * A URL's path, or the empty string when it is not one.
 *
 * @param url a captured response's URL
 * @returns its pathname
 */
function pathOf({ url }: { url: string }): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}

/**
 * The three operations' parsed bodies off one capture.
 *
 * @param responses what the page heard
 * @returns every operation's bodies, or the first operation that is missing or malformed
 */
export function liveBodiesOf({
  responses,
}: {
  responses: readonly CapturedResponse[];
}): Result<LiveBodies, LiveCaptureError> {
  const limits = bodiesOf({ operation: "GetCardLimits", responses, schema: CARD_LIMITS });
  if (limits.isErr()) {
    return err(limits.error);
  }
  const details = bodiesOf({ operation: "GetExpandedCardDetails", responses, schema: CARD_DETAILS });
  if (details.isErr()) {
    return err(details.error);
  }
  const transactions = bodiesOf({ operation: "TransactionSearchByCardId", responses, schema: TRANSACTIONS });
  if (transactions.isErr()) {
    return err(transactions.error);
  }
  return ok({ details: details.value, limits: limits.value, transactions: transactions.value });
}
