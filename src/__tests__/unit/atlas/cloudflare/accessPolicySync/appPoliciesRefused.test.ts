/*
 * How `syncAccessPolicyKind` behaves when one application's policy list is refused: only that application's
 * stored bindings are kept, another application's read still updates, and the refused application's scope opens
 * a permission-refused gap. It was split out when the Access policy sync suite became one file per behaviour.
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
  policyDetail,
  RECONCILE_SOURCE,
  rawPolicy,
  storedFile,
  storedPolicy,
} from "./harness.js";
import { policyClient } from "./policyClient.js";

const APP_POLICIES_DENIED = deniedMessage({ operation: "access-application-policies-list" });

describe("syncAccessPolicyKind", () => {
  it("keeps only the refused application's stored bindings while another application's read still updates", async () => {
    const requests: string[] = [];
    const client = policyClient({
      applications: ["app-1", "app-2"],
      failAppPolicies: ["app-1"],
      policiesByApp: {
        "app-1": [],
        "app-2": [rawPolicy({ id: "pol-a", precedence: 5 }), rawPolicy({ id: "pol-c", precedence: 1 })],
      },
      requests,
      reusable: [],
    });
    const stored = storedFile({
      entities: [
        storedPolicy({
          bindings: [
            { applicationId: "app-1", precedence: 1 },
            { applicationId: "app-2", precedence: 3 },
          ],
          policyId: "pol-a",
          reusable: false,
        }),
        storedPolicy({ bindings: [{ applicationId: "app-1", precedence: 2 }], policyId: "pol-b", reusable: false }),
      ],
    });

    const folded = unwrap(await syncAccessPolicyKind({ accountId: ACCOUNT_ID, at: AT, client, stored }));

    expect(entityView({ entities: folded.file.entities })).toEqual([
      {
        detail: policyDetail({
          bindings: [
            { applicationId: "app-1", precedence: 1 },
            { applicationId: "app-2", precedence: 5 },
          ],
          policyId: "pol-a",
          reusable: false,
        }),
        lastSeenAt: AT,
        providerId: "pol-a",
        source: RECONCILE_SOURCE,
      },
      {
        detail: policyDetail({
          bindings: [{ applicationId: "app-1", precedence: 2 }],
          policyId: "pol-b",
          reusable: false,
        }),
        lastSeenAt: AT,
        providerId: "pol-b",
        source: RECONCILE_SOURCE,
      },
      {
        detail: policyDetail({
          bindings: [{ applicationId: "app-2", precedence: 1 }],
          policyId: "pol-c",
          reusable: false,
        }),
        lastSeenAt: AT,
        providerId: "pol-c",
        source: RECONCILE_SOURCE,
      },
    ]);
    expect(folded.outcome.complete).toBe(false);
    expect(folded.outcome.entityCount).toBe(3);
    expect(folded.outcome.reasons).toEqual([`application app-1: ${APP_POLICIES_DENIED}`]);
    expect(folded.file.coverage.map((cell) => ({ reason: cell.reason, state: cell.state }))).toEqual([
      { reason: `application app-1: ${APP_POLICIES_DENIED}`, state: "unreadable" },
    ]);
    expect(folded.file.gaps).toEqual([
      expectedOpenGap({ reason: APP_POLICIES_DENIED, scope: appScope({ applicationId: "app-1" }) }),
    ]);
  });
});
