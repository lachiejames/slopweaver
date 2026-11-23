import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { emptyHiveKindFile, HIVE_ATLAS_KINDS, initialHiveManifest } from "../../../../atlas/graphqlHive/model.js";
import { resetHiveAtlas } from "../../../../atlas/graphqlHive/reset.js";
import {
  type HiveAtlasPaths,
  hiveAtlasPaths,
  hivePageArtifactPath,
  hiveSchemaArtifactPath,
  publishHiveAtlas,
  readHiveAtlas,
} from "../../../../atlas/graphqlHive/store.js";
import { unwrap } from "../../../../lib/result.js";

const SEED_AT = "2026-10-01T00:00:00.000Z";
const AT = "2026-10-12T05:00:00.000Z";
const ARCHIVE_ID = "2026-10-12T05-00-00.000Z";
const SCREENSHOT_SHA = "0123456789abcdef";
const SCHEMA_SHA = "fedcba9876543210";
const SCREENSHOT_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x48, 0x49, 0x56]);
const SCHEMA_BYTES = Buffer.from("type Query { sentinel: String }\n", "utf8");

const homes: string[] = [];

/** Mint a throwaway state home that the afterEach removes, so nothing here touches the ambient one. */
const scratchHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-hive-reset-"));
  homes.push(home);
  return home;
};

/**
 * Publish a seed generation holding ONE operation file and a manifest that records a successful operation attempt.
 *
 * The recorded attempt is what lets a test tell a fresh manifest from a carried-over one.
 */
function seedGeneration({ paths }: { paths: HiveAtlasPaths }): void {
  const manifest = initialHiveManifest({ updatedAt: SEED_AT });
  unwrap(
    publishHiveAtlas({
      derivedFrom: null,
      files: { operation: emptyHiveKindFile({ kind: "operation", updatedAt: SEED_AT }) },
      manifest: {
        ...manifest,
        kinds: {
          ...manifest.kinds,
          operation: {
            digest: null,
            entityCount: 0,
            lastAttempt: { at: SEED_AT, outcome: "ok", reasons: [] },
            lastSuccessAt: SEED_AT,
          },
        },
      },
      paths,
    }),
  );
}

/** Write one sentinel file at an atlas-relative path under the live generation root, creating its folders. */
function writeSentinel({ paths, relative, bytes }: { paths: HiveAtlasPaths; relative: string; bytes: Buffer }): string {
  const livePath = join(paths.directory, relative);
  mkdirSync(dirname(livePath), { recursive: true });
  writeFileSync(livePath, bytes);
  return livePath;
}

afterEach(() => {
  while (homes.length > 0) {
    rmSync(homes.pop()!, { force: true, recursive: true });
  }
});

describe("resetHiveAtlas", () => {
  it("archives the seeded generation under the colon-free instant of the reset", () => {
    const paths = hiveAtlasPaths({ home: scratchHome() });
    seedGeneration({ paths });

    const outcome = unwrap(resetHiveAtlas({ at: AT, paths }));

    // Regression: an archive id derived from anything but `at`, or a reset that deleted instead of moving.
    expect(outcome.archiveId).toBe(ARCHIVE_ID);
    expect(outcome.archivedTo).toBe(join(paths.superseded, ARCHIVE_ID));
    expect(existsSync(outcome.archivedTo)).toBe(true);
    expect(readdirSync(outcome.archivedTo).toSorted()).toStrictEqual(["manifest.json", "operations.jsonl"]);
  });

  it("installs an empty, reset-stamped file for every declared kind", () => {
    const paths = hiveAtlasPaths({ home: scratchHome() });
    seedGeneration({ paths });
    unwrap(resetHiveAtlas({ at: AT, paths }));

    const snapshot = unwrap(readHiveAtlas({ paths }));
    const observed = HIVE_ATLAS_KINDS.map((kind) => ({
      coverage: snapshot.files[kind]!.coverage,
      entities: snapshot.files[kind]!.entities,
      gaps: snapshot.files[kind]!.gaps,
      kind,
      updatedAt: snapshot.files[kind]!.updatedAt,
    }));

    // Regression: `target` or `type` dropped from the literal map, or one file stamped with the seed instant
    // instead of the reset one.
    expect(HIVE_ATLAS_KINDS.length).toBeGreaterThan(0);
    expect(observed).toStrictEqual(
      HIVE_ATLAS_KINDS.map((kind) => ({ coverage: [], entities: [], gaps: [], kind, updatedAt: AT })),
    );
    expect(snapshot.missing).toStrictEqual([]);
    expect(snapshot.mismatched).toStrictEqual([]);
  });

  it("replaces the manifest with a never-attempted one stamped at the reset instant", () => {
    const paths = hiveAtlasPaths({ home: scratchHome() });
    seedGeneration({ paths });
    unwrap(resetHiveAtlas({ at: AT, paths }));

    const manifest = unwrap(readHiveAtlas({ paths })).manifest!;

    // Regression: a reset that re-published the seed manifest, carrying the operation kind's recorded success
    // forward over a store that holds nothing.
    expect(manifest.updatedAt).toBe(AT);
    expect(
      HIVE_ATLAS_KINDS.map((kind) => ({
        entityCount: manifest.kinds[kind].entityCount,
        lastAttempt: manifest.kinds[kind].lastAttempt,
        lastSuccessAt: manifest.kinds[kind].lastSuccessAt,
      })),
    ).toStrictEqual(HIVE_ATLAS_KINDS.map(() => ({ entityCount: 0, lastAttempt: null, lastSuccessAt: null })));
  });

  // Owner decision: artifacts are archived WITH the generation that references them, never orphaned live.
  it("moves a page screenshot into the archive at the same relative path and leaves none live", () => {
    const paths = hiveAtlasPaths({ home: scratchHome() });
    seedGeneration({ paths });
    const relative = hivePageArtifactPath({ sha256: SCREENSHOT_SHA });
    const livePath = writeSentinel({ bytes: SCREENSHOT_BYTES, paths, relative });

    const outcome = unwrap(resetHiveAtlas({ at: AT, paths }));

    // Regression: a reset that left the screenshot at the live path or lost it.
    expect(livePath.startsWith(paths.pageArtifacts)).toBe(true);
    expect(readFileSync(join(outcome.archivedTo, relative))).toStrictEqual(SCREENSHOT_BYTES);
    expect(existsSync(livePath)).toBe(false);
  });

  it("moves a composed schema into the archive at the same relative path and leaves none live", () => {
    const paths = hiveAtlasPaths({ home: scratchHome() });
    seedGeneration({ paths });
    const relative = hiveSchemaArtifactPath({ sha256: SCHEMA_SHA });
    const livePath = writeSentinel({ bytes: SCHEMA_BYTES, paths, relative });

    const outcome = unwrap(resetHiveAtlas({ at: AT, paths }));

    // Regression: schema artifacts treated differently from page artifacts (kept live, or dropped).
    expect(livePath.startsWith(paths.schemaArtifacts)).toBe(true);
    expect(readFileSync(join(outcome.archivedTo, relative))).toStrictEqual(SCHEMA_BYTES);
    expect(existsSync(livePath)).toBe(false);
  });
});
