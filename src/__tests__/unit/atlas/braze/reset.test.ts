import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { BRAZE_KINDS, emptyBrazeKindFile, initialBrazeManifest } from "../../../../atlas/braze/model.js";
import { resetBrazeAtlas } from "../../../../atlas/braze/reset.js";
import { brazeDocsCachePath } from "../../../../atlas/braze/specSource.js";
import {
  type BrazeAtlasPaths,
  brazeAtlasPaths,
  publishBrazeAtlas,
  readBrazeKindFile,
  readBrazeManifest,
} from "../../../../atlas/braze/store.js";
import { unwrap } from "../../../../lib/result.js";

const SEED_AT = "2026-10-01T00:00:00.000Z";
const AT = "2026-10-12T05:30:00.000Z";
const ARCHIVE_ID = "2026-10-12T05-30-00.000Z";
const CACHE_BYTES = '{"cached":"rows"}';

const homes: string[] = [];

/** Makes a throwaway state home, so nothing here touches the ambient one. */
const scratchHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-braze-reset-"));
  homes.push(home);
  return home;
};

/** Publishes a current generation holding one empty `apps` file at the seed instant. */
function seedGeneration({ paths }: { paths: BrazeAtlasPaths }): void {
  unwrap(
    publishBrazeAtlas({
      derivedFrom: null,
      files: { apps: emptyBrazeKindFile({ kind: "apps", updatedAt: SEED_AT }) },
      manifest: initialBrazeManifest({ updatedAt: SEED_AT }),
      paths,
    }),
  );
}

/** Reads every declared kind back through the reader and projects the fields a reset must have emptied. */
function readEveryKind({ paths }: { paths: BrazeAtlasPaths }): readonly {
  coverage: unknown;
  entities: unknown;
  gaps: unknown;
  kind: string;
  updatedAt: string;
}[] {
  return BRAZE_KINDS.map((declared) => {
    const file = unwrap(readBrazeKindFile({ kind: declared, paths }))!;
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

describe("resetBrazeAtlas", () => {
  // Regression: a reset that deleted, or archived under another id, would lose the generation it replaced.
  it("archives the seeded generation under the id derived from the reset instant", () => {
    const paths = brazeAtlasPaths({ home: scratchHome() });
    seedGeneration({ paths });

    const outcome = unwrap(resetBrazeAtlas({ at: AT, paths }));

    expect(outcome.archiveId).toBe(ARCHIVE_ID);
    expect(outcome.archivedTo).toBe(join(paths.superseded, ARCHIVE_ID));
    expect(existsSync(outcome.archivedTo)).toBe(true);
    const archivedKindFile = join(outcome.archivedTo, relative(paths.directory, paths.kinds.apps));
    expect(readFileSync(archivedKindFile, "utf8")).toContain(SEED_AT);
  });

  // Regression: a hand-edited builder that loses `undocumented`/`page`, or publishes only the common API
  // families, leaves those files missing; a wrong timestamp leaves a stale clock.
  it("installs an empty file for every declared kind, each stamped at the reset instant", () => {
    const paths = brazeAtlasPaths({ home: scratchHome() });
    seedGeneration({ paths });
    unwrap(resetBrazeAtlas({ at: AT, paths }));

    expect(BRAZE_KINDS.length).toBeGreaterThan(0);
    expect(readEveryKind({ paths })).toStrictEqual(
      BRAZE_KINDS.map((declared) => ({
        coverage: [],
        entities: [],
        gaps: [],
        kind: declared,
        updatedAt: AT,
      })),
    );
  });

  // Regression: a manifest stamped at a different instant than the files would carry the seed clock forward.
  it("installs the initial manifest stamped at the reset instant, with every kind graded empty", () => {
    const paths = brazeAtlasPaths({ home: scratchHome() });
    seedGeneration({ paths });
    unwrap(resetBrazeAtlas({ at: AT, paths }));

    const manifest = unwrap(readBrazeManifest({ paths }))!;

    expect(manifest.updatedAt).toBe(AT);
    expect(BRAZE_KINDS.map((declared) => manifest.kinds[declared].entityCount)).toStrictEqual(BRAZE_KINDS.map(() => 0));
  });

  // Regression: the reset header says the documentation cache goes with the archived generation, so the first
  // sync after a reset refetches every page. A reset that left the cache at the live path would silently
  // reuse rows from the generation it just archived.
  it("archives the documentation row cache with the generation and leaves none at the live path", () => {
    const paths = brazeAtlasPaths({ home: scratchHome() });
    seedGeneration({ paths });
    const liveCache = brazeDocsCachePath({ root: paths.directory });
    mkdirSync(dirname(liveCache), { recursive: true });
    writeFileSync(liveCache, CACHE_BYTES);

    const outcome = unwrap(resetBrazeAtlas({ at: AT, paths }));

    const archivedCache = join(outcome.archivedTo, relative(paths.directory, liveCache));
    expect(readFileSync(archivedCache, "utf8")).toBe(CACHE_BYTES);
    expect(existsSync(liveCache)).toBe(false);
  });
});
