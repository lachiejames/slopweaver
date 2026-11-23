/*
 * `syncWorkerScriptKind` over the inventory read: a refused inventory keeps every stored script and reads no
 * bundle, and a later inventory read that succeeds closes the kind-scope gap the refusal opened.
 */
import { describe, expect, it } from "vitest";

import { cloudflareGapId } from "../../../../../atlas/cloudflare/identity.js";
import { CLOUDFLARE_VISIBILITY_SCOPE } from "../../../../../atlas/cloudflare/model.js";
import { syncWorkerScriptKind } from "../../../../../atlas/cloudflare/workerScriptSync.js";
import { unwrap } from "../../../../../lib/result.js";
import { gapLifecycle } from "../sync/zoneSubtypeKind.js";
import {
  ACCOUNT_ID,
  AT,
  KIND_SCOPE,
  OLD,
  rawBundle,
  SCRIPT_A,
  SCRIPT_B,
  SCRIPTS,
  servedClient,
  storedFile,
  storedGap,
  storedScript,
  TOKEN_REMEDY,
} from "./harness.js";

/** What a 403 carrying `{ message: "denied" }` on the inventory read maps to, as the typed error words it. */
const INVENTORY_DENIED =
  "cloudflare workers-scripts-list: permission denied (403) — the configured token cannot see this surface: " +
  '403 {"errors":[{"message":"denied"}],"success":false}';

describe("syncWorkerScriptKind", () => {
  it("keeps every stored script and reads no bundle when the inventory itself is refused", async () => {
    const stored = storedFile({
      entities: [
        storedScript({ bundle: rawBundle({ marker: "old" }), raw: SCRIPT_A }),
        storedScript({ bundle: rawBundle({ marker: "older" }), raw: SCRIPT_B }),
      ],
      gaps: [],
    });
    const served = servedClient({ routes: { [`${SCRIPTS}@1`]: { status: 403 } } });

    const folded = unwrap(await syncWorkerScriptKind({ accountId: ACCOUNT_ID, at: AT, client: served.client, stored }));

    expect(served.requests).toEqual([`${SCRIPTS}@1`]);
    expect(folded.file.entities).toEqual(stored.entities);
    expect(folded.outcome).toEqual({
      complete: false,
      entityCount: 2,
      kind: "worker-script",
      permissionBlocked: { detail: INVENTORY_DENIED, unblockedBy: TOKEN_REMEDY },
      reasons: [INVENTORY_DENIED],
    });
    expect(folded.file.coverage).toEqual([
      {
        lastSuccessAt: OLD,
        latestAttemptFailed: true,
        reason: INVENTORY_DENIED,
        scope: KIND_SCOPE,
        state: "unreadable",
        unblockedBy: null,
        visibilityScope: CLOUDFLARE_VISIBILITY_SCOPE,
      },
    ]);
    expect(folded.file.gaps).toEqual([
      {
        condition: "permission-refused",
        firstDetectedAt: AT,
        id: cloudflareGapId({ condition: "permission-refused", scope: KIND_SCOPE }),
        kind: "worker-script",
        lastCheckedAt: AT,
        lastDetectedAt: AT,
        reason: INVENTORY_DENIED,
        scope: KIND_SCOPE,
        status: "open",
      },
    ]);
  });

  it("closes the kind-scope gap a refused inventory opened once a later inventory read succeeds", async () => {
    // Fixed in this branch: foldFanoutResult now rechecks the kind scope, so the inventory's own gap closes.
    const stored = storedFile({
      entities: [],
      gaps: [storedGap({ condition: "permission-refused", scope: KIND_SCOPE })],
    });
    const served = servedClient({ routes: { [`${SCRIPTS}@1`]: { result: [] } } });

    const folded = unwrap(await syncWorkerScriptKind({ accountId: ACCOUNT_ID, at: AT, client: served.client, stored }));

    expect(served.requests).toEqual([`${SCRIPTS}@1`]);
    expect(gapLifecycle({ file: folded.file })).toEqual([
      { condition: "permission-refused", lastCheckedAt: AT, scope: KIND_SCOPE, status: "closed" },
    ]);
    expect(folded.outcome).toEqual({ complete: true, entityCount: 0, kind: "worker-script", reasons: [] });
  });
});
