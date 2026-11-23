import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { emptyCrowdstrikeKindFile, initialCrowdstrikeManifest } from "../../../../atlas/crowdstrike/kindFiles.js";
import { CROWDSTRIKE_KINDS } from "../../../../atlas/crowdstrike/model.js";
import { emptyCrowdstrikeFiles, resetCrowdstrikeAtlas } from "../../../../atlas/crowdstrike/reset.js";
import {
  type CrowdstrikeAtlasPaths,
  crowdstrikeAtlasPaths,
  publishCrowdstrikeAtlas,
  readCrowdstrikeAtlas,
} from "../../../../atlas/crowdstrike/store.js";
import { unwrap } from "../../../../lib/result.js";

const SEED_AT = "2026-10-01T00:00:00.000Z";
const AT = "2026-10-12T05:00:00.000Z";
const ARCHIVE_ID = "2026-10-12T05-00-00.000Z";

const homes: string[] = [];

/** Mint a throwaway state home that the afterEach removes, so nothing here touches the ambient one. */
const scratchHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-crowdstrike-reset-"));
  homes.push(home);
  return home;
};

/**
 * Publish a seed generation holding ONE host file and a manifest that records a successful host attempt.
 *
 * The recorded attempt is what lets a test tell a fresh manifest from a carried-over one.
 */
function seedGeneration({ paths }: { paths: CrowdstrikeAtlasPaths }): void {
  const manifest = initialCrowdstrikeManifest({ updatedAt: SEED_AT });
  unwrap(
    publishCrowdstrikeAtlas({
      derivedFrom: null,
      files: { host: emptyCrowdstrikeKindFile({ kind: "host", updatedAt: SEED_AT }) },
      manifest: {
        ...manifest,
        kinds: {
          ...manifest.kinds,
          host: {
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

describe("resetCrowdstrikeAtlas", () => {
  it("archives the seeded generation under the colon-free instant of the reset", () => {
    const paths = crowdstrikeAtlasPaths({ home: scratchHome() });
    seedGeneration({ paths });

    const outcome = unwrap(resetCrowdstrikeAtlas({ at: AT, paths }));

    // Regression: an archive id derived from anything but `at`, or a reset that deleted instead of moving.
    expect(outcome.archiveId).toBe(ARCHIVE_ID);
    expect(outcome.archivedTo).toBe(join(paths.superseded, ARCHIVE_ID));
    expect(existsSync(outcome.archivedTo)).toBe(true);
    expect(readdirSync(outcome.archivedTo).toSorted()).toStrictEqual(["hosts.jsonl", "manifest.json"]);
  });

  it("installs an empty, reset-stamped file for every declared kind, including both console and zero-trust kinds", () => {
    const paths = crowdstrikeAtlasPaths({ home: scratchHome() });
    seedGeneration({ paths });
    unwrap(resetCrowdstrikeAtlas({ at: AT, paths }));

    const snapshot = unwrap(readCrowdstrikeAtlas({ paths }));
    const observed = CROWDSTRIKE_KINDS.map((kind) => ({
      coverage: snapshot.files[kind]!.coverage,
      entities: snapshot.files[kind]!.entities,
      gaps: snapshot.files[kind]!.gaps,
      kind,
      updatedAt: snapshot.files[kind]!.updatedAt,
    }));

    // Regression: a kind dropped from the empty map (its file would be missing), or a file stamped with the
    // seed instant instead of the reset one.
    expect(CROWDSTRIKE_KINDS.length).toBeGreaterThan(0);
    expect(observed).toStrictEqual(
      CROWDSTRIKE_KINDS.map((kind) => ({ coverage: [], entities: [], gaps: [], kind, updatedAt: AT })),
    );
    expect(snapshot.missing).toStrictEqual([]);
    expect(snapshot.mismatched).toStrictEqual([]);
  });

  it("replaces the manifest with a never-attempted one stamped at the reset instant", () => {
    const paths = crowdstrikeAtlasPaths({ home: scratchHome() });
    seedGeneration({ paths });
    unwrap(resetCrowdstrikeAtlas({ at: AT, paths }));

    const manifest = unwrap(readCrowdstrikeAtlas({ paths })).manifest!;

    // Regression: a reset that re-published the seed manifest, carrying the host's recorded success forward
    // over a store that holds nothing.
    expect(manifest.updatedAt).toBe(AT);
    expect(
      CROWDSTRIKE_KINDS.map((kind) => ({
        entityCount: manifest.kinds[kind].entityCount,
        lastAttempt: manifest.kinds[kind].lastAttempt,
        lastSuccessAt: manifest.kinds[kind].lastSuccessAt,
      })),
    ).toStrictEqual(CROWDSTRIKE_KINDS.map(() => ({ entityCount: 0, lastAttempt: null, lastSuccessAt: null })));
  });

  it("builds exactly one empty file per declared kind, each stamped with the given instant", () => {
    const files = emptyCrowdstrikeFiles({ at: AT });

    // Regression: the map built from a hand-listed subset of kinds rather than the authoritative tuple.
    expect(Object.keys(files).toSorted()).toStrictEqual([...CROWDSTRIKE_KINDS].toSorted());
    expect(CROWDSTRIKE_KINDS.map((kind) => files[kind].updatedAt)).toStrictEqual(CROWDSTRIKE_KINDS.map(() => AT));
  });
});
