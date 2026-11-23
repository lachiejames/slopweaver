import { describe, expect, it } from "vitest";

import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import { SpendMerchantErrors } from "../../../../spend/merchants/errors.js";
import { NO_MERCHANTS_NOTE, spendMerchantsOf } from "../../../../spend/merchants/read.js";
import { documentOfRows } from "../../../../spend/merchants/store.js";
import { StoreErrors } from "../../../../store/errors.js";

const ACME = { prefixes: ["acme"], receiptDomains: ["acme.example"], slug: "acme" };

describe("spendMerchantsOf", () => {
  it("runs with the register and no note when a merchant is registered", () => {
    expect(unwrap(spendMerchantsOf({ register: ok({ merchants: [ACME], schemaVersion: 1 }) }))).toEqual({
      document: { merchants: [ACME], schemaVersion: 1 },
      note: undefined,
    });
  });

  it("runs with an empty register and the note when none is registered", () => {
    expect(unwrap(spendMerchantsOf({ register: ok({ merchants: [], schemaVersion: 1 }) }))).toEqual({
      document: { merchants: [], schemaVersion: 1 },
      note: NO_MERCHANTS_NOTE,
    });
  });

  it("reads a home with no store selected as no merchant registered", () => {
    const absent = SpendMerchantErrors.queryFailed({
      cause: StoreErrors.urlMissing({ envVar: "SLOPWEAVER_STORE_URL", secretName: "store-url" }),
    });
    expect(unwrap(spendMerchantsOf({ register: err(absent) }))).toEqual({
      document: { merchants: [], schemaVersion: 1 },
      note: NO_MERCHANTS_NOTE,
    });
  });

  it("refuses an unreachable store rather than reading it as an empty register", () => {
    const unreachable = SpendMerchantErrors.queryFailed({
      cause: StoreErrors.queryFailed({ cause: new Error("connection refused"), what: "card merchants read" }),
    });
    expect(unwrapErr(spendMerchantsOf({ register: err(unreachable) }))).toEqual(unreachable);
  });

  it("refuses a stored register that does not read", () => {
    const invalid = SpendMerchantErrors.invalid({ issues: ["merchant acme: the slug is registered twice"] });
    expect(unwrapErr(spendMerchantsOf({ register: err(invalid) })).code).toBe("SPEND_MERCHANT_INVALID");
  });
});

describe("documentOfRows", () => {
  it("validates stored rows exactly as an offered document", () => {
    const rows = [
      { prefixes: ["globex"], receiptDomains: [], slug: "globex" },
      { prefixes: ["ACME"], receiptDomains: ["acme.example"], slug: "acme" },
    ];
    expect(unwrap(documentOfRows({ rows }))).toEqual({
      merchants: [ACME, { prefixes: ["globex"], receiptDomains: [], slug: "globex" }],
      schemaVersion: 1,
    });
  });

  it("refuses rows a hand-edit left overlapping", () => {
    const rows = [
      { prefixes: ["acme"], receiptDomains: [], slug: "acme" },
      { prefixes: ["acme cloud"], receiptDomains: [], slug: "cloud" },
    ];
    expect(unwrapErr(documentOfRows({ rows }))).toEqual(
      SpendMerchantErrors.invalid({
        issues: ['merchant cloud: prefix "acme cloud" overlaps "acme" of acme, so a charge could match both'],
      }),
    );
  });
});
