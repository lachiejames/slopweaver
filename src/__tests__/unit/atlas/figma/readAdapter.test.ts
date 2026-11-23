/**
 * What the Figma read view says about each kind, read off a published generation, and what it says before
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
  emptyFigmaKindFile,
  FIGMA_ATLAS_PLATFORM,
  type FigmaAtlasEntity,
  initialFigmaManifest,
} from "../../../../atlas/figma/model.js";
import { readFigmaSnapshot } from "../../../../atlas/figma/readAdapter.js";
import { figmaAtlasPaths, publishFigmaAtlas } from "../../../../atlas/figma/store.js";
import { unwrap } from "../../../../lib/result.js";

const SEEN_AT = "2026-10-10T00:00:00.000Z";
const AT = "2026-10-12T05:00:00.000Z";
const BLOCK = { at: AT, detail: "403 on the team's files", unblockedBy: "a token with file_content:read" };

const homes: string[] = [];

/** A throwaway state home this file owns and removes. */
function scratchHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-figma-read-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** One `file` entity seen through the api channel, under the scope given. */
function fileEntity({ id, scope }: { id: string; scope: string | null }): FigmaAtlasEntity {
  return {
    channels: {
      api: { channel: "api", detail: null, firstSeenAt: SEEN_AT, lastSeenAt: AT, source: null, state: "observed" },
      browser: null,
    },
    id,
    kind: "file",
    providerId: id,
    scope,
  };
}

/** Publish a generation whose `file` kind holds a scoped and an unscoped entity and a blocked, failed attempt. */
function seedGeneration({ home }: { home: string }): void {
  const manifest = initialFigmaManifest({ updatedAt: AT });
  unwrap(
    publishFigmaAtlas({
      derivedFrom: null,
      files: {
        file: {
          ...emptyFigmaKindFile({ kind: "file", updatedAt: AT }),
          entities: [
            fileEntity({ id: "fileScoped", scope: "project/42" }),
            fileEntity({ id: "fileUnscoped", scope: null }),
          ],
        },
      },
      manifest: {
        ...manifest,
        kinds: {
          ...manifest.kinds,
          file: {
            digest: null,
            entityCount: 2,
            lastAttempt: { at: AT, outcome: "failed", reasons: ["403"] },
            lastSuccessAt: SEEN_AT,
            permissionBlocked: BLOCK,
          },
        },
      },
      paths: figmaAtlasPaths({ home }),
    }),
  );
}

describe("readFigmaSnapshot", () => {
  it("reads an unpublished store as never synced, with no generation stamp", () => {
    const snapshot = unwrap(readFigmaSnapshot({ home: scratchHome() }));
    expect(snapshot.generation.updatedAt).toBeNull();
    const file = snapshot.kinds.find((kind) => kind.kind === "file")!;
    expect({
      lastSuccessAt: file.lastSuccessAt,
      latestAttemptFailed: file.latestAttemptFailed,
      permissionBlocked: file.permissionBlocked,
      publishedCount: file.publishedCount,
    }).toStrictEqual({ lastSuccessAt: null, latestAttemptFailed: false, permissionBlocked: null, publishedCount: 0 });
  });

  it("reads every status field of a kind off the manifest", () => {
    const home = scratchHome();
    seedGeneration({ home });
    const snapshot = unwrap(readFigmaSnapshot({ home }));
    expect(snapshot.generation.updatedAt).toBe(AT);
    const file = snapshot.kinds.find((kind) => kind.kind === "file")!;
    expect({
      lastSuccessAt: file.lastSuccessAt,
      latestAttemptFailed: file.latestAttemptFailed,
      permissionBlocked: file.permissionBlocked,
      publishedCount: file.publishedCount,
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
    const comment = unwrap(readFigmaSnapshot({ home })).kinds.find((kind) => kind.kind === "comment")!;
    expect(comment.permissionBlocked).toBeNull();
    expect(comment.lastSuccessAt).toBeNull();
    expect(comment.publishedCount).toBe(0);
  });

  it("scopes an entity under its own project, and a platform-level row under the platform", () => {
    const home = scratchHome();
    seedGeneration({ home });
    const file = unwrap(readFigmaSnapshot({ home })).kinds.find((kind) => kind.kind === "file")!;
    expect(file.entities.map((entity) => [entity.id, entity.scope])).toStrictEqual([
      ["fileScoped", "project/42"],
      ["fileUnscoped", FIGMA_ATLAS_PLATFORM],
    ]);
  });
});
