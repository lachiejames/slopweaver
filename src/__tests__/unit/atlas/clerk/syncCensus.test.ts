/**
 * The census assertion, which is the whole reason `atlas clerk sync` can be trusted.
 *
 * The documents are pinned to an immutable commit and digest-verified before they are parsed, so their own
 * numbers cannot move. A mismatch is therefore a change in the READER — and this is the check that turns
 * that into a refusal rather than a quietly shorter surface.
 */
import { describe, expect, it } from "vitest";

import {
  CLERK_METHOD_CENSUS,
  CLERK_SPEC_COMMIT,
  CLERK_SPEC_DOCUMENTS,
  CLERK_SPEC_PINS,
  CLERK_TOTAL_CENSUS,
  clerkSpecPinFor,
} from "../../../../atlas/clerk/specLock.js";
import type { ClerkSpecCensus } from "../../../../atlas/clerk/specRead.js";
import { clerkCensusMismatch } from "../../../../atlas/clerk/syncCensus.js";

/** The census a run measures when it reads exactly what was pinned. */
function pinnedCensuses(): readonly ClerkSpecCensus[] {
  return CLERK_SPEC_PINS.map((pin) => ({
    document: pin.document,
    methodCounts: pin.methodCounts,
    operationCount: pin.operationCount,
    pathCount: pin.pathCount,
    schemaCount: pin.schemaCount,
    webhookEventCount: pin.webhookEventCount,
  }));
}

describe("CLERK_SPEC_PINS", () => {
  it("pins one document for every declared document name", () => {
    expect(CLERK_SPEC_PINS.map((pin) => pin.document).toSorted()).toEqual([...CLERK_SPEC_DOCUMENTS].toSorted());
  });

  it("addresses every document at the SAME immutable commit, so a regeneration cannot mix versions", () => {
    expect(CLERK_SPEC_PINS.filter((pin) => !pin.url.includes(CLERK_SPEC_COMMIT))).toEqual([]);
  });

  it("gives every pin a 64-character digest", () => {
    expect(CLERK_SPEC_PINS.filter((pin) => pin.sha256.length !== 64)).toEqual([]);
  });

  it("declares webhook events on exactly one document", () => {
    expect(CLERK_SPEC_PINS.filter((pin) => pin.webhookEventCount > 0).map((pin) => pin.document)).toEqual(["webhooks"]);
  });
});

describe("CLERK_TOTAL_CENSUS", () => {
  it("equals the sum of the per-document pins, so the two halves cannot drift apart", () => {
    const sum = ({ pick }: { pick: (input: (typeof CLERK_SPEC_PINS)[number]) => number }): number =>
      CLERK_SPEC_PINS.reduce((total, pin) => total + pick(pin), 0);
    expect(sum({ pick: (pin) => pin.operationCount })).toBe(CLERK_TOTAL_CENSUS.operationCount);
    expect(sum({ pick: (pin) => pin.pathCount })).toBe(CLERK_TOTAL_CENSUS.pathCount);
    expect(sum({ pick: (pin) => pin.schemaCount })).toBe(CLERK_TOTAL_CENSUS.schemaCount);
    expect(sum({ pick: (pin) => pin.webhookEventCount })).toBe(CLERK_TOTAL_CENSUS.webhookEventCount);
  });

  it("equals the sum of the per-method census too", () => {
    const methods = Object.values(CLERK_METHOD_CENSUS).reduce((total, count) => total + count, 0);
    expect(methods).toBe(CLERK_TOTAL_CENSUS.operationCount);
  });
});

describe("clerkCensusMismatch", () => {
  it("passes the census the pins describe", () => {
    expect(clerkCensusMismatch({ censuses: pinnedCensuses() })).toBe(null);
  });

  it("refuses when one document lost an operation, naming which", () => {
    const censuses = pinnedCensuses().map((census) =>
      census.document === "bapi" ? { ...census, operationCount: census.operationCount - 1 } : census,
    );
    const problems = clerkCensusMismatch({ censuses });
    expect(problems?.join("\n")).toContain("bapi operations: read 248, pinned 249");
  });

  it("refuses a method that changed SIDE, which every total in the pin still agrees with", () => {
    // One GET lost in `bapi` and one gained in `fapi`. The total per method, the total operation count and
    // each document's own operation count are all untouched — and the reader is wrong. Only the per-document
    // method census sees it, which is why the pin carries one.
    const censuses = pinnedCensuses().map((census) => {
      if (census.document === "bapi") {
        return { ...census, methodCounts: { ...census.methodCounts, get: 77 } };
      }
      if (census.document === "fapi") {
        return { ...census, methodCounts: { ...census.methodCounts, get: 75 } };
      }
      return census;
    });
    const problems = clerkCensusMismatch({ censuses })?.join("\n");
    expect(problems).toContain("bapi get operations: read 77, pinned 78");
    expect(problems).toContain("fapi get operations: read 75, pinned 74");
  });

  it("refuses when the method census itself moves", () => {
    const censuses = pinnedCensuses().map((census) =>
      census.document === "bapi" ? { ...census, methodCounts: { ...census.methodCounts, get: 77 } } : census,
    );
    expect(clerkCensusMismatch({ censuses })?.join("\n")).toContain("bapi get operations: read 77, pinned 78");
  });

  it("reads a method the pin declares and the run never counted as zero read, in the document and in the total", () => {
    const censuses = pinnedCensuses().map((census) =>
      census.document === "bapi"
        ? {
            ...census,
            methodCounts: Object.fromEntries(Object.entries(census.methodCounts).filter(([m]) => m !== "get")),
          }
        : census,
    );
    const totalGet = CLERK_METHOD_CENSUS["get"]!;
    expect(clerkCensusMismatch({ censuses })).toStrictEqual([
      "the compiled census does not match the pinned one, so nothing was published",
      "bapi get operations: read 0, pinned 78",
      `get operations: read ${String(totalGet - 78)}, pinned ${String(totalGet)}`,
      "the documents are digest-verified before they are parsed, so this is a change in THIS reader rather than in Clerk's documents — see `sync.ts` on why that is what the assertion is for",
    ]);
  });

  it("refuses a method the run counted that the pin never declares, so a misspelling cannot pass as a zero", () => {
    const censuses = pinnedCensuses().map((census) =>
      census.document === "bapi" ? { ...census, methodCounts: { ...census.methodCounts, trace: 1 } } : census,
    );
    expect(clerkCensusMismatch({ censuses })!.join("\n")).toContain("bapi trace operations: read 1, pinned 0");
  });

  it("refuses a run that read fewer documents than are pinned", () => {
    expect(clerkCensusMismatch({ censuses: pinnedCensuses().slice(1) })?.join("\n")).toContain("documents: read 3");
  });

  it("says the mismatch is in THIS reader rather than in Clerk's documents", () => {
    const censuses = pinnedCensuses().map((census) => ({ ...census, pathCount: 0 }));
    expect(clerkCensusMismatch({ censuses })?.join("\n")).toContain("change in THIS reader");
  });
});

describe("clerkSpecPinFor", () => {
  it("finds every declared document's pin", () => {
    expect(CLERK_SPEC_DOCUMENTS.map((document) => clerkSpecPinFor({ document }).document)).toEqual([
      ...CLERK_SPEC_DOCUMENTS,
    ]);
  });
});
