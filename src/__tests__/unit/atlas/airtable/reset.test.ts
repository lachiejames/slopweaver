import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { AIRTABLE_ATLAS_KINDS } from "../../../../atlas/airtable/kinds.js";
import { emptyAirtableKindFile, initialAirtableManifest } from "../../../../atlas/airtable/model.js";
import { resetAirtableAtlas } from "../../../../atlas/airtable/reset.js";
import {
  type AirtableAtlasPaths,
  airtableAtlasPaths,
  publishAirtableAtlas,
  readAirtableKindFile,
  readAirtableManifest,
} from "../../../../atlas/airtable/store.js";
import { unwrap } from "../../../../lib/result.js";

const SEED_AT = "2026-10-01T00:00:00.000Z";
const AT = "2026-10-12T05:30:00.000Z";
const ARCHIVE_ID = "2026-10-12T05-30-00.000Z";
const SCREENSHOT_BYTES = "not-really-a-png";

const homes: string[] = [];

/** Makes a throwaway state home, so nothing here touches the ambient one. */
const scratchHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-airtable-reset-"));
  homes.push(home);
  return home;
};

/** Publishes a current generation holding one empty `base` file at the seed instant. */
function seedGeneration({ paths }: { paths: AirtableAtlasPaths }): void {
  unwrap(
    publishAirtableAtlas({
      derivedFrom: null,
      files: { base: emptyAirtableKindFile({ kind: "base", updatedAt: SEED_AT }) },
      manifest: initialAirtableManifest({ updatedAt: SEED_AT }),
      paths,
    }),
  );
}

/** Reads every declared kind back through the reader and projects the fields a reset must have emptied. */
function readEveryKind({ paths }: { paths: AirtableAtlasPaths }): readonly {
  coverage: unknown;
  entities: unknown;
  gaps: unknown;
  kind: string;
  updatedAt: string;
}[] {
  return AIRTABLE_ATLAS_KINDS.map((declared) => {
    const file = unwrap(readAirtableKindFile({ kind: declared, paths }))!;
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

describe("resetAirtableAtlas", () => {
  // Regression: a reset that deleted, or archived under another id, would lose the generation it replaced.
  it("archives the seeded generation under the id derived from the reset instant", () => {
    const paths = airtableAtlasPaths({ home: scratchHome() });
    seedGeneration({ paths });

    const outcome = unwrap(resetAirtableAtlas({ at: AT, paths }));

    expect(outcome.archiveId).toBe(ARCHIVE_ID);
    expect(outcome.archivedTo).toBe(join(paths.superseded, ARCHIVE_ID));
    expect(existsSync(outcome.archivedTo)).toBe(true);
    const archivedKindFile = join(outcome.archivedTo, relative(paths.directory, paths.kinds.base));
    expect(readFileSync(archivedKindFile, "utf8")).toContain(SEED_AT);
  });

  // Regression: dropping `record`, `page` or any other declared kind from the empty map leaves that file
  // missing, and a wrong timestamp leaves a stale clock; an exact list over the tuple catches both.
  it("installs an empty file for every declared kind, each stamped at the reset instant", () => {
    const paths = airtableAtlasPaths({ home: scratchHome() });
    seedGeneration({ paths });
    unwrap(resetAirtableAtlas({ at: AT, paths }));

    expect(AIRTABLE_ATLAS_KINDS.length).toBeGreaterThan(0);
    expect(readEveryKind({ paths })).toStrictEqual(
      AIRTABLE_ATLAS_KINDS.map((declared) => ({
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
    const paths = airtableAtlasPaths({ home: scratchHome() });
    seedGeneration({ paths });
    unwrap(resetAirtableAtlas({ at: AT, paths }));

    const manifest = unwrap(readAirtableManifest({ paths }))!;

    expect(manifest.updatedAt).toBe(AT);
    expect(AIRTABLE_ATLAS_KINDS.map((declared) => manifest.kinds[declared].entityCount)).toStrictEqual(
      AIRTABLE_ATLAS_KINDS.map(() => 0),
    );
  });

  // Regression: the reset header says screenshots go with the archived generation. A reset that left them at
  // the live path (or deleted them) would hand the fresh generation proofs its records no longer reference.
  it("archives the screenshot directory with the generation and leaves none at the live path", () => {
    const paths = airtableAtlasPaths({ home: scratchHome() });
    seedGeneration({ paths });
    const liveScreenshot = join(paths.pageArtifacts, "sentinel.png");
    mkdirSync(dirname(liveScreenshot), { recursive: true });
    writeFileSync(liveScreenshot, SCREENSHOT_BYTES);

    const outcome = unwrap(resetAirtableAtlas({ at: AT, paths }));

    const archivedScreenshot = join(outcome.archivedTo, relative(paths.directory, liveScreenshot));
    expect(readFileSync(archivedScreenshot, "utf8")).toBe(SCREENSHOT_BYTES);
    expect(existsSync(liveScreenshot)).toBe(false);
  });
});
