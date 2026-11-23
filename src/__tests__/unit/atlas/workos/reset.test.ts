import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  emptyWorkosKindFile,
  initialWorkosManifest,
  WORKOS_ATLAS_KINDS,
  type WorkosAtlasKind,
} from "../../../../atlas/workos/model.js";
import { resetWorkosAtlas } from "../../../../atlas/workos/reset.js";
import {
  publishWorkosAtlas,
  readWorkosAtlas,
  type WorkosAtlasPaths,
  workosAtlasPaths,
  workosPageArtifactPath,
} from "../../../../atlas/workos/store.js";
import { unwrap } from "../../../../lib/result.js";

const SEED_AT = "2026-09-06T01:00:00.000Z";
const AT = "2026-09-07T01:00:00.000Z";
const SENTINEL_SHA = "0".repeat(64);
const SENTINEL_BYTES = "dashboard-screenshot-sentinel-bytes";

const homes: string[] = [];

/** Makes a throwaway state home under the OS temp directory and records it for removal after the test. */
const scratchHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-workos-reset-"));
  homes.push(home);
  return home;
};

/** Publishes a prior generation with one empty `organization` file at SEED_AT. */
function seedPriorGeneration({ paths }: { paths: WorkosAtlasPaths }): void {
  unwrap(
    publishWorkosAtlas({
      derivedFrom: null,
      files: { organization: emptyWorkosKindFile({ kind: "organization", updatedAt: SEED_AT }) },
      manifest: initialWorkosManifest({ updatedAt: SEED_AT }),
      paths,
    }),
  );
}

/** Reads every declared kind back from disk and returns each one's contents and stamp, in declaration order. */
function readEveryKind({
  paths,
}: {
  paths: WorkosAtlasPaths;
}): readonly { kind: WorkosAtlasKind; entities: unknown; coverage: unknown; gaps: unknown; updatedAt: string }[] {
  const snapshot = unwrap(readWorkosAtlas({ paths }));
  return WORKOS_ATLAS_KINDS.map((kind) => {
    const file = snapshot.files[kind]!;
    return { kind, entities: file.entities, coverage: file.coverage, gaps: file.gaps, updatedAt: file.updatedAt };
  });
}

afterEach(() => {
  while (homes.length > 0) {
    rmSync(homes.pop()!, { force: true, recursive: true });
  }
});

describe("resetWorkosAtlas", () => {
  // Regression: the archive id is derived some other way, or the generation is deleted rather than renamed.
  it("archives the prior generation under the colon-free instant of the reset", () => {
    const paths = workosAtlasPaths({ home: scratchHome() });
    seedPriorGeneration({ paths });

    const outcome = unwrap(resetWorkosAtlas({ at: AT, paths }));

    expect(outcome.archiveId).toBe("2026-09-07T01-00-00.000Z");
    expect(outcome.archivedTo).toBe(join(paths.superseded, "2026-09-07T01-00-00.000Z"));
    expect(existsSync(outcome.archivedTo)).toBe(true);
  });

  // Regression: one API entity kind is omitted while browser `page` remains (or the reverse), or an old kind
  // file is reused with its SEED_AT stamp.
  it("installs an empty file for all six kinds, each stamped with the reset instant", () => {
    const paths = workosAtlasPaths({ home: scratchHome() });
    seedPriorGeneration({ paths });
    unwrap(resetWorkosAtlas({ at: AT, paths }));

    expect(WORKOS_ATLAS_KINDS.length).toBe(6);
    expect(WORKOS_ATLAS_KINDS.filter((kind) => !existsSync(paths.kinds[kind]))).toStrictEqual([]);
    expect(readEveryKind({ paths })).toStrictEqual(
      WORKOS_ATLAS_KINDS.map((kind) => ({ kind, entities: [], coverage: [], gaps: [], updatedAt: AT })),
    );
  });

  // Regression: the fresh manifest is the old one carried over, so its stamp stays at SEED_AT.
  it("stamps the fresh manifest with the reset instant", () => {
    const paths = workosAtlasPaths({ home: scratchHome() });
    seedPriorGeneration({ paths });
    unwrap(resetWorkosAtlas({ at: AT, paths }));

    expect(unwrap(readWorkosAtlas({ paths })).manifest!.updatedAt).toBe(AT);
  });

  // Regression: the artifact directory is left behind at the live path (or deleted), so the fresh generation
  // still serves artifacts its empty records do not reference or the archived records lose their proofs.
  it("moves dashboard screenshots into the archive with the generation and leaves none live", () => {
    const paths = workosAtlasPaths({ home: scratchHome() });
    seedPriorGeneration({ paths });
    const relative = workosPageArtifactPath({ sha256: SENTINEL_SHA });
    mkdirSync(paths.pageArtifacts, { recursive: true });
    writeFileSync(join(paths.pageArtifacts, `${SENTINEL_SHA}.png`), SENTINEL_BYTES);

    const outcome = unwrap(resetWorkosAtlas({ at: AT, paths }));

    expect(readFileSync(join(outcome.archivedTo, relative), "utf8")).toBe(SENTINEL_BYTES);
    expect(existsSync(join(paths.directory, relative))).toBe(false);
    expect(existsSync(paths.pageArtifacts)).toBe(false);
  });
});
