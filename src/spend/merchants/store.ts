/**
 * The card-merchant register's effectful edge over an already-open store client: one read of every row, and one
 * whole-register replacement.
 *
 * The replacement is ONE transaction that takes an `ACCESS EXCLUSIVE` lock on the table before it deletes and
 * re-inserts, so two writers racing each other serialise and the last one's document is what stands — whole, never
 * a mixture of both — and a failed insert rolls the delete back, leaving the previous register exactly as it was.
 */
import { asc, sql } from "drizzle-orm";

import { err, ok, type Result } from "../../lib/result.js";
import type { StoreClient, StoreWriter } from "../../store/client.js";
import { StoreErrors } from "../../store/errors.js";
import { type SpendMerchantRow, spendMerchantTable } from "../../store/schema/spendMerchant.js";

import { parseSpendMerchantDocument, type SpendMerchantDocument } from "./core.js";
import { type SpendMerchantError, SpendMerchantErrors } from "./errors.js";

/**
 * The register a set of stored rows records — validated exactly as an offered document is, so a row a hand-edit
 * left wrong (an overlapping prefix, a domain that is not one) is refused rather than trusted. Pure.
 *
 * @param rows every stored row, in any order
 * @returns the canonical document, or `SPEND_MERCHANT_INVALID` naming every problem
 */
export function documentOfRows({
  rows,
}: {
  rows: readonly SpendMerchantRow[];
}): Result<SpendMerchantDocument, SpendMerchantError> {
  return parseSpendMerchantDocument({
    value: {
      merchants: rows.map((row) => ({ prefixes: row.prefixes, receiptDomains: row.receiptDomains, slug: row.slug })),
      schemaVersion: 1,
    },
  });
}

/**
 * Read every registered merchant. No rows is an empty register, which is a statement, not a failure.
 *
 * @param client an open store connection
 * @returns the canonical document, or the typed refusal
 */
export async function readStoredSpendMerchants({
  client,
}: {
  client: StoreClient;
}): Promise<Result<SpendMerchantDocument, SpendMerchantError>> {
  let rows: SpendMerchantRow[];
  try {
    rows = await client.db.select().from(spendMerchantTable).orderBy(asc(spendMerchantTable.slug));
  } catch (cause) {
    return err(
      SpendMerchantErrors.queryFailed({ cause: StoreErrors.queryFailed({ cause, what: "card merchants read" }) }),
    );
  }
  return documentOfRows({ rows });
}

/** Delete every row and insert the document's, inside the caller's transaction, after locking the table. */
async function replaceWithin({
  writer,
  document,
}: {
  writer: StoreWriter;
  document: SpendMerchantDocument;
}): Promise<void> {
  await writer.execute(sql`LOCK TABLE ${spendMerchantTable} IN ACCESS EXCLUSIVE MODE`);
  await writer.delete(spendMerchantTable);
  if (document.merchants.length === 0) {
    return;
  }
  await writer.insert(spendMerchantTable).values(
    document.merchants.map((merchant) => ({
      prefixes: [...merchant.prefixes],
      receiptDomains: [...merchant.receiptDomains],
      slug: merchant.slug,
    })),
  );
}

/**
 * Replace the whole register with one already-validated document, atomically.
 *
 * @param client an open store connection
 * @param document the canonical register to store; an empty one clears the table
 * @returns nothing on success, or the typed refusal with the previous register left whole
 */
export async function replaceStoredSpendMerchants({
  client,
  document,
}: {
  client: StoreClient;
  document: SpendMerchantDocument;
}): Promise<Result<void, SpendMerchantError>> {
  try {
    await client.db.transaction(async (writer: StoreWriter): Promise<void> => {
      await replaceWithin({ document, writer });
    });
  } catch (cause) {
    return err(
      SpendMerchantErrors.queryFailed({ cause: StoreErrors.queryFailed({ cause, what: "card merchants replace" }) }),
    );
  }
  return ok(undefined);
}
