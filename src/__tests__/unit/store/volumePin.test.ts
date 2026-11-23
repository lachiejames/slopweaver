/**
 * Pinning a backup destination to one external volume: which roots are on one, what a pin judges against what is
 * mounted, when a pin can be recorded at all, and the pin list's round trip under a sandbox home — a schema-1
 * single pin read as a one-pin list. Every read of
 * what is mounted is a plain fake `ReadVolume`; nothing here asks `diskutil`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { err, ok, unwrap, unwrapErr } from "../../../lib/result.js";
import { type IdentityOf } from "../../../store/backup/realPlace.js";
import { stagingRoot } from "../../../store/backup/staging.js";
import {
  externalPlacement,
  pinFor,
  pinVerdict,
  placeRoot,
  type ReadVolume,
  type VolumePin,
} from "../../../store/backup/volumePin.js";
import { VolumePinErrors } from "../../../store/backup/volumePinErrors.js";
import {
  pinForRoot,
  readVolumePins,
  volumePinPath,
  withPin,
  writeVolumePins,
} from "../../../store/backup/volumePins.js";

const PIN: VolumePin = {
  mountPoint: "/Volumes/FixtureDrive",
  root: "/Volumes/FixtureDrive/backups",
  volumeName: "FixtureDrive",
  volumeUuid: "00000000-0000-4000-8000-0000000000A1",
};

const minted: string[] = [];

afterEach(() => {
  minted.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

/**
 * A throwaway home, removed after the test that minted it.
 *
 * @returns its absolute path
 */
function sandboxHome(): string {
  const home = mkdtempSync(join(tmpdir(), "volume-pin-"));
  minted.push(home);
  return home;
}

/**
 * A `ReadVolume` that always answers the same.
 *
 * @param answer what it answers
 * @returns the fake
 */
function answering({ answer }: { answer: ReturnType<ReadVolume> }): ReadVolume {
  return () => answer;
}

/** `/Volumes` reached by three spellings, as on a Mac: itself, the Data volume's firmlink, and another case. */
const VOLUMES_ALIASES = new Set(["/Volumes", "/System/Volumes/Data/Volumes", "/volumes"]);

/**
 * An identity reader where every `/Volumes` spelling is one directory and every other path its own.
 *
 * @param path the path to read
 * @returns the fake identity
 */
const identityOf: IdentityOf = ({ path }) =>
  VOLUMES_ALIASES.has(path) ? { dev: 1, ino: 2 } : { dev: 1, ino: path.length + 100 };

describe("externalPlacement", () => {
  it("names /Volumes/<name> for a root at or below it, and nothing for any other root", () => {
    expect(externalPlacement({ identityOf, root: "/Volumes/FixtureDrive/backups/slopweaver" })).toEqual({
      canonicalRoot: "/Volumes/FixtureDrive/backups/slopweaver",
      mountPoint: "/Volumes/FixtureDrive",
    });
    expect(externalPlacement({ identityOf, root: "/Volumes/FixtureDrive" })!.mountPoint).toBe("/Volumes/FixtureDrive");
    expect(externalPlacement({ identityOf, root: "/Volumes" })).toBe(null);
    expect(externalPlacement({ identityOf, root: "/Users/someone/backups" })).toBe(null);
    expect(externalPlacement({ identityOf, root: "/VolumesElsewhere/x" })).toBe(null);
  });

  it("places a root spelled through any alias of /Volumes on the drive, spelled under /Volumes", () => {
    const expected = { canonicalRoot: "/Volumes/FixtureDrive/backups", mountPoint: "/Volumes/FixtureDrive" };
    expect(externalPlacement({ identityOf, root: "/System/Volumes/Data/Volumes/FixtureDrive/backups" })).toEqual(
      expected,
    );
    expect(externalPlacement({ identityOf, root: "/volumes/FixtureDrive/backups" })).toEqual(expected);
  });

  it("hands a placed root on, spelled under /Volumes, so a pin compares and every write lands by one spelling", () => {
    expect(unwrap(placeRoot({ identityOf, root: "/volumes/FixtureDriveNeverMounted/backups" }))).toEqual({
      mountPoint: "/Volumes/FixtureDriveNeverMounted",
      physicalRoot: "/Volumes/FixtureDriveNeverMounted/backups",
    });
  });
});

describe("pinVerdict", () => {
  it("is plugged in only for the pinned UUID, not plugged in for nothing, and different for any other", () => {
    expect(pinVerdict({ observation: null, pin: PIN })).toEqual({ kind: "not-plugged-in" });
    expect(
      pinVerdict({
        observation: { mountPoint: PIN.mountPoint, volumeName: "Renamed", volumeUuid: PIN.volumeUuid },
        pin: PIN,
      }),
    ).toEqual({ kind: "plugged-in" });
    expect(
      pinVerdict({
        observation: { mountPoint: PIN.mountPoint, volumeName: PIN.volumeName, volumeUuid: "OTHER-UUID" },
        pin: PIN,
      }),
    ).toEqual({ actualVolumeUuid: "OTHER-UUID", kind: "different-volume" });
    expect(
      pinVerdict({
        observation: { mountPoint: PIN.mountPoint, volumeName: PIN.volumeName, volumeUuid: null },
        pin: PIN,
      }),
    ).toEqual({ actualVolumeUuid: null, kind: "different-volume" });
  });
});

describe("pinFor", () => {
  it("records the mounted volume's UUID for exactly this root", () => {
    const readVolume = answering({
      answer: ok({ mountPoint: PIN.mountPoint, volumeName: PIN.volumeName, volumeUuid: PIN.volumeUuid }),
    });
    expect(unwrap(pinFor({ mountPoint: PIN.mountPoint, readVolume, root: PIN.root }))).toEqual(PIN);
  });

  it("refuses a mount point with nothing on it, and a volume with no UUID", () => {
    expect(
      unwrapErr(pinFor({ mountPoint: PIN.mountPoint, readVolume: answering({ answer: ok(null) }), root: PIN.root }))
        .code,
    ).toBe("VOLUME_NOT_MOUNTED");
    const noUuid = answering({ answer: ok({ mountPoint: PIN.mountPoint, volumeName: "X", volumeUuid: null }) });
    expect(unwrapErr(pinFor({ mountPoint: PIN.mountPoint, readVolume: noUuid, root: PIN.root })).code).toBe(
      "VOLUME_UUID_UNAVAILABLE",
    );
  });

  it("carries a failed inspection through unchanged", () => {
    const failing = answering({
      answer: err(
        VolumePinErrors.inspectionFailed({ cause: new Error("diskutil exited 2"), mountPoint: PIN.mountPoint }),
      ),
    });
    expect(unwrapErr(pinFor({ mountPoint: PIN.mountPoint, readVolume: failing, root: PIN.root })).message).toBe(
      "could not read which volume is mounted at /Volumes/FixtureDrive: diskutil exited 2",
    );
  });
});

const OTHER: VolumePin = {
  mountPoint: "/Volumes/SecondDrive",
  root: "/Volumes/SecondDrive/backups",
  volumeName: "SecondDrive",
  volumeUuid: "00000000-0000-4000-8000-0000000000B2",
};

describe("the pin record", () => {
  it("reads no pins before one is written, and the same pins in order after", () => {
    const home = sandboxHome();
    expect(unwrap(readVolumePins({ home }))).toEqual([]);
    expect(unwrap(writeVolumePins({ home, pins: [PIN, OTHER] }))).toBe(
      join(stagingRoot({ home }), "destination-pin.json"),
    );
    expect(unwrap(readVolumePins({ home }))).toEqual([PIN, OTHER]);
  });

  it("reads a schema-1 record, the single pin written before the list, as a one-pin list", () => {
    const home = sandboxHome();
    mkdirSync(stagingRoot({ home }), { recursive: true });
    writeFileSync(volumePinPath({ home }), JSON.stringify({ ...PIN, schemaVersion: 1 }));
    expect(unwrap(readVolumePins({ home }))).toEqual([PIN]);
  });

  it("refuses a record that is not a pin, and one pinning a root twice, rather than trusting either", () => {
    const home = sandboxHome();
    mkdirSync(stagingRoot({ home }), { recursive: true });
    writeFileSync(volumePinPath({ home }), JSON.stringify({ ...PIN, schemaVersion: 2 }));
    expect(unwrapErr(readVolumePins({ home })).code).toBe("VOLUME_PIN_MALFORMED");
    writeFileSync(
      volumePinPath({ home }),
      JSON.stringify({ pins: [PIN, { ...PIN, volumeName: "Again" }], schemaVersion: 2 }),
    );
    expect(unwrapErr(readVolumePins({ home })).message).toContain(`it pins ${PIN.root} twice`);
    expect(unwrapErr(writeVolumePins({ home, pins: [PIN, PIN] })).code).toBe("VOLUME_PIN_MALFORMED");
  });

  it("finds a pin only for exactly its root on exactly its mount point", () => {
    const pins = [PIN, OTHER];
    expect(pinForRoot({ mountPoint: OTHER.mountPoint, pins, root: OTHER.root })).toEqual(OTHER);
    expect(pinForRoot({ mountPoint: OTHER.mountPoint, pins, root: PIN.root })).toBe(null);
    expect(pinForRoot({ mountPoint: PIN.mountPoint, pins, root: "/Volumes/FixtureDrive/other" })).toBe(null);
  });

  it("puts a pin in by its root, replacing that root's and keeping every other in order", () => {
    const renamed = { ...PIN, volumeName: "Renamed" };
    expect(withPin({ pin: renamed, pins: [PIN, OTHER] })).toEqual([renamed, OTHER]);
    expect(withPin({ pin: OTHER, pins: [PIN] })).toEqual([PIN, OTHER]);
  });
});
