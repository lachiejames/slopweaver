/**
 * `store backup --sweep-only`'s lines: one block per destination on the list, in order, and a head that says how many
 * stagings went across how many destinations. Pure functions over report values, no Docker. A sweep writes no
 * `last.json` at all — that half is `backupStatus.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { sweepOnlyLines } from "../../../cli/commands/store/backupLines.js";
import { type ConfiguredDestination, destinationId } from "../../../store/backup/destinationConfig.js";
import type { SweepReport } from "../../../store/backup/sweep.js";
import { StagingSweepErrors } from "../../../store/backup/sweepErrors.js";
import type { SweepOnlyReport } from "../../../store/backup/sweepRun.js";
import type { VolumePin } from "../../../store/backup/volumePin.js";

// A sweep writes no last.json now, so the attempt it used to record left with its cases.
// deleted-with-code: sweepOnlyOutcome

/**
 * A configured destination at a root.
 *
 * @param root the destination root
 * @returns the destination
 */
function at({ root }: { root: string }): ConfiguredDestination {
  return { address: root, id: destinationId({ root }), root };
}

const MAC = at({ root: "/Users/someone/backups" });
const SSD = at({ root: "/Volumes/FixtureDrive/backups" });
const PIN: VolumePin = {
  mountPoint: "/Volumes/FixtureDrive",
  root: SSD.root,
  volumeName: "FixtureDrive",
  volumeUuid: "00000000-0000-4000-8000-0000000000A1",
};
const WRITTEN = { objectName: "slopweaver/keys/631645873f6e085d.wrap", state: "written" } as const;
const EMPTY: SweepReport = { recovered: [], unfinished: [], unrecoverable: [] };

/**
 * A staging the sweep sent.
 *
 * @param name the staging's directory name
 * @returns the recovered staging
 */
function recovered({ name }: { name: string }): SweepReport["recovered"][number] {
  return { directory: `/home/backups/store/${name}`, filesMissing: [], objects: [], prefix: `slopweaver/${name}/` };
}

const DEAD = {
  directory: "/home/backups/store/dead",
  error: StagingSweepErrors.uploadFailed({ directory: "/home/backups/store/dead", problems: ["EPIPE"] }),
};

/**
 * A sweep-only report over the given destinations.
 *
 * @param destinations what became of each
 * @param pruned what finishing pruned
 * @returns the report
 */
function report({
  destinations,
  pruned = [],
}: {
  destinations: SweepOnlyReport["destinations"];
  pruned?: readonly string[];
}): SweepOnlyReport {
  return { destinations, pruned, released: [], stranded: [], unremoved: [] };
}

describe("--sweep-only lines", () => {
  it("prints one block per destination in list order, the drive that is out among them", () => {
    const lines = sweepOnlyLines({
      report: report({
        destinations: [
          {
            destination: MAC,
            report: {
              keyWrap: WRITTEN,
              sweep: { ...EMPTY, recovered: [recovered({ name: "x" })], unrecoverable: [DEAD] },
            },
            status: "swept",
          },
          { destination: SSD, pin: PIN, status: "drive-not-plugged-in" },
        ],
        pruned: ["old"],
      }),
    });
    expect(lines).toEqual([
      "store backup --sweep-only: sent 1 staging(s) across 2 destination(s) — no new dump taken",
      "  /Users/someone/backups: sent 1 staging(s), 1 could not be sent",
      "    backup key wrapped under the master password at slopweaver/keys/631645873f6e085d.wrap",
      "    recovered /home/backups/store/x → slopweaver/x/ (0 object(s))",
      `    could NOT send /home/backups/store/dead — ${DEAD.error.message}`,
      "  /Volumes/FixtureDrive/backups: drive not plugged in at /Volumes/FixtureDrive — nothing sent",
      "  pruned 1 uploaded staged copy: old",
    ]);
  });

  it("says in one line per destination when nothing was waiting for it", () => {
    const lines = sweepOnlyLines({
      report: report({
        destinations: [{ destination: MAC, report: { keyWrap: WRITTEN, sweep: EMPTY }, status: "swept" }],
      }),
    });
    expect(lines).toEqual([
      "store backup --sweep-only: sent 0 staging(s) across 1 destination(s) — no new dump taken",
      "  /Users/someone/backups: no staging is waiting for it — nothing sent",
      "    backup key wrapped under the master password at slopweaver/keys/631645873f6e085d.wrap",
    ]);
  });

  it("says a recovered staging lacks blobs its files.json names, and names every unfinished staging it left", () => {
    const partial = {
      ...recovered({ name: "old" }),
      filesMissing: ["slopweaver/blobs/aa", "slopweaver/chunks/zstd/bb"],
    };
    const lines = sweepOnlyLines({
      report: report({
        destinations: [
          {
            destination: MAC,
            report: {
              keyWrap: WRITTEN,
              sweep: { recovered: [partial], unfinished: ["/home/backups/store/half"], unrecoverable: [] },
            },
            status: "swept",
          },
        ],
      }),
    });
    expect(lines.slice(3)).toEqual([
      "    recovered /home/backups/store/old → slopweaver/old/ (0 object(s))",
      "      but it lacks 2 of the blobs and chunks its files.json names, so its files half will not restore; its " +
        "dump does",
      "    1 unfinished staging(s) carry no files.json and were left alone: /home/backups/store/half",
    ]);
  });

  it("names a failed destination and its reasons without hiding the one after it", () => {
    const lines = sweepOnlyLines({
      report: report({
        destinations: [
          { destination: SSD, errors: ["door refused"], status: "failed" },
          { destination: MAC, report: { keyWrap: { state: "no-master-password" }, sweep: EMPTY }, status: "swept" },
        ],
      }),
    });
    expect(lines.slice(1)).toEqual([
      "  /Volumes/FixtureDrive/backups: FAILED",
      "    door refused",
      "  /Users/someone/backups: no staging is waiting for it — nothing sent",
      "    backup key NOT wrapped here — only this Mac's Keychain opens it; generate the master password once with " +
        "`slopweaver store backup --create-master-password`",
    ]);
  });
});
