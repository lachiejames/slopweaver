/**
 * THE one write of the card-merchant register: the whole document, replaced atomically, then read back so what a
 * caller reports is what the store holds rather than the form that asked for it. `spend merchants set` is its only
 * caller.
 */
import { err, type Result } from "../../lib/result.js";
import { closeAfterAnswer } from "../../organisation/store.js";
import { connectStore, type StoreClient } from "../../store/client.js";

import type { SpendMerchantDocument } from "./core.js";
import { type SpendMerchantError, SpendMerchantErrors } from "./errors.js";
import { readStoredSpendMerchants, replaceStoredSpendMerchants } from "./store.js";

/**
 * Replace the register in the store selected under `home`.
 *
 * @param home the Slopweaver home the store selection is read under
 * @param document the validated register to store
 * @returns the register as stored, or the typed refusal
 */
export async function writeSpendMerchantRegister({
  home,
  document,
}: {
  home: string;
  document: SpendMerchantDocument;
}): Promise<Result<SpendMerchantDocument, SpendMerchantError>> {
  const opened = await connectStore({ home });
  if (opened.isErr()) {
    return err(SpendMerchantErrors.queryFailed({ cause: opened.error }));
  }
  try {
    return await writeSpendMerchantRegisterOverClient({ client: opened.value, document });
  } finally {
    await closeAfterAnswer({ client: opened.value });
  }
}

/**
 * The write over an already-open client: replace, then read back.
 *
 * @param client an open store connection, closed by the caller
 * @param document the validated register to store
 * @returns the register as stored, or the typed refusal
 */
export async function writeSpendMerchantRegisterOverClient({
  client,
  document,
}: {
  client: StoreClient;
  document: SpendMerchantDocument;
}): Promise<Result<SpendMerchantDocument, SpendMerchantError>> {
  const replaced = await replaceStoredSpendMerchants({ client, document });
  if (replaced.isErr()) {
    return err(replaced.error);
  }
  return readStoredSpendMerchants({ client });
}
