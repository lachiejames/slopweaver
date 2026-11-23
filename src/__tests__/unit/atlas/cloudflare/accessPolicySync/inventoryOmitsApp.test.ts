/*
 * How `syncAccessPolicyKind` treats an application the inventory no longer lists: its stored bindings are
 * dropped, a policy left unbound and unreusable is pruned, and a reusable or still-bound policy survives. It was
 * split out when the Access policy sync suite became one file per behaviour.
 */
import { describe, expect, it } from "vitest";

import { syncAccessPolicyKind } from "../../../../../atlas/cloudflare/accessPolicySync.js";
import { unwrap } from "../../../../../lib/result.js";
import {
  ACCOUNT_ID,
  APPS_PATH,
  AT,
  appPoliciesPath,
  entityView,
  policyDetail,
  RECONCILE_SOURCE,
  REUSABLE_PATH,
  rawPolicy,
  storedFile,
  storedPolicy,
} from "./harness.js";
import { policyClient } from "./policyClient.js";

describe("syncAccessPolicyKind", () => {
  it("drops a stored application's bindings once the inventory omits it, pruning a policy left unbound and unreusable", async () => {
    const requests: string[] = [];
    const client = policyClient({
      applications: ["app-1"],
      policiesByApp: { "app-1": [rawPolicy({ id: "pol-shared", precedence: 1 })] },
      requests,
      reusable: [rawPolicy({ id: "pol-reuse", reusable: true })],
    });
    const stored = storedFile({
      entities: [
        storedPolicy({
          bindings: [{ applicationId: "app-gone", precedence: 1 }],
          policyId: "pol-solo",
          reusable: false,
        }),
        storedPolicy({
          bindings: [{ applicationId: "app-gone", precedence: 2 }],
          policyId: "pol-reuse",
          reusable: true,
        }),
        storedPolicy({
          bindings: [
            { applicationId: "app-1", precedence: 7 },
            { applicationId: "app-gone", precedence: 3 },
          ],
          policyId: "pol-shared",
          reusable: false,
        }),
      ],
    });

    const folded = unwrap(await syncAccessPolicyKind({ accountId: ACCOUNT_ID, at: AT, client, stored }));

    expect(requests.toSorted()).toEqual([APPS_PATH, appPoliciesPath({ applicationId: "app-1" }), REUSABLE_PATH]);
    expect(entityView({ entities: folded.file.entities })).toEqual([
      {
        detail: policyDetail({ bindings: [], policyId: "pol-reuse", reusable: true }),
        lastSeenAt: AT,
        providerId: "pol-reuse",
        source: RECONCILE_SOURCE,
      },
      {
        detail: policyDetail({
          bindings: [{ applicationId: "app-1", precedence: 1 }],
          policyId: "pol-shared",
          reusable: false,
        }),
        lastSeenAt: AT,
        providerId: "pol-shared",
        source: RECONCILE_SOURCE,
      },
    ]);
    expect(folded.outcome).toEqual({ complete: true, entityCount: 2, kind: "access-policy", reasons: [] });
  });
});
