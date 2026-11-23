/*
 * How `syncPagesProjectKind` reads a full inventory: each project's children by NAME, a project the inventory
 * dropped pruned, and the per-project gaps a previous run opened closed. It was split out when the Pages sync
 * suite became one file per behaviour.
 */
import { describe, expect, it } from "vitest";

import { CLOUDFLARE_VISIBILITY_SCOPE } from "../../../../../atlas/cloudflare/model.js";
import { syncPagesProjectKind } from "../../../../../atlas/cloudflare/pagesSync.js";
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
  gapLifecycle,
  KIND_SCOPE,
  OLD,
  PROJECT_ONE,
  PROJECT_TWO,
  PROJECTS,
  pagedRoutes,
  projectScope,
  servedClient,
  storedFile,
  storedGap,
  storedProject,
} from "./harness.js";

describe("syncPagesProjectKind", () => {
  it("reads each project's children by NAME, prunes a project the inventory dropped, and closes its per-project gaps", async () => {
    const stored = storedFile({
      entities: [
        storedProject({
          children: [{ deployment: { environment: "production", id: "dep-old" }, itemKind: "deployment" }],
          raw: PROJECT_ONE,
        }),
        storedProject({ children: [], raw: { id: "proj-gone", name: "site-gone", production_branch: "main" } }),
      ],
      gaps: [
        storedGap({ condition: "permission-refused", scope: projectScope({ projectId: "proj-1" }) }),
        storedGap({ condition: "pagination-incomplete", scope: projectScope({ projectId: "proj-2" }) }),
      ],
    });
    const served = servedClient({
      routes: {
        ...pagedRoutes({ items: [PROJECT_ONE, PROJECT_TWO], path: PROJECTS }),
        ...childRoutes({
          deployments: [
            { environment: "production", id: "dep-1" },
            { environment: "preview", id: "dep-2" },
          ],
          domains: [{ name: "www.one.example", status: "active" }],
          name: "site-one",
        }),
        ...childRoutes({ deployments: [{ environment: "production", id: "dep-3" }], domains: [], name: "site-two" }),
      },
    });

    const folded = unwrap(await syncPagesProjectKind({ accountId: ACCOUNT_ID, at: AT, client: served.client, stored }));

    expect(served.requests.toSorted()).toEqual(
      [
        `${PROJECTS}@1`,
        `${PROJECTS}@2`,
        `${deploymentsPath({ name: "site-one" })}@1`,
        `${deploymentsPath({ name: "site-one" })}@2`,
        `${domainsPath({ name: "site-one" })}@1`,
        `${deploymentsPath({ name: "site-two" })}@1`,
        `${deploymentsPath({ name: "site-two" })}@2`,
        `${domainsPath({ name: "site-two" })}@1`,
      ].toSorted(),
    );
    expect(folded.file.entities).toEqual(
      byId({
        entities: [
          expectedEntity({
            at: AT,
            detail: {
              declaredDomainNames: ["www.one.example"],
              deployments: [
                deploymentDetail({ environment: "production", id: "dep-1" }),
                deploymentDetail({ environment: "preview", id: "dep-2" }),
              ],
              domains: [domainDetail({ name: "www.one.example", status: "active" })],
              domainsComplete: true,
              name: "site-one",
              productionBranch: "main",
              subdomain: "site-one.pages.dev",
            },
            // Already stored, so it keeps the instant it was first seen.
            firstSeenAt: OLD,
            providerId: "proj-1",
          }),
          expectedEntity({
            at: AT,
            detail: {
              declaredDomainNames: [],
              deployments: [deploymentDetail({ environment: "production", id: "dep-3" })],
              domains: [],
              domainsComplete: true,
              name: "site-two",
              productionBranch: "main",
              subdomain: "site-two.pages.dev",
            },
            firstSeenAt: AT,
            providerId: "proj-2",
          }),
        ],
      }),
    );
    expect(folded.outcome).toEqual({ complete: true, entityCount: 2, kind: "pages-project", reasons: [] });
    expect(folded.file.coverage).toEqual([
      {
        lastSuccessAt: AT,
        latestAttemptFailed: false,
        reason: "reconciled 2 Pages project(s)",
        scope: KIND_SCOPE,
        state: "synced",
        unblockedBy: null,
        visibilityScope: CLOUDFLARE_VISIBILITY_SCOPE,
      },
    ]);
    expect(gapLifecycle({ file: folded.file })).toEqual([
      {
        condition: "permission-refused",
        lastCheckedAt: AT,
        scope: projectScope({ projectId: "proj-1" }),
        status: "closed",
      },
      {
        condition: "pagination-incomplete",
        lastCheckedAt: AT,
        scope: projectScope({ projectId: "proj-2" }),
        status: "closed",
      },
    ]);
  });
});
