import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { emptyJumpcloudKindFile, initialJumpcloudManifest } from "../../../../atlas/jumpcloud/entities.js";
import { JUMPCLOUD_KINDS } from "../../../../atlas/jumpcloud/model.js";
import {
  emptyJumpcloudFiles,
  type JumpcloudResetOutcome,
  resetJumpcloudAtlas,
} from "../../../../atlas/jumpcloud/reset.js";
import { jumpcloudResumePath } from "../../../../atlas/jumpcloud/resume.js";
import {
  type JumpcloudAtlasPaths,
  type JumpcloudAtlasSnapshot,
  jumpcloudAtlasPaths,
  publishJumpcloudAtlas,
  readJumpcloudAtlas,
} from "../../../../atlas/jumpcloud/store.js";
import { unwrap } from "../../../../lib/result.js";

const SEED_AT = "2026-10-01T00:00:00.000Z";
const AT = "2026-10-12T05:00:00.000Z";
const ARCHIVE_ID = "2026-10-12T05-00-00.000Z";
const JOURNAL_BYTES = '{"key":"sentinel-call","note":"journalled against the archived generation"}\n';

const homes: string[] = [];

/** Mint a throwaway state home that the afterEach removes, so nothing here touches the ambient one. */
const scratchHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-jumpcloud-reset-"));
  homes.push(home);
  return home;
};

/**
 * Publish a seed generation holding ONE accessrequests file and a manifest that records a successful attempt.
 *
 * The recorded attempt is what lets a test tell a fresh manifest from a carried-over one.
 */
function seedGeneration({ paths }: { paths: JumpcloudAtlasPaths }): void {
  const manifest = initialJumpcloudManifest({ updatedAt: SEED_AT });
  unwrap(
    publishJumpcloudAtlas({
      derivedFrom: null,
      files: { accessrequests: emptyJumpcloudKindFile({ kind: "accessrequests", updatedAt: SEED_AT }) },
      manifest: {
        ...manifest,
        kinds: {
          ...manifest.kinds,
          accessrequests: {
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

describe("resetJumpcloudAtlas", () => {
  // The three cases that only INSPECT a seeded-then-reset home share one, reset once: a reset installs an
  // empty file for every declared kind, and doing that per case was most of this file's time. Nothing below
  // writes into it; the journal case, which seeds a different home, still mints its own.
  let sharedHome = "";
  let paths: JumpcloudAtlasPaths;
  let outcome: JumpcloudResetOutcome;
  let snapshot: JumpcloudAtlasSnapshot;
  beforeAll(() => {
    sharedHome = mkdtempSync(join(tmpdir(), "slopweaver-jumpcloud-reset-shared-"));
    paths = jumpcloudAtlasPaths({ home: sharedHome });
    seedGeneration({ paths });
    outcome = unwrap(resetJumpcloudAtlas({ at: AT, paths }));
    snapshot = unwrap(readJumpcloudAtlas({ paths }));
  });
  afterAll(() => {
    rmSync(sharedHome, { force: true, recursive: true });
  });

  it("archives the seeded generation under the colon-free instant of the reset", () => {
    // Regression: an archive id derived from anything but `at`, or a reset that deleted instead of moving.
    expect(outcome.archiveId).toBe(ARCHIVE_ID);
    expect(outcome.archivedTo).toBe(join(paths.superseded, ARCHIVE_ID));
    expect(existsSync(outcome.archivedTo)).toBe(true);
    expect(readdirSync(outcome.archivedTo).toSorted()).toStrictEqual(["accessrequests.jsonl", "manifest.json"]);
  });

  it("installs an empty, reset-stamped file for every declared kind", () => {
    const observed = JUMPCLOUD_KINDS.map((kind) => ({
      coverage: snapshot.files[kind]!.coverage,
      entities: snapshot.files[kind]!.entities,
      gaps: snapshot.files[kind]!.gaps,
      kind,
      updatedAt: snapshot.files[kind]!.updatedAt,
    }));

    // Regression: a newly declared kind missing from the empty map (its file would be absent), or a file
    // stamped with the seed instant instead of the reset one.
    expect(JUMPCLOUD_KINDS.length).toBeGreaterThan(0);
    expect(observed).toStrictEqual(
      JUMPCLOUD_KINDS.map((kind) => ({ coverage: [], entities: [], gaps: [], kind, updatedAt: AT })),
    );
    expect(snapshot.missing).toStrictEqual([]);
    expect(snapshot.mismatched).toStrictEqual([]);
  });

  it("replaces the manifest with a never-attempted one stamped at the reset instant", () => {
    const manifest = snapshot.manifest!;

    // Regression: a reset that re-published the seed manifest, carrying the accessrequests success forward
    // over a store that holds nothing.
    expect(manifest.updatedAt).toBe(AT);
    expect(
      JUMPCLOUD_KINDS.map((kind) => ({
        entityCount: manifest.kinds[kind].entityCount,
        lastAttempt: manifest.kinds[kind].lastAttempt,
        lastSuccessAt: manifest.kinds[kind].lastSuccessAt,
      })),
    ).toStrictEqual(JUMPCLOUD_KINDS.map(() => ({ entityCount: 0, lastAttempt: null, lastSuccessAt: null })));
  });

  // Owner decision: the journal goes WITH the archived generation. Nothing is deleted after the reset's lock
  // is released, so a sync started in that gap owns the only journal at the live path.
  it("moves the resume journal into the archive with its exact bytes and leaves none live", () => {
    const ownPaths = jumpcloudAtlasPaths({ home: scratchHome() });
    seedGeneration({ paths: ownPaths });
    const journalPath = jumpcloudResumePath({ directory: ownPaths.directory });
    writeFileSync(journalPath, JOURNAL_BYTES);

    const ownOutcome = unwrap(resetJumpcloudAtlas({ at: AT, paths: ownPaths }));

    // Regression: a journal left at the live path (it would resume a sync into the emptied store), or one
    // deleted rather than archived.
    expect(readFileSync(join(ownOutcome.archivedTo, basename(journalPath)), "utf8")).toBe(JOURNAL_BYTES);
    expect(existsSync(journalPath)).toBe(false);
  });

  it("builds exactly one empty file per declared kind, each stamped with the given instant", () => {
    const files = emptyJumpcloudFiles({ at: AT });

    // Regression: the map built from a hand-listed subset of kinds rather than the authoritative tuple.
    expect(Object.keys(files).toSorted()).toStrictEqual([...JUMPCLOUD_KINDS].toSorted());
    expect(JUMPCLOUD_KINDS.map((kind) => files[kind].updatedAt)).toStrictEqual(JUMPCLOUD_KINDS.map(() => AT));
  });
});
