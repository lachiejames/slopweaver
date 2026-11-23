/**
 * Reading or writing the card-merchant register fails in two ways a caller branches on, so it carries its own union.
 *
 * There is deliberately no "not configured" variant: an empty register is a statement — this install groups charges
 * by their own merchant string — and `./read.ts`'s `spendMerchantsOf` turns it into one note. Nor is there a write
 * conflict: `spend merchants set` replaces the whole register under a table lock, so the last writer wins whole.
 * `SPEND_MERCHANT_QUERY_FAILED` keeps the store's own error, so an unselected store (`STORE_URL_MISSING`, which is
 * absence one step earlier) stays distinguishable from an unreachable one (which is a refusal).
 */
import type { StoreError } from "../../store/errors.js";

/** An offered document, or a stored row, does not read — every problem named. */
export interface SpendMerchantInvalidError {
  readonly code: "SPEND_MERCHANT_INVALID";
  readonly message: string;
  readonly issues: readonly string[];
}

/** The store refused, failed or could not be reached, with its own reason carried forward. */
export interface SpendMerchantQueryFailedError {
  readonly code: "SPEND_MERCHANT_QUERY_FAILED";
  readonly message: string;
  readonly cause: StoreError;
}

/** Every way reading or writing the card-merchant register can fail. */
export type SpendMerchantError = SpendMerchantInvalidError | SpendMerchantQueryFailedError;

/** Build one of the two, so a test constructs a failure the same way the real code does. */
export const SpendMerchantErrors = {
  invalid: ({ issues }: { issues: readonly string[] }): SpendMerchantInvalidError => ({
    code: "SPEND_MERCHANT_INVALID",
    issues,
    message: `the card-merchant register does not read: ${issues.join("; ")}`,
  }),
  queryFailed: ({ cause }: { cause: StoreError }): SpendMerchantQueryFailedError => ({
    cause,
    code: "SPEND_MERCHANT_QUERY_FAILED",
    message: `the card-merchant register could not be read from or written to the store: ${cause.message}`,
  }),
} as const;
