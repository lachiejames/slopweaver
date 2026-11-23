/**
 * Where a WRITING backup run sends its objects, and the guard that keeps one off the boot disk while its drive is
 * out. The drive reads are plain fakes (`DriveProbes`), so a destination under `/Volumes/<name>` is judged without
 * one mounted; a destination anywhere else is a real directory beside a sandbox home.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  type DriveProbes,
  driveNowUnplugged,
  inspectWriteDestinations,
  openWriteDestination,
  SYSTEM_DRIVE_PROBES,
} from "../../../../../cli/commands/store/writeDestination.js";
import { err, ok, type Result, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { localDirectoryTransport } from "../../../../../store/backup/localDirectoryTransport.js";
import { pinnedTransport } from "../../../../../store/backup/pinnedTransport.js";
import { type BackupProtection, NO_PROTECTION } from "../../../../../store/backup/protectedPaths.js";
import { type IdentityOf, statIdentity } from "../../../../../store/backup/realPlace.js";
import type { BackupTransport } from "../../../../../store/backup/transport.js";
import type { VolumePin } from "../../../../../store/backup/volumePin.js";
import { writeVolumePins } from "../../../../../store/backup/volumePins.js";

const ROOT = "/Volumes/FixtureDrive/backups";
const PIN: VolumePin = {
  mountPoint: "/Volumes/FixtureDrive",
  root: ROOT,
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
  const parent = mkdtempSync(join(tmpdir(), "write-destination-"));
  minted.push(parent);
  const home = join(parent, "home");
  mkdirSync(join(home, "secrets"), { recursive: true });
  return { home, parent };
}

/**
 * Drive probes that report one volume UUID — or nothing — at the fixture mount point.
 *
 * @param volumeUuid the UUID mounted there, or `null` for nothing mounted
 * @param device the device number the mount reports, or `null` for none
 * @returns the probes
 */
function probesWith({ volumeUuid, device }: { volumeUuid: string | null; device: number | null }): DriveProbes {
  return {
    deviceOf: () => device,
    deviceUnder: () => device,
    identityOf: volumesHere,
    readVolume: ({ mountPoint }) =>
      ok(volumeUuid === null ? null : { mountPoint, volumeName: "FixtureDrive", volumeUuid }),
  };
}

/** One destination resolved for writing, as the night's door sees it after inspection and open. */
type Resolved =
  | { readonly kind: "reachable"; readonly root: string; readonly transport: BackupTransport }
  | { readonly kind: "not-plugged-in"; readonly origin: string; readonly pin: VolumePin; readonly root: string };

/**
 * Inspect the ONE destination `override` names and, when it is reachable, open it — the two halves a door runs.
 *
 * @param home the sandbox home
 * @param override the destination
 * @param create whether the open makes the root
 * @param probes the drive reads
 * @param protection the protected paths the inspection honours, none by default
 * @returns the destination, or why it was refused at either half
 */
function resolveOne({
  home,
  override,
  create,
  probes = SYSTEM_DRIVE_PROBES,
  protection = NO_PROTECTION,
}: {
  home: string;
  override: string;
  create: boolean;
  probes?: DriveProbes;
  protection?: BackupProtection;
}): Result<Resolved> {
  const inspected = inspectWriteDestinations({ home, override, probes, protection });
  if (inspected.isErr()) {
    return err(inspected.error);
  }
  const inspection = inspected.value.inspections[0]!;
  if (inspection.kind === "failed") {
    return err(inspection.errors);
  }
  if (inspection.kind === "not-plugged-in") {
    return ok({ kind: "not-plugged-in", origin: inspected.value.origin, pin: inspection.pin, root: override });
  }
  return openWriteDestination({ create, home, inspection, probes }).map((transport) => ({
    kind: "reachable" as const,
    root: inspection.destination.root,
    transport,
  }));
}

/**
 * Record one pin, replacing any.
 *
 * @param home the sandbox home
 * @param pin the pin
 * @returns the file written
 */
function pinOne({ home, pin }: { home: string; pin: VolumePin }): Result<string> {
  return writeVolumePins({ home, pins: [pin] }).mapErr((error) => [error.message]);
}

describe("resolveWriteDestination on an external drive", () => {
  it("refuses a destination on a drive no pin names, and one pinned for a different root", () => {
    const { home } = sandbox();
    const probes = probesWith({ device: 7, volumeUuid: PIN.volumeUuid });
    const message =
      `${ROOT} is on the external volume /Volumes/FixtureDrive, and no pin names that volume for this destination — ` +
      "with the drive plugged in, run `slopweaver store backup --set-destination <address>` so a backup never " +
      "writes to the boot disk while the drive is out";
    expect(unwrapErr(resolveOne({ create: true, home, override: ROOT, probes }))).toEqual([message]);
    unwrap(pinOne({ home, pin: { ...PIN, root: "/Volumes/FixtureDrive/other" } }));
    expect(unwrapErr(resolveOne({ create: true, home, override: ROOT, probes }))).toEqual([message]);
    unwrap(pinOne({ home, pin: { ...PIN, mountPoint: "/Volumes/OtherDrive" } }));
    expect(unwrapErr(resolveOne({ create: true, home, override: ROOT, probes }))).toEqual([message]);
  });

  it("says the drive is not plugged in when nothing is mounted, and makes no folder where it belongs", () => {
    const { home } = sandbox();
    unwrap(pinOne({ home, pin: PIN }));
    const resolved = unwrap(
      resolveOne({
        create: true,
        home,
        override: ROOT,
        probes: probesWith({ device: null, volumeUuid: null }),
      }),
    );
    expect(resolved).toEqual({ kind: "not-plugged-in", origin: "flag", pin: PIN, root: ROOT });
    expect(existsSync(PIN.mountPoint)).toBe(false);
  });

  it("reads a mount with the pinned UUID but no device as not plugged in", () => {
    const { home } = sandbox();
    unwrap(pinOne({ home, pin: PIN }));
    const probes = probesWith({ device: null, volumeUuid: PIN.volumeUuid });
    expect(unwrap(resolveOne({ create: false, home, override: ROOT, probes })).kind).toBe("not-plugged-in");
  });

  it("refuses a volume swapped between the reads around its UUID, and makes no folder", () => {
    const { home } = sandbox();
    unwrap(pinOne({ home, pin: PIN }));
    const devices = [7, 8];
    const probes: DriveProbes = {
      deviceOf: () => devices.shift()!,
      deviceUnder: () => 7,
      identityOf: volumesHere,
      readVolume: ({ mountPoint }) => ok({ mountPoint, volumeName: "FixtureDrive", volumeUuid: PIN.volumeUuid }),
    };
    expect(unwrapErr(resolveOne({ create: true, home, override: ROOT, probes }))).toEqual([
      "the volume mounted at /Volumes/FixtureDrive changed while it was being checked — nothing is written; run the " +
        "backup again once the drive is settled",
    ]);
    expect(devices).toEqual([]);
    expect(existsSync(PIN.mountPoint)).toBe(false);
  });

  it("refuses every later operation once another drive takes the pinned one's device slot", async () => {
    const { home, parent } = sandbox();
    unwrap(pinOne({ home, pin: PIN }));
    let mountedUuid = PIN.volumeUuid;
    const probes: DriveProbes = {
      deviceOf: () => 7,
      deviceUnder: () => 7,
      identityOf: volumesHere,
      readVolume: ({ mountPoint }) => ok({ mountPoint, volumeName: "FixtureDrive", volumeUuid: mountedUuid }),
    };
    const resolved = unwrap(resolveOne({ create: false, home, override: ROOT, probes }));
    expect(resolved.kind).toBe("reachable");
    mountedUuid = "00000000-0000-4000-8000-0000000000B2";
    const source = join(parent, "object.bin");
    writeFileSync(source, "bytes");
    const transport = (resolved as Extract<typeof resolved, { kind: "reachable" }>).transport;
    expect(unwrapErr(await transport.upload({ objectName: "a/object.bin", path: source })).message).toBe(
      `backup destination ${ROOT} is not a writable directory: the drive at /Volumes/FixtureDrive was ejected or replaced`,
    );
  });

  it("refuses a root on a volume mounted inside the drive, at resolution and before every later operation", async () => {
    const { home, parent } = sandbox();
    unwrap(pinOne({ home, pin: PIN }));
    let rootDevice = 9;
    const probes: DriveProbes = {
      deviceOf: () => 7,
      deviceUnder: () => rootDevice,
      identityOf: volumesHere,
      readVolume: ({ mountPoint }) => ok({ mountPoint, volumeName: "FixtureDrive", volumeUuid: PIN.volumeUuid }),
    };
    expect(unwrapErr(resolveOne({ create: false, home, override: ROOT, probes }))).toEqual([
      `${ROOT} is on a volume mounted inside /Volumes/FixtureDrive, not on the drive at /Volumes/FixtureDrive ` +
        "itself — nothing is written to a volume no pin names; name that volume's own /Volumes path as the destination",
    ]);
    rootDevice = 7;
    const resolved = unwrap(resolveOne({ create: false, home, override: ROOT, probes }));
    rootDevice = 9;
    const source = join(parent, "object.bin");
    writeFileSync(source, "bytes");
    const transport = (resolved as Extract<typeof resolved, { kind: "reachable" }>).transport;
    expect(unwrapErr(await transport.upload({ objectName: "a/object.bin", path: source })).message).toBe(
      `backup destination ${ROOT} is not a writable directory: the drive at /Volumes/FixtureDrive was ejected or replaced`,
    );
  });

  it("refuses an object whose own path lands on a volume mounted below the root", async () => {
    const { home, parent } = sandbox();
    unwrap(pinOne({ home, pin: PIN }));
    const asked: string[] = [];
    const probes: DriveProbes = {
      deviceOf: () => 7,
      deviceUnder: ({ path }) => {
        asked.push(path);
        return path.startsWith(join(ROOT, "slopweaver")) ? 9 : 7;
      },
      identityOf: volumesHere,
      readVolume: ({ mountPoint }) => ok({ mountPoint, volumeName: "FixtureDrive", volumeUuid: PIN.volumeUuid }),
    };
    const resolved = unwrap(resolveOne({ create: false, home, override: ROOT, probes }));
    const source = join(parent, "object.bin");
    writeFileSync(source, "bytes");
    const transport = (resolved as Extract<typeof resolved, { kind: "reachable" }>).transport;
    const objectName = "slopweaver/2026-11-08T00-00-00Z/object.bin";
    expect(unwrapErr(await transport.upload({ objectName, path: source })).message).toBe(
      `backup destination ${ROOT} is not a writable directory: the drive at /Volumes/FixtureDrive was ejected or replaced`,
    );
    expect(asked).toEqual([ROOT, join(ROOT, objectName)]);
  });

  it("refuses a different volume mounted under the same name", () => {
    const { home } = sandbox();
    unwrap(pinOne({ home, pin: PIN }));
    const probes = probesWith({ device: 7, volumeUuid: "00000000-0000-4000-8000-0000000000B2" });
    expect(unwrapErr(resolveOne({ create: true, home, override: ROOT, probes }))).toEqual([
      "the volume mounted at /Volumes/FixtureDrive is 00000000-0000-4000-8000-0000000000B2, not the pinned " +
        "00000000-0000-4000-8000-0000000000A1 — nothing is written to a different drive under the same name; plug " +
        "the pinned drive in, or pin this one with `slopweaver store backup --set-destination <address>`",
    ]);
  });
});

describe("resolveWriteDestination through a link", () => {
  it("places a root through a link onto a drive that is out by where the link points, so a pinned one is not plugged in", () => {
    const { home, parent } = sandbox();
    const alias = join(parent, "alias");
    symlinkSync(PIN.mountPoint, alias);
    const probes = probesWith({ device: null, volumeUuid: null });
    const override = join(alias, "backups");
    expect(unwrapErr(resolveOne({ create: true, home, override, probes }))[0]).toContain(
      `${override} is on the external volume /Volumes/FixtureDrive, and no pin names that volume`,
    );
    unwrap(pinOne({ home, pin: PIN }));
    expect(unwrap(resolveOne({ create: true, home, override, probes }))).toEqual({
      kind: "not-plugged-in",
      origin: "flag",
      pin: PIN,
      root: override,
    });
    expect(existsSync(PIN.mountPoint)).toBe(false);
  });

  it("refuses a root through a dangling link that points anywhere but an external drive, and makes nothing", () => {
    const { home, parent } = sandbox();
    const alias = join(parent, "alias");
    symlinkSync(join(parent, "gone"), alias);
    const refused = unwrapErr(resolveOne({ create: true, home, override: join(alias, "dest") }));
    expect(refused.join("\n")).toContain(`could not read which volume is mounted at ${join(alias, "dest")}`);
    expect(existsSync(join(parent, "gone"))).toBe(false);
  });

  it("places a root reached through a link by where it really lands", () => {
    const { home, parent } = sandbox();
    const real = join(parent, "real");
    mkdirSync(real);
    symlinkSync(real, join(parent, "alias"));
    const resolved = unwrap(resolveOne({ create: true, home, override: join(parent, "alias", "dest") }));
    expect(resolved.kind).toBe("reachable");
    expect(readdirSync(real)).toEqual(["dest"]);
  });

  it("keeps writing where the root was placed once resolved, even after the link is re-pointed", async () => {
    const { home, parent } = sandbox();
    const real = join(parent, "real");
    const elsewhere = join(parent, "elsewhere");
    mkdirSync(real);
    mkdirSync(elsewhere);
    const alias = join(parent, "alias");
    symlinkSync(real, alias);
    const resolved = unwrap(resolveOne({ create: true, home, override: join(alias, "dest") }));
    expect(resolved.root).toBe(join(alias, "dest"));
    rmSync(alias);
    symlinkSync(elsewhere, alias);
    const source = join(parent, "object.bin");
    writeFileSync(source, "bytes");
    expect(resolved.kind).toBe("reachable");
    const transport = (resolved as Extract<typeof resolved, { kind: "reachable" }>).transport;
    unwrap(await transport.upload({ objectName: "a/object.bin", path: source }));
    expect(readdirSync(join(real, "dest"))).toEqual(["a"]);
    expect(readdirSync(elsewhere)).toEqual([]);
  });

  it("refuses a root whose link lands in a protected folder, judged by where it lands, and makes nothing", () => {
    const { home, parent } = sandbox();
    const real = join(parent, "real");
    mkdirSync(real);
    symlinkSync(real, join(parent, "alias"));
    const landing = realpathSync(real);
    const protection: BackupProtection = {
      entries: [{ addedIso: "2026-11-01T00:00:00.000Z", mode: "read-only", path: landing, why: "fixture: kept" }],
    };
    const override = join(parent, "alias", "dest");
    const refused = unwrapErr(resolveOne({ create: true, home, override, protection }));
    expect(refused).toEqual([
      `HELD: destination ${override} reaches ${landing}, which the owner marked read-only (fixture: kept); a backup ` +
        "never writes into a protected path, nor reads a no-access one — choose another place",
    ]);
    expect(readdirSync(real)).toEqual([]);
  });

  it("refuses a root that holds a no-access folder, since its own listing would read into it", () => {
    const { home, parent } = sandbox();
    const override = join(parent, "dest");
    const inside = join(override, "private");
    const protection: BackupProtection = {
      entries: [{ addedIso: "2026-11-01T00:00:00.000Z", mode: "no-access", path: inside, why: "fixture: kept" }],
    };
    const refused = unwrapErr(resolveOne({ create: true, home, override, protection }));
    expect(refused[0]).toContain(`HELD: destination ${override} reaches ${inside}, which the owner marked no-access`);
    expect(existsSync(override)).toBe(false);
  });
});

describe("resolveWriteDestination anywhere else", () => {
  it("makes and returns a folder on an always-there disk with no pin, exactly as before", () => {
    const { home, parent } = sandbox();
    const root = join(parent, "dest");
    const resolved = unwrap(
      resolveOne({
        create: true,
        home,
        override: root,
        probes: probesWith({ device: null, volumeUuid: null }),
      }),
    );
    expect(resolved.kind).toBe("reachable");
    expect(existsSync(root)).toBe(true);
    expect(unwrap(resolveOne({ create: false, home, override: root })).kind).toBe("reachable");
  });

  it("refuses an address naming a held remote kind, never reading it as a path", () => {
    const { home } = sandbox();
    expect(unwrapErr(resolveOne({ create: true, home, override: "s3://bucket/backups" }))).toEqual([
      '"s3://bucket/backups" names a s3:// destination, which is not built — a backup goes to a local folder or a ' +
        "mounted drive; name one as an absolute path or a file:// address",
    ]);
  });
});

describe("inspectWriteDestinations over a list", () => {
  /**
   * Remember a list of destinations, one per line.
   *
   * @param home the sandbox home
   * @param roots the destinations, in order
   */
  function remember({ home, roots }: { home: string; roots: readonly string[] }): void {
    writeFileSync(join(home, "secrets", "store-backup-directory"), roots.map((root) => `${root}\n`).join(""));
  }

  it("inspects every destination independently, in list order, and makes nothing", () => {
    const { home, parent } = sandbox();
    const mac = join(parent, "mac");
    const unpinned = "/Volumes/OtherDrive/backups";
    remember({ home, roots: [unpinned, mac, ROOT] });
    unwrap(pinOne({ home, pin: PIN }));
    const inspected = unwrap(
      inspectWriteDestinations({
        home,
        override: null,
        probes: probesWith({ device: null, volumeUuid: null }),
        protection: NO_PROTECTION,
      }),
    );
    expect(inspected.inspections.map((inspection) => [inspection.kind, inspection.destination.root])).toEqual([
      ["failed", unpinned],
      ["reachable", mac],
      ["not-plugged-in", ROOT],
    ]);
    expect(inspected.origin).toBe("remembered");
    expect(inspected.pins).toEqual([PIN]);
    expect(existsSync(mac)).toBe(false);
  });

  it("holds each drive on the list to its own pin", () => {
    const { home } = sandbox();
    const second = "/Volumes/SecondDrive/backups";
    const secondPin: VolumePin = {
      mountPoint: "/Volumes/SecondDrive",
      root: second,
      volumeName: "SecondDrive",
      volumeUuid: "00000000-0000-4000-8000-0000000000C3",
    };
    remember({ home, roots: [ROOT, second] });
    unwrap(writeVolumePins({ home, pins: [PIN, secondPin] }).mapErr((error) => [error.message]));
    const probes: DriveProbes = {
      deviceOf: ({ mountPoint }) => (mountPoint === PIN.mountPoint ? 7 : null),
      deviceUnder: () => 7,
      identityOf: volumesHere,
      readVolume: ({ mountPoint }) =>
        ok(
          mountPoint === PIN.mountPoint ? { mountPoint, volumeName: "FixtureDrive", volumeUuid: PIN.volumeUuid } : null,
        ),
    };
    const inspected = unwrap(inspectWriteDestinations({ home, override: null, probes, protection: NO_PROTECTION }));
    expect(inspected.inspections.map((inspection) => inspection.kind)).toEqual(["reachable", "not-plugged-in"]);
    const out = inspected.inspections[1] as Extract<(typeof inspected.inspections)[number], { kind: "not-plugged-in" }>;
    expect(out.pin).toEqual(secondPin);
  });

  it("fails only the destination whose drive read throws, and still inspects every later one", () => {
    const { home, parent } = sandbox();
    const mac = join(parent, "mac");
    remember({ home, roots: [ROOT, mac] });
    unwrap(pinOne({ home, pin: PIN }));
    const probes: DriveProbes = {
      deviceOf: () => 7,
      deviceUnder: () => {
        throw new Error("EACCES: permission denied");
      },
      identityOf: volumesHere,
      readVolume: ({ mountPoint }) => ok({ mountPoint, volumeName: "FixtureDrive", volumeUuid: PIN.volumeUuid }),
    };
    const inspected = unwrap(inspectWriteDestinations({ home, override: null, probes, protection: NO_PROTECTION }));
    expect(inspected.inspections.map((inspection) => [inspection.kind, inspection.destination.root])).toEqual([
      ["failed", ROOT],
      ["reachable", mac],
    ]);
    const failed = inspected.inspections[0] as Extract<(typeof inspected.inspections)[number], { kind: "failed" }>;
    expect(failed.errors).toEqual([
      `reading where ${ROOT} lands threw: EACCES: permission denied — nothing was sent to it`,
    ]);
  });

  it("keeps every remembered destination in the obligations when --destination replaces the list for one run", () => {
    const { home, parent } = sandbox();
    const mac = join(parent, "mac");
    const other = join(parent, "other");
    remember({ home, roots: [mac] });
    const inspected = unwrap(inspectWriteDestinations({ home, override: other, protection: NO_PROTECTION }));
    expect(inspected.inspections.map((inspection) => inspection.destination.root)).toEqual([other]);
    expect(inspected.obligations).toHaveLength(2);
    expect(inspected.origin).toBe("flag");
  });
});

describe("driveNowUnplugged", () => {
  it("is true only when nothing is mounted where the pinned drive belongs", () => {
    expect(driveNowUnplugged({ pin: PIN, probes: probesWith({ device: null, volumeUuid: null }) })).toBe(true);
    expect(driveNowUnplugged({ pin: PIN, probes: probesWith({ device: 7, volumeUuid: PIN.volumeUuid }) })).toBe(false);
    expect(driveNowUnplugged({ pin: PIN, probes: probesWith({ device: 7, volumeUuid: "OTHER" }) })).toBe(false);
  });
});

describe("pinnedTransport", () => {
  it("passes every operation through while the drive is mounted, and refuses each once it is not", async () => {
    const { parent } = sandbox();
    const root = join(parent, "drive");
    mkdirSync(root);
    const source = join(parent, "object.bin");
    writeFileSync(source, "bytes");
    let mounted = true;
    const transport = pinnedTransport({
      inner: localDirectoryTransport({ root, rootPolicy: "require-existing" }),
      mountPoint: "/Volumes/FixtureDrive",
      root,
      stillMounted: () => mounted,
    });
    expect((await transport.probe()).isOk()).toBe(true);
    expect(unwrap(await transport.upload({ objectName: "a/object.bin", path: source })).name).toBe("a/object.bin");
    mounted = false;
    const refused = unwrapErr(await transport.upload({ objectName: "b/object.bin", path: source }));
    expect(refused.code).toBe("LOCAL_DESTINATION_UNREACHABLE");
    expect(refused.message).toBe(
      `backup destination ${root} is not a writable directory: the drive at /Volumes/FixtureDrive was ejected or replaced`,
    );
    expect(unwrapErr(await transport.probe()).code).toBe("LOCAL_DESTINATION_UNREACHABLE");
    expect(unwrapErr(await transport.list({ prefix: "a/" })).code).toBe("LOCAL_DESTINATION_UNREACHABLE");
    expect(readdirSync(root)).toEqual(["a"]);
    expect(transport.holds({ path: join(root, "a", "object.bin") })).toBe(true);
  });

  it("fails an upload when the drive is swapped while the object streams, rather than counting it as held", async () => {
    const { parent } = sandbox();
    const root = join(parent, "drive");
    mkdirSync(root);
    const source = join(parent, "object.bin");
    writeFileSync(source, "bytes");
    const answers = [true, false];
    const transport = pinnedTransport({
      inner: localDirectoryTransport({ root, rootPolicy: "require-existing" }),
      mountPoint: "/Volumes/FixtureDrive",
      root,
      stillMounted: () => answers.shift()!,
    });
    expect(unwrapErr(await transport.upload({ objectName: "a/object.bin", path: source })).message).toBe(
      `backup destination ${root} is not a writable directory: the drive at /Volumes/FixtureDrive was ejected or replaced`,
    );
    expect(answers).toEqual([]);
  });
});
