import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  emptyLinearAtlasKindFile,
  initialLinearAtlasManifest,
  LINEAR_ATLAS_KINDS,
  type LinearAtlasKind,
} from "../../../../atlas/linear/model.js";
import { resetLinearAtlas } from "../../../../atlas/linear/reset.js";
import {
  type LinearAtlasPaths,
  linearAtlasPaths,
  publishLinearAtlas,
  readLinearAtlas,
} from "../../../../atlas/linear/store.js";
import { unwrap } from "../../../../lib/result.js";

const SEED_AT = "2026-09-06T01:00:00.000Z";
const AT = "2026-09-07T01:00:00.000Z";

const homes: string[] = [];

/** Makes a throwaway state home under the OS temp directory and records it for removal after the test. */
const scratchHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-linear-reset-"));
  homes.push(home);
  return home;
};

/** Publishes a prior generation bound to "old-workspace" with one empty `operation` file, at SEED_AT. */
function seedPriorGeneration({ paths }: { paths: LinearAtlasPaths }): void {
  unwrap(
    publishLinearAtlas({
      derivedFrom: null,
      files: { operation: emptyLinearAtlasKindFile({ kind: "operation", updatedAt: SEED_AT }) },
      manifest: initialLinearAtlasManifest({ updatedAt: SEED_AT, workspaceId: "old-workspace" }),
      paths,
    }),
  );
}

/** Reads every declared kind back from disk and returns each one's contents and stamp, in declaration order. */
function readEveryKind({
  paths,
}: {
  paths: LinearAtlasPaths;
}): readonly { kind: LinearAtlasKind; entities: unknown; coverage: unknown; gaps: unknown; updatedAt: string }[] {
  const snapshot = unwrap(readLinearAtlas({ paths }));
  return LINEAR_ATLAS_KINDS.map((kind) => {
    const file = snapshot.files[kind]!;
    return { kind, entities: file.entities, coverage: file.coverage, gaps: file.gaps, updatedAt: file.updatedAt };
  });
}

afterEach(() => {
  while (homes.length > 0) {
    rmSync(homes.pop()!, { force: true, recursive: true });
  }
});

describe("resetLinearAtlas", () => {
  // Regression: the archive id is derived some other way, or the generation is deleted rather than renamed.
  it("archives the prior generation under the colon-free instant of the reset", () => {
    const paths = linearAtlasPaths({ home: scratchHome() });
    seedPriorGeneration({ paths });

    const outcome = unwrap(resetLinearAtlas({ at: AT, paths }));

    expect(outcome.archiveId).toBe("2026-09-07T01-00-00.000Z");
    expect(outcome.archivedTo).toBe(join(paths.superseded, "2026-09-07T01-00-00.000Z"));
    expect(existsSync(outcome.archivedTo)).toBe(true);
  });

  // Regression: the old manifest is discarded instead of archived, so the old workspace is unrecoverable.
  it("keeps the old workspace in the archive, where it can still be restored from", () => {
    const paths = linearAtlasPaths({ home: scratchHome() });
    seedPriorGeneration({ paths });

    const outcome = unwrap(resetLinearAtlas({ at: AT, paths }));

    expect(readFileSync(join(outcome.archivedTo, "manifest.json"), "utf8")).toContain('"workspaceId": "old-workspace"');
  });

  // Regression: one declared kind is missing from the installed generation, or the old files are reused so
  // their SEED_AT stamp survives.
  it("installs an empty file for every declared kind, each stamped with the reset instant", () => {
    const paths = linearAtlasPaths({ home: scratchHome() });
    seedPriorGeneration({ paths });
    unwrap(resetLinearAtlas({ at: AT, paths }));

    expect(LINEAR_ATLAS_KINDS.length).toBeGreaterThan(0);
    expect(LINEAR_ATLAS_KINDS.map((kind) => existsSync(paths.kinds[kind]))).toStrictEqual([true, true, true, true]);
    expect(readEveryKind({ paths })).toStrictEqual(
      LINEAR_ATLAS_KINDS.map((kind) => ({ kind, entities: [], coverage: [], gaps: [], updatedAt: AT })),
    );
  });

  // Regression: the fresh manifest is built from the old one, so the next sync stays bound to the old
  // workspace and the workspace guard refuses the new one.
  it("forgets the workspace: the fresh manifest is unbound and stamped with the reset instant", () => {
    const paths = linearAtlasPaths({ home: scratchHome() });
    seedPriorGeneration({ paths });
    unwrap(resetLinearAtlas({ at: AT, paths }));

    const manifest = unwrap(readLinearAtlas({ paths })).manifest!;

    expect(manifest.workspaceId).toBeNull();
    expect(manifest.updatedAt).toBe(AT);
  });
});
