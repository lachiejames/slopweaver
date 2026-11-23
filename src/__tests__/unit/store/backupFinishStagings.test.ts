/**
 * What a run does after its last destination: name per destination what it still lacks (tonight's own staging
 * aside), release the frozen copies of a staging every destination holds and no other, and prune only when told to.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap } from "../../../lib/result.js";
import { type ConfiguredDestination, configuredDestination } from "../../../store/backup/destinationConfig.js";
import { snapshotDirectory } from "../../../store/backup/filesLeg.js";
import { finishStagings } from "../../../store/backup/finishStagings.js";
import { FILES_MANIFEST } from "../../../store/backup/plan.js";
import { writeReceipt } from "../../../store/backup/receipts.js";
import { writeStagingDestinations } from "../../../store/backup/stagingDestinations.js";

const MAC = unwrap(configuredDestination({ address: "/Users/someone/backups" }));
const SSD = unwrap(configuredDestination({ address: "/Volumes/FixtureDrive/backups" }));

const OWED_SSD = "2026-11-06T03-00-00-000Z";
const HELD_BY_BOTH = "2026-11-07T03-00-00-000Z";
const TONIGHT = "2026-11-08T03-00-00-000Z";

const roots: string[] = [];

afterEach(() => {
  roots.splice(0).forEach((root) => {
    rmSync(root, { force: true, recursive: true });
  });
});

/**
 * A staging root holding three finished stagings, each owed to this Mac and the SSD and each carrying its frozen
 * copies: one the SSD never got, one both hold, and tonight's, which the SSD has not got yet either.
 *
 * @returns the root
 */
function threeStagings(): string {
  const root = mkdtempSync(join(tmpdir(), "finish-stagings-"));
  roots.push(root);
  const holders: Record<string, readonly ConfiguredDestination[]> = {
    [HELD_BY_BOTH]: [MAC, SSD],
    [OWED_SSD]: [MAC],
    [TONIGHT]: [MAC],
  };
  for (const [name, held] of Object.entries(holders)) {
    const directory = join(root, name);
    mkdirSync(snapshotDirectory({ directory }), { recursive: true });
    writeFileSync(join(directory, FILES_MANIFEST), "{}");
    writeStagingDestinations({ destinations: [MAC, SSD], directory });
    held.forEach((destination) => {
      writeReceipt({
        destination,
        directory,
        receipt: {
          destination: destination.root,
          encryption: { keyFingerprint: "FIXTURE", scheme: "fixture" },
          objects: [],
          prefix: `slopweaver/${name}/`,
          uploadedAtIso: "2026-11-08T03:00:00.000Z",
        },
      });
    });
  }
  return root;
}

describe("finishStagings", () => {
  it("names what each destination lacks, tonight aside, and releases only what both hold", () => {
    const root = threeStagings();
    const finished = finishStagings({
      destinations: [MAC, SSD],
      keepLocal: 0,
      obligations: [MAC.id, SSD.id],
      prune: false,
      root,
      tonight: TONIGHT,
    });
    expect(finished.stranded.map(({ destination, names }) => [destination.id, names])).toEqual([
      [MAC.id, []],
      [SSD.id, [OWED_SSD]],
    ]);
    expect(finished.released).toEqual([HELD_BY_BOTH]);
    expect(finished.pruned).toEqual([]);
    const snapshots = [OWED_SSD, HELD_BY_BOTH, TONIGHT].map((name) =>
      existsSync(snapshotDirectory({ directory: join(root, name) })),
    );
    expect(snapshots).toEqual([true, false, true]);
  });

  it("names tonight's staging too on a sweep, and prunes only the staging every destination holds", () => {
    const root = threeStagings();
    const finished = finishStagings({
      destinations: [MAC, SSD],
      keepLocal: 0,
      obligations: [MAC.id, SSD.id],
      prune: true,
      root,
      tonight: null,
    });
    expect(finished.stranded[1]!.names).toEqual([OWED_SSD, TONIGHT]);
    expect(finished.pruned).toEqual([HELD_BY_BOTH]);
    expect([OWED_SSD, HELD_BY_BOTH, TONIGHT].map((name) => existsSync(join(root, name)))).toEqual([true, false, true]);
  });

  it("reports a staging the filesystem will not let go rather than throwing, and still finishes the rest", () => {
    const root = threeStagings();
    const locked = join(root, HELD_BY_BOTH);
    chmodSync(locked, 0o555);
    try {
      const finished = finishStagings({
        destinations: [MAC, SSD],
        keepLocal: 0,
        obligations: [MAC.id, SSD.id],
        prune: true,
        root,
        tonight: TONIGHT,
      });
      expect(finished.released).toEqual([]);
      expect(finished.pruned).toEqual([]);
      expect(finished.unremoved.map(({ name }) => name)).toEqual([HELD_BY_BOTH, HELD_BY_BOTH]);
      expect(finished.unremoved[0]!.why).toContain("EACCES");
      expect(finished.stranded[1]!.names).toEqual([OWED_SSD]);
      expect(existsSync(snapshotDirectory({ directory: locked }))).toBe(true);
    } finally {
      chmodSync(locked, 0o755);
    }
  });
});
