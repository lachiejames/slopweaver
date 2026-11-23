/**
 * `slopweaver store backup --set-destination | --add-destination | --remove-destination <address>` — change the
 * LIST of destinations a night writes to, pinning each one on an external drive.
 *
 * The list is remembered in `secrets/store-backup-directory`, one address per line, so it travels in `secrets.enc`
 * to a new Mac exactly as the single address did. Each pinned drive is one row of `backups/store/destination-pin.json`
 * (`src/store/backup/volumePins.ts`): the volume UUID mounted at `/Volumes/<name>` right now, for exactly that root.
 * Pinning refuses when nothing is mounted there — the one moment a name cannot be checked is the moment it would be
 * trusted.
 *
 * - `--set-destination` replaces the whole list with one, and every pin with that one's (none for a folder on a
 *   disk that is always there), so a pin for a destination no longer on the list does not linger.
 * - `--add-destination` appends one, in the order the night writes, and puts in only its own pin.
 * - `--remove-destination` drops one and its pin. The last one is refused: the nightly would have nowhere to write.
 *
 * Two files change, so each change is a small transaction: both files' exact earlier bytes are held, the pins are
 * written first, the folder is made and checked, the list is written last, and a failure after the first write
 * puts the earlier pin bytes back — and says so when it cannot, never claiming a change half made.
 */
import { readFileSync, rmSync, writeFileSync } from "node:fs";

import { err, ok, type Result } from "#lib/result.js";

import { writeSecretFile } from "../../../secrets/store.js";
import { BACKUP_DIRECTORY_SECRET, refuseHomeOverlap } from "../../../store/backup/destination.js";
import {
  type ConfiguredDestination,
  configuredDestination,
  destinationListText,
  rememberedDestinations,
} from "../../../store/backup/destinationConfig.js";
import { DestinationListErrors } from "../../../store/backup/destinationListErrors.js";
import { BackupErrors, backupErrorLines } from "../../../store/backup/errors.js";
import { type MadeFolder, makeFolders, removeMadeFolders } from "../../../store/backup/madeFolders.js";
import { pinFor, placeRoot, type VolumePin } from "../../../store/backup/volumePin.js";
import { VolumePinErrors } from "../../../store/backup/volumePinErrors.js";
import { readVolumePins, volumePinPath, withPin, writeVolumePins } from "../../../store/backup/volumePins.js";
import { type DriveProbes, SYSTEM_DRIVE_PROBES, stillOnPinnedDrive } from "./writeDestination.js";

/** Which change to the list was asked for. */
export type DestinationChangeKind = "set" | "add" | "remove";

/** What a change to the list left remembered. */
export interface DestinationSettingsReport {
  readonly change: DestinationChangeKind;
  /** The destination the change named. */
  readonly root: string;
  /** The drive it was pinned to, or `null` for a folder on a disk that is always there, or a removal. */
  readonly pin: VolumePin | null;
  /** Every destination now on the list, in the order the night writes them. */
  readonly destinations: readonly string[];
  readonly secretPath: string;
  readonly pinPath: string;
}

/** A destination whose drive, if it has one, has been checked and is ready to pin. */
interface PinnableRoot {
  readonly physicalRoot: string;
  readonly mountPoint: string | null;
  readonly pin: VolumePin | null;
  readonly device: number | null;
}

/**
 * Change the remembered list.
 *
 * @param home the Slopweaver home whose list and pins it writes
 * @param change set, add or remove
 * @param address the address the flag carried
 * @param probes the drive reads; a test passes its own
 * @returns what is remembered now, or every reason nothing changed
 */
export function changeDestinations({
  home,
  change,
  address,
  probes = SYSTEM_DRIVE_PROBES,
}: {
  home: string;
  change: DestinationChangeKind;
  address: string;
  probes?: DriveProbes;
}): Result<DestinationSettingsReport> {
  const named = configuredDestination({ address });
  if (named.isErr()) {
    return err([named.error.message]);
  }
  const listed = rememberedDestinations({ home });
  if (listed.isErr()) {
    return err([listed.error.message]);
  }
  const destination = named.value;
  if (change === "remove") {
    return removeDestination({ destination, home, listed: listed.value, probes });
  }
  if (change === "add" && listed.value.some((existing) => existing.id === destination.id)) {
    return err([DestinationListErrors.alreadyListed({ root: destination.root }).message]);
  }
  const list = change === "set" ? [destination] : [...listed.value, destination];
  return rememberWithRoot({ change, destination, home, list, probes });
}

/**
 * Record the pins a change leaves BEFORE any folder is made, so no folder exists on a drive without its pin; a later
 * step that fails calls `undo`, which puts the earlier bytes back, so the destinations already in use keep working.
 *
 * @param home the Slopweaver home
 * @param change set or add
 * @param pin the new destination's pin, or `null` when it sits on no external drive
 * @returns the pin file's path and how to put it back, or why the pins could not be recorded
 */
function recordPinsFirst({
  home,
  change,
  pin,
}: {
  home: string;
  change: DestinationChangeKind;
  pin: VolumePin | null;
}): Result<{ readonly pinPath: string; readonly undo: () => readonly string[] }> {
  const nextPins = pinsAfter({ change, home, pin });
  if (nextPins.isErr()) {
    return err(nextPins.error);
  }
  const pinPath = volumePinPath({ home });
  const earlier = heldBytes({ path: pinPath });
  if (earlier.isErr()) {
    return err([VolumePinErrors.pinUnreadable({ cause: earlier.error, path: pinPath }).message]);
  }
  const written = writeVolumePins({ home, pins: nextPins.value });
  if (written.isErr()) {
    return err([written.error.message]);
  }
  return ok({ pinPath, undo: () => restoredBytes({ earlier: earlier.value, path: pinPath }) });
}

/**
 * Pin, make and remember one destination as part of a new list.
 *
 * @param home the Slopweaver home
 * @param change set or add
 * @param destination the destination being put on the list
 * @param list the whole list to remember
 * @param probes the drive reads
 * @returns what is remembered now, or every reason nothing changed
 */
function rememberWithRoot({
  home,
  change,
  destination,
  list,
  probes,
}: {
  home: string;
  change: DestinationChangeKind;
  destination: ConfiguredDestination;
  list: readonly ConfiguredDestination[];
  probes: DriveProbes;
}): Result<DestinationSettingsReport> {
  const pinnable = pinnableRoot({ probes, root: destination.root });
  if (pinnable.isErr()) {
    return err(pinnable.error);
  }
  const { device, mountPoint, physicalRoot, pin } = pinnable.value;
  const recorded = recordPinsFirst({ change, home, pin });
  if (recorded.isErr()) {
    return err(recorded.error);
  }
  const { pinPath, undo } = recorded.value;
  // Made at the PHYSICAL root, so a link re-pointed after placement cannot carry the mkdir elsewhere.
  const prepared = preparedRoot({ home, root: physicalRoot });
  if (prepared.isErr()) {
    return err([...prepared.error, ...undo()]);
  }
  // Checked again AFTER the mkdir: a drive pulled between the last check and the mkdir leaves the folder on the boot
  // disk where its mount point was, so what was made is taken back and nothing is remembered.
  if (
    mountPoint !== null &&
    pin !== null &&
    device !== null &&
    !stillOnPinnedDrive({ device, mountPoint, path: physicalRoot, pin, probes })
  ) {
    removeMadeFolders({ made: prepared.value });
    return err([VolumePinErrors.changed({ mountPoint }).message, ...undo()]);
  }
  const secret = writeSecretFile({
    home,
    name: BACKUP_DIRECTORY_SECRET,
    value: destinationListText({ destinations: list }),
  });
  if (secret.isErr()) {
    removeMadeFolders({ made: prepared.value });
    return err([secret.error.message, ...undo()]);
  }
  return ok({
    change,
    destinations: list.map((one) => one.root),
    pin,
    pinPath,
    root: destination.root,
    secretPath: secret.value.path,
  });
}

/**
 * Drop one destination and its pin from the list.
 *
 * @param home the Slopweaver home
 * @param destination the destination to drop
 * @param listed the list remembered now
 * @param probes the drive reads, to place the root its pin was recorded under
 * @returns what is remembered now, or why nothing changed
 */
function removeDestination({
  home,
  destination,
  listed,
  probes,
}: {
  home: string;
  destination: ConfiguredDestination;
  listed: readonly ConfiguredDestination[];
  probes: DriveProbes;
}): Result<DestinationSettingsReport> {
  if (!listed.some((existing) => existing.id === destination.id)) {
    return err([DestinationListErrors.notListed({ root: destination.root }).message]);
  }
  if (listed.length === 1) {
    return err([DestinationListErrors.lastDestination({ root: destination.root }).message]);
  }
  const pins = readVolumePins({ home });
  if (pins.isErr()) {
    return err([pins.error.message]);
  }
  // A pin is recorded under the root a write really lands on; a drive that is out still places through its link.
  const placed = placeRoot({ identityOf: probes.identityOf, root: destination.root });
  const roots = new Set([destination.root, ...(placed.isOk() ? [placed.value.physicalRoot] : [])]);
  const pinPath = volumePinPath({ home });
  const earlier = heldBytes({ path: pinPath });
  if (earlier.isErr()) {
    return err([VolumePinErrors.pinUnreadable({ cause: earlier.error, path: pinPath }).message]);
  }
  const written = writeVolumePins({ home, pins: pins.value.filter((pin) => !roots.has(pin.root)) });
  if (written.isErr()) {
    return err([written.error.message]);
  }
  const list = listed.filter((existing) => existing.id !== destination.id);
  const secret = writeSecretFile({
    home,
    name: BACKUP_DIRECTORY_SECRET,
    value: destinationListText({ destinations: list }),
  });
  if (secret.isErr()) {
    return err([secret.error.message, ...restoredBytes({ earlier: earlier.value, path: pinPath })]);
  }
  return ok({
    change: "remove",
    destinations: list.map((one) => one.root),
    pin: null,
    pinPath,
    root: destination.root,
    secretPath: secret.value.path,
  });
}

/**
 * Place a root and, when it is on an external drive, read the pin for it — BEFORE any folder is made, because a
 * recursive mkdir under an absent drive would make it on the boot disk. The device is read on both sides of the
 * UUID, so a swap between them is refused rather than pinned.
 *
 * @param root the destination root
 * @param probes the drive reads
 * @returns where the root lands and the pin to record, or why it cannot be pinned
 */
function pinnableRoot({ root, probes }: { root: string; probes: DriveProbes }): Result<PinnableRoot> {
  const placed = placeRoot({ identityOf: probes.identityOf, root });
  if (placed.isErr()) {
    return err([placed.error.message]);
  }
  const { mountPoint, physicalRoot } = placed.value;
  if (mountPoint === null) {
    return ok({ device: null, mountPoint, physicalRoot, pin: null });
  }
  const device = probes.deviceOf({ mountPoint });
  const pinned = pinFor({ mountPoint, readVolume: probes.readVolume, root: physicalRoot });
  if (pinned.isErr()) {
    return err([pinned.error.message]);
  }
  if (device === null || probes.deviceOf({ mountPoint }) !== device) {
    return err([VolumePinErrors.changed({ mountPoint }).message]);
  }
  if (probes.deviceUnder({ path: physicalRoot }) !== device) {
    return err([VolumePinErrors.nested({ mountPoint, root }).message]);
  }
  return ok({ device, mountPoint, physicalRoot, pin: pinned.value });
}

/**
 * The pins a set or an add leaves: a set keeps only its own, an add puts its own in beside every other.
 *
 * @param home the Slopweaver home
 * @param change set or add
 * @param pin the named destination's pin, `null` when it has none
 * @returns the pins to record, or why the pins recorded now cannot be read for an add
 */
function pinsAfter({
  home,
  change,
  pin,
}: {
  home: string;
  change: DestinationChangeKind;
  pin: VolumePin | null;
}): Result<readonly VolumePin[]> {
  if (change === "set") {
    return ok(pin === null ? [] : [pin]);
  }
  const pins = readVolumePins({ home });
  if (pins.isErr()) {
    return err([pins.error.message]);
  }
  if (pin === null) {
    return ok(pins.value);
  }
  return ok(withPin({ pin, pins: pins.value }));
}

/**
 * Make the root (0700) and refuse one overlapping the home a backup stages plaintext under.
 *
 * @param home the Slopweaver home
 * @param root the destination root
 * @returns the folders this call made, deepest first (none when the root was already there), or why it cannot be
 *   a destination — a refused root's folders are removed again
 */
function preparedRoot({ home, root }: { home: string; root: string }): Result<readonly MadeFolder[]> {
  let made: readonly MadeFolder[];
  try {
    made = makeFolders({ root });
  } catch (error: unknown) {
    return err(backupErrorLines({ error: BackupErrors.destinationUncreatable({ cause: error, destination: root }) }));
  }
  const overlap = refuseHomeOverlap({ home, root });
  if (overlap.isErr()) {
    removeMadeFolders({ made });
    return err(backupErrorLines({ error: overlap.error }));
  }
  return ok(made);
}

/**
 * A file's exact bytes before a change replaces it.
 *
 * @param path the file
 * @returns its bytes, `null` when there is no file, or the read's failure when it is there but cannot be read
 */
function heldBytes({ path }: { path: string }): Result<Buffer | null, unknown> {
  try {
    return ok(readFileSync(path));
  } catch (cause: unknown) {
    // ENOTDIR: something above it is a file, so nothing can be there either.
    if (cause instanceof Error && "code" in cause && (cause.code === "ENOENT" || cause.code === "ENOTDIR")) {
      return ok(null);
    }
    return err(cause);
  }
}

/**
 * Put back the pin file a failed change replaced: the earlier bytes exactly as they were, or the file removed when
 * there was none.
 *
 * @param path the pin file
 * @param earlier its bytes before this change, `null` when there was none
 * @returns nothing when it is back, else the line saying it could not be
 */
function restoredBytes({ path, earlier }: { path: string; earlier: Buffer | null }): readonly string[] {
  try {
    if (earlier === null) {
      rmSync(path, { force: true });
    } else {
      writeFileSync(path, earlier, { mode: 0o600 });
    }
    return [];
  } catch (cause: unknown) {
    return [VolumePinErrors.pinWriteFailed({ cause, path }).message];
  }
}
