import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  PRISMA_AUTH_ENDPOINTS,
  prismaAbsentAuthEndpoints,
  prismaConfirmedAuthEndpoints,
} from "../../../../atlas/prismaDataPlatform/authEndpoints.js";
import { PRISMA_CONSOLE_ROUTES } from "../../../../atlas/prismaDataPlatform/consoleRoutes.js";
import { PRISMA_DATA_PLATFORM_SURFACES } from "../../../../atlas/prismaDataPlatform/generated/surfaces.js";
import { PRISMA_DATA_PLATFORM_ATLAS_KINDS } from "../../../../atlas/prismaDataPlatform/kinds.js";
import {
  PRISMA_AUTH_SURFACE,
  PRISMA_CONSOLE_SURFACE,
  PRISMA_SPEC_SURFACE,
  prismaFillableKinds,
} from "../../../../atlas/prismaDataPlatform/projection.js";
import { readPrismaDataPlatformSnapshot } from "../../../../atlas/prismaDataPlatform/readAdapter.js";
import { resetPrismaDataPlatformAtlas } from "../../../../atlas/prismaDataPlatform/reset.js";
import {
  prismaDataPlatformAtlasPaths,
  readPrismaDataPlatformAtlas,
} from "../../../../atlas/prismaDataPlatform/store.js";
import {
  PRISMA_ENTITY_SURFACE,
  PRISMA_ENTITY_UNBLOCK,
  syncPrismaDataPlatformSurfaces,
} from "../../../../atlas/prismaDataPlatform/sync.js";
import { unwrap } from "../../../../lib/result.js";

const AT = "2026-09-06T02:00:00.000Z";
const LATER = "2026-09-07T02:00:00.000Z";

const homes: string[] = [];

/** A throwaway state home. Every write in this file is scoped to one, per `.claude/rules/testing.md`. */
function scratchHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-prisma-sync-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  homes.splice(0).forEach((home) => {
    rmSync(home, { force: true, recursive: true });
  });
});

describe("publishing the Prisma Data Platform surface maps", () => {
  it("publishes every operation, endpoint and route, and says how many are confirmed", () => {
    const home = scratchHome();

    const outcome = unwrap(syncPrismaDataPlatformSurfaces({ at: AT, paths: prismaDataPlatformAtlasPaths({ home }) }));

    expect(outcome.operationCount).toBe(PRISMA_DATA_PLATFORM_SURFACES.length);
    expect(outcome.documentedOperationCount).toBe(45);
    expect(outcome.authEndpointCount).toBe(PRISMA_AUTH_ENDPOINTS.length);
    expect(outcome.confirmedAuthEndpointCount).toBe(prismaConfirmedAuthEndpoints().length);
    expect(outcome.consoleRouteCount).toBe(PRISMA_CONSOLE_ROUTES.length);
    expect(outcome.unreachableKindCount).toBe(PRISMA_DATA_PLATFORM_ATLAS_KINDS.length - prismaFillableKinds().length);
  });

  it("writes a file for every kind, so a fresh generation is complete rather than partial", () => {
    const home = scratchHome();
    const paths = prismaDataPlatformAtlasPaths({ home });

    unwrap(syncPrismaDataPlatformSurfaces({ at: AT, paths }));
    const snapshot = unwrap(readPrismaDataPlatformAtlas({ paths }));

    expect(snapshot.missing).toEqual([]);
    expect(snapshot.mismatched).toEqual([]);
  });

  it("reads back all three surface maps through the registry's own adapter", () => {
    const home = scratchHome();

    unwrap(syncPrismaDataPlatformSurfaces({ at: AT, paths: prismaDataPlatformAtlasPaths({ home }) }));
    const snapshot = unwrap(readPrismaDataPlatformSnapshot({ home }));

    expect(snapshot.kinds.find((kind) => kind.kind === "method")!.entities.length).toBe(
      PRISMA_DATA_PLATFORM_SURFACES.length,
    );
    expect(snapshot.kinds.find((kind) => kind.kind === "oauth-endpoint")!.entities.length).toBe(
      PRISMA_AUTH_ENDPOINTS.length,
    );
    expect(snapshot.kinds.find((kind) => kind.kind === "console-route")!.entities.length).toBe(
      PRISMA_CONSOLE_ROUTES.length,
    );
  });

  // A kind that is empty for want of a credential and a kind that is empty because the organisation holds
  // nothing are the same file with opposite meanings. This is the field that tells them apart.
  it("gives every unreachable entity kind a not-configured cell naming the credential", () => {
    const home = scratchHome();
    const paths = prismaDataPlatformAtlasPaths({ home });

    unwrap(syncPrismaDataPlatformSurfaces({ at: AT, paths }));
    const cell = unwrap(readPrismaDataPlatformAtlas({ paths })).files.database!.coverage.find(
      (entry) => entry.surface === PRISMA_ENTITY_SURFACE,
    )!;

    expect(cell.state).toBe("not-configured");
    expect(cell.unblockedBy).toBe(PRISMA_ENTITY_UNBLOCK);
    expect(cell.channel).toBe("api");
  });

  it("grades the spec surface synced and the console surface unreadable, because one was read and one was not", () => {
    const home = scratchHome();
    const paths = prismaDataPlatformAtlasPaths({ home });

    unwrap(syncPrismaDataPlatformSurfaces({ at: AT, paths }));
    const files = unwrap(readPrismaDataPlatformAtlas({ paths })).files;
    const spec = files.method!.coverage.find((cell) => cell.surface === PRISMA_SPEC_SURFACE)!;
    const auth = files["oauth-endpoint"]!.coverage.find((cell) => cell.surface === PRISMA_AUTH_SURFACE)!;
    const consoleRoutes = files["console-route"]!.coverage.find((cell) => cell.surface === PRISMA_CONSOLE_SURFACE)!;

    expect(spec.state).toBe("synced");
    expect(auth.state).toBe("synced");
    expect(consoleRoutes.state).toBe("unreadable");
    expect(consoleRoutes.channel).toBe("browser");
    expect(consoleRoutes.visibilityScope).toBe("browser-signed-in-role");
  });

  it("opens the six standing gaps, one of them about the organisation rather than about Prisma", () => {
    const home = scratchHome();
    const paths = prismaDataPlatformAtlasPaths({ home });

    unwrap(syncPrismaDataPlatformSurfaces({ at: AT, paths }));
    const files = unwrap(readPrismaDataPlatformAtlas({ paths })).files;
    const conditions = [
      ...files.method!.gaps.map((gap) => gap.condition),
      ...files["console-route"]!.gaps.map((gap) => gap.condition),
      ...files.workspace!.gaps.map((gap) => gap.condition),
    ];

    expect(conditions.filter((condition) => condition === "docs-omit-declared-operation").length).toBe(1);
    expect(conditions.filter((condition) => condition === "spec-references-undeclared-endpoint").length).toBe(4);
    expect(conditions.filter((condition) => condition === "surface-self-contradiction").length).toBe(1);
    expect(conditions.filter((condition) => condition === "console-origin-indiscriminate").length).toBe(1);
    expect(conditions.filter((condition) => condition === "browser-session-absent").length).toBe(1);
    expect(conditions.filter((condition) => condition === "vendor-inventory-disagreement").length).toBe(1);
  });

  // The vendor-inventory gap is written as a QUESTION carrying the commands that answer it, never as a
  // frozen count — a count would become a confident lie the day somebody adds the register row.
  it("states the vendor-inventory gap as two commands rather than as a claim about a count", () => {
    const home = scratchHome();
    const paths = prismaDataPlatformAtlasPaths({ home });

    unwrap(syncPrismaDataPlatformSurfaces({ at: AT, paths }));
    const gap = unwrap(readPrismaDataPlatformAtlas({ paths })).files.workspace!.gaps.find(
      (row) => row.condition === "vendor-inventory-disagreement",
    )!;

    expect(gap.reason).toContain("slopweaver atlas trelica read --kind app --query prisma");
    expect(gap.reason).toContain("slopweaver atlas vanta read --kind vendor --query prisma");
    expect(gap.status).toBe("open");
  });

  it("carries the documentation page as the deep link where one exists, and says unavailable where none does", () => {
    const home = scratchHome();
    const paths = prismaDataPlatformAtlasPaths({ home });

    unwrap(syncPrismaDataPlatformSurfaces({ at: AT, paths }));
    const methods = unwrap(readPrismaDataPlatformAtlas({ paths })).files.method!.entities;
    const documented = methods.find((entity) => entity.providerId === "GET /v1/databases")!;
    const undocumented = methods.find((entity) => entity.providerId === "GET /v1/services")!;

    expect(documented.channels.api!.source!.deepLinkStatus).toBe("provider-provided");
    expect(documented.channels.api!.source!.deepLink).toBe(
      "https://www.prisma.io/docs/rest-api/endpoints/databases/get-databases",
    );
    expect(undocumented.channels.api!.source!.deepLinkStatus).toBe("unavailable");
    expect(undocumented.channels.api!.source!.deepLink).toBe(null);
  });

  // The browser channel arrives late and all at once. A merge that staled by KIND would blank the API
  // surface the first time a walk ran, which is the failure `merge.ts` is channel-scoped to prevent.
  it("keeps a second run idempotent and leaves firstSeenAt where the first run put it", () => {
    const home = scratchHome();
    const paths = prismaDataPlatformAtlasPaths({ home });

    unwrap(syncPrismaDataPlatformSurfaces({ at: AT, paths }));
    unwrap(syncPrismaDataPlatformSurfaces({ at: LATER, paths }));
    const methods = unwrap(readPrismaDataPlatformAtlas({ paths })).files.method!;
    const one = methods.entities.find((entity) => entity.providerId === "GET /v1/databases")!;

    expect(methods.entities.length).toBe(PRISMA_DATA_PLATFORM_SURFACES.length);
    expect(one.channels.api!.firstSeenAt).toBe(AT);
    expect(one.channels.api!.lastSeenAt).toBe(LATER);
  });

  it("archives a generation and installs a complete empty one in its place", () => {
    const home = scratchHome();
    const paths = prismaDataPlatformAtlasPaths({ home });

    unwrap(syncPrismaDataPlatformSurfaces({ at: AT, paths }));
    const outcome = unwrap(resetPrismaDataPlatformAtlas({ at: LATER, paths }));
    const snapshot = unwrap(readPrismaDataPlatformAtlas({ paths }));

    expect(outcome.archivedTo).toContain("_superseded");
    expect(snapshot.missing).toEqual([]);
    expect(snapshot.files.method!.entities).toEqual([]);
  });

  it("reports the absent authorization endpoints rather than dropping them", () => {
    const home = scratchHome();
    const paths = prismaDataPlatformAtlasPaths({ home });

    unwrap(syncPrismaDataPlatformSurfaces({ at: AT, paths }));
    const endpoints = unwrap(readPrismaDataPlatformAtlas({ paths })).files["oauth-endpoint"]!.entities;
    const absent = endpoints.find((entity) => entity.providerId === "/.well-known/openid-configuration")!;

    expect(prismaAbsentAuthEndpoints().length).toBe(3);
    expect(absent.channels.api!.source!.deepLink).toBe(null);
    expect(absent.channels.api!.source!.deepLinkStatus).toBe("unavailable");
  });
});
