/*
 * How `syncPagesProjectKind` behaves when the projects inventory read itself is refused: every stored project is
 * kept, no project's children are read, and the kind scope opens a permission-refused gap. It was split out
 * when the Pages sync suite became one file per behaviour.
 */
import { describe, expect, it } from "vitest";

import { cloudflareGapId } from "../../../../../atlas/cloudflare/identity.js";
import { CLOUDFLARE_VISIBILITY_SCOPE } from "../../../../../atlas/cloudflare/model.js";
import { syncPagesProjectKind } from "../../../../../atlas/cloudflare/pagesSync.js";
import { unwrap } from "../../../../../lib/result.js";
import {
  ACCOUNT_ID,
  AT,
  KIND_SCOPE,
  OLD,
  PROJECT_ONE,
  PROJECT_TWO,
  PROJECTS,
  servedClient,
  storedFile,
  storedProject,
  TOKEN_REMEDY,
} from "./harness.js";

/** What a 403 carrying `{ message: "denied" }` on the inventory read maps to, as the typed error words it. */
const INVENTORY_DENIED =
  "cloudflare pages-projects-list: permission denied (403) — the configured token cannot see this surface: " +
  '403 {"errors":[{"message":"denied"}],"success":false}';

describe("syncPagesProjectKind", () => {
  it("keeps every stored project and reads no project's children when the inventory itself is refused", async () => {
    const stored = storedFile({
      entities: [
        storedProject({
          children: [{ deployment: { environment: "production", id: "dep-old" }, itemKind: "deployment" }],
          raw: PROJECT_ONE,
        }),
        storedProject({ children: [], raw: PROJECT_TWO }),
      ],
      gaps: [],
    });
    const served = servedClient({ routes: { [`${PROJECTS}@1`]: { status: 403 } } });

    const folded = unwrap(await syncPagesProjectKind({ accountId: ACCOUNT_ID, at: AT, client: served.client, stored }));

    expect(served.requests).toEqual([`${PROJECTS}@1`]);
    expect(folded.file.entities).toEqual(stored.entities);
    expect(folded.outcome).toEqual({
      complete: false,
      entityCount: 2,
      kind: "pages-project",
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
        kind: "pages-project",
        lastCheckedAt: AT,
        lastDetectedAt: AT,
        reason: INVENTORY_DENIED,
        scope: KIND_SCOPE,
        status: "open",
      },
    ]);
  });
});
