/**
 * The destinations a WRITING `store backup` run resolves — the nightly, `--sweep-only` and `--check` — and the one
 * place a destination on an external drive is held to its pin (`src/store/backup/volumePin.ts`).
 *
 * Two halves, because one door is opened per destination and nothing may be made before it is (a
 * list of local destinations). {@link inspectWriteDestinations} is READ-ONLY: it reads the list and the pins, places
 * each root, and says per destination whether it is reachable, its pinned drive is out, or it is refused — one bad
 * destination never stops the others. {@link openWriteDestination} runs INSIDE that destination's door: it makes the
 * root and returns the transport.
 *
 * A destination anywhere but `/Volumes/<name>/…` is a plain local folder. One on an external volume is written only
 * while the volume mounted there carries the UUID `--set-destination` recorded for exactly that root: absent, the run
 * is told the drive is not plugged in and never makes a folder where the drive belongs; a different volume under the
 * same name is refused. Reads — `store recover`, `store rehearse` — never come here: a new Mac recovering from the
 * drive has no pin, and needs none to read.
 */

import { errorMessage } from "#lib/errorMessage.js";
import { err, ok, type Result } from "#lib/result.js";
import { deviceUnder, mountedDevice, readDarwinVolume } from "../../../store/backup/darwinVolume.js";
import {
  type BackupDestinationOrigin,
  backupDestinations,
  type ConfiguredDestination,
  type DestinationId,
  rememberedDestinations,
} from "../../../store/backup/destinationConfig.js";
import { BackupErrors, backupErrorLines } from "../../../store/backup/errors.js";
import { type MadeFolder, makeFoldersHeld } from "../../../store/backup/madeFolders.js";
import { pinnedTransport } from "../../../store/backup/pinnedTransport.js";
import { type BackupProtection, writeProtectionHit } from "../../../store/backup/protectedPaths.js";
import { BackupProtectionErrors } from "../../../store/backup/protectedPathsErrors.js";
import { type IdentityOf, statIdentity } from "../../../store/backup/realPlace.js";
import { BackupSendErrors } from "../../../store/backup/sendErrors.js";
import { pruneObligations } from "../../../store/backup/stagingDestinations.js";
import type { BackupTransport } from "../../../store/backup/transport.js";
import { pinVerdict, placeRoot, type ReadVolume, type VolumePin } from "../../../store/backup/volumePin.js";
import { VolumePinErrors } from "../../../store/backup/volumePinErrors.js";
import { pinForRoot, readVolumePins } from "../../../store/backup/volumePins.js";
import { openLocalDestination } from "./verbShell.js";

/** Reads the device a mount point is mounted on, `null` when nothing is. */
type DeviceOfMount = (args: { mountPoint: string }) => number | null;

/** Reads the device a write to a path would land on, `null` when nothing along it can be read. */
type DeviceUnderPath = (args: { path: string }) => number | null;

/** The system reads a writing destination depends on, so a test names a drive without one plugged in. */
export interface DriveProbes {
  readonly readVolume: ReadVolume;
  readonly deviceOf: DeviceOfMount;
  readonly deviceUnder: DeviceUnderPath;
  /** Reads an entry's identity, so a root is placed on `/Volumes` by what it IS, not how it is spelled. */
  readonly identityOf: IdentityOf;
}

/** The production reads. */
export const SYSTEM_DRIVE_PROBES: DriveProbes = {
  deviceOf: mountedDevice,
  deviceUnder,
  identityOf: statIdentity,
  readVolume: readDarwinVolume,
};

/** The pinned drive a reachable destination is held to while it is written. */
interface HeldDrive {
  readonly pin: VolumePin;
  /** The mount point derived from where the root lands, never the one the pin file names. */
  readonly mountPoint: string;
  /** The device the pinned UUID was read from. */
  readonly device: number;
}

/** One destination as a writing run finds it, before anything is made. */
export type WriteInspection =
  | {
      readonly kind: "reachable";
      readonly destination: ConfiguredDestination;
      /** Where every write goes, with links resolved — never back through the spelling. */
      readonly physicalRoot: string;
      /** The drive it is pinned to, or `null` for a folder on a disk that is always there. */
      readonly held: HeldDrive | null;
    }
  | { readonly kind: "not-plugged-in"; readonly destination: ConfiguredDestination; readonly pin: VolumePin }
  | { readonly kind: "failed"; readonly destination: ConfiguredDestination; readonly errors: readonly string[] };

/** Every destination a writing run sends to, as it found each. */
export interface WriteDestinations {
  readonly origin: BackupDestinationOrigin;
  /** One per destination, in list order. */
  readonly inspections: readonly WriteInspection[];
  /** The ids pruning reads each staging against: the remembered list plus tonight's override. */
  readonly obligations: readonly DestinationId[];
  /** Every recorded pin, so a caller labels a destination by its drive's name without reading them again. */
  readonly pins: readonly VolumePin[];
}

/**
 * Read the list and the pins, and inspect every destination on it. Nothing is made.
 *
 * @param home the Slopweaver home whose list and pins it reads
 * @param override what `--destination` carried, or `null`
 * @param protection the owner's protected paths: a destination at or under one, or holding a `no-access` one, is
 *   that destination's failed arm, and the others are still inspected
 * @param probes the drive reads; a test passes its own
 * @returns every destination's inspection, or why the list or the pins could not be read
 */
export function inspectWriteDestinations({
  home,
  override,
  protection,
  probes = SYSTEM_DRIVE_PROBES,
}: {
  home: string;
  override: string | null;
  protection: BackupProtection;
  probes?: DriveProbes;
}): Result<WriteDestinations> {
  const selection = backupDestinations({ home, override });
  if (selection.isErr()) {
    return err([selection.error.message]);
  }
  // The remembered list is read even under an override: pruning must still keep what it owes.
  const remembered = rememberedDestinations({ home });
  if (remembered.isErr()) {
    return err([remembered.error.message]);
  }
  const pins = readVolumePins({ home });
  if (pins.isErr()) {
    return err([pins.error.message]);
  }
  const { destinations, origin } = selection.value;
  return ok({
    inspections: destinations.map((destination) =>
      inspectGuarded({ destination, pins: pins.value, probes, protection }),
    ),
    obligations: pruneObligations({ active: destinations, remembered: remembered.value }),
    origin,
    pins: pins.value,
  });
}

/**
 * Inspect one destination with a throw turned into its failed arm, so a probe the filesystem refuses (an `EACCES`
 * from `statSync`, say) fails that destination alone and every later one is still inspected and sent.
 *
 * @param destination the destination
 * @param pins every recorded pin
 * @param probes the drive reads
 * @param protection the owner's protected paths
 * @returns the inspection
 */
function inspectGuarded({
  destination,
  pins,
  probes,
  protection,
}: {
  destination: ConfiguredDestination;
  pins: readonly VolumePin[];
  probes: DriveProbes;
  protection: BackupProtection;
}): WriteInspection {
  try {
    return inspectOne({ destination, pins, probes, protection });
  } catch (error: unknown) {
    const why = errorMessage({ error });
    return {
      destination,
      errors: [BackupSendErrors.inspectThrew({ root: destination.root, why }).message],
      kind: "failed",
    };
  }
}

/**
 * Inspect one destination: refuse it when the owner protects it, place its root by where a write really lands, then
 * hold it to its pin when that is on a drive.
 *
 * The protection is asked TWICE, by spelling before anything touches the root and by its physical place once that is
 * known, so a link into a protected folder is refused before a probe, a `mkdir` or a listing reaches it.
 *
 * @param destination the destination
 * @param pins every recorded pin
 * @param probes the drive reads
 * @param protection the owner's protected paths
 * @returns the inspection
 */
function inspectOne({
  destination,
  pins,
  probes,
  protection,
}: {
  destination: ConfiguredDestination;
  pins: readonly VolumePin[];
  probes: DriveProbes;
  protection: BackupProtection;
}): WriteInspection {
  const failed = ({ errors }: { errors: readonly string[] }): WriteInspection => ({
    destination,
    errors,
    kind: "failed",
  });
  const refused = ({ targets }: { targets: readonly string[] }): WriteInspection | null => {
    const entry = writeProtectionHit({ protection, targets });
    if (entry === undefined) {
      return null;
    }
    const error = BackupProtectionErrors.protectedPlace({ entry, role: "destination", target: destination.root });
    return failed({ errors: [error.message] });
  };
  const bySpelling = refused({ targets: [destination.root] });
  if (bySpelling !== null) {
    return bySpelling;
  }
  // Placed by where a write really lands: a root reached through a link onto a drive is held to the pin too.
  const placed = placeRoot({ identityOf: probes.identityOf, root: destination.root });
  if (placed.isErr()) {
    return failed({ errors: [placed.error.message] });
  }
  const { mountPoint, physicalRoot } = placed.value;
  const byPlace = refused({ targets: [physicalRoot] });
  if (byPlace !== null) {
    return byPlace;
  }
  // Every write goes to the PHYSICAL root, never back through the spelling: a link re-pointed after it was placed
  // would otherwise carry the writes somewhere no check looked.
  if (mountPoint === null) {
    return { destination, held: null, kind: "reachable", physicalRoot };
  }
  // A pin is honoured only for exactly this root on exactly this mount point, so the UUID read before every
  // operation is read where the write lands, whatever the file on disk says.
  const pin = pinForRoot({ mountPoint, pins, root: physicalRoot });
  if (pin === null) {
    return failed({ errors: [VolumePinErrors.pinRequired({ mountPoint, root: destination.root }).message] });
  }
  const held = heldDrive({ mountPoint, physicalRoot, pin, probes });
  if (held.isErr()) {
    return failed({ errors: held.error });
  }
  if (held.value === null) {
    return { destination, kind: "not-plugged-in", pin };
  }
  return { destination, held: held.value, kind: "reachable", physicalRoot };
}

/**
 * Whether the pinned drive is the one mounted where the root lands, read device-UUID-device.
 *
 * @param mountPoint the mount point derived from where the root lands
 * @param physicalRoot the root a write lands on
 * @param pin the pin recorded for exactly that root
 * @param probes the drive reads
 * @returns the drive to hold the writes to, `null` when it is out, or why it is refused
 */
function heldDrive({
  mountPoint,
  physicalRoot,
  pin,
  probes,
}: {
  mountPoint: string;
  physicalRoot: string;
  pin: VolumePin;
  probes: DriveProbes;
}): Result<HeldDrive | null> {
  // The device is read on both sides of the UUID, so the device every later operation is held to is the one the
  // UUID was read from: a swap between the two reads changes it and is refused.
  const device = probes.deviceOf({ mountPoint });
  const observed = probes.readVolume({ mountPoint });
  if (observed.isErr()) {
    return err([observed.error.message]);
  }
  const verdict = pinVerdict({ observation: observed.value, pin });
  if (verdict.kind === "not-plugged-in" || device === null) {
    return ok(null);
  }
  if (probes.deviceOf({ mountPoint }) !== device) {
    return err([VolumePinErrors.changed({ mountPoint }).message]);
  }
  if (verdict.kind === "different-volume") {
    const mismatch = VolumePinErrors.mismatch({
      actualVolumeUuid: verdict.actualVolumeUuid,
      expectedVolumeUuid: pin.volumeUuid,
      mountPoint,
    });
    return err([mismatch.message]);
  }
  // The root must land on the drive itself, not on another volume mounted inside it.
  if (probes.deviceUnder({ path: physicalRoot }) !== device) {
    return err([VolumePinErrors.nested({ mountPoint, root: pin.root }).message]);
  }
  return ok({ device, mountPoint, pin });
}

/**
 * Open one reachable destination for writing — run INSIDE its door, so nothing is made before the door passed.
 *
 * @param home the Slopweaver home whose staging the root must stay clear of
 * @param inspection the reachable destination, as inspected
 * @param create whether to make the root — a backup does, `--check` does not
 * @param probes the drive reads
 * @returns the PLAIN transport (the caller wraps it in the object cipher), or why the root could not be opened
 */
export function openWriteDestination({
  home,
  inspection,
  create,
  probes = SYSTEM_DRIVE_PROBES,
}: {
  home: string;
  inspection: Extract<WriteInspection, { kind: "reachable" }>;
  create: boolean;
  probes?: DriveProbes;
}): Result<BackupTransport> {
  const { held, physicalRoot } = inspection;
  if (held === null) {
    return openLocalDestination({ create, home, root: physicalRoot });
  }
  const { device, mountPoint, pin } = held;
  // The root is made HERE, then checked again: a drive pulled between the last check and the mkdir leaves the folder
  // on the boot disk where its mount point was, so what was made is taken back and nothing is written.
  // The local open is then asked to make NOTHING — an unguarded mkdir after this check would reopen
  // the window — and its transport refuses a root that has gone rather than making it again.
  if (create) {
    let made: readonly MadeFolder[] | null;
    try {
      made = makeFoldersHeld({
        root: physicalRoot,
        stillHolds: () => stillOnPinnedDrive({ device, mountPoint, path: physicalRoot, pin, probes }),
      });
    } catch (error: unknown) {
      return err(
        backupErrorLines({ error: BackupErrors.destinationUncreatable({ cause: error, destination: physicalRoot }) }),
      );
    }
    if (made === null) {
      return err([VolumePinErrors.changed({ mountPoint }).message]);
    }
  }
  return openLocalDestination({ create: false, home, root: physicalRoot }).map((inner) =>
    pinnedTransport({
      inner,
      mountPoint,
      root: physicalRoot,
      // The UUID is read again before EVERY operation, not just the device: another drive attached in the device
      // slot this one left reports the same device number. MEASURED on a disk
      // image (`time diskutil info -plist /Volumes/<name>`): 0.15s a read, against 67 objects a night.
      // And the device is read under the exact path an operation touches, so a volume mounted anywhere below the
      // root — `<root>/slopweaver`, say — never takes a write.
      stillMounted: ({ path }) => stillOnPinnedDrive({ device, mountPoint, path, pin, probes }),
    }),
  );
}

/**
 * Whether a write to `path` still lands on the pinned drive: the same device mounted at the mount point, the same
 * device under the exact path, and the pinned UUID read there now. A read that fails is not.
 *
 * @param device the device the pinned UUID was read from
 * @param mountPoint the mount point derived from where the root lands, never the one the pin file names
 * @param path the exact path about to be written
 * @param pin the pin the run writes under
 * @param probes the drive reads
 * @returns `true` only when all three still hold
 */
export function stillOnPinnedDrive({
  device,
  mountPoint,
  path,
  pin,
  probes,
}: {
  device: number;
  mountPoint: string;
  path: string;
  pin: VolumePin;
  probes: DriveProbes;
}): boolean {
  if (probes.deviceOf({ mountPoint }) !== device || probes.deviceUnder({ path }) !== device) {
    return false;
  }
  const observed = probes.readVolume({ mountPoint });
  return observed.isOk() && pinVerdict({ observation: observed.value, pin }).kind === "plugged-in";
}

/**
 * Whether the drive a destination is pinned to is out now — asked again after a send to it failed, so a drive
 * ejected mid-run reads as a night that finished locally rather than a failed backup.
 *
 * @param pin the pin the run wrote under
 * @param probes the drive reads
 * @returns `true` only when nothing is mounted where the drive belongs
 */
export function driveNowUnplugged({
  pin,
  probes = SYSTEM_DRIVE_PROBES,
}: {
  pin: VolumePin;
  probes?: DriveProbes;
}): boolean {
  const observed = probes.readVolume({ mountPoint: pin.mountPoint });
  if (observed.isErr()) {
    return false;
  }
  return pinVerdict({ observation: observed.value, pin }).kind === "not-plugged-in";
}
