/**
 * What a destination's failed send becomes: a drive pulled mid-run, whose staging is whole and unsent there, reads as
 * DRIVE NOT PLUGGED IN (ejected), and every other failure stays the failure it was. Over a real staging directory in a
 * throwaway root, with the drive reads passed in.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { failedSendOutcome } from "../../../cli/commands/store/backupTargets.js";
import { type DriveProbes, SYSTEM_DRIVE_PROBES } from "../../../cli/commands/store/writeDestination.js";
import { ok } from "../../../lib/result.js";
import { FILES_MANIFEST } from "../../../store/backup/plan.js";
import { writeStagingDestinations } from "../../../store/backup/stagingDestinations.js";
import { MAC, SSD, SSD_PIN } from "./backupReportFixture.js";

const minted: string[] = [];

afterEach(() => {
  minted.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

/**
 * A finished staging directory that owes both destinations and holds no receipt.
 *
 * @returns the staging directory
 */
function unsentStaging(): string {
  const root = mkdtempSync(join(tmpdir(), "backup-failed-send-"));
  minted.push(root);
  const directory = join(root, "2026-11-08T03-00-00-000Z");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, FILES_MANIFEST), "{}");
  writeStagingDestinations({ destinations: [MAC, SSD], directory });
  return directory;
}

/**
 * Drive reads answering with the SSD mounted, or with nothing mounted at its mount point.
 *
 * @param mounted whether the pinned SSD is in now
 * @returns the probes
 */
function probesWith({ mounted }: { mounted: boolean }): DriveProbes {
  return {
    ...SYSTEM_DRIVE_PROBES,
    readVolume: () =>
      ok(
        mounted
          ? { mountPoint: SSD_PIN.mountPoint, volumeName: SSD_PIN.volumeName, volumeUuid: SSD_PIN.volumeUuid }
          : null,
      ),
  };
}

const ON_SSD = {
  destination: SSD,
  held: { device: 7, mountPoint: SSD_PIN.mountPoint, pin: SSD_PIN },
  kind: "reachable" as const,
  physicalRoot: SSD.root,
};

describe("failedSendOutcome", () => {
  it("records a drive ejected mid-run as DRIVE NOT PLUGGED IN, ejected", () => {
    expect(
      failedSendOutcome({
        directory: unsentStaging(),
        errors: ["the drive at /Volumes/FixtureDrive was ejected or replaced"],
        inspection: ON_SSD,
        probes: probesWith({ mounted: false }),
      }),
    ).toEqual({ destination: SSD, ejected: true, pin: SSD_PIN, status: "drive-not-plugged-in" });
  });

  it("keeps the failure when the drive is still in", () => {
    expect(
      failedSendOutcome({
        directory: unsentStaging(),
        errors: ["disk full"],
        inspection: ON_SSD,
        probes: probesWith({ mounted: true }),
      }),
    ).toEqual({ destination: SSD, errors: ["disk full"], status: "failed" });
  });

  it("keeps the failure for a folder on no drive, whatever the drive reads say", () => {
    expect(
      failedSendOutcome({
        directory: unsentStaging(),
        errors: ["permission denied"],
        inspection: { destination: MAC, held: null, kind: "reachable", physicalRoot: MAC.root },
        probes: probesWith({ mounted: false }),
      }),
    ).toEqual({ destination: MAC, errors: ["permission denied"], status: "failed" });
  });
});
