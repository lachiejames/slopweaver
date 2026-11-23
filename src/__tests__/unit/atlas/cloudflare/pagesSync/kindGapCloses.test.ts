/*
 * How `syncPagesProjectKind` closes the kind-scope gap a refused inventory opened, once a later inventory read
 * succeeds. It was split out when the Pages sync suite became one file per behaviour.
 */
import { describe, expect, it } from "vitest";

import { syncPagesProjectKind } from "../../../../../atlas/cloudflare/pagesSync.js";
import { unwrap } from "../../../../../lib/result.js";
import {
  ACCOUNT_ID,
  AT,
  gapLifecycle,
  KIND_SCOPE,
  PROJECTS,
  pagedRoutes,
  servedClient,
  storedFile,
  storedGap,
} from "./harness.js";

describe("syncPagesProjectKind", () => {
  it("closes the kind-scope gap a refused inventory opened once a later inventory read succeeds", async () => {
    // Fixed in this branch: foldFanoutResult now rechecks the kind scope, so the inventory's own gap closes.
    const stored = storedFile({
      entities: [],
      gaps: [storedGap({ condition: "permission-refused", scope: KIND_SCOPE })],
    });
    const served = servedClient({ routes: pagedRoutes({ items: [], path: PROJECTS }) });

    const folded = unwrap(await syncPagesProjectKind({ accountId: ACCOUNT_ID, at: AT, client: served.client, stored }));

    expect(served.requests).toEqual([`${PROJECTS}@1`]);
    expect(gapLifecycle({ file: folded.file })).toEqual([
      { condition: "permission-refused", lastCheckedAt: AT, scope: KIND_SCOPE, status: "closed" },
    ]);
    expect(folded.outcome).toEqual({ complete: true, entityCount: 0, kind: "pages-project", reasons: [] });
  });
});
