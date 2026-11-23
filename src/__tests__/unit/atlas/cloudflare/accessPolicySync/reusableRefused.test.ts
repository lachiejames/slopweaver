/*
 * How `syncAccessPolicyKind` behaves when the account-level reusable list is refused: prior reusable state is
 * preserved, application bindings still update, only the reusable list's scope stays open, and an application
 * gap this run's read cleared closes. It was split out when the Access policy sync suite became one file per
 * behaviour.
 */
import { describe, expect, it } from "vitest";

import { syncAccessPolicyKind } from "../../../../../atlas/cloudflare/accessPolicySync.js";
import { unwrap } from "../../../../../lib/result.js";
import {
  ACCOUNT_ID,
  AT,
  appScope,
  deniedMessage,
  entityView,
  expectedOpenGap,
  gapLifecycle,
  openGapsOf,
  policyDetail,
  RECONCILE_SOURCE,
  REUSABLE_SCOPE,
  rawPolicy,
  storedFile,
  storedPermissionGap,
  storedPolicy,
} from "./harness.js";
import { policyClient } from "./policyClient.js";

const REUSABLE_DENIED = deniedMessage({ operation: "access-reusable-policies-list" });

describe("syncAccessPolicyKind", () => {
  it("preserves prior reusable state when the reusable list is refused, while application bindings still update", async () => {
    const requests: string[] = [];
    const client = policyClient({
      applications: ["app-1", "app-2"],
      failReusable: true,
      policiesByApp: {
        "app-1": [rawPolicy({ id: "pol-x", precedence: 4 })],
        "app-2": [rawPolicy({ id: "pol-y", precedence: 1 })],
      },
      requests,
      reusable: [],
    });
    const stored = storedFile({
      entities: [
        storedPolicy({ bindings: [], policyId: "pol-r", reusable: true }),
        storedPolicy({ bindings: [{ applicationId: "app-1", precedence: 1 }], policyId: "pol-x", reusable: false }),
      ],
      gaps: [storedPermissionGap({ scope: appScope({ applicationId: "app-1" }) })],
    });

    const folded = unwrap(await syncAccessPolicyKind({ accountId: ACCOUNT_ID, at: AT, client, stored }));

    expect(entityView({ entities: folded.file.entities })).toEqual([
      {
        detail: policyDetail({ bindings: [], policyId: "pol-r", reusable: true }),
        lastSeenAt: AT,
        providerId: "pol-r",
        source: RECONCILE_SOURCE,
      },
      {
        detail: policyDetail({
          bindings: [{ applicationId: "app-1", precedence: 4 }],
          policyId: "pol-x",
          reusable: false,
        }),
        lastSeenAt: AT,
        providerId: "pol-x",
        source: RECONCILE_SOURCE,
      },
      {
        detail: policyDetail({
          bindings: [{ applicationId: "app-2", precedence: 1 }],
          policyId: "pol-y",
          reusable: false,
        }),
        lastSeenAt: AT,
        providerId: "pol-y",
        source: RECONCILE_SOURCE,
      },
    ]);
    expect(folded.outcome.complete).toBe(false);
    expect(folded.outcome.reasons).toEqual([REUSABLE_DENIED]);
    // Only the reusable list's scope is open; the application whose earlier refusal this run's read cleared is closed.
    expect(openGapsOf({ file: folded.file })).toEqual([
      expectedOpenGap({ reason: REUSABLE_DENIED, scope: REUSABLE_SCOPE }),
    ]);
    expect(gapLifecycle({ file: folded.file })).toEqual([
      {
        condition: "permission-refused",
        lastCheckedAt: AT,
        scope: appScope({ applicationId: "app-1" }),
        status: "closed",
      },
      { condition: "permission-refused", lastCheckedAt: AT, scope: REUSABLE_SCOPE, status: "open" },
    ]);
  });
});
