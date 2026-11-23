/**
 * Pinning a backup destination to ONE external volume, so a backup never writes to the boot disk while the drive
 * is out.
 *
 * ## The hole this closes
 *
 * A drive mounts at `/Volumes/<name>`, and the folder vanishes when it is ejected. `/Volumes` is `root:wheel 755`,
 * so with the drive out the destination root normally cannot be made and the night fails. But an ordinary empty
 * folder left at `/Volumes/<name>` — by an unclean eject, or by anything run as root — is indistinguishable by
 * path, and the destination's recursive `mkdir` would then write the whole backup onto the boot disk without a
 * word. So a destination under `/Volumes/<name>/` is written to only while the volume mounted there is the one
 * `store backup --set-destination` recorded.
 *
 * ## The identity is the volume UUID, never the device number
 *
 * MEASURED on a disk image (`hdiutil create -size 20m -fs APFS -volname P p.dmg`, `hdiutil attach`,
 * `diskutil info /Volumes/P | grep 'Volume UUID'`, `stat -f %d /Volumes/P`, detach, attach, read both again):
 * the Volume UUID read the same across the replug. `stat`'s device number did too, but only because the image
 * came back on the same `diskNsM` node — it names the mount's current device slot, which another disk attached
 * in between takes, so it is never the pin. A volume reporting no UUID is refused rather than pinned by its name.
 *
 * The pure half is here; reading what is mounted is `./darwinVolume.ts`, behind {@link ReadVolume}, and the
 * recorded pins — one per pinned destination on the list — are `./volumePins.ts`.
 */
import { lstatSync, readlinkSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

import { err, ok, type Result } from "#lib/result.js";

import { type IdentityOf, type PlaceUnresolvedError, realPlace, statIdentity } from "./realPlace.js";
import { type VolumePinError, VolumePinErrors } from "./volumePinErrors.js";

/** Where external volumes are mounted on macOS. */
const VOLUMES_ROOT = "/Volumes";

/** The one volume a destination root may be written to. Every pinned destination has its own (`./volumePins.ts`). */
export interface VolumePin {
  /** The destination root this pin was recorded for; a pin never carries over to another root. */
  readonly root: string;
  readonly mountPoint: string;
  readonly volumeUuid: string;
  /** The volume's name when it was pinned, for a reader; never compared. */
  readonly volumeName: string;
}

/** What is mounted at one mount point. */
export interface VolumeObservation {
  readonly mountPoint: string;
  /** `null` when the volume reports none. */
  readonly volumeUuid: string | null;
  readonly volumeName: string;
}

/** Read what is mounted at a mount point: the volume, `null` when nothing is, or why it could not be read. */
export type ReadVolume = (args: { mountPoint: string }) => Result<VolumeObservation | null, VolumePinError>;

/** Whether the pinned volume is the one mounted now. */
export type PinVerdict =
  | { readonly kind: "plugged-in" }
  | { readonly kind: "not-plugged-in" }
  | { readonly kind: "different-volume"; readonly actualVolumeUuid: string | null };

/** A root on an external volume: its `/Volumes/<name>` mount point, and the root spelled under `/Volumes`. */
export interface ExternalPlacement {
  readonly mountPoint: string;
  readonly canonicalRoot: string;
}

/**
 * The external volume a destination root sits on, judged by IDENTITY rather than spelling: the root is on the
 * volume `<name>` when one of its ancestors IS the `/Volumes` directory (same device and inode) and `<name>` is the
 * component below it. A prefix test missed `/System/Volumes/Data/Volumes/<name>`, the same directory through the Data
 * volume's firmlink, and `/volumes/<name>` on a case-insensitive disk — Node's `realpathSync` keeps both spellings
 * (`stat -f '%d %i' /Volumes /System/Volumes/Data/Volumes` prints one identity twice).
 *
 * @param root the destination root, absolute and resolved
 * @param identityOf reads an entry's identity; a test passes its own
 * @returns the placement, or `null` when the root is not on an external volume
 */
export function externalPlacement({
  root,
  identityOf,
}: {
  root: string;
  identityOf: IdentityOf;
}): ExternalPlacement | null {
  const volumes = identityOf({ path: VOLUMES_ROOT });
  if (volumes === null) {
    return null;
  }
  const parts = root.split(sep).filter((part) => part !== "");
  for (let depth = 0; depth < parts.length; depth += 1) {
    const parent = identityOf({ path: sep + parts.slice(0, depth).join(sep) });
    if (parent !== null && parent.dev === volumes.dev && parent.ino === volumes.ino) {
      return {
        canonicalRoot: join(VOLUMES_ROOT, ...parts.slice(depth)),
        mountPoint: join(VOLUMES_ROOT, parts[depth]!),
      };
    }
  }
  return null;
}

/** Where a destination root really lands, and the external volume it lands on. */
export interface RootPlacement {
  /**
   * The root with every existing link along it resolved, and spelled under `/Volumes` when it is on an external
   * volume — what a pin is recorded for and compared against, and where every write goes.
   */
  readonly physicalRoot: string;
  /** Its `/Volumes/<name>` mount point, or `null` when it lands anywhere else. */
  readonly mountPoint: string | null;
}

/**
 * Place a destination root by where a write to it would REALLY land, not by how it is spelled: a root reached
 * through a link (`/tmp/alias` → `/Volumes/Drive`) is on the drive, and is held to the pin exactly as
 * `/Volumes/Drive/…` is. Judged lexically, the link skipped the pin while every `mkdir` followed it. It also places `/Volumes/Macintosh HD/…`, a link to `/`, on the boot disk where it belongs.
 *
 * @param root the destination root, absolute
 * @param identityOf reads an entry's identity; a test passes its own
 * @returns the placement, or why the root could not be placed — refused, never guessed
 */
export function placeRoot({
  root,
  identityOf = statIdentity,
}: {
  root: string;
  identityOf?: IdentityOf;
}): Result<RootPlacement, VolumePinError> {
  const real = realPlace({ path: root });
  try {
    if (real.isErr()) {
      // A link onto a drive that is OUT dangles. Read where it points, and when that is on an external volume the
      // root is placed there, so the night is told the drive is not plugged in rather than failing.
      // A dangling link anywhere else stays refused: nothing is made through it.
      const followed = throughDanglingLinks({ path: root, unresolved: real.error });
      const external = followed === null ? null : externalPlacement({ identityOf, root: followed });
      if (external === null) {
        return err(VolumePinErrors.inspectionFailed({ cause: new Error(real.error.message), mountPoint: root }));
      }
      return ok({ mountPoint: external.mountPoint, physicalRoot: external.canonicalRoot });
    }
    const external = externalPlacement({ identityOf, root: real.value });
    if (external === null) {
      return ok({ mountPoint: null, physicalRoot: real.value });
    }
    return ok({ mountPoint: external.mountPoint, physicalRoot: external.canonicalRoot });
  } catch (cause: unknown) {
    return err(VolumePinErrors.inspectionFailed({ cause, mountPoint: root }));
  }
}

/** How many dangling links one root may pass through before it is refused — a loop, past this. */
const MAX_DANGLING_HOPS = 8;

/**
 * Where a root that runs into a dangling link would land, reading each such link rather than following it.
 *
 * @param path the root as spelled
 * @param unresolved why it could not be resolved, naming the deepest entry that exists
 * @returns the place it points at, resolved as far as anything exists, or `null` when the failure is not a
 *   dangling link, or the links loop
 */
function throughDanglingLinks({ path, unresolved }: { path: string; unresolved: PlaceUnresolvedError }): string | null {
  let current = resolve(path);
  let failure = unresolved;
  for (let hop = 0; hop < MAX_DANGLING_HOPS; hop += 1) {
    const at = lstatSync(failure.at, { throwIfNoEntry: false });
    if (at === undefined || !at.isSymbolicLink()) {
      return null;
    }
    const target = resolve(dirname(failure.at), readlinkSync(failure.at));
    current = join(target, relative(failure.at, current));
    const next = realPlace({ path: current });
    if (next.isOk()) {
      return next.value;
    }
    failure = next.error;
  }
  return null;
}

/**
 * Judge the pinned volume against what is mounted at its mount point now.
 *
 * @param pin the recorded pin
 * @param observation what is mounted there, `null` when nothing is
 * @returns plugged in, not plugged in, or a different volume under the same name
 */
export function pinVerdict({
  pin,
  observation,
}: {
  pin: VolumePin;
  observation: VolumeObservation | null;
}): PinVerdict {
  if (observation === null) {
    return { kind: "not-plugged-in" };
  }
  if (observation.volumeUuid !== pin.volumeUuid) {
    return { actualVolumeUuid: observation.volumeUuid, kind: "different-volume" };
  }
  return { kind: "plugged-in" };
}

/**
 * The pin to record for a root, read from what is mounted under it now. Refuses a mount point with nothing on it
 * (a stale folder at `/Volumes/<name>` included) and a volume that reports no UUID.
 *
 * @param root the destination root, on an external volume
 * @param mountPoint its mount point, from {@link externalPlacement}
 * @param readVolume reads what is mounted
 * @returns the pin, or why the volume cannot be pinned
 */
export function pinFor({
  root,
  mountPoint,
  readVolume,
}: {
  root: string;
  mountPoint: string;
  readVolume: ReadVolume;
}): Result<VolumePin, VolumePinError> {
  const observed = readVolume({ mountPoint });
  if (observed.isErr()) {
    return err(observed.error);
  }
  const observation = observed.value;
  if (observation === null) {
    return err(VolumePinErrors.notMounted({ mountPoint }));
  }
  if (observation.volumeUuid === null) {
    return err(VolumePinErrors.uuidUnavailable({ mountPoint }));
  }
  return ok({ mountPoint, root, volumeName: observation.volumeName, volumeUuid: observation.volumeUuid });
}
