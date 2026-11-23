/**
 * The card-merchant register against a REAL store: the facts an in-memory register cannot prove — the `text[]`
 * round trip, the whole-register replacement, a failed insert rolling the delete back, and an empty document
 * clearing the table.
 *
 * OPT-IN, and never in CI: it needs a real, migrated local store, and there is none in any lane. Point it at a
 * THROWAWAY database in the running stack — never `postgres`, which is the live fleet's, and whose
 * `spend_merchant` rows ARE this install's register. This file empties that table before and after every case:
 *
 *   createdb -h 127.0.0.1 -p 55322 -U postgres spend_merchant_proof
 *   SLOPWEAVER_STORE_URL=postgresql://postgres:postgres@127.0.0.1:55322/spend_merchant_proof slopweaver store push
 *   SPEND_MERCHANT_PROOF_URL=postgresql://postgres:postgres@127.0.0.1:55322/spend_merchant_proof \
 *     yarn vitest run --config config/vitest/integration.ts src/__tests__/integration/spendMerchantStore.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../lib/result.js";
import type { SpendMerchantDocument } from "../../spend/merchants/core.js";
import { readStoredSpendMerchants, replaceStoredSpendMerchants } from "../../spend/merchants/store.js";
import { writeSpendMerchantRegisterOverClient } from "../../spend/merchants/write.js";
import { openStore, type StoreClient } from "../../store/client.js";
import { spendMerchantTable } from "../../store/schema/spendMerchant.js";

const PROOF_URL = process.env["SPEND_MERCHANT_PROOF_URL"];

const ACME: SpendMerchantDocument = {
  merchants: [
    { prefixes: ["acme", "acme cloud*"], receiptDomains: ["acme.example", "billing.acme.example"], slug: "acme" },
    { prefixes: ["globex"], receiptDomains: [], slug: "globex" },
  ],
  schemaVersion: 1,
};

describe.skipIf(PROOF_URL === undefined)("the card-merchant register in a real store", () => {
  let client: StoreClient;

  beforeAll(() => {
    client = openStore({ url: PROOF_URL! });
  });

  afterAll(async () => {
    await client.db.delete(spendMerchantTable);
    await client.close();
  });

  beforeEach(async () => {
    await client.db.delete(spendMerchantTable);
  });

  it("reads an empty table as an empty register", async () => {
    expect(unwrap(await readStoredSpendMerchants({ client }))).toEqual({ merchants: [], schemaVersion: 1 });
  });

  it("round-trips every array, and a second write replaces the first whole", async () => {
    expect(unwrap(await writeSpendMerchantRegisterOverClient({ client, document: ACME }))).toEqual(ACME);
    const second: SpendMerchantDocument = {
      merchants: [{ prefixes: ["initech"], receiptDomains: ["initech.example"], slug: "initech" }],
      schemaVersion: 1,
    };
    expect(unwrap(await writeSpendMerchantRegisterOverClient({ client, document: second }))).toEqual(second);
  });

  it("clears the table on an empty document", async () => {
    unwrap(await replaceStoredSpendMerchants({ client, document: ACME }));
    expect(
      unwrap(await writeSpendMerchantRegisterOverClient({ client, document: { merchants: [], schemaVersion: 1 } })),
    ).toEqual({ merchants: [], schemaVersion: 1 });
  });

  it("rolls the delete back when the insert fails, leaving the previous register whole", async () => {
    unwrap(await replaceStoredSpendMerchants({ client, document: ACME }));
    const duplicated: SpendMerchantDocument = {
      merchants: [
        { prefixes: ["initech"], receiptDomains: [], slug: "initech" },
        { prefixes: ["other"], receiptDomains: [], slug: "initech" },
      ],
      schemaVersion: 1,
    };
    expect(unwrapErr(await replaceStoredSpendMerchants({ client, document: duplicated })).code).toBe(
      "SPEND_MERCHANT_QUERY_FAILED",
    );
    expect(unwrap(await readStoredSpendMerchants({ client }))).toEqual(ACME);
  });
});
