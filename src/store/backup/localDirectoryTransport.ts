/**
 * A backup destination that is a directory on this machine — the store's backup lands at a local path the
 * fleet picks, never assumed to be a cloud bucket. Objects are laid out by name (`<project>/<instant>/…`, the chunk and blob prefixes), so every
 * caller of {@link BackupTransport} speaks object names and never a path.
 *
 * ## What it guards, because an object name becomes a path
 *
 * - **Containment.** An object name is a plain relative POSIX path: no empty, `.` or `..` segment, no
 *   backslash, no NUL, never absolute. A name that would land outside the root is refused, never joined.
 * - **No symbolic links below the root.** A link planted inside the destination could redirect a write
 *   anywhere this user can write, so every component between the root and the object is `lstat`ed and a
 *   link is refused. The root itself may be reached through one (`/var` is a link on macOS).
 * - **Atomic writes.** An upload streams into a unique sibling `.partial-…` file at `0600`, is `fsync`ed,
 *   renamed over the target and its directory `fsync`ed, so a reader sees the old bytes or the new ones and
 *   never a torn file. A download copies to a sibling temporary and renames for the same reason.
 * - **No download into the destination.** A download whose target resolves inside the root is refused, so
 *   no read can replace a stored object (`holds` on {@link BackupTransport} says why it matters).
 *
 * Directories are created `0700`.
 */
import { createHash, randomUUID } from "node:crypto";
import {
  accessSync,
  constants,
  copyFileSync,
  createReadStream,
  createWriteStream,
  type Dirent,
  lstatSync,
  mkdirSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { err, ok, type Result } from "#lib/result.js";
import { fsyncFile, renameStagedFile } from "#lib/writeAtomic.js";

import { type LocalDestinationError, LocalDestinationErrors } from "./localDestinationErrors.js";
import { heldByIdentity, placeWithin, realPlace, statIdentity } from "./realPlace.js";
import type { BackupTransport } from "./transport.js";

/** The prefix every in-flight temporary carries, so a listing never reports half a write as an object. */
const PARTIAL_PREFIX = ".partial-";

/**
 * Turn an object name into its path under the root, refusing every name that is not a plain relative path.
 *
 * @param root the destination root, already resolved
 * @param objectName the object's name, `<project>/<instant>/<file>` or a chunk or blob name
 * @returns the absolute path the object lives at, or why the name is refused
 */
export function localObjectPath({
  root,
  objectName,
}: {
  root: string;
  objectName: string;
}): Result<string, LocalDestinationError> {
  const refuse = ({ why }: { why: string }): Result<string, LocalDestinationError> =>
    err(LocalDestinationErrors.nameRefused({ objectName, root, why }));
  if (objectName.length === 0) {
    return refuse({ why: "it is empty" });
  }
  if (objectName.includes("\\") || objectName.includes("\0")) {
    return refuse({ why: "it carries a backslash or a NUL" });
  }
  if (objectName.startsWith("/")) {
    return refuse({ why: "it is absolute" });
  }
  const segments = objectName.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return refuse({ why: "it has an empty, '.' or '..' segment" });
  }
  if (segments.some((segment) => segment.startsWith(PARTIAL_PREFIX))) {
    return refuse({ why: `a segment starts with ${PARTIAL_PREFIX}, which names an in-flight write` });
  }
  const path = join(root, ...segments);
  if (!placeWithin({ place: path, root })) {
    return refuse({ why: "it resolves outside the destination" });
  }
  return ok(path);
}

/**
 * Refuse a symbolic link at the root itself or at any component below it, up to and including `path` when it
 * exists. The root is checked too because it is pinned as a PATH: one absent at construction is pinned as
 * the place it would be created, and a link made there later would otherwise move the whole destination.
 *
 * @param root the destination root
 * @param path a path at or under it
 * @returns nothing, or the first link met
 */
function refuseLinksBelow({ root, path }: { root: string; path: string }): Result<void, LocalDestinationError> {
  const segments = relative(root, path)
    .split("/")
    .filter((segment) => segment !== "");
  let current = root;
  for (const next of [null, ...segments]) {
    if (next !== null) {
      current = join(current, next);
    }
    let isLink = false;
    try {
      isLink = lstatSync(current).isSymbolicLink();
    } catch {
      // Absent from here down: nothing below can be a link yet.
      return ok(undefined);
    }
    if (isLink) {
      return err(LocalDestinationErrors.symlinkRefused({ path: current, root }));
    }
  }
  return ok(undefined);
}

/**
 * Whether a host path, resolved through every link, lands at or below the destination root.
 *
 * @param root the destination root, already pinned to its real place
 * @param path the host path
 * @returns true when a write to the path would land inside the destination — and true for a path that
 *   cannot be resolved, because nothing may be written there on the strength of a guess
 */
function holdsPath({ root, path }: { root: string; path: string }): boolean {
  const place = realPlace({ path });
  if (place.isErr()) {
    return true;
  }
  return heldByIdentity({ identityOf: statIdentity, place: place.value, root });
}

/** Reads the device a folder is on. */
export type DeviceAt = (args: { path: string }) => number;

/**
 * The production device reader: the folder's own device, never a link's target's.
 *
 * @param path the folder to read
 * @returns its device number
 */
const lstatDevice: DeviceAt = ({ path }) => lstatSync(path).dev;

/**
 * Every regular file under one directory, as slash-separated names relative to the root with their lengths.
 * In-flight temporaries are skipped; a symbolic link anywhere in the walk is refused rather than followed, and so is
 * a folder on another volume than the root's — one mounted inside the destination, whose files would otherwise read
 * as objects already held.
 *
 * @param root the destination root
 * @param start the directory to walk, under the root
 * @param deviceAt reads the device a folder is on
 * @returns each object's name and length, or why the walk failed
 */
function walkObjects({
  root,
  start,
  deviceAt,
}: {
  root: string;
  start: string;
  deviceAt: DeviceAt;
}): Result<readonly { name: string; bytes: number }[], LocalDestinationError> {
  const found: { name: string; bytes: number }[] = [];
  const device = deviceAt({ path: root });
  const pending = [start];
  while (pending.length > 0) {
    const directory = pending.pop()!;
    if (deviceAt({ path: directory }) !== device) {
      return err(LocalDestinationErrors.mountCrossed({ path: directory, root }));
    }
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        return err(LocalDestinationErrors.symlinkRefused({ path, root }));
      }
      if (entry.isDirectory()) {
        pending.push(path);
      } else if (isHeldObject({ entry })) {
        found.push({ bytes: lstatSync(path).size, name: relative(root, path).split("\\").join("/") });
      }
    }
  }
  return ok(found);
}

/**
 * Whether a directory entry is an object the destination holds: a regular file, not an in-flight temporary.
 *
 * @param entry what `readdirSync` returned
 * @returns whether it counts as a held object
 */
function isHeldObject({ entry }: { entry: Dirent }): boolean {
  return entry.isFile() && !entry.name.startsWith(PARTIAL_PREFIX);
}

/**
 * The objects under a prefix: walk from the deepest directory the prefix names, keep the names it begins.
 *
 * @param root the destination root
 * @param prefix the object-name prefix, a directory when it ends in `/`
 * @param deviceAt reads the device a folder is on
 * @returns each matching object's name and length, sorted by name, or why the listing failed
 */
function objectsUnder({
  root,
  prefix,
  deviceAt,
}: {
  root: string;
  prefix: string;
  deviceAt: DeviceAt;
}): Result<readonly { name: string; bytes: number }[], LocalDestinationError> {
  const directoryPart = prefix.includes("/") ? prefix.slice(0, prefix.lastIndexOf("/")) : "";
  const start = directoryPart === "" ? ok(root) : localObjectPath({ objectName: directoryPart, root });
  if (start.isErr()) {
    return err(start.error);
  }
  const links = refuseLinksBelow({ path: start.value, root });
  if (links.isErr()) {
    return err(links.error);
  }
  try {
    lstatSync(start.value);
  } catch {
    return ok([]);
  }
  try {
    const walked = walkObjects({ deviceAt, root, start: start.value });
    return walked.map((objects) =>
      objects.filter((object) => object.name.startsWith(prefix)).toSorted((a, b) => (a.name < b.name ? -1 : 1)),
    );
  } catch (cause: unknown) {
    return err(LocalDestinationErrors.listFailed({ cause, prefix, root }));
  }
}

/**
 * The object's path with its directory made and every component below the root checked for a link.
 *
 * @param root the destination root
 * @param objectName the object's name
 * @returns the object's path, or why it may not be written
 */
function writablePath({
  root,
  objectName,
}: {
  root: string;
  objectName: string;
}): Result<string, LocalDestinationError> {
  const path = localObjectPath({ objectName, root });
  if (path.isErr()) {
    return path;
  }
  const before = refuseLinksBelow({ path: path.value, root });
  if (before.isErr()) {
    return err(before.error);
  }
  try {
    mkdirSync(dirname(path.value), { mode: 0o700, recursive: true });
  } catch (cause: unknown) {
    return err(LocalDestinationErrors.writeFailed({ cause, objectName, root }));
  }
  // Again after the mkdir, so a link raced into place between the check and the create is still caught.
  const after = refuseLinksBelow({ path: path.value, root });
  return after.map(() => path.value);
}

/**
 * Stream a local file, bounded to `bytes` when given, into an object atomically, hashing what passes.
 *
 * @param root the destination root
 * @returns the upload operation
 */
function uploadObject({ root }: { root: string }): BackupTransport["upload"] {
  return async ({ path, objectName, bytes }) => {
    const target = writablePath({ objectName, root });
    if (target.isErr()) {
      return err(target.error);
    }
    const temporary = join(dirname(target.value), `${PARTIAL_PREFIX}${basename(target.value)}-${randomUUID()}`);
    try {
      const digest = createHash("sha256");
      let sent = 0;
      // `end` is INCLUSIVE, so a bound of n reads through index n-1; a bound of zero sends nothing at all.
      const source =
        bytes === 0
          ? Readable.from([])
          : createReadStream(path, bytes === undefined ? {} : { end: bytes - 1, start: 0 });
      source.on("data", (chunk: Buffer) => {
        digest.update(chunk);
        sent += chunk.length;
      });
      await pipeline(source, createWriteStream(temporary, { flags: "wx", mode: 0o600 }));
      fsyncFile({ path: temporary });
      renameStagedFile({ flushDirectory: true, from: temporary, to: target.value });
      return ok({ bytes: sent, name: objectName, sha256: digest.digest("hex") });
    } catch (cause: unknown) {
      rmSync(temporary, { force: true });
      return err(LocalDestinationErrors.writeFailed({ cause, objectName, root }));
    }
  };
}

/**
 * Copy one object to a local path through a sibling temporary, so the path holds the whole object or nothing new.
 *
 * @param root the destination root
 * @returns the download operation
 */
function downloadObject({ root }: { root: string }): BackupTransport["download"] {
  return async ({ objectName, path }) => {
    const source = localObjectPath({ objectName, root });
    if (source.isErr()) {
      return err(source.error);
    }
    const links = refuseLinksBelow({ path: source.value, root });
    if (links.isErr()) {
      return err(links.error);
    }
    // Resolved once, then checked and written as the SAME place, so no link re-pointed after the check redirects it.
    const resolved = realPlace({ path });
    if (resolved.isErr()) {
      return err(LocalDestinationErrors.targetUnresolvable({ path, root, why: resolved.error.message }));
    }
    const target = resolved.value;
    // By identity, not spelling: a firmlink or a case-insensitive volume names one directory two ways.
    if (heldByIdentity({ identityOf: statIdentity, place: target, root })) {
      return err(LocalDestinationErrors.targetInside({ path, root }));
    }
    const temporary = join(dirname(target), `${PARTIAL_PREFIX}${basename(target)}-${randomUUID()}`);
    try {
      copyFileSync(source.value, temporary, constants.COPYFILE_EXCL);
      fsyncFile({ path: temporary });
      renameStagedFile({ flushDirectory: true, from: temporary, to: target });
      return ok(undefined);
    } catch (cause: unknown) {
      rmSync(temporary, { force: true });
      return err(LocalDestinationErrors.readFailed({ cause, objectName, root }));
    }
  };
}

/**
 * A destination whose root could not be pinned: every operation refuses with why, and it claims to hold
 * every path, so nothing is ever written on the strength of a root nobody could resolve.
 *
 * @param root the root as given
 * @param why why it could not be resolved
 * @returns the refusing transport
 */
function unpinnedTransport({ root, why }: { root: string; why: string }): BackupTransport {
  const refusal = LocalDestinationErrors.unreachable({ cause: new Error(why), root });
  return {
    download: async () => err(refusal),
    holds: () => true,
    list: async () => err(refusal),
    objectSizes: async () => err(refusal),
    probe: async () => err(refusal),
    remove: async () => err(refusal),
    upload: async () => err(refusal),
  };
}

/**
 * Whether the root has to exist already: `create` makes it on the first probe, `require-existing` refuses a probe
 * of a root that is not there — what every READ uses, so recovering from an unplugged drive names the drive
 * rather than making an empty folder where it belongs.
 */
export type LocalRootPolicy = "create" | "require-existing";

/**
 * The production local destination over one directory.
 *
 * @param root the directory every object lands under; pinned to its real place once, here, so a link on the
 *   way to it that is re-pointed later never moves the destination between a check and a write. A root
 *   carrying a link that points at nothing cannot be pinned, and every operation then refuses
 * @param rootPolicy whether a probe may make the root
 * @param deviceAt reads the device a folder is on, so a listing stays on the root's own volume; a test passes its
 *   own to stand for a volume mounted inside the destination
 * @returns the transport
 */
export function localDirectoryTransport({
  root,
  rootPolicy,
  deviceAt = lstatDevice,
}: {
  root: string;
  rootPolicy: LocalRootPolicy;
  deviceAt?: DeviceAt;
}): BackupTransport {
  const pinned = realPlace({ path: root });
  if (pinned.isErr()) {
    return unpinnedTransport({ root, why: pinned.error.message });
  }
  const resolved = pinned.value;
  return {
    download: downloadObject({ root: resolved }),
    holds: ({ path }) => holdsPath({ path, root: resolved }),
    list: async ({ prefix }) =>
      objectsUnder({ deviceAt, prefix, root: resolved }).map((objects) => objects.map((object) => object.name)),
    objectSizes: async ({ prefix }) =>
      objectsUnder({ deviceAt, prefix, root: resolved }).map(
        (objects) => new Map(objects.map((object) => [object.name, object.bytes] as const)),
      ),
    probe: async () => {
      const links = refuseLinksBelow({ path: resolved, root: resolved });
      if (links.isErr()) {
        return err(links.error);
      }
      try {
        if (rootPolicy === "create") {
          mkdirSync(resolved, { mode: 0o700, recursive: true });
        }
        accessSync(resolved, constants.R_OK | constants.W_OK | constants.X_OK);
        return ok({ location: resolved });
      } catch (cause: unknown) {
        return err(LocalDestinationErrors.unreachable({ cause, root: resolved }));
      }
    },
    remove: async ({ objectName }) => {
      const path = localObjectPath({ objectName, root: resolved });
      if (path.isErr()) {
        return err(path.error);
      }
      const links = refuseLinksBelow({ path: path.value, root: resolved });
      if (links.isErr()) {
        return err(links.error);
      }
      try {
        rmSync(path.value, { force: true });
        return ok(undefined);
      } catch (cause: unknown) {
        return err(LocalDestinationErrors.removeFailed({ cause, objectName, root: resolved }));
      }
    },
    upload: uploadObject({ root: resolved }),
  };
}
