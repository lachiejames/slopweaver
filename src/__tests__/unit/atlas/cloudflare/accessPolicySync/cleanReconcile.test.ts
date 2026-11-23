/*
 * How `syncAccessPolicyKind` reconciles a clean pass: it requests the inventory, the reusable list and each
 * application's policy list, folds them into one policy graph with sorted bindings, marks the flat scope synced,
 * and closes the permission-refused gaps an earlier run opened. It was split out when the Access policy sync
 * suite became one file per behaviour.
 */
import { describe, expect, it } from "vitest";

import { syncAccessPolicyKind } from "../../../../../atlas/cloudflare/accessPolicySync.js";
import { CLOUDFLARE_VISIBILITY_SCOPE } from "../../../../../atlas/cloudflare/model.js";
import { unwrap } from "../../../../../lib/result.js";
import {
  ACCOUNT_ID,
  APPS_PATH,
  AT,
  appPoliciesPath,
  appScope,
  entityView,
  FLAT_SCOPE,
  gapLifecycle,
  openGapsOf,
  policyDetail,
  RECONCILE_SOURCE,
  REUSABLE_PATH,
  REUSABLE_SCOPE,
  rawPolicy,
  storedFile,
  storedPermissionGap,
} from "./harness.js";
import { policyClient } from "./policyClient.js";

describe("syncAccessPolicyKind", () => {
  it("requests the inventory, the reusable list and each application's list, and reconciles them into one graph", async () => {
    const requests: string[] = [];
    const client = policyClient({
      // Listed out of order so the sorted bindings are the module's doing rather than the fixture's.
      applications: ["app-2", "app-1"],
      policiesByApp: {
        "app-1": [rawPolicy({ id: "pol-reuse", precedence: 2 }), rawPolicy({ id: "pol-excl-1", precedence: 1 })],
        "app-2": [rawPolicy({ id: "pol-reuse", precedence: 1 }), rawPolicy({ id: "pol-excl-2" })],
      },
      requests,
      reusable: [rawPolicy({ id: "pol-reuse", reusable: true })],
    });
    // A refusal a previous run opened on the reusable list and on app-1: a clean pass closes both.
    const stored = storedFile({
      entities: [],
      gaps: [
        storedPermissionGap({ scope: REUSABLE_SCOPE }),
        storedPermissionGap({ scope: appScope({ applicationId: "app-1" }) }),
      ],
    });

    const folded = unwrap(await syncAccessPolicyKind({ accountId: ACCOUNT_ID, at: AT, client, stored }));

    expect(requests.toSorted()).toEqual([
      APPS_PATH,
      appPoliciesPath({ applicationId: "app-1" }),
      appPoliciesPath({ applicationId: "app-2" }),
      REUSABLE_PATH,
    ]);
    expect(entityView({ entities: folded.file.entities })).toEqual([
      {
        detail: policyDetail({
          bindings: [{ applicationId: "app-1", precedence: 1 }],
          policyId: "pol-excl-1",
          reusable: false,
        }),
        lastSeenAt: AT,
        providerId: "pol-excl-1",
        source: RECONCILE_SOURCE,
      },
      {
        detail: policyDetail({
          bindings: [{ applicationId: "app-2", precedence: null }],
          policyId: "pol-excl-2",
          reusable: false,
        }),
        lastSeenAt: AT,
        providerId: "pol-excl-2",
        source: RECONCILE_SOURCE,
      },
      {
        detail: policyDetail({
          bindings: [
            { applicationId: "app-1", precedence: 2 },
            { applicationId: "app-2", precedence: 1 },
          ],
          policyId: "pol-reuse",
          reusable: true,
        }),
        lastSeenAt: AT,
        providerId: "pol-reuse",
        source: RECONCILE_SOURCE,
      },
    ]);
    expect(folded.outcome).toEqual({ complete: true, entityCount: 3, kind: "access-policy", reasons: [] });
    expect(folded.file.coverage).toEqual([
      {
        lastSuccessAt: AT,
        latestAttemptFailed: false,
        reason: "reconciled 3 polic(y/ies) across 2 application(s)",
        scope: FLAT_SCOPE,
        state: "synced",
        unblockedBy: null,
        visibilityScope: CLOUDFLARE_VISIBILITY_SCOPE,
      },
    ]);
    expect(openGapsOf({ file: folded.file })).toEqual([]);
    expect(gapLifecycle({ file: folded.file })).toEqual([
      {
        condition: "permission-refused",
        lastCheckedAt: AT,
        scope: appScope({ applicationId: "app-1" }),
        status: "closed",
      },
      { condition: "permission-refused", lastCheckedAt: AT, scope: REUSABLE_SCOPE, status: "closed" },
    ]);
  });
});
