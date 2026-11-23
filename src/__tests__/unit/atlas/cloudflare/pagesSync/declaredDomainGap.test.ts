/*
 * How `syncPagesProjectKind` tracks a declared custom domain its read missed: a pagination-incomplete gap opens
 * at the project's scope naming it, and closes on a later read that returns every declared domain. It was split
 * out when the Pages sync suite became one file per behaviour.
 */
import { describe, expect, it } from "vitest";

import { cloudflareGapId } from "../../../../../atlas/cloudflare/identity.js";
import { CLOUDFLARE_VISIBILITY_SCOPE, emptyCloudflareKindFile } from "../../../../../atlas/cloudflare/model.js";
import { syncPagesProjectKind } from "../../../../../atlas/cloudflare/pagesSync.js";
import type { CloudflareRawPagesProject } from "../../../../../atlas/cloudflare/projection/pages.js";
import { unwrap } from "../../../../../lib/result.js";
import {
  ACCOUNT_ID,
  AT,
  childRoutes,
  domainDetail,
  expectedEntity,
  gapLifecycle,
  KIND_SCOPE,
  OLD,
  PROJECT_ONE,
  PROJECTS,
  pagedRoutes,
  projectScope,
  servedClient,
} from "./harness.js";

const LATER = "2026-03-01T00:00:00.000Z";

describe("syncPagesProjectKind", () => {
  it("opens a pagination-incomplete gap naming a declared domain the read missed, and closes it on a later complete read", async () => {
    const declaring: CloudflareRawPagesProject = {
      ...PROJECT_ONE,
      domains: ["site-one.pages.dev", "www.one.example", "api.one.example"],
    };
    const scope = projectScope({ projectId: "proj-1" });
    const first = servedClient({
      routes: {
        ...pagedRoutes({ items: [declaring], path: PROJECTS }),
        ...childRoutes({ deployments: [], domains: [{ name: "WWW.one.example", status: "active" }], name: "site-one" }),
      },
    });

    const short = unwrap(
      await syncPagesProjectKind({
        accountId: ACCOUNT_ID,
        at: AT,
        client: first.client,
        stored: emptyCloudflareKindFile({ kind: "pages-project", updatedAt: OLD }),
      }),
    );

    expect(short.file.entities).toEqual([
      expectedEntity({
        at: AT,
        detail: {
          declaredDomainNames: ["www.one.example", "api.one.example"],
          deployments: [],
          domains: [domainDetail({ name: "WWW.one.example", status: "active" })],
          domainsComplete: false,
          name: "site-one",
          productionBranch: "main",
          subdomain: "site-one.pages.dev",
        },
        firstSeenAt: AT,
        providerId: "proj-1",
      }),
    ]);
    expect(short.outcome).toEqual({
      complete: false,
      entityCount: 1,
      kind: "pages-project",
      reasons: ["proj-1: declared domain(s) not read"],
    });
    expect(short.file.coverage).toEqual([
      {
        lastSuccessAt: null,
        latestAttemptFailed: true,
        reason: "proj-1: declared domain(s) not read",
        scope: KIND_SCOPE,
        state: "unreadable",
        unblockedBy: null,
        visibilityScope: CLOUDFLARE_VISIBILITY_SCOPE,
      },
    ]);
    expect(short.file.gaps).toEqual([
      {
        condition: "pagination-incomplete",
        firstDetectedAt: AT,
        id: cloudflareGapId({ condition: "pagination-incomplete", scope }),
        kind: "pages-project",
        lastCheckedAt: AT,
        lastDetectedAt: AT,
        reason: "declared domain(s) not read: api.one.example",
        scope,
        status: "open",
      },
    ]);

    const second = servedClient({
      routes: {
        ...pagedRoutes({ items: [declaring], path: PROJECTS }),
        ...childRoutes({
          deployments: [],
          domains: [
            { name: "www.one.example", status: "active" },
            { name: "api.one.example", status: "active" },
          ],
          name: "site-one",
        }),
      },
    });

    const complete = unwrap(
      await syncPagesProjectKind({ accountId: ACCOUNT_ID, at: LATER, client: second.client, stored: short.file }),
    );

    expect(complete.outcome).toEqual({ complete: true, entityCount: 1, kind: "pages-project", reasons: [] });
    expect(complete.file.entities).toEqual([
      expectedEntity({
        at: LATER,
        detail: {
          declaredDomainNames: ["www.one.example", "api.one.example"],
          deployments: [],
          domains: [
            domainDetail({ name: "www.one.example", status: "active" }),
            domainDetail({ name: "api.one.example", status: "active" }),
          ],
          domainsComplete: true,
          name: "site-one",
          productionBranch: "main",
          subdomain: "site-one.pages.dev",
        },
        // First seen by the earlier run, so it keeps that instant.
        firstSeenAt: AT,
        providerId: "proj-1",
      }),
    ]);
    expect(gapLifecycle({ file: complete.file })).toEqual([
      { condition: "pagination-incomplete", lastCheckedAt: LATER, scope, status: "closed" },
    ]);
    expect(complete.file.coverage.map((cell) => ({ reason: cell.reason, state: cell.state }))).toEqual([
      { reason: "reconciled 1 Pages project(s)", state: "synced" },
    ]);
  });
});
