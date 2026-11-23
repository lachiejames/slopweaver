import { describe, expect, it } from "vitest";

import {
  type AccessPolicyAppAttempt,
  reconcileAccessPolicies,
} from "../../../../atlas/cloudflare/accessPolicyReconcile.js";
import { CloudflareClientErrors } from "../../../../atlas/cloudflare/errors.js";
import type { CloudflareEntity } from "../../../../atlas/cloudflare/model.js";
import {
  type CloudflareAccessPolicyDetail,
  projectCloudflareAccessPolicy,
} from "../../../../atlas/cloudflare/projection/accessPolicy.js";
import { err, ok } from "../../../../lib/result.js";

const AT = "2026-01-01T00:00:00.000Z";
const ACCOUNT_ID = "a".repeat(32);

function storedEntity({
  policyId,
  bindings,
  reusable,
}: {
  policyId: string;
  bindings: readonly { applicationId: string; precedence: number | null }[];
  reusable: boolean;
}): CloudflareEntity {
  return projectCloudflareAccessPolicy({
    accountId: ACCOUNT_ID,
    at: AT,
    bindings,
    body: { config: {}, decision: "allow", name: policyId },
    policyId,
    reusable,
  });
}

function detailOf(entity: CloudflareEntity): CloudflareAccessPolicyDetail {
  return entity.detail as CloudflareAccessPolicyDetail;
}

describe("reconcileAccessPolicies", () => {
  it("adds a fresh policy seen only on one application's read", () => {
    const attempts: readonly AccessPolicyAppAttempt[] = [
      { applicationId: "app-1", result: ok([{ id: "pol-1", decision: "allow" }]) },
    ];
    const reconciliation = reconcileAccessPolicies({
      accountId: ACCOUNT_ID,
      appAttempts: attempts,
      at: AT,
      currentApplicationIds: ["app-1"],
      reusableRead: ok([]),
      stored: [],
    });
    expect(reconciliation.entities.map((entity) => entity.providerId)).toEqual(["pol-1"]);
    expect(reconciliation.complete).toBe(true);
  });

  it("binds a policy whose per-app read omits precedence with a null precedence, never a substituted one", () => {
    const reconciliation = reconcileAccessPolicies({
      accountId: ACCOUNT_ID,
      appAttempts: [{ applicationId: "app-1", result: ok([{ id: "pol-1" }]) }],
      at: AT,
      currentApplicationIds: ["app-1"],
      reusableRead: ok([]),
      stored: [],
    });
    expect(detailOf(reconciliation.entities[0]!).bindings).toEqual([{ applicationId: "app-1", precedence: null }]);
  });

  it("does not flag a precedence-only difference across two applications as a conflict", () => {
    const attempts: readonly AccessPolicyAppAttempt[] = [
      { applicationId: "app-1", result: ok([{ id: "pol-1", decision: "allow", precedence: 1 }]) },
      { applicationId: "app-2", result: ok([{ id: "pol-1", decision: "allow", precedence: 5 }]) },
    ];
    const reconciliation = reconcileAccessPolicies({
      accountId: ACCOUNT_ID,
      appAttempts: attempts,
      at: AT,
      currentApplicationIds: ["app-1", "app-2"],
      reusableRead: ok([]),
      stored: [],
    });
    const detail = detailOf(reconciliation.entities.find((entity) => entity.providerId === "pol-1")!);
    expect(detail.bindings).toEqual([
      { applicationId: "app-1", precedence: 1 },
      { applicationId: "app-2", precedence: 5 },
    ]);
    expect(reconciliation.complete).toBe(true);
    expect(reconciliation.reasons).toEqual([]);
  });

  it("preserves a failed application's prior edges while another application's success still updates", () => {
    const stored = [
      storedEntity({ bindings: [{ applicationId: "app-1", precedence: 1 }], policyId: "pol-1", reusable: false }),
    ];
    const attempts: readonly AccessPolicyAppAttempt[] = [
      {
        applicationId: "app-1",
        result: err(CloudflareClientErrors.provider({ cause: new Error("boom"), operation: "test", status: 500 })),
      },
      { applicationId: "app-2", result: ok([{ id: "pol-2", decision: "allow" }]) },
    ];
    const reconciliation = reconcileAccessPolicies({
      accountId: ACCOUNT_ID,
      appAttempts: attempts,
      at: AT,
      currentApplicationIds: ["app-1", "app-2"],
      reusableRead: ok([]),
      stored,
    });
    const preserved = detailOf(reconciliation.entities.find((entity) => entity.providerId === "pol-1")!);
    expect(preserved.bindings).toEqual([{ applicationId: "app-1", precedence: 1 }]);
    expect(reconciliation.entities.map((entity) => entity.providerId).toSorted()).toEqual(["pol-1", "pol-2"]);
    expect(reconciliation.complete).toBe(false);
    expect(reconciliation.failedApplicationIds).toEqual(["app-1"]);
  });

  it("never prunes any application's edges when the application inventory itself failed", () => {
    const stored = [
      storedEntity({ bindings: [{ applicationId: "app-1", precedence: 1 }], policyId: "pol-1", reusable: false }),
    ];
    const reconciliation = reconcileAccessPolicies({
      accountId: ACCOUNT_ID,
      appAttempts: [],
      at: AT,
      currentApplicationIds: null,
      reusableRead: ok([]),
      stored,
    });
    const preserved = detailOf(reconciliation.entities.find((entity) => entity.providerId === "pol-1")!);
    expect(preserved.bindings).toEqual([{ applicationId: "app-1", precedence: 1 }]);
    expect(reconciliation.complete).toBe(false);
  });

  it("drops a policy with no bindings that is not reusable", () => {
    const stored = [
      storedEntity({ bindings: [{ applicationId: "app-1", precedence: 1 }], policyId: "pol-1", reusable: false }),
    ];
    const reconciliation = reconcileAccessPolicies({
      accountId: ACCOUNT_ID,
      appAttempts: [{ applicationId: "app-1", result: ok([]) }],
      at: AT,
      currentApplicationIds: ["app-1"],
      reusableRead: ok([]),
      stored,
    });
    expect(reconciliation.entities).toEqual([]);
  });

  it("keeps a reusable policy with no current bindings", () => {
    const reconciliation = reconcileAccessPolicies({
      accountId: ACCOUNT_ID,
      appAttempts: [],
      at: AT,
      currentApplicationIds: [],
      reusableRead: ok([{ id: "pol-1", decision: "allow", reusable: true }]),
      stored: [],
    });
    expect(reconciliation.entities.map((entity) => entity.providerId)).toEqual(["pol-1"]);
    expect(detailOf(reconciliation.entities[0]!).reusable).toBe(true);
  });

  it("marks a policy no longer named in a successful reusable read as not reusable", () => {
    const stored = [storedEntity({ bindings: [], policyId: "pol-1", reusable: true })];
    const reconciliation = reconcileAccessPolicies({
      accountId: ACCOUNT_ID,
      appAttempts: [],
      at: AT,
      currentApplicationIds: [],
      reusableRead: ok([]),
      stored,
    });
    expect(reconciliation.entities).toEqual([]);
  });

  it("reports the reusable-read failure and stays incomplete without dropping any prior entity", () => {
    const stored = [storedEntity({ bindings: [], policyId: "pol-1", reusable: true })];
    const reconciliation = reconcileAccessPolicies({
      accountId: ACCOUNT_ID,
      appAttempts: [],
      at: AT,
      currentApplicationIds: [],
      reusableRead: err(CloudflareClientErrors.provider({ cause: new Error("down"), operation: "test", status: 500 })),
      stored,
    });
    expect(reconciliation.complete).toBe(false);
    expect(reconciliation.entities.map((entity) => entity.providerId)).toEqual(["pol-1"]);
    expect(reconciliation.reasons.length).toBeGreaterThan(0);
  });

  it("prunes an application's edge once it no longer appears in a trustworthy inventory", () => {
    const stored = [
      storedEntity({
        bindings: [
          { applicationId: "app-1", precedence: 1 },
          { applicationId: "app-2", precedence: 2 },
        ],
        policyId: "pol-1",
        reusable: false,
      }),
    ];
    const reconciliation = reconcileAccessPolicies({
      accountId: ACCOUNT_ID,
      appAttempts: [{ applicationId: "app-1", result: ok([{ id: "pol-1", decision: "allow", precedence: 1 }]) }],
      at: AT,
      currentApplicationIds: ["app-1"],
      reusableRead: ok([]),
      stored,
    });
    const detail = detailOf(reconciliation.entities.find((entity) => entity.providerId === "pol-1")!);
    expect(detail.bindings).toEqual([{ applicationId: "app-1", precedence: 1 }]);
  });
});
