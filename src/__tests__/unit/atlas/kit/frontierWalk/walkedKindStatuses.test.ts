/*
 * The status a frontier walk records for each walked kind: a success on both, or a signed-out attempt that holds
 * each kind's earlier success.
 */
import { describe, expect, it } from "vitest";

import { walkedKindStatuses } from "../../../../../atlas/kit/frontierPublish.js";

import { AT } from "./harness.js";

describe("walkedKindStatuses", () => {
  const base = {
    at: AT,
    heldMethodSuccess: "2026-10-01T00:00:00.000Z",
    heldPageSuccess: "2026-10-02T00:00:00.000Z",
    methodCount: 4,
    pageCount: 7,
    signedOutReason: "sign in to the console in the work profile, then walk again",
  };

  it("records a walk that reached its pages as a success on both kinds", () => {
    expect(walkedKindStatuses({ ...base, signedOut: false })).toEqual({
      method: { digest: null, entityCount: 4, lastAttempt: { at: AT, outcome: "ok", reasons: [] }, lastSuccessAt: AT },
      page: { digest: null, entityCount: 7, lastAttempt: { at: AT, outcome: "ok", reasons: [] }, lastSuccessAt: AT },
    });
  });

  it("records a signed-out walk as an attempt and no success, holding both kinds' earlier successes", () => {
    expect(walkedKindStatuses({ ...base, signedOut: true })).toEqual({
      method: {
        digest: null,
        entityCount: 4,
        lastAttempt: { at: AT, outcome: "ok", reasons: [] },
        lastSuccessAt: "2026-10-01T00:00:00.000Z",
      },
      page: {
        digest: null,
        entityCount: 7,
        lastAttempt: { at: AT, outcome: "failed", reasons: [base.signedOutReason] },
        lastSuccessAt: "2026-10-02T00:00:00.000Z",
      },
    });
  });
});
