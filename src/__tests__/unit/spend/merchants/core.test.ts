import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  merchantIdentityKey,
  merchantIdentityLabel,
  merchantIdentityOf,
  merchantRegisterLines,
  normaliseMerchantPrefix,
  parseSpendMerchantDocument,
  registeredMerchantOf,
} from "../../../../spend/merchants/core.js";
import { SpendMerchantErrors } from "../../../../spend/merchants/errors.js";

/** A register for the synthetic organisation's card. */
const ACME = {
  merchants: [
    { prefixes: ["Acme  Cloud", "acme*"], receiptDomains: ["acme.example"], slug: "acme" },
    { prefixes: ["globex"], receiptDomains: [], slug: "globex" },
  ],
  schemaVersion: 1,
};

describe("parseSpendMerchantDocument", () => {
  it("normalises every prefix and orders merchants by slug", () => {
    const offered = { ...ACME, merchants: ACME.merchants.toReversed() };
    expect(unwrap(parseSpendMerchantDocument({ value: offered }))).toEqual({
      merchants: [
        { prefixes: ["acme cloud", "acme*"], receiptDomains: ["acme.example"], slug: "acme" },
        { prefixes: ["globex"], receiptDomains: [], slug: "globex" },
      ],
      schemaVersion: 1,
    });
  });

  it("takes an empty register", () => {
    expect(unwrap(parseSpendMerchantDocument({ value: { merchants: [], schemaVersion: 1 } }))).toEqual({
      merchants: [],
      schemaVersion: 1,
    });
  });

  it("refuses an unknown field, a bad slug and a receipt domain that is not a bare name", () => {
    const value = {
      merchants: [{ prefixes: ["x"], receiptDomains: ["from:evil OR x.com"], slug: "Bad Slug" }],
      note: "extra",
      schemaVersion: 1,
    };
    expect(unwrapErr(parseSpendMerchantDocument({ value }))).toEqual(
      SpendMerchantErrors.invalid({
        issues: [
          "merchants.0.receiptDomains.0: must be a bare lowercase domain with a dot",
          "merchants.0.slug: must be a lowercase slug of letters, digits and hyphens",
          'document: Unrecognized key: "note"',
        ],
      }),
    );
  });

  it("refuses a repeated slug, a repeated domain and an empty prefix", () => {
    const value = {
      merchants: [
        { prefixes: [" "], receiptDomains: ["acme.example", "acme.example"], slug: "acme" },
        { prefixes: ["other"], receiptDomains: [], slug: "acme" },
      ],
      schemaVersion: 1,
    };
    expect(unwrapErr(parseSpendMerchantDocument({ value }))).toEqual(
      SpendMerchantErrors.invalid({
        issues: [
          "merchant acme: a receipt domain is listed twice",
          "merchant acme: a prefix is empty",
          "merchant acme: the slug is registered twice",
        ],
      }),
    );
  });

  it("refuses two prefixes that overlap at a word boundary, across merchants and within one", () => {
    const value = {
      merchants: [
        { prefixes: ["acme"], receiptDomains: [], slug: "acme" },
        { prefixes: ["acme cloud"], receiptDomains: [], slug: "cloud" },
        { prefixes: ["globex", "globex"], receiptDomains: [], slug: "globex" },
      ],
      schemaVersion: 1,
    };
    expect(unwrapErr(parseSpendMerchantDocument({ value }))).toEqual(
      SpendMerchantErrors.invalid({
        issues: [
          'merchant cloud: prefix "acme cloud" overlaps "acme" of acme, so a charge could match both',
          'merchant globex: prefix "globex" overlaps "globex" of globex, so a charge could match both',
        ],
      }),
    );
  });

  it("allows two prefixes that only share letters, not a word", () => {
    const value = {
      merchants: [
        { prefixes: ["acme"], receiptDomains: [], slug: "acme" },
        { prefixes: ["acmex"], receiptDomains: [], slug: "acmex" },
      ],
      schemaVersion: 1,
    };
    expect(unwrap(parseSpendMerchantDocument({ value })).merchants.map((merchant) => merchant.slug)).toEqual([
      "acme",
      "acmex",
    ]);
  });
});

describe("merchantIdentityOf", () => {
  const merchants = unwrap(parseSpendMerchantDocument({ value: ACME })).merchants;

  it.each([
    ["ACME CLOUD", "acme"],
    ["Acme Cloud  Sydney", "acme"],
    ["ACME*INVOICE 0042", "acme"],
    ["Globex", "globex"],
    ["globex.com/bill", "globex"],
  ])("groups %s under %s", (merchant, slug) => {
    expect(merchantIdentityOf({ merchant, merchants })).toEqual({ kind: "merchant", slug });
  });

  it.each(["Globexx", "Globex_Store", "Acme Cloudy", "Not Globex"])("keeps %s under its own string", (merchant) => {
    expect(merchantIdentityOf({ merchant: ` ${merchant} `, merchants })).toEqual({ kind: "raw", merchant });
  });

  it("keeps every charge under its own string when nothing is registered", () => {
    expect(merchantIdentityOf({ merchant: "Acme Cloud", merchants: [] })).toEqual({
      kind: "raw",
      merchant: "Acme Cloud",
    });
  });

  it("finds the registered merchant behind an identity, and none behind a raw one", () => {
    expect(registeredMerchantOf({ identity: { kind: "merchant", slug: "globex" }, merchants })).toEqual({
      prefixes: ["globex"],
      receiptDomains: [],
      slug: "globex",
    });
    expect(registeredMerchantOf({ identity: { kind: "raw", merchant: "globex" }, merchants })).toBeUndefined();
  });
});

describe("merchantIdentityKey and merchantIdentityLabel", () => {
  it("keeps a registered slug and a raw string of the same text apart, and labels each by its text", () => {
    const registered = { kind: "merchant", slug: "acme" } as const;
    const raw = { kind: "raw", merchant: "acme" } as const;
    expect([merchantIdentityKey({ identity: registered }), merchantIdentityKey({ identity: raw })]).toEqual([
      "merchant:acme",
      "raw:acme",
    ]);
    expect([merchantIdentityLabel({ identity: registered }), merchantIdentityLabel({ identity: raw })]).toEqual([
      "acme",
      "acme",
    ]);
  });
});

describe("merchantNormalise and merchantRegisterLines", () => {
  it("collapses whitespace and case", () => {
    expect(normaliseMerchantPrefix({ prefix: "  Acme\t Cloud " })).toBe("acme cloud");
  });

  it("prints one line per merchant, saying when no receipt is searched", () => {
    const document = unwrap(parseSpendMerchantDocument({ value: ACME }));
    expect(merchantRegisterLines({ document })).toEqual([
      "spend merchants: 2 registered",
      '  acme  prefixes "acme cloud", "acme*"  receipts from acme.example',
      '  globex  prefixes "globex"  receipts from (no receipt search)',
    ]);
  });

  it("says none are registered for an empty register", () => {
    expect(merchantRegisterLines({ document: { merchants: [], schemaVersion: 1 } })).toEqual([
      "spend merchants: none registered",
    ]);
  });
});
