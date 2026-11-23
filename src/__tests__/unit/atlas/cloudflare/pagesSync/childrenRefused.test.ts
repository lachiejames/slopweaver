/*
 * How `syncPagesProjectKind` handles one project's children read being refused: that project keeps its stored
 * children under fresh metadata and opens a permission-refused gap at its own scope, while the other project
 * refreshes. It was split out when the Pages sync suite became one file per behaviour.
 */
import { describe, expect, it } from "vitest";

import { cloudflareGapId } from "../../../../../atlas/cloudflare/identity.js";
import { CLOUDFLARE_VISIBILITY_SCOPE } from "../../../../../atlas/cloudflare/model.js";
import { syncPagesProjectKind } from "../../../../../atlas/cloudflare/pagesSync.js";
import type { CloudflareRawPagesProject } from "../../../../../atlas/cloudflare/projection/pages.js";
import { unwrap } from "../../../../../lib/result.js";
import {
  ACCOUNT_ID,
  AT,
  byId,
  childRoutes,
  deploymentDetail,
  deploymentsPath,
  domainDetail,
  domainsPath,
  expectedEntity,
  KIND_SCOPE,
  OLD,
  PROJECT_ONE,
  PROJECT_TWO,
  PROJECTS,
  pagedRoutes,
  projectScope,
  servedClient,
  storedFile,
  storedProject,
  TOKEN_REMEDY,
} from "./harness.js";

/** What the same 403 on one project's deployments/domains read maps to. */
const CHILDREN_DENIED =
  "cloudflare pages-project-children-list: permission denied (403) — the configured token cannot see this surface: " +
  '403 {"errors":[{"message":"denied"}],"success":false}';

describe("syncPagesProjectKind", () => {
  it("costs only the refused project its fresh children: it keeps its stored ones under fresh metadata, the other refreshes", async () => {
    const stored = storedFile({
      entities: [
        storedProject({
          children: [{ deployment: { environment: "production", id: "dep-old-1" }, itemKind: "deployment" }],
          raw: PROJECT_ONE,
        }),
        storedProject({
          children: [
            { deployment: { environment: "production", id: "dep-old-2" }, itemKind: "deployment" },
            { domain: { name: "two.example", status: "active" }, itemKind: "domain" },
          ],
          raw: PROJECT_TWO,
        }),
      ],
      gaps: [],
    });
    const renamedTwo: CloudflareRawPagesProject = {
      ...PROJECT_TWO,
      domains: ["site-two.pages.dev", "two.example"],
      production_branch: "release",
    };
    const served = servedClient({
      routes: {
        ...pagedRoutes({ items: [PROJECT_ONE, renamedTwo], path: PROJECTS }),
        ...childRoutes({
          deployments: [{ environment: "production", id: "dep-new-1" }],
          domains: [{ name: "www.one.example", status: "active" }],
          name: "site-one",
        }),
        [`${deploymentsPath({ name: "site-two" })}@1`]: { status: 403 },
      },
    });

    const folded = unwrap(await syncPagesProjectKind({ accountId: ACCOUNT_ID, at: AT, client: served.client, stored }));

    const failedScope = projectScope({ projectId: "proj-2" });
    const reason = `proj-2: ${CHILDREN_DENIED}`;
    // The deployments read failed first, so the same project's domains were never asked for.
    expect(served.requests).not.toContain(`${domainsPath({ name: "site-two" })}@1`);
    expect(served.requests).toContain(`${deploymentsPath({ name: "site-two" })}@1`);
    expect(folded.file.entities).toEqual(
      byId({
        entities: [
          expectedEntity({
            at: AT,
            detail: {
              declaredDomainNames: ["www.one.example"],
              deployments: [deploymentDetail({ environment: "production", id: "dep-new-1" })],
              domains: [domainDetail({ name: "www.one.example", status: "active" })],
              domainsComplete: true,
              name: "site-one",
              productionBranch: "main",
              subdomain: "site-one.pages.dev",
            },
            firstSeenAt: OLD,
            providerId: "proj-1",
          }),
          expectedEntity({
            at: AT,
            detail: {
              declaredDomainNames: ["two.example"],
              deployments: [deploymentDetail({ environment: "production", id: "dep-old-2" })],
              domains: [domainDetail({ name: "two.example", status: "active" })],
              domainsComplete: true,
              name: "site-two",
              productionBranch: "release",
              subdomain: "site-two.pages.dev",
            },
            firstSeenAt: OLD,
            providerId: "proj-2",
          }),
        ],
      }),
    );
    expect(folded.outcome).toEqual({
      complete: false,
      entityCount: 2,
      kind: "pages-project",
      permissionBlocked: { detail: `${failedScope}: ${CHILDREN_DENIED}`, unblockedBy: TOKEN_REMEDY },
      reasons: [reason],
    });
    expect(folded.file.coverage).toEqual([
      {
        lastSuccessAt: OLD,
        latestAttemptFailed: true,
        reason,
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
        id: cloudflareGapId({ condition: "permission-refused", scope: failedScope }),
        kind: "pages-project",
        lastCheckedAt: AT,
        lastDetectedAt: AT,
        reason: CHILDREN_DENIED,
        scope: failedScope,
        status: "open",
      },
    ]);
  });
});
