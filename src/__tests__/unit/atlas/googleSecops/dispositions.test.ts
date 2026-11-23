/**
 * The disposition rule: read-only forever means the HTTP method decides first, so every non-GET is
 * excluded — POST reads included — and only a GET List/Get (or a reviewed custom GET) is an entity.
 */
import { describe, expect, it } from "vitest";

import {
  type GoogleSecopsDispositionVerdict,
  googleSecopsCustomGetReads,
  googleSecopsDispositionFor,
} from "../../../../atlas/googleSecops/dispositions.js";
import { GOOGLE_SECOPS_SURFACES } from "../../../../atlas/googleSecops/generated/surfaces.js";
import type { GoogleSecopsHttpMethod } from "../../../../atlas/googleSecops/surfaceRow.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const NON_GET: readonly GoogleSecopsHttpMethod[] = ["POST", "PATCH", "PUT", "DELETE"];

/** Every rpc verb a real Chronicle method opens with, read or write. */
const RPC_NAMES: readonly string[] = [
  "GetRule",
  "ListRules",
  "SearchRules",
  "QueryEvents",
  "BulkGetDataTableRows",
  "BatchGetDashboardCharts",
  "VerifyRuleText",
  "ComputeFindingsRefinementActivity",
  "CreateRule",
  "UpdateRule",
  "DeleteRule",
  "GenerateSecret",
];

/**
 * The rule's verdict for one synthetic method in `RuleService`.
 *
 * @param httpMethod the binding's method
 * @param rpc the bare rpc name
 * @returns the verdict, unwrapped
 */
function verdictOf({
  httpMethod,
  rpc,
}: {
  httpMethod: GoogleSecopsHttpMethod;
  rpc: string;
}): GoogleSecopsDispositionVerdict {
  return unwrap(googleSecopsDispositionFor({ httpMethod, id: `google.cloud.chronicle.v1.RuleService.${rpc}`, rpc }));
}

describe("googleSecopsDispositionFor", () => {
  it("makes a GET List or Get an entity", () => {
    expect(verdictOf({ httpMethod: "GET", rpc: "ListRules" })).toStrictEqual({
      disposition: "entity",
      dispositionBecause: "a GET List/Get read of a resource under the instance",
      exclusionReason: null,
    });
    expect(verdictOf({ httpMethod: "GET", rpc: "GetRule" }).disposition).toBe("entity");
  });

  it("excludes every non-GET, whatever its verb", () => {
    const verdicts = NON_GET.flatMap((httpMethod) =>
      RPC_NAMES.map((rpc) => verdictOf({ httpMethod, rpc }).disposition),
    );
    expect(verdicts.length).toBe(NON_GET.length * RPC_NAMES.length);
    expect(new Set(verdicts)).toStrictEqual(new Set(["excluded"]));
  });

  it("never makes a POST an entity, even one named List or Get", () => {
    expect(verdictOf({ httpMethod: "POST", rpc: "ListRules" })).toStrictEqual({
      disposition: "excluded",
      dispositionBecause:
        "it is not a GET and its verb names no read, so it is taken to change the instance — this atlas is read-only forever and only ever sends GET",
      exclusionReason: "mutating",
    });
  });

  it("files a POST opening with each read verb as query, still excluded", () => {
    const reads = [
      "BatchGetDashboardCharts",
      "BulkGetDataTableRows",
      "ComputeFindingsRefinementActivity",
      "ExecuteDashboardQuery",
      "FetchAssociations",
      "QueryEvents",
      "SearchRules",
      "VerifyRuleText",
    ];
    expect(reads.map((rpc) => verdictOf({ httpMethod: "POST", rpc }).exclusionReason)).toStrictEqual([
      "query",
      "query",
      "query",
      "query",
      "query",
      "query",
      "query",
      "query",
    ]);
    expect(verdictOf({ httpMethod: "POST", rpc: "SearchRules" }).disposition).toBe("excluded");
  });

  it("files a create, update, delete or secret rotation as mutating", () => {
    const writes = [
      { httpMethod: "POST", rpc: "CreateRule" },
      { httpMethod: "PATCH", rpc: "UpdateRule" },
      { httpMethod: "DELETE", rpc: "DeleteRule" },
      { httpMethod: "POST", rpc: "GenerateSecret" },
    ] as const;
    expect(writes.map((write) => verdictOf(write).exclusionReason)).toStrictEqual([
      "mutating",
      "mutating",
      "mutating",
      "mutating",
    ]);
  });

  it("refuses a custom GET nobody judged as DISPOSITION_UNDECIDED", () => {
    const error = unwrapErr(
      googleSecopsDispositionFor({
        httpMethod: "GET",
        id: "google.cloud.chronicle.v1.FeedsService.FetchSomethingNew",
        rpc: "FetchSomethingNew",
      }),
    );
    expect(error.code).toBe("DISPOSITION_UNDECIDED");
    expect(error.message).toBe(
      "google.cloud.chronicle.v1.FeedsService.FetchSomethingNew is a GET whose verb is neither List nor Get, and dispositions.ts names no verdict for it",
    );
  });

  it("reads a verb at a word boundary, so Getaway is not Get, while a bare verb still is one", () => {
    const error = unwrapErr(
      googleSecopsDispositionFor({ httpMethod: "GET", id: "google.cloud.chronicle.v1.X.Getaway", rpc: "Getaway" }),
    );
    expect(error.code).toBe("DISPOSITION_UNDECIDED");
    const inner = unwrapErr(
      googleSecopsDispositionFor({ httpMethod: "GET", id: "google.cloud.chronicle.v1.X.RunGetX", rpc: "RunGetX" }),
    );
    expect(inner.code).toBe("DISPOSITION_UNDECIDED");
    expect(verdictOf({ httpMethod: "GET", rpc: "Get" }).disposition).toBe("entity");
    expect(verdictOf({ httpMethod: "POST", rpc: "Search" }).exclusionReason).toBe("query");
    expect(verdictOf({ httpMethod: "POST", rpc: "Searchlight" }).exclusionReason).toBe("mutating");
  });

  it("makes the one reviewed custom GET an entity, with its reason", () => {
    expect(googleSecopsCustomGetReads()).toStrictEqual([
      "google.cloud.chronicle.v1.FeedsService.FetchServiceAccountForCustomer",
    ]);
    const verdict = unwrap(
      googleSecopsDispositionFor({
        httpMethod: "GET",
        id: "google.cloud.chronicle.v1.FeedsService.FetchServiceAccountForCustomer",
        rpc: "FetchServiceAccountForCustomer",
      }),
    );
    expect(verdict.disposition).toBe("entity");
    expect(verdict.dispositionBecause).toContain("service account");
  });

  it("keys a custom GET verdict on the whole method, so the same rpc in another service is undecided", () => {
    const error = unwrapErr(
      googleSecopsDispositionFor({
        httpMethod: "GET",
        id: "google.cloud.chronicle.v1.OtherService.FetchServiceAccountForCustomer",
        rpc: "FetchServiceAccountForCustomer",
      }),
    );
    expect(error.code).toBe("DISPOSITION_UNDECIDED");
  });
});

describe("the committed inventory under the read-only rule", () => {
  it("excludes every non-GET row and makes no POST an entity", () => {
    expect(GOOGLE_SECOPS_SURFACES.length).toBeGreaterThan(0);
    const nonGet = GOOGLE_SECOPS_SURFACES.filter((row) => row.httpMethod !== "GET");
    expect(nonGet.length).toBe(53);
    expect(nonGet.filter((row) => row.disposition !== "excluded")).toStrictEqual([]);
    expect(
      GOOGLE_SECOPS_SURFACES.filter((row) => row.httpMethod === "POST" && row.disposition === "entity"),
    ).toStrictEqual([]);
  });

  it("makes every GET row an entity", () => {
    const gets = GOOGLE_SECOPS_SURFACES.filter((row) => row.httpMethod === "GET");
    expect(gets.length).toBe(39);
    expect(gets.filter((row) => row.disposition !== "entity")).toStrictEqual([]);
  });

  it("holds every custom GET verdict as a row, so none is stale", () => {
    const ids = new Set(GOOGLE_SECOPS_SURFACES.map((row) => row.id));
    expect(googleSecopsCustomGetReads().filter((id) => !ids.has(id))).toStrictEqual([]);
  });
});
