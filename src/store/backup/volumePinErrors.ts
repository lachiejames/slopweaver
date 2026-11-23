/**
 * Every way pinning a backup destination to one external volume fails — its own union, because a caller
 * branches on it: a drive that is simply not plugged in is a night that finishes locally, while a DIFFERENT
 * drive under the same name, or a pin nobody recorded, is a refusal.
 */
import { errorMessage } from "#lib/errorMessage.js";

/** `diskutil` could not be run, or what it printed is not a volume description this code knows. */
export interface VolumeInspectionFailedError {
  readonly code: "VOLUME_INSPECTION_FAILED";
  readonly message: string;
  readonly mountPoint: string;
}

/** A destination on an external volume, written to with no pin recorded for exactly that root. */
export interface VolumePinRequiredError {
  readonly code: "VOLUME_PIN_REQUIRED";
  readonly message: string;
  readonly root: string;
  readonly mountPoint: string;
}

/** The pin record is on disk and is not one. */
export interface VolumePinMalformedError {
  readonly code: "VOLUME_PIN_MALFORMED";
  readonly message: string;
  readonly path: string;
}

/** The pin record is there but could not be read, so it could not be put back if replacing it failed. */
export interface VolumePinUnreadableError {
  readonly code: "VOLUME_PIN_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** The pin record could not be written. */
export interface VolumePinWriteFailedError {
  readonly code: "VOLUME_PIN_WRITE_FAILED";
  readonly message: string;
  readonly path: string;
}

/** A volume is mounted where the pinned one belongs, and it is not the pinned one. */
export interface VolumeMismatchError {
  readonly code: "VOLUME_MISMATCH";
  readonly message: string;
  readonly mountPoint: string;
  readonly expectedVolumeUuid: string;
  /** `null` when the mounted volume reports no UUID at all. */
  readonly actualVolumeUuid: string | null;
}

/**
 * Names a mounted volume by its UUID, or says it has none.
 *
 * @returns the UUID, or a phrase standing in for the absent one
 */
function describeVolumeUuid({ volumeUuid }: { volumeUuid: string | null }): string {
  if (volumeUuid === null) {
    return "a volume with no UUID";
  }
  return volumeUuid;
}

/** Setting a destination on an external volume while nothing is mounted at its mount point. */
export interface VolumeNotMountedError {
  readonly code: "VOLUME_NOT_MOUNTED";
  readonly message: string;
  readonly mountPoint: string;
}

/** The volume is mounted but reports no volume UUID, so there is nothing stable to pin it by. */
export interface VolumeUuidUnavailableError {
  readonly code: "VOLUME_UUID_UNAVAILABLE";
  readonly message: string;
  readonly mountPoint: string;
}

/** The volume at the mount point changed while it was being checked, so what was read is not what would be written. */
export interface VolumeChangedError {
  readonly code: "VOLUME_CHANGED";
  readonly message: string;
  readonly mountPoint: string;
}

/** The root lands on a different volume mounted INSIDE the drive, so the drive's UUID does not name where it writes. */
export interface VolumeNestedError {
  readonly code: "VOLUME_NESTED";
  readonly message: string;
  readonly mountPoint: string;
  readonly root: string;
}

/** Every way pinning a destination to a volume fails. */
export type VolumePinError =
  | VolumeNestedError
  | VolumeChangedError
  | VolumeInspectionFailedError
  | VolumeMismatchError
  | VolumeNotMountedError
  | VolumePinMalformedError
  | VolumePinRequiredError
  | VolumePinUnreadableError
  | VolumePinWriteFailedError
  | VolumeUuidUnavailableError;

/** The factory for every {@link VolumePinError}. */
export const VolumePinErrors = {
  changed: ({ mountPoint }: { mountPoint: string }): VolumeChangedError => ({
    code: "VOLUME_CHANGED",
    message:
      `the volume mounted at ${mountPoint} changed while it was being checked — nothing is written; run the backup ` +
      "again once the drive is settled",
    mountPoint,
  }),
  inspectionFailed: ({ mountPoint, cause }: { mountPoint: string; cause: unknown }): VolumeInspectionFailedError => ({
    code: "VOLUME_INSPECTION_FAILED",
    message: `could not read which volume is mounted at ${mountPoint}: ${errorMessage({ error: cause })}`,
    mountPoint,
  }),
  mismatch: ({
    mountPoint,
    expectedVolumeUuid,
    actualVolumeUuid,
  }: {
    mountPoint: string;
    expectedVolumeUuid: string;
    actualVolumeUuid: string | null;
  }): VolumeMismatchError => ({
    actualVolumeUuid,
    code: "VOLUME_MISMATCH",
    expectedVolumeUuid,
    message:
      `the volume mounted at ${mountPoint} is ${describeVolumeUuid({ volumeUuid: actualVolumeUuid })}, not the ` +
      `pinned ${expectedVolumeUuid} — nothing is written to a different drive under the same name; plug the pinned ` +
      "drive in, or pin this one with `slopweaver store backup --set-destination <address>`",
    mountPoint,
  }),
  nested: ({ mountPoint, root }: { mountPoint: string; root: string }): VolumeNestedError => ({
    code: "VOLUME_NESTED",
    message:
      `${root} is on a volume mounted inside ${mountPoint}, not on the drive at ${mountPoint} itself — nothing is ` +
      "written to a volume no pin names; name that volume's own /Volumes path as the destination",
    mountPoint,
    root,
  }),
  notMounted: ({ mountPoint }: { mountPoint: string }): VolumeNotMountedError => ({
    code: "VOLUME_NOT_MOUNTED",
    message: `nothing is mounted at ${mountPoint} — plug the drive in, then set the destination again`,
    mountPoint,
  }),
  pinMalformed: ({ path, why }: { path: string; why: string }): VolumePinMalformedError => ({
    code: "VOLUME_PIN_MALFORMED",
    message: `${path} is not a backup destination pin (${why}) — set the destination again with \`slopweaver store backup --set-destination <address>\``,
    path,
  }),
  pinRequired: ({ root, mountPoint }: { root: string; mountPoint: string }): VolumePinRequiredError => ({
    code: "VOLUME_PIN_REQUIRED",
    message:
      `${root} is on the external volume ${mountPoint}, and no pin names that volume for this destination — ` +
      "with the drive plugged in, run `slopweaver store backup --set-destination <address>` so a backup never " +
      "writes to the boot disk while the drive is out",
    mountPoint,
    root,
  }),
  pinUnreadable: ({ path, cause }: { path: string; cause: unknown }): VolumePinUnreadableError => ({
    code: "VOLUME_PIN_UNREADABLE",
    message:
      `could not read the destination pin ${path}: ${errorMessage({ error: cause })} — nothing is changed; make it ` +
      "readable or remove it, then set the destination again",
    path,
  }),
  pinWriteFailed: ({ path, cause }: { path: string; cause: unknown }): VolumePinWriteFailedError => ({
    code: "VOLUME_PIN_WRITE_FAILED",
    message: `could not write the destination pin ${path}: ${errorMessage({ error: cause })}`,
    path,
  }),
  uuidUnavailable: ({ mountPoint }: { mountPoint: string }): VolumeUuidUnavailableError => ({
    code: "VOLUME_UUID_UNAVAILABLE",
    message: `the volume at ${mountPoint} reports no volume UUID, so it cannot be pinned — it is never pinned by its name or device number instead`,
    mountPoint,
  }),
} as const;
