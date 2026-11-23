/**
 * The one predicate that says WHY a kind holds what it holds.
 *
 * Every case here is a state that used to be classified by a different predicate in each of four readers,
 * and the precedence cases are the ones that were answered inconsistently: a kind that is fenced AND has
 * never been attempted, and a kind read successfully that legitimately holds nothing.
 */
import { describe, expect, it } from "vitest";

import { type AtlasKindReasonInput, kindReason, kindsWithReason } from "../../../../atlas/kit/kindReason.js";

/**
 * One kind's reachability inputs, defaulted to a kind that has never been touched.
 *
 * @param over the fields this case is actually about
 * @returns the input
 */
function input({ over }: { over: Partial<AtlasKindReasonInput> }): AtlasKindReasonInput {
  return {
    entityCount: 0,
    kind: "control",
    lastSuccessAt: null,
    latestAttemptFailed: false,
    permissionBlocked: null,
    productAbsent: null,
    ...over,
  };
}

/** The boundary a real GitHub `admin:org` refusal stamps, in the shape `permissionBlock.ts` declares. */
const ADMIN_ORG_BLOCK = {
  at: "2026-09-15T00:00:00.000Z",
  detail: "GET /orgs/{org}/settings/billing: 403 Resource not accessible by personal access token",
  unblockedBy: "a GitHub credential holding admin:org",
} as const;

/** The answer the JumpCloud sync stamps for a product this organisation never bought. */
const GCEP_ABSENT = {
  at: "2026-09-17T00:00:00.000Z",
  detail: "v2-gcep-configuration: answered 404",
} as const;

describe("kindReason", () => {
  it("calls a fenced kind a permission boundary and carries the grant that would lift it", () => {
    const reason = kindReason(input({ over: { permissionBlocked: ADMIN_ORG_BLOCK } }));
    expect(reason.reason).toBe("permission-boundary");
    expect(reason).toEqual({
      because:
        "control is not reachable under the current permissions — GET /orgs/{org}/settings/billing: 403" +
        " Resource not accessible by personal access token. Reachable if a GitHub credential holding" +
        " admin:org; the atlas is not missing it.",
      detail: ADMIN_ORG_BLOCK.detail,
      observedAt: "2026-09-15T00:00:00.000Z",
      reason: "permission-boundary",
      unblockedBy: "a GitHub credential holding admin:org",
    });
  });

  it("puts the boundary ahead of every other arm, so a fenced kind never reads as a defect", () => {
    const reason = kindReason(input({ over: { latestAttemptFailed: true, permissionBlocked: ADMIN_ORG_BLOCK } }));
    expect(reason.reason).toBe("permission-boundary");
  });

  it("calls a kind the provider answered absent product-absent, and carries the provider's own answer", () => {
    const reason = kindReason(input({ over: { latestAttemptFailed: true, productAbsent: GCEP_ABSENT } }));
    expect(reason).toEqual({
      because:
        "control is not reachable because this organisation has no such product — v2-gcep-configuration:" +
        " answered 404. Only adopting the product would change that; the atlas is not missing it.",
      detail: GCEP_ABSENT.detail,
      observedAt: "2026-09-17T00:00:00.000Z",
      reason: "product-absent",
    });
  });

  it("ranks a permission boundary above a product absence, since a fence hides whether the product exists", () => {
    const reason = kindReason(input({ over: { permissionBlocked: ADMIN_ORG_BLOCK, productAbsent: GCEP_ABSENT } }));
    expect(reason.reason).toBe("permission-boundary");
  });

  it("calls a kind holding entities reached, and counts them", () => {
    const reason = kindReason(input({ over: { entityCount: 12, lastSuccessAt: "2026-09-14T00:00:00.000Z" } }));
    expect(reason.reason).toBe("reached");
    expect(reason.because).toBe("control holds 12 entities");
  });

  it("calls a successful read of an EMPTY kind reached, not a gap — the organisation holds none", () => {
    const reason = kindReason(input({ over: { lastSuccessAt: "2026-09-14T00:00:00.000Z" } }));
    expect(reason.reason).toBe("reached");
    expect(reason.because).toBe(
      "control was read successfully at 2026-09-14T00:00:00.000Z and this organisation holds none",
    );
  });

  it("stays reached when a LATER attempt failed, because staleness is a different question", () => {
    const reason = kindReason(
      input({ over: { entityCount: 3, lastSuccessAt: "2026-09-10T00:00:00.000Z", latestAttemptFailed: true } }),
    );
    expect(reason.reason).toBe("reached");
  });

  it("calls an attempted, never-acquired kind a gap and says no boundary explains it", () => {
    const reason = kindReason(input({ over: { latestAttemptFailed: true } }));
    expect(reason.reason).toBe("gap");
    expect(reason.because).toBe(
      "control has been attempted and never acquired, and no permission boundary explains it",
    );
  });

  it("calls a kind no run has touched not-attempted, which is neither broken nor fenced", () => {
    const reason = kindReason(input({ over: {} }));
    expect(reason.reason).toBe("not-attempted");
    expect(reason.because).toBe("control has never been attempted — no run has been here, and nothing is blocking one");
  });
});

describe("kindsWithReason", () => {
  const kinds: readonly AtlasKindReasonInput[] = [
    input({ over: { kind: "webhook", permissionBlocked: ADMIN_ORG_BLOCK } }),
    input({ over: { kind: "actions-policy", permissionBlocked: ADMIN_ORG_BLOCK } }),
    input({ over: { kind: "ruleset", latestAttemptFailed: true } }),
    input({ over: { kind: "environment" } }),
    input({ over: { kind: "gcep", latestAttemptFailed: true, productAbsent: GCEP_ABSENT } }),
    input({ over: { entityCount: 9, kind: "repository-settings", lastSuccessAt: "2026-09-14T00:00:00.000Z" } }),
  ];

  it("selects the fenced kinds, sorted, so two runs over one generation print identically", () => {
    expect(kindsWithReason({ kinds, reason: "permission-boundary" })).toEqual(["actions-policy", "webhook"]);
  });

  it("puts each of the other four kinds in exactly one other arm", () => {
    expect(kindsWithReason({ kinds, reason: "product-absent" })).toEqual(["gcep"]);
    expect(kindsWithReason({ kinds, reason: "gap" })).toEqual(["ruleset"]);
    expect(kindsWithReason({ kinds, reason: "not-attempted" })).toEqual(["environment"]);
    expect(kindsWithReason({ kinds, reason: "reached" })).toEqual(["repository-settings"]);
  });

  it("partitions the whole input, so no kind is counted twice and none is lost", () => {
    const selected = [
      ...kindsWithReason({ kinds, reason: "permission-boundary" }),
      ...kindsWithReason({ kinds, reason: "product-absent" }),
      ...kindsWithReason({ kinds, reason: "gap" }),
      ...kindsWithReason({ kinds, reason: "not-attempted" }),
      ...kindsWithReason({ kinds, reason: "reached" }),
    ];
    expect(selected.toSorted()).toEqual(kinds.map((kind) => kind.kind).toSorted());
  });

  it("answers an empty generation with an empty list rather than throwing", () => {
    expect(kindsWithReason({ kinds: [], reason: "permission-boundary" })).toEqual([]);
  });
});
