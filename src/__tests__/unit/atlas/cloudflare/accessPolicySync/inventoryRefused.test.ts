/*
 * How `syncAccessPolicyKind` behaves when the application inventory read itself is refused: no per-application
 * list is requested, every stored policy is kept, the flat scope's coverage turns unreadable and a
 * permission-refused gap opens. It was split out when the Access policy sync suite became one file per behaviour.
 */
import { describe, expect, it } from "vitest";

import { syncAccessPolicyKind } from "../../../../../atlas/cloudflare/accessPolicySync.js";
import { succeededCloudflareCoverageCell } from "../../../../../atlas/cloudflare/coverage.js";
import { CLOUDFLARE_VISIBILITY_SCOPE } from "../../../../../atlas/cloudflare/model.js";
import { unwrap } from "../../../../../lib/result.js";
import {
  ACCOUNT_ID,
  APPS_PATH,
  AT,
  deniedMessage,
  expectedOpenGap,
  FLAT_SCOPE,
  STORED_AT,
  storedFile,
  storedPolicy,
} from "./harness.js";
import { policyClient } from "./policyClient.js";

const APPS_DENIED = deniedMessage({ operation: "access-applications-list" });

describe("syncAccessPolicyKind", () => {
  it("makes no per-application request and keeps every stored policy when the application inventory is refused", async () => {
    const requests: string[] = [];
    const client = policyClient({ applications: [], failApps: true, policiesByApp: {}, requests, reusable: [] });
    const entities = [
      storedPolicy({ bindings: [], policyId: "pol-reusable", reusable: true }),
      storedPolicy({ bindings: [{ applicationId: "app-1", precedence: 1 }], policyId: "pol-bound", reusable: false }),
    ];
    const stored = storedFile({
      coverage: [
        succeededCloudflareCoverageCell({
          at: STORED_AT,
          reason: "reconciled 2 polic(y/ies) across 1 application(s)",
          scope: FLAT_SCOPE,
          state: "synced",
        }),
      ],
      entities,
    });

    const folded = unwrap(await syncAccessPolicyKind({ accountId: ACCOUNT_ID, at: AT, client, stored }));

    expect(requests).toEqual([APPS_PATH]);
    expect(folded.file.entities).toEqual(entities);
    expect(folded.file.coverage).toEqual([
      {
        lastSuccessAt: STORED_AT,
        latestAttemptFailed: true,
        reason: APPS_DENIED,
        scope: FLAT_SCOPE,
        state: "unreadable",
        unblockedBy: null,
        visibilityScope: CLOUDFLARE_VISIBILITY_SCOPE,
      },
    ]);
    expect(folded.file.gaps).toEqual([expectedOpenGap({ reason: APPS_DENIED, scope: FLAT_SCOPE })]);
    expect(folded.outcome.complete).toBe(false);
    expect(folded.outcome.entityCount).toBe(2);
    expect(folded.outcome.kind).toBe("access-policy");
    expect(folded.outcome.reasons).toEqual([APPS_DENIED]);
    expect(folded.outcome.permissionBlocked!.detail).toBe(APPS_DENIED);
  });
});
