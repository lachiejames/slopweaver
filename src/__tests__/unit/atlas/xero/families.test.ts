/**
 * The family enumeration, and the GATE that keeps its judgement table exhaustive.
 *
 * The last test in this file is the reason the rest exist. `families.ts` derives the family list from the
 * installed SDK and declares the disposition by hand, and those two halves can only stay honest if something
 * fails when they diverge. A family the SDK declares and the table does not judge lands as `unjudged` at
 * runtime — which is the honest fallback — and fails here, which is the point: an install should never SEE
 * that state, because CI should have caught it first.
 */
import { describe, expect, it } from "vitest";

import {
  XERO_FAMILY_JUDGEMENTS,
  XERO_HISTORY_SUFFIX,
  xeroFamilies,
  xeroFamilyKey,
  xeroProductRoot,
} from "../../../../atlas/xero/families.js";
import type { XeroSdkOperation } from "../../../../atlas/xero/sdkEndpoints.js";
import { readXeroSdkSurface } from "../../../../atlas/xero/sdkRead.js";
import { unwrap } from "../../../../lib/result.js";

/** One declared operation, with only the fields a family derivation reads stated. */
function operation({ over }: { over: Partial<XeroSdkOperation> }): XeroSdkOperation {
  return {
    basePath: "https://api.xero.com/api.xro/2.0",
    headerParams: [],
    httpMethod: "GET",
    module: "accountingApi",
    name: "getThings",
    path: "/Invoices",
    pathParams: [],
    queryParams: [],
    requestModel: null,
    responseModel: null,
    summary: null,
    ...over,
  };
}

describe("xeroProductRoot", () => {
  it("reads the path beneath api.xero.com, which is what distinguishes one product from another", () => {
    expect(xeroProductRoot({ basePath: "https://api.xero.com/payroll.xro/2.0" })).toBe("payroll.xro/2.0");
  });

  it("keeps an unparseable base path whole rather than collapsing every such operation onto one row", () => {
    expect(xeroProductRoot({ basePath: "not a url" })).toBe("not a url");
  });
});

describe("xeroFamilyKey", () => {
  it("keys a family on its product root and its first path segment", () => {
    expect(xeroFamilyKey({ operation: operation({ over: { path: "/Invoices/{InvoiceID}" } }) })).toBe(
      "api.xro/2.0:Invoices",
    );
  });

  it("puts two products' identically-named segments in different families", () => {
    expect(
      xeroFamilyKey({
        operation: operation({ over: { basePath: "https://api.xero.com/payroll.xro/2.0", path: "/Settings" } }),
      }),
    ).toBe("payroll.xro/2.0:Settings");
  });

  it("files an operation on the product root itself under the root family", () => {
    expect(xeroFamilyKey({ operation: operation({ over: { path: "/" } }) })).toBe("api.xro/2.0:(root)");
  });

  it("skips empty segments, so a doubled slash still keys on the first real one", () => {
    expect(xeroFamilyKey({ operation: operation({ over: { path: "//Invoices" } }) })).toBe("api.xro/2.0:Invoices");
  });
});

describe("xeroFamilies", () => {
  it("has at least one entry in XERO_FAMILY_JUDGEMENTS, so the guards below are not vacuously green", () => {
    expect(Object.keys(XERO_FAMILY_JUDGEMENTS).length).toBeGreaterThan(0);
  });

  it("judges a family the table calls configuration as configuration", () => {
    const families = xeroFamilies({ operations: [operation({ over: { path: "/Accounts" } })] });
    expect(families[0]!.disposition).toBe("configuration");
  });

  it("judges the general ledger voluminous, which is the ledger half of the owner's own bound", () => {
    const families = xeroFamilies({ operations: [operation({ over: { path: "/Journals" } })] });
    expect(families[0]!.disposition).toBe("voluminous");
  });

  it("marks every operation of a voluminous family observation-shaped", () => {
    const families = xeroFamilies({
      operations: [operation({ over: { path: "/Journals" } }), operation({ over: { path: "/Journals/{JournalID}" } })],
    });
    expect(families[0]!.voluminousOperations).toEqual(["GET /Journals", "GET /Journals/{JournalID}"]);
  });

  // The criterion cuts THROUGH a family rather than along it, which is the whole reason `mixed` exists.
  it("turns a configuration family with a history sub-resource into a mixed one", () => {
    const families = xeroFamilies({
      operations: [
        operation({ over: { path: "/Invoices" } }),
        operation({ over: { path: `/Invoices/{InvoiceID}${XERO_HISTORY_SUFFIX}` } }),
      ],
    });
    expect(families[0]!.disposition).toBe("mixed");
  });

  it("names only the history operation as observation-shaped on a mixed family", () => {
    const families = xeroFamilies({
      operations: [
        operation({ over: { path: "/Invoices" } }),
        operation({ over: { path: `/Invoices/{InvoiceID}${XERO_HISTORY_SUFFIX}` } }),
      ],
    });
    expect(families[0]!.voluminousOperations).toEqual(["GET /Invoices/{InvoiceID}/History"]);
  });

  it("leaves a pure configuration family with no observation-shaped operations at all", () => {
    const families = xeroFamilies({ operations: [operation({ over: { path: "/Accounts" } })] });
    expect(families[0]!.voluminousOperations).toEqual([]);
  });

  it("reports a family the table does not judge as unjudged rather than guessing the safer half", () => {
    const families = xeroFamilies({ operations: [operation({ over: { path: "/SomethingXeroAddedLater" } })] });
    expect(families[0]!.disposition).toBe("unjudged");
  });

  it("gives an unjudged family a reason naming the table that has to grow", () => {
    const families = xeroFamilies({ operations: [operation({ over: { path: "/SomethingXeroAddedLater" } })] });
    expect(families[0]!.reason).toContain("XERO_FAMILY_JUDGEMENTS");
  });

  it("deduplicates an operation two clients declare identically", () => {
    const families = xeroFamilies({
      operations: [
        operation({ over: { module: "payrollNZApi", path: "/Employees" } }),
        operation({ over: { module: "payrollUKApi", path: "/Employees" } }),
      ],
    });
    expect(families[0]!.operations).toEqual(["GET /Employees"]);
  });

  it("gathers every operation of one family into one row, however the declarations interleave", () => {
    const families = xeroFamilies({
      operations: [
        operation({ over: { path: "/Invoices" } }),
        operation({ over: { path: "/Accounts" } }),
        operation({ over: { httpMethod: "POST", path: "/Invoices" } }),
      ],
    });
    expect(families.map((family) => [family.key, family.operations])).toStrictEqual([
      ["api.xro/2.0:Accounts", ["GET /Accounts"]],
      ["api.xro/2.0:Invoices", ["GET /Invoices", "POST /Invoices"]],
    ]);
  });

  it("sorts families by key, so a published generation is stable", () => {
    const families = xeroFamilies({
      operations: [operation({ over: { path: "/Invoices" } }), operation({ over: { path: "/Accounts" } })],
    });
    expect(families.map((family) => family.key)).toEqual(["api.xro/2.0:Accounts", "api.xro/2.0:Invoices"]);
  });
});

describe("the judgement table stays exhaustive against the installed SDK", () => {
  const derived = xeroFamilies({ operations: unwrap(readXeroSdkSurface()).operations });

  // A family the SDK declares and the table does not judge is `unjudged` at runtime — honest, and useless.
  // This is what makes the honest fallback something an install never actually sees.
  it("judges every family the installed client declares", () => {
    expect(derived.filter((family) => family.disposition === "unjudged").map((family) => family.key)).toEqual([]);
  });

  // The other direction: a table entry for a family that no longer exists is doc rot that reads perfectly.
  it("declares no judgement for a family the installed client no longer declares", () => {
    const keys = new Set(derived.map((family) => family.key));
    expect(
      Object.keys(XERO_FAMILY_JUDGEMENTS)
        .filter((key) => !keys.has(key))
        .toSorted(),
    ).toEqual([]);
  });

  it("gives every judgement a reason, because a disposition with no reason is unfalsifiable", () => {
    expect(Object.entries(XERO_FAMILY_JUDGEMENTS).filter(([, judged]) => judged.reason.length < 20)).toEqual([]);
  });

  it("declares the general ledger and the bank feed voluminous, which is what the owner's bound names", () => {
    const voluminous = derived.filter((family) => family.disposition === "voluminous").map((family) => family.key);
    expect(voluminous).toContain("api.xro/2.0:Journals");
    expect(voluminous).toContain("bankfeeds.xro/1.0:Statements");
  });

  it("keeps the contacts and invoices families holdable, because spend-per-vendor is asked of those two", () => {
    const holdable = derived.filter((family) => family.disposition !== "voluminous").map((family) => family.key);
    expect(holdable).toContain("api.xro/2.0:Contacts");
    expect(holdable).toContain("api.xro/2.0:Invoices");
  });
});
