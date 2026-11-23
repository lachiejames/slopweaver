import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { emptyAetherKindFile, initialAetherManifest } from "../../../../atlas/aether/entities.js";
import { AETHER_KINDS } from "../../../../atlas/aether/model.js";
import { resetAetherAtlas } from "../../../../atlas/aether/reset.js";
import {
  type AetherAtlasPaths,
  aetherAtlasPaths,
  publishAetherAtlas,
  readAetherKindFile,
  readAetherManifest,
} from "../../../../atlas/aether/store.js";
import { unwrap } from "../../../../lib/result.js";

const SEED_AT = "2026-10-01T00:00:00.000Z";
const AT = "2026-10-12T05:30:00.000Z";
const ARCHIVE_ID = "2026-10-12T05-30-00.000Z";

const homes: string[] = [];

/** Makes a throwaway state home, so nothing here touches the ambient one. */
const scratchHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-aether-reset-"));
  homes.push(home);
  return home;
};

/** Publishes a current generation holding one empty `project` file at the seed instant. */
function seedGeneration({ paths }: { paths: AetherAtlasPaths }): void {
  unwrap(
    publishAetherAtlas({
      derivedFrom: null,
      files: { project: emptyAetherKindFile({ kind: "project", updatedAt: SEED_AT }) },
      manifest: initialAetherManifest({ updatedAt: SEED_AT }),
      paths,
    }),
  );
}

/** Reads every declared kind back through the reader and projects the fields a reset must have emptied. */
function readEveryKind({ paths }: { paths: AetherAtlasPaths }): readonly {
  coverage: unknown;
  entities: unknown;
  gaps: unknown;
  kind: string;
  updatedAt: string;
}[] {
  return AETHER_KINDS.map((declared) => {
    const file = unwrap(readAetherKindFile({ kind: declared, paths }))!;
    return {
      coverage: file.coverage,
      entities: file.entities,
      gaps: file.gaps,
      kind: file.kind,
      updatedAt: file.updatedAt,
    };
  });
}

afterEach(() => {
  while (homes.length > 0) {
    rmSync(homes.pop()!, { force: true, recursive: true });
  }
});

describe("resetAetherAtlas", () => {
  // Regression: a reset that deleted, or archived under another id, would lose the generation it replaced.
  it("archives the seeded generation under the id derived from the reset instant", () => {
    const paths = aetherAtlasPaths({ home: scratchHome() });
    seedGeneration({ paths });

    const outcome = unwrap(resetAetherAtlas({ at: AT, paths }));

    expect(outcome.archiveId).toBe(ARCHIVE_ID);
    expect(outcome.archivedTo).toBe(join(paths.superseded, ARCHIVE_ID));
    expect(existsSync(outcome.archivedTo)).toBe(true);
    const archivedKindFile = join(outcome.archivedTo, relative(paths.directory, paths.kinds.project));
    expect(readFileSync(archivedKindFile, "utf8")).toContain(SEED_AT);
  });

  // Regression: omitting `page` (or any kind) from the builder leaves that kind's file missing, and a wrong
  // timestamp leaves a stale clock; an exact list over the authoritative tuple catches both.
  it("installs an empty file for every declared kind, each stamped at the reset instant", () => {
    const paths = aetherAtlasPaths({ home: scratchHome() });
    seedGeneration({ paths });
    unwrap(resetAetherAtlas({ at: AT, paths }));

    expect(AETHER_KINDS.length).toBeGreaterThan(0);
    expect(readEveryKind({ paths })).toStrictEqual(
      AETHER_KINDS.map((declared) => ({
        coverage: [],
        entities: [],
        gaps: [],
        kind: declared,
        updatedAt: AT,
      })),
    );
  });

  // Regression: a reset that kept the old manifest, or passed one the Aether publish guard refuses, would
  // either fail here or carry the seed clock forward.
  it("installs the initial manifest stamped at the reset instant, with every kind graded empty", () => {
    const paths = aetherAtlasPaths({ home: scratchHome() });
    seedGeneration({ paths });
    unwrap(resetAetherAtlas({ at: AT, paths }));

    const manifest = unwrap(readAetherManifest({ paths }))!;

    expect(manifest.updatedAt).toBe(AT);
    expect(AETHER_KINDS.map((declared) => manifest.kinds[declared].entityCount)).toStrictEqual(
      AETHER_KINDS.map(() => 0),
    );
    expect(AETHER_KINDS.map((declared) => manifest.kinds[declared].lastSuccessAt)).toStrictEqual(
      AETHER_KINDS.map(() => null),
    );
  });
});
