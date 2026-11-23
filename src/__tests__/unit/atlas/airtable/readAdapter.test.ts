/**
 * What the Airtable read view says about each kind, read off a published generation, and what it says before
 * anything has been published.
 *
 * The manifest is the authority on a kind's synchronisation, so every status field a reader sees is the one
 * the manifest records. A platform-level row carries no scope of its own and reads under the platform.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  AIRTABLE_ATLAS_PLATFORM,
  type AirtableAtlasEntity,
  emptyAirtableKindFile,
  initialAirtableManifest,
} from "../../../../atlas/airtable/model.js";
import { readAirtableSnapshot } from "../../../../atlas/airtable/readAdapter.js";
import { airtableAtlasPaths, publishAirtableAtlas } from "../../../../atlas/airtable/store.js";
import { unwrap } from "../../../../lib/result.js";

const SEEN_AT = "2026-10-10T00:00:00.000Z";
const AT = "2026-10-12T05:00:00.000Z";
const BLOCK = { at: AT, detail: "403 on the enterprise audit log", unblockedBy: "an enterprise admin token" };

const homes: string[] = [];

/** A throwaway state home this file owns and removes. */
function scratchHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-airtable-read-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** One `table` entity seen through the api channel, under the scope given. */
function tableEntity({ id, scope }: { id: string; scope: string | null }): AirtableAtlasEntity {
  return {
    channels: {
      api: { channel: "api", detail: null, firstSeenAt: SEEN_AT, lastSeenAt: AT, source: null, state: "observed" },
      browser: null,
    },
    id,
    kind: "table",
    providerId: id,
    scope,
  };
}

/** Publish a generation whose `table` kind holds a scoped and an unscoped entity and a blocked, failed attempt. */
function seedGeneration({ home }: { home: string }): void {
  const manifest = initialAirtableManifest({ updatedAt: AT });
  unwrap(
    publishAirtableAtlas({
      derivedFrom: null,
      files: {
        table: {
          ...emptyAirtableKindFile({ kind: "table", updatedAt: AT }),
          entities: [
            tableEntity({ id: "tblScoped", scope: "appBase" }),
            tableEntity({ id: "tblUnscoped", scope: null }),
          ],
        },
      },
      manifest: {
        ...manifest,
        kinds: {
          ...manifest.kinds,
          table: {
            digest: null,
            entityCount: 2,
            lastAttempt: { at: AT, outcome: "failed", reasons: ["403"] },
            lastSuccessAt: SEEN_AT,
            permissionBlocked: BLOCK,
          },
        },
      },
      paths: airtableAtlasPaths({ home }),
    }),
  );
}

describe("readAirtableSnapshot", () => {
  it("reads an unpublished store as never synced, with no generation stamp", () => {
    const snapshot = unwrap(readAirtableSnapshot({ home: scratchHome() }));
    expect(snapshot.generation.updatedAt).toBeNull();
    const table = snapshot.kinds.find((kind) => kind.kind === "table")!;
    expect({
      lastSuccessAt: table.lastSuccessAt,
      latestAttemptFailed: table.latestAttemptFailed,
      permissionBlocked: table.permissionBlocked,
      publishedCount: table.publishedCount,
    }).toStrictEqual({ lastSuccessAt: null, latestAttemptFailed: false, permissionBlocked: null, publishedCount: 0 });
  });

  it("reads every status field of a kind off the manifest", () => {
    const home = scratchHome();
    seedGeneration({ home });
    const snapshot = unwrap(readAirtableSnapshot({ home }));
    expect(snapshot.generation.updatedAt).toBe(AT);
    const table = snapshot.kinds.find((kind) => kind.kind === "table")!;
    expect({
      lastSuccessAt: table.lastSuccessAt,
      latestAttemptFailed: table.latestAttemptFailed,
      permissionBlocked: table.permissionBlocked,
      publishedCount: table.publishedCount,
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
    const base = unwrap(readAirtableSnapshot({ home })).kinds.find((kind) => kind.kind === "base")!;
    expect(base.permissionBlocked).toBeNull();
    expect(base.lastSuccessAt).toBeNull();
    expect(base.publishedCount).toBe(0);
  });

  it("scopes an entity under its own base, and a platform-level row under the platform", () => {
    const home = scratchHome();
    seedGeneration({ home });
    const table = unwrap(readAirtableSnapshot({ home })).kinds.find((kind) => kind.kind === "table")!;
    expect(table.entities.map((entity) => [entity.id, entity.scope])).toStrictEqual([
      ["tblScoped", "appBase"],
      ["tblUnscoped", AIRTABLE_ATLAS_PLATFORM],
    ]);
  });
});
