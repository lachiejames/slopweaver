/*
 * `syncWorkerScriptKind` over a newly discovered script whose bundle read fails: with nothing read this run and
 * nothing stored to fall back on it is built on the documented empty bundle, and the kind reports incomplete.
 */
import { describe, expect, it } from "vitest";

import { emptyCloudflareKindFile } from "../../../../../atlas/cloudflare/model.js";
import { syncWorkerScriptKind } from "../../../../../atlas/cloudflare/workerScriptSync.js";
import { unwrap } from "../../../../../lib/result.js";
import {
  ACCOUNT_ID,
  AT,
  BUNDLE_DENIED,
  bareMetadata,
  bundleRoutes,
  expectedEntity,
  OLD,
  rawBundle,
  SCRIPTS,
  scriptPath,
  servedClient,
} from "./harness.js";

describe("syncWorkerScriptKind", () => {
  it("builds a newly discovered script whose bundle read fails on the documented empty bundle, and reports the kind incomplete", async () => {
    const served = servedClient({
      routes: {
        [`${SCRIPTS}@1`]: { result: [{ id: "worker-new" }] },
        ...bundleRoutes({ bundle: rawBundle({ marker: "new" }), name: "worker-new" }),
        [`${scriptPath({ name: "worker-new", suffix: "/secrets" })}@1`]: { status: 403 },
      },
    });

    const folded = unwrap(
      await syncWorkerScriptKind({
        accountId: ACCOUNT_ID,
        at: AT,
        client: served.client,
        stored: emptyCloudflareKindFile({ kind: "worker-script", updatedAt: OLD }),
      }),
    );

    expect(folded.file.entities).toEqual([
      expectedEntity({
        // `EMPTY_WORKER_SCRIPT_BUNDLE`, written out: nothing read this run, nothing stored to fall back on.
        detail: {
          ...bareMetadata({ name: "worker-new" }),
          bindings: [],
          content: null,
          deployments: [],
          schedules: [],
          secrets: [],
          settings: {},
          subdomainEnabled: null,
          subdomainPreviewsEnabled: null,
          versions: [],
        },
        firstSeenAt: AT,
        providerId: "worker-new",
      }),
    ]);
    expect(folded.outcome.complete).toBe(false);
    expect(folded.outcome.reasons).toEqual([`worker-new: ${BUNDLE_DENIED}`]);
    expect(folded.file.coverage.map((cell) => ({ reason: cell.reason, state: cell.state }))).toEqual([
      { reason: `worker-new: ${BUNDLE_DENIED}`, state: "unreadable" },
    ]);
  });
});
