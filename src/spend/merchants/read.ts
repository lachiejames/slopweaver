/**
 * THE one read of the card-merchant register, and the rule that turns it into the merchants a spend reader runs with.
 *
 * ## No register is a statement, an unreadable one is not
 *
 * The same line `../../organisation/dependencyBots.ts` draws. An install that registered no merchant — or selected no
 * store at all, which is the same fact one step earlier and what CI's throwaway home always is — groups every charge
 * under its own merchant string, and says so in one note. Any other failure refuses: an unreachable store or a row a
 * hand-edit left wrong must never read as "this install registers no merchant".
 */
import { err, ok, type Result } from "../../lib/result.js";
import { closeAfterAnswer } from "../../organisation/store.js";
import { connectStore } from "../../store/client.js";

import type { SpendMerchantDocument } from "./core.js";
import { type SpendMerchantError, SpendMerchantErrors } from "./errors.js";
import { readStoredSpendMerchants } from "./store.js";

/** The note a reader prints, once, when the register is empty by absence. */
export const NO_MERCHANTS_NOTE =
  "no card merchants are registered on this install — charges group by their own merchant string; " +
  "`slopweaver spend merchants set` registers them";

/** The register a reader runs with, and the one line it owes when the register is empty. */
export interface ResolvedSpendMerchants {
  readonly document: SpendMerchantDocument;
  /** {@link NO_MERCHANTS_NOTE} when no merchant is registered; `undefined` when one is. */
  readonly note: string | undefined;
}

/**
 * Read the register from the store selected under `home`.
 *
 * @param home the Slopweaver home the store selection is read under
 * @returns the canonical document — empty when nothing is registered — or the typed refusal
 */
export async function readSpendMerchantRegister({
  home,
}: {
  home: string;
}): Promise<Result<SpendMerchantDocument, SpendMerchantError>> {
  const opened = await connectStore({ home });
  if (opened.isErr()) {
    return err(SpendMerchantErrors.queryFailed({ cause: opened.error }));
  }
  try {
    return await readStoredSpendMerchants({ client: opened.value });
  } finally {
    await closeAfterAnswer({ client: opened.value });
  }
}

/** The register a home with no store selected holds: none, by construction. */
const EMPTY: SpendMerchantDocument = { merchants: [], schemaVersion: 1 };

/**
 * The merchants one register read implies. Pure.
 *
 * @param register the result of the one register read, taken at the caller's effectful edge
 * @returns the register with no note; an empty register with the note when nothing is registered or no store is
 *   selected; or the read's own refusal, unchanged, for any other failure
 */
export function spendMerchantsOf({
  register,
}: {
  register: Result<SpendMerchantDocument, SpendMerchantError>;
}): Result<ResolvedSpendMerchants, SpendMerchantError> {
  if (register.isOk()) {
    if (register.value.merchants.length === 0) {
      return ok({ document: register.value, note: NO_MERCHANTS_NOTE });
    }
    return ok({ document: register.value, note: undefined });
  }
  const error = register.error;
  if (error.code === "SPEND_MERCHANT_QUERY_FAILED" && error.cause.code === "STORE_URL_MISSING") {
    return ok({ document: EMPTY, note: NO_MERCHANTS_NOTE });
  }
  return err(error);
}
