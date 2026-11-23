/**
 * `store backup --status`, pure half: the exit code over every `last.json` shape, one entry per CONFIGURED
 * destination with its own last-written instant, and the lines — so an unplugged SSD reads "FixtureDrive … last
 * written <date>" beside this Mac's own line. No filesystem.
 */
import { describe, expect, it } from "vitest";

import {
  attemptedStaging,
  type StatusDestination,
  statusDestinations,
  statusExitCode,
  statusLines,
} from "../../../cli/commands/store/backupStatus.js";
import { EXIT_ERROR, EXIT_OK } from "../../../cli/exitCodes.js";
import type { DestinationId } from "../../../store/backup/destinationConfig.js";
import {
  type DestinationAttempt,
  type LastOutcome,
  type LastOutcomeRead,
  LOCAL_ONLY_WHY,
} from "../../../store/backup/lastOutcome.js";
import type { LastUpload } from "../../../store/backup/receipts.js";
import { destinationFixture, MAC, SSD, SSD_PIN } from "./backupReportFixture.js";

const AT = "2026-11-08T03:00:00.000Z";
const WROTE_MAC: DestinationAttempt = {
  id: MAC.id,
  label: "this Mac",
  prefix: "slopweaver/x/",
  root: MAC.root,
  status: "succeeded",
};
const SSD_OUT: DestinationAttempt = {
  id: SSD.id,
  label: "FixtureDrive",
  mountPoint: SSD_PIN.mountPoint,
  root: SSD.root,
  status: "drive-not-plugged-in",
  volumeUuid: SSD_PIN.volumeUuid,
};
const MAC_FAILED: DestinationAttempt = {
  errors: ["EACCES"],
  id: MAC.id,
  label: "this Mac",
  root: MAC.root,
  status: "failed",
};

/**
 * The destinations arm over some attempts.
 *
 * @param attempts each destination's attempt
 * @returns the record
 */
function night({ attempts }: { attempts: readonly DestinationAttempt[] }): LastOutcome {
  return { atIso: AT, destinations: attempts, directory: "/home/backups/store/x", status: "destinations" };
}

/**
 * The newest upload a receipt evidences.
 *
 * @param destination the root the receipt names
 * @param uploadedAtIso when it landed
 * @returns the upload
 */
function upload({ destination, uploadedAtIso }: { destination: string; uploadedAtIso: string }): LastUpload {
  return { destination, directory: "/home/backups/store/w", prefix: "slopweaver/w/", uploadedAtIso };
}

/**
 * The status lines with the attempted night passed as the shell passes it — these fixture paths resolve to
 * themselves, so the recorded spelling is the resolved one.
 *
 * @param outcome what the read of `last.json` found
 * @param destinations every configured destination's status
 * @returns the lines
 */
function linesOf({
  outcome,
  destinations,
}: {
  outcome: LastOutcomeRead;
  destinations: readonly StatusDestination[];
}): readonly string[] {
  return statusLines({ destinations, night: attemptedStaging({ outcome }), outcome });
}

describe("statusExitCode", () => {
  it("is green only when a destination was written and none failed, or nothing has ever run", () => {
    const cases: readonly [string, Parameters<typeof statusExitCode>[0]["outcome"], number][] = [
      ["never run", "absent", EXIT_OK],
      ["not a record", "unreadable", EXIT_ERROR],
      ["local-only", { atIso: AT, directory: "/x", status: "staged", why: LOCAL_ONLY_WHY }, EXIT_ERROR],
      ["failed before staging", { atIso: AT, errors: ["no key"], status: "failed" }, EXIT_ERROR],
      ["mac written, ssd out", night({ attempts: [WROTE_MAC, SSD_OUT] }), EXIT_OK],
      ["every drive out", night({ attempts: [SSD_OUT] }), EXIT_ERROR],
      [
        "one written, one failed",
        night({ attempts: [MAC_FAILED, { ...WROTE_MAC, id: SSD.id, root: SSD.root }] }),
        EXIT_ERROR,
      ],
      ["only one failed", night({ attempts: [MAC_FAILED] }), EXIT_ERROR],
    ];
    expect(cases.length).toBeGreaterThan(0);
    expect(cases.map(([name, outcome]) => [name, statusExitCode({ outcome })])).toEqual(
      cases.map(([name, , code]) => [name, code]),
    );
  });
});

describe("statusDestinations", () => {
  it("gives each configured destination its own last-written upload and attempt, by id, in list order", () => {
    const uploads = new Map<DestinationId, LastUpload | null>([
      [MAC.id, upload({ destination: MAC.root, uploadedAtIso: "2026-11-08T03:01:00.000Z" })],
      [SSD.id, upload({ destination: SSD.root, uploadedAtIso: "2026-11-05T03:01:00.000Z" })],
    ]);
    const entries = statusDestinations({
      destinations: [SSD, MAC],
      outcome: night({ attempts: [WROTE_MAC, SSD_OUT] }),
      pins: [SSD_PIN],
      uploads,
    });
    expect(
      entries.map(({ label, lastUpload, attempt }) => [label, lastUpload!.uploadedAtIso, attempt!.status]),
    ).toEqual([
      ["FixtureDrive", "2026-11-05T03:01:00.000Z", "drive-not-plugged-in"],
      ["this Mac", "2026-11-08T03:01:00.000Z", "succeeded"],
    ]);
  });

  it("drops a destination the record names once it is off the list, and gives a new one no attempt", () => {
    const added = destinationFixture({ root: "/Users/someone/second" });
    const entries = statusDestinations({
      destinations: [added],
      outcome: night({ attempts: [WROTE_MAC, SSD_OUT] }),
      pins: [SSD_PIN],
      uploads: new Map([[added.id, null]]),
    });
    expect(entries).toEqual([
      { attempt: null, id: added.id, label: "this Mac", lastUpload: null, pinnedVolumeUuid: null, root: added.root },
    ]);
  });
});

describe("statusLines", () => {
  it("prints the verdict, then each destination's last-written line with the attempt beneath it", () => {
    const destinations: readonly StatusDestination[] = [
      {
        attempt: WROTE_MAC,
        id: MAC.id,
        label: "this Mac",
        lastUpload: upload({ destination: MAC.root, uploadedAtIso: "2026-11-08T03:01:00.000Z" }),
        pinnedVolumeUuid: null,
        root: MAC.root,
      },
      {
        attempt: SSD_OUT,
        id: SSD.id,
        label: "FixtureDrive",
        lastUpload: upload({ destination: SSD.root, uploadedAtIso: "2026-11-05T03:01:00.000Z" }),
        pinnedVolumeUuid: SSD_PIN.volumeUuid,
        root: SSD.root,
      },
    ];
    expect(linesOf({ destinations, outcome: night({ attempts: [WROTE_MAC, SSD_OUT] }) })).toEqual([
      "store backup: last attempt 2026-11-08T03:00:00.000Z wrote 1 of 2 destination(s) (staged at /home/backups/store/x)",
      "  this Mac (/Users/someone/backups) last written 2026-11-08T03:01:00.000Z (slopweaver/w/)",
      "    last attempt wrote slopweaver/x/",
      "  FixtureDrive (/Volumes/FixtureDrive/backups) last written 2026-11-05T03:01:00.000Z (slopweaver/w/)",
      "    last attempt: DRIVE NOT PLUGGED IN — nothing was mounted at /Volumes/FixtureDrive; plug the drive " +
        "(volume 00000000-0000-4000-8000-0000000000A1) in and `slopweaver store backup --sweep-only` sends it",
    ]);
  });

  it("says a sweep has since sent the night the drive was out for, rather than asking for the sweep again", () => {
    const swept: StatusDestination = {
      attempt: SSD_OUT,
      id: SSD.id,
      label: "FixtureDrive",
      lastUpload: {
        destination: SSD.root,
        directory: "/home/backups/store/x",
        prefix: "slopweaver/x/",
        uploadedAtIso: "2026-11-08T04:10:00.000Z",
      },
      pinnedVolumeUuid: SSD_PIN.volumeUuid,
      root: SSD.root,
    };
    expect(linesOf({ destinations: [swept], outcome: night({ attempts: [SSD_OUT] }) }).slice(1)).toEqual([
      "  FixtureDrive (/Volumes/FixtureDrive/backups) last written 2026-11-08T04:10:00.000Z (slopweaver/x/)",
      "    last attempt: DRIVE NOT PLUGGED IN at /Volumes/FixtureDrive; a sweep has since sent that night",
    ]);
    // An older staging's receipt, even one whose prefix claims the attempted night, is not that night's receipt; nor
    // is a distinct staging that only shares the night's name.
    const olderNightOnly = { ...swept, lastUpload: { ...swept.lastUpload!, directory: "/home/backups/store/w" } };
    const sameNameElsewhere = { ...swept, lastUpload: { ...swept.lastUpload!, directory: "/other/backups/store/x" } };
    const repinned = { ...swept, pinnedVolumeUuid: "00000000-0000-4000-8000-0000000000B2" };
    expect(
      [olderNightOnly, sameNameElsewhere, repinned].map(
        (destination) => linesOf({ destinations: [destination], outcome: night({ attempts: [SSD_OUT] }) })[2],
      ),
    ).toEqual([
      "    last attempt: DRIVE NOT PLUGGED IN — nothing was mounted at /Volumes/FixtureDrive; plug the drive " +
        "(volume 00000000-0000-4000-8000-0000000000A1) in and `slopweaver store backup --sweep-only` sends it",
      "    last attempt: DRIVE NOT PLUGGED IN — nothing was mounted at /Volumes/FixtureDrive; plug the drive " +
        "(volume 00000000-0000-4000-8000-0000000000A1) in and `slopweaver store backup --sweep-only` sends it",
      "    last attempt: DRIVE NOT PLUGGED IN — nothing was mounted at /Volumes/FixtureDrive; plug the drive " +
        "(volume 00000000-0000-4000-8000-0000000000A1) in and `slopweaver store backup --sweep-only` sends it",
    ]);
  });

  it("says a local-only attempt wrote nothing, and a destination with no receipt has no local evidence", () => {
    const destinations: readonly StatusDestination[] = [
      { attempt: null, id: MAC.id, label: "this Mac", lastUpload: null, pinnedVolumeUuid: null, root: MAC.root },
    ];
    expect(
      linesOf({
        destinations,
        outcome: { atIso: AT, directory: "/home/backups/store/x", status: "staged", why: LOCAL_ONLY_WHY },
      }),
    ).toEqual([
      `store backup: last attempt ${AT} wrote NOTHING to any destination — ${LOCAL_ONLY_WHY}`,
      "  it is staged on this machine only, at /home/backups/store/x",
      "  this Mac (/Users/someone/backups): no staged copy on this machine holds a receipt for it, so there is no " +
        "local evidence of any write",
    ]);
  });

  it("prints a failed destination's reasons under it", () => {
    const destinations: readonly StatusDestination[] = [
      { attempt: MAC_FAILED, id: MAC.id, label: "this Mac", lastUpload: null, pinnedVolumeUuid: null, root: MAC.root },
    ];
    expect(linesOf({ destinations, outcome: night({ attempts: [MAC_FAILED] }) }).slice(2)).toEqual([
      "    last attempt FAILED",
      "      EACCES",
    ]);
  });

  it("separates a never-run install from a last.json that is not a record", () => {
    expect(linesOf({ destinations: [], outcome: "absent" })).toEqual([
      "store backup: no attempt has been recorded on this install",
    ]);
    expect(linesOf({ destinations: [], outcome: "unreadable" })).toEqual([
      "store backup: last.json is present and is NOT a last-attempt record — when this install last backed up is " +
        "unknown. Run `slopweaver store backup` to write a fresh one.",
    ]);
  });
});
