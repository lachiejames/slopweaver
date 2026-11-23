/**
 * What the Prisma Data Platform read view says about each kind, read off a published generation, and what it
 * says before anything has been published.
 *
 * The manifest is the authority on a kind's synchronisation, so every status field a reader sees is the one
 * the manifest records. A platform-level row carries no scope of its own and reads under the platform.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  emptyPrismaDataPlatformKindFile,
  initialPrismaDataPlatformManifest,
  PRISMA_DATA_PLATFORM_ATLAS_PLATFORM,
  type PrismaDataPlatformEntity,
} from "../../../../atlas/prismaDataPlatform/model.js";
import { readPrismaDataPlatformSnapshot } from "../../../../atlas/prismaDataPlatform/readAdapter.js";
import {
  prismaDataPlatformAtlasPaths,
  publishPrismaDataPlatformAtlas,
} from "../../../../atlas/prismaDataPlatform/store.js";
import { unwrap } from "../../../../lib/result.js";

const SEEN_AT = "2026-10-10T00:00:00.000Z";
const AT = "2026-10-12T05:00:00.000Z";
const BLOCK = { at: AT, detail: "403 listing the workspace's databases", unblockedBy: "a workspace service token" };

const homes: string[] = [];

/** A throwaway state home this file owns and removes. */
function scratchHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-prisma-read-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** One `database` entity seen through the api channel, under the scope given. */
function databaseEntity({ id, scope }: { id: string; scope: string | null }): PrismaDataPlatformEntity {
  return {
    channels: {
      api: { channel: "api", detail: null, firstSeenAt: SEEN_AT, lastSeenAt: AT, source: null, state: "observed" },
      browser: null,
    },
    id,
    kind: "database",
    providerId: id,
    scope,
  };
}

/** Publish a generation whose `database` kind holds a scoped and an unscoped entity and a blocked, failed attempt. */
function seedGeneration({ home }: { home: string }): void {
  const manifest = initialPrismaDataPlatformManifest({ updatedAt: AT });
  unwrap(
    publishPrismaDataPlatformAtlas({
      derivedFrom: null,
      files: {
        database: {
          ...emptyPrismaDataPlatformKindFile({ kind: "database", updatedAt: AT }),
          entities: [
            databaseEntity({ id: "dbScoped", scope: "project/acme" }),
            databaseEntity({ id: "dbUnscoped", scope: null }),
          ],
        },
      },
      manifest: {
        ...manifest,
        kinds: {
          ...manifest.kinds,
          database: {
            digest: null,
            entityCount: 2,
            lastAttempt: { at: AT, outcome: "failed", reasons: ["403"] },
            lastSuccessAt: SEEN_AT,
            permissionBlocked: BLOCK,
          },
        },
      },
      paths: prismaDataPlatformAtlasPaths({ home }),
    }),
  );
}

describe("readPrismaDataPlatformSnapshot", () => {
  it("reads an unpublished store as never synced, with no generation stamp", () => {
    const snapshot = unwrap(readPrismaDataPlatformSnapshot({ home: scratchHome() }));
    expect(snapshot.generation.updatedAt).toBeNull();
    const database = snapshot.kinds.find((kind) => kind.kind === "database")!;
    expect({
      lastSuccessAt: database.lastSuccessAt,
      latestAttemptFailed: database.latestAttemptFailed,
      permissionBlocked: database.permissionBlocked,
      publishedCount: database.publishedCount,
    }).toStrictEqual({ lastSuccessAt: null, latestAttemptFailed: false, permissionBlocked: null, publishedCount: 0 });
  });

  it("reads every status field of a kind off the manifest", () => {
    const home = scratchHome();
    seedGeneration({ home });
    const snapshot = unwrap(readPrismaDataPlatformSnapshot({ home }));
    expect(snapshot.generation.updatedAt).toBe(AT);
    const database = snapshot.kinds.find((kind) => kind.kind === "database")!;
    expect({
      lastSuccessAt: database.lastSuccessAt,
      latestAttemptFailed: database.latestAttemptFailed,
      permissionBlocked: database.permissionBlocked,
      publishedCount: database.publishedCount,
    }).toStrictEqual({
      lastSuccessAt: SEEN_AT,
      latestAttemptFailed: true,
      permissionBlocked: BLOCK,
      publishedCount: 2,
    });
  });

  it("reads a kind whose manifest status carries no permission block as unblocked", () => {
    const home = scratchHome();
    seedGeneration({ home });
    const region = unwrap(readPrismaDataPlatformSnapshot({ home })).kinds.find((kind) => kind.kind === "region")!;
    expect(region.permissionBlocked).toBeNull();
    expect(region.lastSuccessAt).toBeNull();
    expect(region.publishedCount).toBe(0);
  });

  it("scopes an entity under its own project, and a platform-level row under the platform", () => {
    const home = scratchHome();
    seedGeneration({ home });
    const database = unwrap(readPrismaDataPlatformSnapshot({ home })).kinds.find((kind) => kind.kind === "database")!;
    expect(database.entities.map((entity) => [entity.id, entity.scope])).toStrictEqual([
      ["dbScoped", "project/acme"],
      ["dbUnscoped", PRISMA_DATA_PLATFORM_ATLAS_PLATFORM],
    ]);
  });
});
