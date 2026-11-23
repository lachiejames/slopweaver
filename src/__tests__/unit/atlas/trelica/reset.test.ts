import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  emptyTrelicaKindFile,
  initialTrelicaManifest,
  TRELICA_ATLAS_KINDS,
  type TrelicaAtlasKind,
} from "../../../../atlas/trelica/model.js";
import { resetTrelicaAtlas } from "../../../../atlas/trelica/reset.js";
import {
  publishTrelicaAtlas,
  readTrelicaAtlas,
  type TrelicaAtlasPaths,
  trelicaAtlasPaths,
  trelicaPageArtifactPath,
} from "../../../../atlas/trelica/store.js";
import { unwrap } from "../../../../lib/result.js";

const SEED_AT = "2026-09-06T01:00:00.000Z";
const AT = "2026-09-07T01:00:00.000Z";
const SENTINEL_SHA = "0".repeat(64);
const SENTINEL_BYTES = "screenshot-sentinel-bytes";

const homes: string[] = [];

/** Makes a throwaway state home under the OS temp directory and records it for removal after the test. */
const scratchHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-trelica-reset-"));
  homes.push(home);
  return home;
};

/** Publishes a prior generation with one empty `app` file at SEED_AT. */
function seedPriorGeneration({ paths }: { paths: TrelicaAtlasPaths }): void {
  unwrap(
    publishTrelicaAtlas({
      derivedFrom: null,
      files: { app: emptyTrelicaKindFile({ kind: "app", updatedAt: SEED_AT }) },
      manifest: initialTrelicaManifest({ updatedAt: SEED_AT }),
      paths,
    }),
  );
}

/** Reads every declared kind back from disk and returns each one's contents and stamp, in declaration order. */
function readEveryKind({ paths }: { paths: TrelicaAtlasPaths }): readonly {
  kind: TrelicaAtlasKind;
  entities: unknown;
  coverage: unknown;
  gaps: unknown;
  schemaVersion: number;
  updatedAt: string;
}[] {
  const snapshot = unwrap(readTrelicaAtlas({ paths }));
  return TRELICA_ATLAS_KINDS.map((kind) => {
    const file = snapshot.files[kind]!;
    return {
      kind,
      entities: file.entities,
      coverage: file.coverage,
      gaps: file.gaps,
      schemaVersion: file.schemaVersion,
      updatedAt: file.updatedAt,
    };
  });
}

afterEach(() => {
  while (homes.length > 0) {
    rmSync(homes.pop()!, { force: true, recursive: true });
  }
});

describe("resetTrelicaAtlas", () => {
  // Regression: the archive id is derived some other way, or the generation is deleted rather than renamed.
  it("archives the prior generation under the colon-free instant of the reset", () => {
    const paths = trelicaAtlasPaths({ home: scratchHome() });
    seedPriorGeneration({ paths });

    const outcome = unwrap(resetTrelicaAtlas({ at: AT, paths }));

    expect(outcome.archiveId).toBe("2026-09-07T01-00-00.000Z");
    expect(outcome.archivedTo).toBe(join(paths.superseded, "2026-09-07T01-00-00.000Z"));
    expect(existsSync(outcome.archivedTo)).toBe(true);
  });

  // Regression: a kind is omitted from the empty map, or an old kind file is reused with its SEED_AT stamp.
  it("installs an empty schema-3 file for all fifteen kinds, each stamped with the reset instant", () => {
    const paths = trelicaAtlasPaths({ home: scratchHome() });
    seedPriorGeneration({ paths });
    unwrap(resetTrelicaAtlas({ at: AT, paths }));

    expect(TRELICA_ATLAS_KINDS.length).toBe(15);
    expect(TRELICA_ATLAS_KINDS.filter((kind) => !existsSync(paths.kinds[kind]))).toStrictEqual([]);
    expect(readEveryKind({ paths })).toStrictEqual(
      TRELICA_ATLAS_KINDS.map((kind) => ({
        kind,
        entities: [],
        coverage: [],
        gaps: [],
        schemaVersion: 3,
        updatedAt: AT,
      })),
    );
  });

  // Regression: reset publishes an older manifest shape, or carries the old manifest (and its stamp) over.
  it("installs a schema-version-3 manifest stamped with the reset instant", () => {
    const paths = trelicaAtlasPaths({ home: scratchHome() });
    seedPriorGeneration({ paths });
    unwrap(resetTrelicaAtlas({ at: AT, paths }));

    const manifest = unwrap(readTrelicaAtlas({ paths })).manifest!;

    expect(manifest.schemaVersion).toBe(3);
    expect(manifest.updatedAt).toBe(AT);
  });

  // Regression: screenshots are left behind at the live path (or deleted), so the fresh generation either
  // still serves artifacts its empty records do not reference or the archived records lose their proofs.
  it("moves page screenshots into the archive with the generation and leaves none live", () => {
    const paths = trelicaAtlasPaths({ home: scratchHome() });
    seedPriorGeneration({ paths });
    const relative = trelicaPageArtifactPath({ sha256: SENTINEL_SHA });
    mkdirSync(paths.pageArtifacts, { recursive: true });
    writeFileSync(join(paths.pageArtifacts, `${SENTINEL_SHA}.png`), SENTINEL_BYTES);

    const outcome = unwrap(resetTrelicaAtlas({ at: AT, paths }));

    expect(readFileSync(join(outcome.archivedTo, relative), "utf8")).toBe(SENTINEL_BYTES);
    expect(existsSync(join(paths.directory, relative))).toBe(false);
    expect(existsSync(paths.pageArtifacts)).toBe(false);
  });
});
