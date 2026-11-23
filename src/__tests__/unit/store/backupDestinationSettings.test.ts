/**
 * Changing the LIST of destinations: `--set-destination` replaces it with one, `--add-destination` appends one,
 * `--remove-destination` drops one — each pinning or unpinning a drive, and each a transaction over the list and
 * the pin file that puts the earlier pin bytes back when a later step fails. Every read of what is mounted is a plain
 * fake; nothing here asks `diskutil`, and every write lands under a sandbox home.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { changeDestinations } from "../../../cli/commands/store/destinationSettings.js";
import { destinationSettingsLines } from "../../../cli/commands/store/destinationSettingsReport.js";
import type { DriveProbes } from "../../../cli/commands/store/writeDestination.js";
import { ok, unwrap, unwrapErr } from "../../../lib/result.js";
import { BACKUP_DIRECTORY_SECRET } from "../../../store/backup/destination.js";
import { backupDestinations } from "../../../store/backup/destinationConfig.js";
import { type IdentityOf, statIdentity } from "../../../store/backup/realPlace.js";
import type { VolumePin } from "../../../store/backup/volumePin.js";
import { readVolumePins, volumePinPath, writeVolumePins } from "../../../store/backup/volumePins.js";

const PIN: VolumePin = {
  mountPoint: "/Volumes/FixtureDrive",
  root: "/Volumes/FixtureDrive/backups",
  volumeName: "FixtureDrive",
  volumeUuid: "00000000-0000-4000-8000-0000000000A1",
};

/**
 * Reads identities from the real disk, except that `/Volumes` is declared — so a root under it is placed on an
 * external volume on any host, a Linux runner with no `/Volumes` included.
 *
 * @param path the path to read
 * @returns its identity
 */
const volumesHere: IdentityOf = ({ path }) => (path === "/Volumes" ? { dev: -1, ino: -1 } : statIdentity({ path }));

/** Nothing is ever mounted. */
const NO_DRIVE: DriveProbes = {
  deviceOf: () => null,
  deviceUnder: () => null,
  identityOf: volumesHere,
  readVolume: () => ok(null),
};

/** The fixture drive, mounted on device 7, with everything under it on the same device. */
const DRIVE_IN: DriveProbes = {
  deviceOf: () => 7,
  deviceUnder: () => 7,
  identityOf: volumesHere,
  readVolume: () => ok({ mountPoint: PIN.mountPoint, volumeName: "FixtureDrive", volumeUuid: PIN.volumeUuid }),
};

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
  const parent = mkdtempSync(join(tmpdir(), "backup-settings-"));
  minted.push(parent);
  const home = join(parent, "home");
  mkdirSync(join(home, "secrets"), { recursive: true });
  return { home, parent };
}

/**
 * The roots the remembered list holds now.
 *
 * @param home the sandbox home
 * @returns the roots, in order
 */
function listedRoots({ home }: { home: string }): readonly string[] {
  return unwrap(backupDestinations({ env: {}, home, override: null })).destinations.map((one) => one.root);
}

describe("--set-destination", () => {
  it("remembers a folder on an always-there disk, makes it, and pins nothing", () => {
    const { home, parent } = sandbox();
    const root = join(parent, "dest");
    const report = unwrap(changeDestinations({ address: `file://${root}`, change: "set", home, probes: NO_DRIVE }));
    expect(report.pin).toBe(null);
    expect(report.root).toBe(root);
    expect(report.destinations).toEqual([root]);
    expect(listedRoots({ home })).toEqual([root]);
    expect(readFileSync(join(home, "secrets", BACKUP_DIRECTORY_SECRET), "utf8")).toBe(`file://${root}\n`);
    expect(unwrap(readVolumePins({ home }))).toEqual([]);
  });

  it("replaces a whole list with one, and drops a pin no destination on it uses", () => {
    const { home, parent } = sandbox();
    writeFileSync(join(home, "secrets", BACKUP_DIRECTORY_SECRET), `${PIN.root}\n${join(parent, "a")}\n`);
    unwrap(writeVolumePins({ home, pins: [PIN] }));
    const root = join(parent, "only");
    unwrap(changeDestinations({ address: root, change: "set", home, probes: NO_DRIVE }));
    expect(listedRoots({ home })).toEqual([root]);
    expect(unwrap(readVolumePins({ home }))).toEqual([]);
  });

  it("refuses to pin a drive that is not plugged in, and remembers nothing", () => {
    const { home } = sandbox();
    expect(unwrapErr(changeDestinations({ address: PIN.root, change: "set", home, probes: NO_DRIVE }))).toEqual([
      "nothing is mounted at /Volumes/FixtureDrive — plug the drive in, then set the destination again",
    ]);
    expect(unwrapErr(backupDestinations({ env: {}, home, override: null })).code).toBe("DESTINATION_UNSELECTED");
    expect(unwrap(readVolumePins({ home }))).toEqual([]);
  });

  it("refuses a drive swapped while its UUID was read, and remembers nothing", () => {
    const { home } = sandbox();
    const devices = [7, 8];
    const probes = { ...DRIVE_IN, deviceOf: () => devices.shift()! };
    expect(unwrapErr(changeDestinations({ address: PIN.root, change: "set", home, probes }))).toEqual([
      "the volume mounted at /Volumes/FixtureDrive changed while it was being checked — nothing is written; run the " +
        "backup again once the drive is settled",
    ]);
    expect(devices).toEqual([]);
    expect(unwrap(readVolumePins({ home }))).toEqual([]);
  });

  it("refuses to pin a root that lands on a volume mounted inside the drive", () => {
    const { home } = sandbox();
    const probes = { ...DRIVE_IN, deviceUnder: () => 9 };
    expect(unwrapErr(changeDestinations({ address: PIN.root, change: "set", home, probes }))[0]).toContain(
      `${PIN.root} is on a volume mounted inside /Volumes/FixtureDrive`,
    );
    expect(unwrap(readVolumePins({ home }))).toEqual([]);
  });

  it("records the pin before making the folder, so a pin that cannot be written leaves no folder", () => {
    const { home } = sandbox();
    writeFileSync(join(home, "backups"), "not a directory");
    const refused = unwrapErr(changeDestinations({ address: PIN.root, change: "set", home, probes: DRIVE_IN }));
    expect(refused).toHaveLength(1);
    expect(refused[0]).toContain(`could not write the destination pin ${join(home, "backups", "store")}`);
    expect(existsSync(PIN.mountPoint)).toBe(false);
  });

  it("puts the earlier pins back when the folder cannot be made", () => {
    const { home } = sandbox();
    const earlier: VolumePin = { ...PIN, root: "/Volumes/FixtureDrive/earlier" };
    unwrap(writeVolumePins({ home, pins: [earlier] }));
    const refused = unwrapErr(changeDestinations({ address: PIN.root, change: "set", home, probes: DRIVE_IN }));
    expect(refused[0]).toContain(`could not create the backup destination ${PIN.root}`);
    expect(unwrap(readVolumePins({ home }))).toEqual([earlier]);
  });

  it("puts the earlier pin file back byte for byte, even one that is not a pin", () => {
    const { home } = sandbox();
    unwrap(writeVolumePins({ home, pins: [PIN] }));
    writeFileSync(volumePinPath({ home }), "not a pin, but kept");
    expect(unwrapErr(changeDestinations({ address: PIN.root, change: "set", home, probes: DRIVE_IN }))[0]).toContain(
      `could not create the backup destination ${PIN.root}`,
    );
    expect(readFileSync(volumePinPath({ home }), "utf8")).toBe("not a pin, but kept");
  });

  it("refuses before changing anything when the earlier pin file is there but cannot be read", () => {
    const { home } = sandbox();
    mkdirSync(volumePinPath({ home }), { recursive: true });
    const refused = unwrapErr(changeDestinations({ address: PIN.root, change: "set", home, probes: DRIVE_IN }));
    expect(refused).toHaveLength(1);
    expect(refused[0]).toContain(`could not read the destination pin ${volumePinPath({ home })}`);
    expect(refused[0]).toContain("nothing is changed");
    expect(statSync(volumePinPath({ home })).isDirectory()).toBe(true);
    expect(unwrapErr(backupDestinations({ env: {}, home, override: null })).code).toBe("DESTINATION_UNSELECTED");
  });

  it("removes the folders it made when the list cannot be written, and keeps what was already there", () => {
    const { home, parent } = sandbox();
    const root = join(parent, "made", "dest");
    // A secret is never written under a home others can write to, so the list cannot be replaced.
    chmodSync(home, 0o777);
    try {
      const refused = unwrapErr(changeDestinations({ address: root, change: "set", home, probes: NO_DRIVE }));
      expect(refused).toHaveLength(1);
    } finally {
      chmodSync(home, 0o700);
    }
    expect(existsSync(join(parent, "made"))).toBe(false);
    expect(existsSync(parent)).toBe(true);
  });
});

describe("--add-destination", () => {
  it("appends a destination in the order the night writes, and puts in only its own pin", () => {
    const { home, parent } = sandbox();
    const local = join(parent, "this-mac");
    const other: VolumePin = { ...PIN, mountPoint: "/Volumes/Other", root: "/Volumes/Other/backups" };
    writeFileSync(join(home, "secrets", BACKUP_DIRECTORY_SECRET), `${local}\n`);
    unwrap(writeVolumePins({ home, pins: [other] }));
    // The fixture drive's mount point never exists on the runner, so the folder cannot be made: the pin is put back.
    expect(unwrapErr(changeDestinations({ address: PIN.root, change: "add", home, probes: DRIVE_IN }))[0]).toContain(
      `could not create the backup destination ${PIN.root}`,
    );
    expect(unwrap(readVolumePins({ home }))).toEqual([other]);
    const second = join(parent, "second");
    const report = unwrap(changeDestinations({ address: second, change: "add", home, probes: NO_DRIVE }));
    expect(report.destinations).toEqual([local, second]);
    expect(listedRoots({ home })).toEqual([local, second]);
    expect(unwrap(readVolumePins({ home }))).toEqual([other]);
    expect(existsSync(second)).toBe(true);
  });

  it("refuses a destination already on the list, however it is spelled", () => {
    const { home, parent } = sandbox();
    const local = join(parent, "this-mac");
    writeFileSync(join(home, "secrets", BACKUP_DIRECTORY_SECRET), `${local}\n`);
    expect(
      unwrapErr(changeDestinations({ address: `file://${local}/`, change: "add", home, probes: NO_DRIVE })),
    ).toEqual([`${local} is already a backup destination — nothing was changed`]);
  });

  it("starts a list when none is remembered", () => {
    const { home, parent } = sandbox();
    const root = join(parent, "first");
    unwrap(changeDestinations({ address: root, change: "add", home, probes: NO_DRIVE }));
    expect(listedRoots({ home })).toEqual([root]);
  });
});

describe("--remove-destination", () => {
  it("drops one destination and its pin, keeping the rest in order", () => {
    const { home, parent } = sandbox();
    const local = join(parent, "this-mac");
    const later = join(parent, "later");
    writeFileSync(join(home, "secrets", BACKUP_DIRECTORY_SECRET), `${local}\n${PIN.root}\n${later}\n`);
    const other: VolumePin = { ...PIN, mountPoint: "/Volumes/Other", root: "/Volumes/Other/backups" };
    unwrap(writeVolumePins({ home, pins: [PIN, other] }));
    const report = unwrap(changeDestinations({ address: PIN.root, change: "remove", home, probes: NO_DRIVE }));
    expect(report.destinations).toEqual([local, later]);
    expect(listedRoots({ home })).toEqual([local, later]);
    expect(unwrap(readVolumePins({ home }))).toEqual([other]);
  });

  it("refuses a destination that is not on the list, and the last one on it", () => {
    const { home, parent } = sandbox();
    const local = join(parent, "this-mac");
    writeFileSync(join(home, "secrets", BACKUP_DIRECTORY_SECRET), `${local}\n`);
    expect(unwrapErr(changeDestinations({ address: "/elsewhere", change: "remove", home, probes: NO_DRIVE }))).toEqual([
      "/elsewhere is not a backup destination — nothing was removed",
    ]);
    expect(unwrapErr(changeDestinations({ address: local, change: "remove", home, probes: NO_DRIVE }))[0]).toContain(
      `${local} is the only backup destination`,
    );
    expect(listedRoots({ home })).toEqual([local]);
  });

  it("puts the earlier pins back when the list cannot be written", () => {
    const { home, parent } = sandbox();
    const local = join(parent, "this-mac");
    const listPath = join(home, "secrets", BACKUP_DIRECTORY_SECRET);
    writeFileSync(listPath, `${local}\n${PIN.root}\n`);
    unwrap(writeVolumePins({ home, pins: [PIN] }));
    const before = readFileSync(volumePinPath({ home }));
    // The list reads, and cannot be replaced: a secret is never written under a home others can write to.
    chmodSync(home, 0o777);
    try {
      const refused = unwrapErr(changeDestinations({ address: PIN.root, change: "remove", home, probes: NO_DRIVE }));
      expect(refused).toHaveLength(1);
    } finally {
      chmodSync(home, 0o700);
    }
    expect(readFileSync(volumePinPath({ home }))).toEqual(before);
    expect(listedRoots({ home })).toEqual([local, PIN.root]);
  });
});

describe("destinationSettingsLines", () => {
  it("names the pinned drive, the whole list in order, and an environment variable that replaces it", () => {
    const lines = destinationSettingsLines({
      envValue: "/elsewhere",
      report: {
        change: "add",
        destinations: ["/Users/me/backups", PIN.root],
        pin: PIN,
        pinPath: "/home/backups/store/destination-pin.json",
        root: PIN.root,
        secretPath: "/s",
      },
    });
    expect(lines).toEqual([
      "store backup: backups now also go to /Volumes/FixtureDrive/backups (remembered in /s)",
      "  each night writes, in this order: /Users/me/backups, /Volumes/FixtureDrive/backups",
      '  pinned to the drive "FixtureDrive" (volume 00000000-0000-4000-8000-0000000000A1) at /Volumes/FixtureDrive, ' +
        "recorded in /home/backups/store/destination-pin.json",
      "  a night the drive is out stages here and says DRIVE NOT PLUGGED IN; `--sweep-only` sends it once it is back",
      "  NOTE: SLOPWEAVER_BACKUP_DIRECTORY is set to /elsewhere in this environment and replaces the remembered list for a run",
    ]);
  });

  it("says a removal plainly, with no pin line", () => {
    const lines = destinationSettingsLines({
      envValue: undefined,
      report: { change: "remove", destinations: ["/a"], pin: null, pinPath: "/p", root: "/b", secretPath: "/s" },
    });
    expect(lines).toEqual(["store backup: backups no longer go to /b (remembered in /s)"]);
  });
});
