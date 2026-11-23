/**
 * What is mounted at a mount point on macOS, read with `diskutil info -plist` — the effectful half of
 * `./volumePin.ts`, and the only place a backup asks the system which drive is plugged in.
 *
 * MEASURED (`diskutil info -plist /Volumes/<image>`, then the same against an ordinary folder and an
 * absent path): a mounted volume prints a plist carrying `MountPoint`, `VolumeUUID`, `VolumeName` and exits 0; an
 * ordinary folder or a path with nothing mounted prints `Error: true` with "Could not find disk" and exits 1. So
 * exit 1 is "nothing mounted here", and the printed `MountPoint` is still compared with the one asked about, so a
 * folder that resolves to some OTHER volume is never mistaken for the drive.
 *
 * `spawnSync` with an argument list, so no shell parses the path, and synchronous because `no-headless` bans the
 * async `child_process` members. The plist is turned into JSON by `plutil` rather than parsed by hand.
 */
import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import { dirname } from "node:path";

import { z } from "zod";

import { err, ok, type Result } from "#lib/result.js";

import type { ReadVolume, VolumeObservation } from "./volumePin.js";
import { type VolumePinError, VolumePinErrors } from "./volumePinErrors.js";

/** The fields of `diskutil info -plist` this code reads, as `plutil` renders them in JSON. */
const diskInfoSchema = z.object({
  MountPoint: z.string(),
  VolumeName: z.string(),
  VolumeUUID: z.string().optional(),
});

/** How long one `diskutil` or `plutil` call may take before it is treated as a failure. */
const INSPECT_TIMEOUT_MS = 15_000;

/**
 * Run one inspection command and return its stdout.
 *
 * @param command the absolute command
 * @param args its arguments
 * @param input what to feed its stdin, if anything
 * @returns its exit status and stdout, or the launch failure
 */
function inspect({
  command,
  args,
  input,
}: {
  command: string;
  args: readonly string[];
  input?: string;
}): Result<{ status: number | null; stdout: string }, unknown> {
  const result = spawnSync(command, [...args], {
    encoding: "utf8",
    timeout: INSPECT_TIMEOUT_MS,
    ...(input === undefined ? {} : { input }),
  });
  if (result.error !== undefined) {
    return err(result.error);
  }
  return ok({ status: result.status, stdout: result.stdout });
}

/**
 * {@link ReadVolume} over `diskutil`: the volume mounted at exactly this mount point, or `null` when none is.
 *
 * @param mountPoint the mount point to ask about, `/Volumes/<name>`
 * @returns the observation, `null` when nothing is mounted there, or why the answer could not be read
 */
export const readDarwinVolume: ReadVolume = ({ mountPoint }) => {
  const info = inspect({ args: ["info", "-plist", mountPoint], command: "/usr/sbin/diskutil" });
  if (info.isErr()) {
    return err(VolumePinErrors.inspectionFailed({ cause: info.error, mountPoint }));
  }
  if (info.value.status === 1) {
    return ok(null);
  }
  if (info.value.status !== 0) {
    return err(
      VolumePinErrors.inspectionFailed({
        cause: new Error(`diskutil exited ${String(info.value.status)}`),
        mountPoint,
      }),
    );
  }
  return observationOf({ mountPoint, plist: info.value.stdout });
};

/**
 * Turn `diskutil`'s plist into an observation, refusing one that names another mount point.
 *
 * @param mountPoint the mount point asked about
 * @param plist what `diskutil info -plist` printed
 * @returns the observation, `null` when the volume it describes is mounted elsewhere, or why it could not be read
 */
function observationOf({
  mountPoint,
  plist,
}: {
  mountPoint: string;
  plist: string;
}): Result<VolumeObservation | null, VolumePinError> {
  const converted = inspect({ args: ["-convert", "json", "-o", "-", "-"], command: "/usr/bin/plutil", input: plist });
  if (converted.isErr()) {
    return err(VolumePinErrors.inspectionFailed({ cause: converted.error, mountPoint }));
  }
  if (converted.value.status !== 0) {
    return err(VolumePinErrors.inspectionFailed({ cause: new Error("plutil could not read the plist"), mountPoint }));
  }
  let raw: unknown;
  try {
    raw = JSON.parse(converted.value.stdout);
  } catch (cause: unknown) {
    return err(VolumePinErrors.inspectionFailed({ cause, mountPoint }));
  }
  const parsed = diskInfoSchema.safeParse(raw);
  if (!parsed.success) {
    return err(VolumePinErrors.inspectionFailed({ cause: parsed.error, mountPoint }));
  }
  if (parsed.data.MountPoint !== mountPoint) {
    return ok(null);
  }
  const uuid = parsed.data.VolumeUUID;
  return ok({
    mountPoint,
    volumeName: parsed.data.VolumeName,
    volumeUuid: uuid === undefined || uuid === "" ? null : uuid,
  });
}

/**
 * The device a mount point is mounted on, or `null` when it is not a mount point now — absent, or an ordinary
 * folder on the same device as `/Volumes`. A cheap per-operation check that the drive verified at the start of a
 * run has not been ejected since; the UUID itself is read once, by {@link readDarwinVolume}.
 *
 * @param mountPoint `/Volumes/<name>`, compared with its parent folder's device
 * @returns its device number while something is mounted there, else `null`
 */
export function mountedDevice({ mountPoint }: { mountPoint: string }): number | null {
  const here = statSync(mountPoint, { throwIfNoEntry: false });
  const parent = statSync(dirname(mountPoint), { throwIfNoEntry: false });
  if (here === undefined || parent === undefined || here.dev === parent.dev) {
    return null;
  }
  return here.dev;
}

/**
 * The device a write to a path would land on: that of its deepest existing ancestor. A root whose device differs
 * from its drive's mount point sits on a volume mounted INSIDE the drive, which no pin names.
 *
 * @param path the destination root, physical
 * @returns the device number, or `null` when not even `/` could be read
 */
export function deviceUnder({ path }: { path: string }): number | null {
  let probe = path;
  for (;;) {
    const here = statSync(probe, { throwIfNoEntry: false });
    if (here !== undefined) {
      return here.dev;
    }
    const up = dirname(probe);
    if (up === probe) {
      return null;
    }
    probe = up;
  }
}
