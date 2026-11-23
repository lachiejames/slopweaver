import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CANVA_ATLAS_KINDS, emptyCanvaKindFile, initialCanvaManifest } from "../../../../atlas/canva/model.js";
import { emptyCanvaFiles, resetCanvaAtlas } from "../../../../atlas/canva/reset.js";
import {
  type CanvaAtlasPaths,
  canvaAtlasPaths,
  publishCanvaAtlas,
  readCanvaKindFile,
  readCanvaManifest,
} from "../../../../atlas/canva/store.js";
import { unwrap } from "../../../../lib/result.js";

const SEED_AT = "2026-10-01T00:00:00.000Z";
const AT = "2026-10-12T05:30:00.000Z";
const ARCHIVE_ID = "2026-10-12T05-30-00.000Z";

const homes: string[] = [];

/** Makes a throwaway state home, so nothing here touches the ambient one. */
const scratchHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-canva-reset-"));
  homes.push(home);
  return home;
};

/** Publishes a current generation holding one empty `analytics` file at the seed instant. */
function seedGeneration({ paths }: { paths: CanvaAtlasPaths }): void {
  unwrap(
    publishCanvaAtlas({
      derivedFrom: null,
      files: { analytics: emptyCanvaKindFile({ kind: "analytics", updatedAt: SEED_AT }) },
      manifest: initialCanvaManifest({ updatedAt: SEED_AT }),
      paths,
    }),
  );
}

/** Reads every declared kind back through the reader and projects the fields a reset must have emptied. */
function readEveryKind({ paths }: { paths: CanvaAtlasPaths }): readonly {
  coverage: unknown;
  entities: unknown;
  gaps: unknown;
  kind: string;
  updatedAt: string;
}[] {
  return CANVA_ATLAS_KINDS.map((declared) => {
    const file = unwrap(readCanvaKindFile({ kind: declared, paths }))!;
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

describe("resetCanvaAtlas", () => {
  // Regression: a reset that deleted, or archived under another id, would lose the generation it replaced.
  it("archives the seeded generation under the id derived from the reset instant", () => {
    const paths = canvaAtlasPaths({ home: scratchHome() });
    seedGeneration({ paths });

    const outcome = unwrap(resetCanvaAtlas({ at: AT, paths }));

    expect(outcome.archiveId).toBe(ARCHIVE_ID);
    expect(outcome.archivedTo).toBe(join(paths.superseded, ARCHIVE_ID));
    expect(existsSync(outcome.archivedTo)).toBe(true);
    const archivedKindFile = join(outcome.archivedTo, relative(paths.directory, paths.kinds.analytics));
    expect(readFileSync(archivedKindFile, "utf8")).toContain(SEED_AT);
  });

  // Regression: `byCanvaKind` or the wrapper dropping `page`/`user` leaves that kind's file missing, and a
  // wrong timestamp leaves a stale clock; an exact list over the authoritative tuple catches both.
  it("installs an empty file for every declared kind, each stamped at the reset instant", () => {
    const paths = canvaAtlasPaths({ home: scratchHome() });
    seedGeneration({ paths });
    unwrap(resetCanvaAtlas({ at: AT, paths }));

    expect(CANVA_ATLAS_KINDS.length).toBeGreaterThan(0);
    expect(readEveryKind({ paths })).toStrictEqual(
      CANVA_ATLAS_KINDS.map((declared) => ({
        coverage: [],
        entities: [],
        gaps: [],
        kind: declared,
        updatedAt: AT,
      })),
    );
  });

  // Regression: `emptyCanvaFiles` is exported and also feeds the publish; a builder that diverged from the
  // declared tuple would name a different key set than the tuple.
  it("builds exactly one empty file per declared kind", () => {
    const files = emptyCanvaFiles({ at: AT });

    expect(Object.keys(files).toSorted()).toStrictEqual(CANVA_ATLAS_KINDS.toSorted());
  });

  // Regression: a reset that kept the old manifest would carry the seed clock forward.
  it("installs the initial manifest stamped at the reset instant, with every kind graded empty", () => {
    const paths = canvaAtlasPaths({ home: scratchHome() });
    seedGeneration({ paths });
    unwrap(resetCanvaAtlas({ at: AT, paths }));

    const manifest = unwrap(readCanvaManifest({ paths }))!;

    expect(manifest.updatedAt).toBe(AT);
    expect(CANVA_ATLAS_KINDS.map((declared) => manifest.kinds[declared].entityCount)).toStrictEqual(
      CANVA_ATLAS_KINDS.map(() => 0),
    );
    expect(CANVA_ATLAS_KINDS.map((declared) => manifest.kinds[declared].lastSuccessAt)).toStrictEqual(
      CANVA_ATLAS_KINDS.map(() => null),
    );
  });
});
