import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FIGMA_ATLAS_KINDS } from "../../../../atlas/figma/kinds.js";
import { emptyFigmaKindFile, initialFigmaManifest } from "../../../../atlas/figma/model.js";
import { resetFigmaAtlas } from "../../../../atlas/figma/reset.js";
import {
  type FigmaAtlasPaths,
  figmaAtlasPaths,
  figmaPageArtifactPath,
  publishFigmaAtlas,
  readFigmaAtlas,
} from "../../../../atlas/figma/store.js";
import { unwrap } from "../../../../lib/result.js";

const SEED_AT = "2026-10-01T00:00:00.000Z";
const AT = "2026-10-12T05:00:00.000Z";
const ARCHIVE_ID = "2026-10-12T05-00-00.000Z";
const SCREENSHOT_SHA = "0123456789abcdef";
const SCREENSHOT_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x46, 0x49, 0x47]);

const homes: string[] = [];

/** Mint a throwaway state home that the afterEach removes, so nothing here touches the ambient one. */
const scratchHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-figma-reset-"));
  homes.push(home);
  return home;
};

/**
 * Publish a seed generation holding ONE comment file and a manifest that records a successful comment attempt.
 *
 * The recorded attempt is what lets a test tell a fresh manifest from a carried-over one.
 */
function seedGeneration({ paths }: { paths: FigmaAtlasPaths }): void {
  const manifest = initialFigmaManifest({ updatedAt: SEED_AT });
  unwrap(
    publishFigmaAtlas({
      derivedFrom: null,
      files: { comment: emptyFigmaKindFile({ kind: "comment", updatedAt: SEED_AT }) },
      manifest: {
        ...manifest,
        kinds: {
          ...manifest.kinds,
          comment: {
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

afterEach(() => {
  while (homes.length > 0) {
    rmSync(homes.pop()!, { force: true, recursive: true });
  }
});

describe("resetFigmaAtlas", () => {
  it("archives the seeded generation under the colon-free instant of the reset", () => {
    const paths = figmaAtlasPaths({ home: scratchHome() });
    seedGeneration({ paths });

    const outcome = unwrap(resetFigmaAtlas({ at: AT, paths }));

    // Regression: an archive id derived from anything but `at`, or a reset that deleted instead of moving.
    expect(outcome.archiveId).toBe(ARCHIVE_ID);
    expect(outcome.archivedTo).toBe(join(paths.superseded, ARCHIVE_ID));
    expect(existsSync(outcome.archivedTo)).toBe(true);
    expect(readdirSync(outcome.archivedTo).toSorted()).toStrictEqual(["comments.jsonl", "manifest.json"]);
  });

  it("installs an empty, reset-stamped file for every declared kind, team and person included", () => {
    const paths = figmaAtlasPaths({ home: scratchHome() });
    seedGeneration({ paths });
    unwrap(resetFigmaAtlas({ at: AT, paths }));

    const snapshot = unwrap(readFigmaAtlas({ paths }));
    const observed = FIGMA_ATLAS_KINDS.map((kind) => ({
      coverage: snapshot.files[kind]!.coverage,
      entities: snapshot.files[kind]!.entities,
      gaps: snapshot.files[kind]!.gaps,
      kind,
      updatedAt: snapshot.files[kind]!.updatedAt,
    }));

    // Regression: a reset that followed only the API-generated kinds and dropped `team` or `person` (which
    // have no API operation), or a file stamped with the seed instant instead of the reset one.
    expect(FIGMA_ATLAS_KINDS.length).toBeGreaterThan(0);
    expect(observed).toStrictEqual(
      FIGMA_ATLAS_KINDS.map((kind) => ({ coverage: [], entities: [], gaps: [], kind, updatedAt: AT })),
    );
    expect(snapshot.missing).toStrictEqual([]);
    expect(snapshot.mismatched).toStrictEqual([]);
  });

  it("replaces the manifest with a never-attempted one stamped at the reset instant", () => {
    const paths = figmaAtlasPaths({ home: scratchHome() });
    seedGeneration({ paths });
    unwrap(resetFigmaAtlas({ at: AT, paths }));

    const manifest = unwrap(readFigmaAtlas({ paths })).manifest!;

    // Regression: a reset that re-published the seed manifest, carrying the comment kind's recorded success
    // forward over a store that holds nothing.
    expect(manifest.updatedAt).toBe(AT);
    expect(
      FIGMA_ATLAS_KINDS.map((kind) => ({
        entityCount: manifest.kinds[kind].entityCount,
        lastAttempt: manifest.kinds[kind].lastAttempt,
        lastSuccessAt: manifest.kinds[kind].lastSuccessAt,
      })),
    ).toStrictEqual(FIGMA_ATLAS_KINDS.map(() => ({ entityCount: 0, lastAttempt: null, lastSuccessAt: null })));
  });

  // Owner decision: screenshots are archived WITH the generation that references them, never orphaned live.
  it("moves a page screenshot into the archive at the same relative path and leaves none live", () => {
    const paths = figmaAtlasPaths({ home: scratchHome() });
    seedGeneration({ paths });
    const relative = figmaPageArtifactPath({ sha256: SCREENSHOT_SHA });
    const livePath = join(paths.directory, relative);
    mkdirSync(dirname(livePath), { recursive: true });
    writeFileSync(livePath, SCREENSHOT_BYTES);

    const outcome = unwrap(resetFigmaAtlas({ at: AT, paths }));

    // Regression: a reset that left the screenshot behind at the live path (so the fresh generation
    // references a file its records never wrote), or lost it.
    expect(livePath.startsWith(paths.pageArtifacts)).toBe(true);
    expect(readFileSync(join(outcome.archivedTo, relative))).toStrictEqual(SCREENSHOT_BYTES);
    expect(existsSync(livePath)).toBe(false);
  });
});
