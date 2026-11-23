/**
 * A destination on a pinned external volume: every operation first asks whether the drive verified at the start of
 * the run is still the one a write would land on, and refuses — reaching nothing below — once it is not. A drive
 * ejected or replaced mid-run then fails the next write cleanly instead of letting a recursive `mkdir` land it on the
 * boot disk or another volume.
 *
 * The question is asked of the exact path an operation touches — the object's own path for an upload, a removal or
 * a download — so a volume mounted anywhere BELOW the root is caught too. The answer is
 * `../../cli/commands/store/writeDestination.ts`'s, which re-reads the mount's device, the device under that path
 * and the volume UUID.
 */
import { join } from "node:path";

import { err } from "#lib/result.js";

import { LocalDestinationErrors } from "./localDestinationErrors.js";
import type { BackupTransport } from "./transport.js";

/** Whether the volume verified at the start of the run is still the one a write to this path lands on. */
export type StillMounted = (args: { path: string }) => boolean;

/**
 * Guard a transport behind a still-mounted check.
 *
 * @param inner the plain local destination on the volume
 * @param root the destination root, physical: the objects' paths are built under it
 * @param mountPoint where the volume is mounted, for the refusal
 * @param stillMounted answers, per operation and per path, whether it still is
 * @returns the guarded transport; `holds` is a pure containment test and is never guarded
 */
export function pinnedTransport({
  inner,
  root,
  mountPoint,
  stillMounted,
}: {
  inner: BackupTransport;
  root: string;
  mountPoint: string;
  stillMounted: StillMounted;
}): BackupTransport {
  const ejected = () =>
    err(
      LocalDestinationErrors.unreachable({
        cause: new Error(`the drive at ${mountPoint} was ejected or replaced`),
        root,
      }),
    );
  const atRoot = (): boolean => stillMounted({ path: root });
  const atObject = ({ objectName }: { objectName: string }): boolean => stillMounted({ path: join(root, objectName) });
  return {
    download: async (args) => (atObject(args) ? inner.download(args) : ejected()),
    holds: (args) => inner.holds(args),
    list: async (args) => (atRoot() ? inner.list(args) : ejected()),
    objectSizes: async (args) => (atRoot() ? inner.objectSizes(args) : ejected()),
    probe: async () => (atRoot() ? inner.probe() : ejected()),
    remove: async (args) => (atObject(args) ? inner.remove(args) : ejected()),
    // Checked after the upload too: a drive swapped while the object streamed fails the run rather than counting an
    // object the pinned drive never got as backed up. What this does NOT close: a drive
    // swapped inside one operation, after its check, can still take that one encrypted object, or one empty folder.
    // Closing it needs every syscall bound to the volume itself (an `openat` from a held directory handle), which
    // Node's fs does not offer; the check on either side is what bounds it to one object.
    upload: async (args) => {
      if (!atObject(args)) {
        return ejected();
      }
      const landed = await inner.upload(args);
      return atObject(args) ? landed : ejected();
    },
  };
}
