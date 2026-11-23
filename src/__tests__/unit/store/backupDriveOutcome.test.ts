/**
 * The external-drive half of `store backup`: what an address names, how a night whose drive was out beside a written
 * destination is recorded — one attempt per destination — and how a single-destination `last.json` written before
 * the list is read. Changing the list and its pins is `backupDestinationSettings.test.ts`. Every write lands under a
 * sandbox home.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { writeJsonFile } from "#lib/jsonFile.js";

import { attemptOutcome } from "../../../cli/commands/store/backupStatus.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { localPathOfAddress, parseBackupSourceAddress } from "../../../store/backup/destination.js";
import { LOCAL_ONLY_WHY, readLastOutcome, recordLastOutcome } from "../../../store/backup/lastOutcome.js";
import { ensureStagingRoot } from "../../../store/backup/staging.js";
import { MAC, nightFixture, SSD, SSD_PIN, sentFixture } from "./backupReportFixture.js";

// The one-destination setter and its single-drive night left with their cases; changing the list and its pins is
// backupDestinationSettings.test.ts, a night's per-destination lines backupVerbsLines.test.ts.
// deleted-with-code: setDestination, setDestinationLines, driveNotPluggedInOutcome, driveNotPluggedInLines
const minted: string[] = [];

afterEach(() => {
  minted.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

/**
 * A throwaway parent holding a home with a `secrets/` directory.
 *
 * @returns the parent and the home under it
 */
function sandbox(): { parent: string; home: string } {
  const parent = mkdtempSync(join(tmpdir(), "backup-drive-"));
  minted.push(parent);
  const home = join(parent, "home");
  mkdirSync(join(home, "secrets"), { recursive: true });
  return { home, parent };
}

describe("localPathOfAddress", () => {
  it("reads an absolute path and a file:// address as the same local folder", () => {
    expect(unwrap(localPathOfAddress({ address: "/Users/someone/backups/" }))).toBe("/Users/someone/backups");
    expect(unwrap(localPathOfAddress({ address: "file:///Users/someone/backups" }))).toBe("/Users/someone/backups");
  });

  it("refuses every held remote kind and any other scheme by name, and a relative path", () => {
    expect(unwrapErr(localPathOfAddress({ address: "gs://bucket" })).code).toBe("DESTINATION_KIND_NOT_BUILT");
    expect(unwrapErr(localPathOfAddress({ address: "drive://folder" })).message).toBe(
      '"drive://folder" names a drive:// destination, which is not built — a backup goes to a local folder or a ' +
        "mounted drive; name one as an absolute path or a file:// address",
    );
    expect(unwrapErr(localPathOfAddress({ address: "https://example.test/x" })).message).toBe(
      '"https://example.test/x" is a https: address, which is not a backup destination — name a local folder or a ' +
        "mounted drive as an absolute path or a file:// address",
    );
    expect(unwrapErr(localPathOfAddress({ address: "backups" })).code).toBe("DESTINATION_NOT_ABSOLUTE");
  });

  it("refuses a held kind as a restore's source too", () => {
    expect(unwrapErr(parseBackupSourceAddress({ from: "s3://bucket/slopweaver/x", project: "slopweaver" })).code).toBe(
      "DESTINATION_KIND_NOT_BUILT",
    );
  });
});

describe("a night whose drive was out beside one that was written", () => {
  it("records one attempt per destination, labelled from the pin, and reads both back intact", () => {
    const { home } = sandbox();
    const report = nightFixture({
      destinations: [
        { destination: MAC, report: sentFixture({ root: MAC.root }), status: "succeeded" },
        { destination: SSD, ejected: false, pin: SSD_PIN, status: "drive-not-plugged-in" },
      ],
    });
    recordLastOutcome({
      home,
      outcome: attemptOutcome({ atIso: "2026-11-08T03:00:00.000Z", pins: [SSD_PIN], report }),
    });
    expect(readLastOutcome({ home })).toEqual({
      atIso: "2026-11-08T03:00:00.000Z",
      destinations: [
        { id: MAC.id, label: "this Mac", prefix: "slopweaver/x/", root: MAC.root, status: "succeeded" },
        {
          id: SSD.id,
          label: "FixtureDrive",
          mountPoint: "/Volumes/FixtureDrive",
          root: SSD.root,
          status: "drive-not-plugged-in",
          volumeUuid: "00000000-0000-4000-8000-0000000000A1",
        },
      ],
      directory: "/home/backups/store/x",
      status: "destinations",
    });
  });

  it("records a night with no destination as staged, naming why", () => {
    expect(
      attemptOutcome({ atIso: "2026-11-08T03:00:00.000Z", pins: [], report: nightFixture({ destinations: [] }) }),
    ).toEqual({
      atIso: "2026-11-08T03:00:00.000Z",
      directory: "/home/backups/store/x",
      status: "staged",
      why: LOCAL_ONLY_WHY,
    });
  });
});

describe("a single-destination last.json", () => {
  /**
   * Write a raw `last.json` the way a single-destination night did.
   *
   * @param home the sandbox home
   * @param value the record as it was written
   */
  function writeSingleDestination({ home, value }: { home: string; value: Record<string, unknown> }): void {
    writeJsonFile({ path: join(ensureStagingRoot({ home }), "last.json"), value });
  }

  it("reads a succeeded record as a one-destination attempt with the id a listed destination gets", () => {
    const { home } = sandbox();
    writeSingleDestination({
      home,
      value: {
        atIso: "2026-11-01T03:00:00.000Z",
        destination: SSD.root,
        directory: "/home/backups/store/w",
        prefix: "slopweaver/w/",
        status: "succeeded",
      },
    });
    expect(readLastOutcome({ home })).toEqual({
      atIso: "2026-11-01T03:00:00.000Z",
      destinations: [
        { id: SSD.id, label: "FixtureDrive", prefix: "slopweaver/w/", root: SSD.root, status: "succeeded" },
      ],
      directory: "/home/backups/store/w",
      status: "destinations",
    });
  });

  it("reads a drive-not-plugged-in record the same way, labelled from its mount point", () => {
    const { home } = sandbox();
    writeSingleDestination({
      home,
      value: {
        atIso: "2026-11-01T03:00:00.000Z",
        destination: MAC.root,
        directory: "/home/backups/store/w",
        mountPoint: "/Volumes/OldDrive",
        status: "drive-not-plugged-in",
        volumeUuid: "00000000-0000-4000-8000-0000000000B2",
      },
    });
    expect(readLastOutcome({ home })).toEqual({
      atIso: "2026-11-01T03:00:00.000Z",
      destinations: [
        {
          id: MAC.id,
          label: "OldDrive",
          mountPoint: "/Volumes/OldDrive",
          root: MAC.root,
          status: "drive-not-plugged-in",
          volumeUuid: "00000000-0000-4000-8000-0000000000B2",
        },
      ],
      directory: "/home/backups/store/w",
      status: "destinations",
    });
  });

  it("still calls a record of neither shape unreadable", () => {
    const { home } = sandbox();
    writeSingleDestination({
      home,
      value: { atIso: "2026-11-01T03:00:00.000Z", status: "succeeded", uploaded: false },
    });
    expect(readLastOutcome({ home })).toBe("unreadable");
  });
});
