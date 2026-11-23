import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  emptyOnepasswordKindFile,
  initialOnepasswordManifest,
  ONEPASSWORD_KINDS,
  type OnepasswordKind,
} from "../../../../atlas/onepassword/model.js";
import { resetOnepasswordAtlas } from "../../../../atlas/onepassword/reset.js";
import {
  type OnepasswordAtlasPaths,
  onepasswordAtlasPaths,
  publishOnepasswordAtlas,
  readOnepasswordAtlas,
} from "../../../../atlas/onepassword/store.js";
import { unwrap } from "../../../../lib/result.js";

const SEED_AT = "2026-09-06T01:00:00.000Z";
const AT = "2026-09-07T01:00:00.000Z";

const homes: string[] = [];

/** Makes a throwaway state home under the OS temp directory and records it for removal after the test. */
const scratchHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-onepassword-reset-"));
  homes.push(home);
  return home;
};

/** Publishes a prior generation with one empty `user` file at SEED_AT, through the sensitivity-gated publisher. */
function seedPriorGeneration({ paths }: { paths: OnepasswordAtlasPaths }): void {
  unwrap(
    publishOnepasswordAtlas({
      denylist: [],
      derivedFrom: null,
      files: { user: emptyOnepasswordKindFile({ kind: "user", updatedAt: SEED_AT }) },
      manifest: initialOnepasswordManifest({ updatedAt: SEED_AT }),
      paths,
    }),
  );
}

/** Reads every declared kind back from disk and returns each one's contents and stamp, in declaration order. */
function readEveryKind({
  paths,
}: {
  paths: OnepasswordAtlasPaths;
}): readonly { kind: OnepasswordKind; entities: unknown; coverage: unknown; gaps: unknown; updatedAt: string }[] {
  const snapshot = unwrap(readOnepasswordAtlas({ paths }));
  return ONEPASSWORD_KINDS.map((kind) => {
    const file = snapshot.files[kind]!;
    return { kind, entities: file.entities, coverage: file.coverage, gaps: file.gaps, updatedAt: file.updatedAt };
  });
}

afterEach(() => {
  while (homes.length > 0) {
    rmSync(homes.pop()!, { force: true, recursive: true });
  }
});

describe("resetOnepasswordAtlas", () => {
  // Regression: the archive id is derived some other way, or the generation is deleted rather than renamed.
  it("archives the prior generation under the colon-free instant of the reset", () => {
    const paths = onepasswordAtlasPaths({ home: scratchHome() });
    seedPriorGeneration({ paths });

    const outcome = unwrap(resetOnepasswordAtlas({ at: AT, paths }));

    expect(outcome.archiveId).toBe("2026-09-07T01-00-00.000Z");
    expect(outcome.archivedTo).toBe(join(paths.superseded, "2026-09-07T01-00-00.000Z"));
    expect(existsSync(outcome.archivedTo)).toBe(true);
  });

  // Regression: `vault-grant` or `group-member` (or any kind) is left out of the empty map, or the dynamic
  // spec is built over different files than the ones published, so the sensitivity-gated publish fails.
  it("installs an empty file for all seven kinds, each stamped with the reset instant", () => {
    const paths = onepasswordAtlasPaths({ home: scratchHome() });
    seedPriorGeneration({ paths });
    unwrap(resetOnepasswordAtlas({ at: AT, paths }));

    expect(ONEPASSWORD_KINDS.length).toBe(7);
    expect(ONEPASSWORD_KINDS.filter((kind) => !existsSync(paths.kinds[kind]))).toStrictEqual([]);
    expect(readEveryKind({ paths })).toStrictEqual(
      ONEPASSWORD_KINDS.map((kind) => ({ kind, entities: [], coverage: [], gaps: [], updatedAt: AT })),
    );
  });

  // Regression: the fresh manifest is the old one carried over, so its stamp stays at SEED_AT.
  it("stamps the fresh manifest with the reset instant", () => {
    const paths = onepasswordAtlasPaths({ home: scratchHome() });
    seedPriorGeneration({ paths });
    unwrap(resetOnepasswordAtlas({ at: AT, paths }));

    expect(unwrap(readOnepasswordAtlas({ paths })).manifest!.updatedAt).toBe(AT);
  });
});
