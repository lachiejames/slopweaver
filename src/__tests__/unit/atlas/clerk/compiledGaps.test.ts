/*
 * The gaps the `operation` kind carries after a successful compile — `src/atlas/clerk/compiledGaps.ts`.
 *
 * Two standing gaps are raised on every run, and a reviewed disposition rule that matched no operation is
 * raised as a dead rule rather than read as considered judgement.
 */
import { describe, expect, it } from "vitest";

import { compiledGaps } from "../../../../atlas/clerk/compiledGaps.js";
import { clerkDispositionRuleIds } from "../../../../atlas/clerk/dispositions.js";
import { CLERK_OPERATION_KIND } from "../../../../atlas/clerk/model.js";
import type { ClerkOperationRow } from "../../../../atlas/clerk/specRead.js";

const AT = "2026-09-05T11:00:00.000Z";

/** One compiled row, decided by the given disposition rule. */
function row({ dispositionRuleId }: { dispositionRuleId: ClerkOperationRow["dispositionRuleId"] }): ClerkOperationRow {
  return {
    api: "bapi",
    declaredPath: "/users",
    disposition: "excluded",
    dispositionReason: "the rows are the product's own end users",
    dispositionRuleId,
    document: "bapi",
    method: "GET",
    operationId: "GetUserList",
    pagination: "limit-offset",
    pathParams: [],
    providerId: "GET bapi:/v1/users",
    queryParams: ["limit", "offset"],
    responseFields: ["id"],
    responseSchema: "User",
    security: ["bearerAuth"],
    summary: "List all users",
    tags: ["Users"],
    wirePath: "/v1/users",
  };
}

describe("compiledGaps", () => {
  it("raises only the two standing gaps when every reviewed rule fired", () => {
    const operations = clerkDispositionRuleIds().map((dispositionRuleId) => row({ dispositionRuleId }));
    const gaps = compiledGaps({ at: AT, kind: CLERK_OPERATION_KIND, operations });
    expect(gaps.map((gap) => gap.condition)).toEqual(["clerk-credential-absent", "clerk-api-versions-not-compiled"]);
    expect(gaps.map((gap) => gap.scope)).toEqual([CLERK_OPERATION_KIND, CLERK_OPERATION_KIND]);
  });

  it("raises a dead-rule gap, scoped to the rule, for every reviewed rule no operation matched", () => {
    const ruleIds = clerkDispositionRuleIds();
    expect(ruleIds.length).toBeGreaterThan(1);
    const fired = ruleIds[0]!;
    const gaps = compiledGaps({ at: AT, kind: CLERK_OPERATION_KIND, operations: [row({ dispositionRuleId: fired })] });
    const dead = gaps.filter((gap) => gap.condition === "disposition-rule-never-fired");
    expect(dead.map((gap) => gap.scope)).toEqual(ruleIds.slice(1));
    expect(dead[0]!.kind).toBe(null);
    expect(dead[0]!.reason).toContain(`\`${ruleIds[1]!}\` matched no operation`);
  });

  it("treats a run that compiled nothing as every rule dead", () => {
    const none: readonly ClerkOperationRow[] = [];
    const gaps = compiledGaps({ at: AT, kind: CLERK_OPERATION_KIND, operations: none });
    expect(gaps.length).toBe(2 + clerkDispositionRuleIds().length);
  });
});
