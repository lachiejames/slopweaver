/**
 * Where an encrypted backup lands, and how a restore's `--from` names one to read back.
 *
 * ## A destination is a local directory the operator picks
 *
 * Owner ruling (option A): the backup goes to a local path, never a bucket; only local
 * destinations are built, a remote one waits until the owner names it, and a night writes to a LIST of them
 * (`./destinationConfig.ts`, which resolves the list from `$SLOPWEAVER_HOME`, never a constant). An address is an
 * absolute path or a `file://` URL ({@link localPathOfAddress}); a relative path is refused rather than resolved,
 * because a scheduled run's working directory is not the operator's, and `s3://`, `gs://` and `drive://` are
 * refused as not built.
 *
 * A destination on the same device as the home survives a corrupted store but not a lost disk.
 * {@link sharesDeviceWithHome} lets the verb say so instead of letting the operator assume otherwise. One on an
 * external drive is written only while the drive pinned for it is mounted (`./volumePin.ts`).
 *
 * ## A restore source is one of two shapes, told apart by its path
 *
 * - A **staging directory**, which holds the plaintext files a backup wrote before upload. It is any absolute
 *   path that is not the second shape.
 * - A **destination address**: `<root>/<project>/<instant>`, spelled as a path or a `file://` URL. The last two
 *   segments are exactly what `backupPrefix` writes. Everything above them is the destination root, so the same
 *   address `store backup` prints is the one `store restore --from` and `store rehearse --from` read.
 */
import { mkdirSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { errorMessage } from "#lib/errorMessage.js";
import { err, ok, type Result } from "#lib/result.js";

import { stateHomePaths } from "../../stateHome.js";
import { type BackupError, BackupErrors } from "./errors.js";
import { heldByIdentity, type IdentityOf, realPlace, statIdentity } from "./realPlace.js";

/**
 * The staging root, read from the home's paths directly rather than through `./staging.ts`, which reaches this module
 * back through the receipts it reads — an import cycle.
 *
 * @param home the Slopweaver home
 * @returns the staging root
 */
function stagingRoot({ home }: { home: string }): string {
  return stateHomePaths({ home }).storeBackups;
}

/** The environment variable that replaces the remembered list with one destination for one run. */
export const BACKUP_DIRECTORY_ENV = "SLOPWEAVER_BACKUP_DIRECTORY";

/** The secret-store file the destination list is remembered in, one address per line. A per-install value, not a credential. */
export const BACKUP_DIRECTORY_SECRET = "store-backup-directory";

/** The shape `backupDirectoryName` gives an instant: every `:` and `.` of an ISO string replaced by `-`. */
const INSTANT_SEGMENT = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;

/** A URI scheme at the start of an address: `s3:`, `file:`, `drive:`. A POSIX path never starts with one. */
const ADDRESS_SCHEME = /^([a-z][a-z0-9+.-]*):/i;

/**
 * The local path a destination address names: an absolute path, or a `file://` URL. Any other scheme is refused by
 * name and never read as a path — the remote kinds (`s3://`, `gs://`, `drive://`) are held, not built.
 *
 * @param address the address as named
 * @returns the absolute, resolved path, or why the address names no local destination
 */
export function localPathOfAddress({ address }: { address: string }): Result<string, BackupError> {
  const scheme = ADDRESS_SCHEME.exec(address)?.[1];
  if (scheme !== undefined && scheme.toLowerCase() !== "file") {
    return err(BackupErrors.destinationKindNotBuilt({ address, scheme: scheme.toLowerCase() }));
  }
  const path = pathOfAddress({ from: address });
  if (path.isErr()) {
    return err(path.error);
  }
  if (!isAbsolute(path.value)) {
    return err(BackupErrors.destinationNotAbsolute({ destination: address }));
  }
  return ok(resolve(path.value));
}

/** The device a path's nearest existing ancestor sits on, or `null` when none could be read. */
export type DeviceOf = (args: { path: string }) => number | null;

/**
 * {@link DeviceOf} over the real filesystem: `stat`'s `dev`, following links.
 *
 * @returns the device number, or `null` when the path does not exist
 */
const statDevice: DeviceOf = ({ path }) => {
  const stats = statSync(path, { throwIfNoEntry: false });
  if (stats === undefined) {
    return null;
  }
  return stats.dev;
};

/**
 * Whether a destination sits on the same device as the Slopweaver home, so one lost disk takes both.
 *
 * A destination that does not exist yet is judged by its nearest existing ancestor, which is where its first
 * directory will be made.
 *
 * @param root the destination root
 * @param home the Slopweaver home
 * @param deviceOf reads a path's device; a seam so a test can name two devices on one machine
 * @returns `true` on one device, `false` on two, `null` when either device could not be read
 */
export function sharesDeviceWithHome({
  root,
  home,
  deviceOf = statDevice,
}: {
  root: string;
  home: string;
  deviceOf?: DeviceOf;
}): boolean | null {
  const rootDevice = nearestDevice({ deviceOf, path: root });
  const homeDevice = nearestDevice({ deviceOf, path: home });
  if (rootDevice === null || homeDevice === null) {
    return null;
  }
  return rootDevice === homeDevice;
}

/**
 * The device of a path, or of its nearest ancestor that exists.
 *
 * @param path where to start
 * @param deviceOf the device reader
 * @returns the device, or `null` when not even the filesystem root could be read
 */
function nearestDevice({ path, deviceOf }: { path: string; deviceOf: DeviceOf }): number | null {
  let current = resolve(path);
  for (;;) {
    let device: number | null = null;
    try {
      device = deviceOf({ path: current });
    } catch {
      device = null;
    }
    if (device !== null) {
      return device;
    }
    if (dirname(current) === current) {
      return null;
    }
    current = dirname(current);
  }
}

/** A place a run writes plaintext to, named the way a refusal should name it. */
export interface PlaintextPlace {
  readonly path: string;
  /** What it is: `the Slopweaver home`, `--secrets-into`, `--files-into`. */
  readonly role: string;
}

/**
 * The places under a home every backup verb writes plaintext to: the home itself, and the staging root, checked
 * on its own because a link at `<home>/backups` would carry it somewhere the home's own check never looks.
 *
 * @param home the Slopweaver home
 * @returns the two places, named for a refusal
 */
function homePlaintextPlaces({ home }: { home: string }): readonly PlaintextPlace[] {
  return [
    { path: home, role: "the Slopweaver home" },
    { path: stagingRoot({ home }), role: "the backup staging root" },
  ];
}

/**
 * Refuse a destination overlapping the home, its staging root or any other named place — checked TWICE around
 * making the staging root (0700). Before: the staging root's path is resolved through every link that already
 * exists, so a planted `backups` link into the destination is refused before the `mkdir` that would follow it
 * and leave a directory there. After: the root now exists, so it is compared by device and inode rather than by
 * spelling — two absent names that differ only in case, or in Unicode normalisation, are one directory on the
 * owner's APFS volume once made, which an identity comparison sees and a path comparison cannot. The caller makes
 * the destination before this when it is a writing run, for the same reason.
 *
 * @param home the Slopweaver home
 * @param root the destination root
 * @param writesTo the other places this run writes plaintext to
 * @returns nothing when every place is clear, else the overlap, or why the staging root could not be made
 */
export function refuseHomeOverlap({
  home,
  root,
  writesTo = [],
}: {
  home: string;
  root: string;
  writesTo?: readonly PlaintextPlace[];
}): Result<void, BackupError> {
  const places = [...homePlaintextPlaces({ home }), ...writesTo];
  const before = refusePlaintextInsideDestination({ places, root });
  if (before.isErr()) {
    return err(before.error);
  }
  const staging = stagingRoot({ home });
  try {
    mkdirSync(staging, { mode: 0o700, recursive: true });
  } catch (cause: unknown) {
    return err(BackupErrors.stepFailed({ reasons: [`could not make ${staging}: ${errorMessage({ error: cause })}`] }));
  }
  return refusePlaintextInsideDestination({ places, root });
}

/**
 * Refuse a destination that sits inside a place the run writes plaintext to, or holds one. A backup stages its
 * dump, tar and manifest under the home, and a restore writes the files and credentials wherever its flags say,
 * none of it through the object cipher; inside the destination, any of them would be plaintext beside the
 * ciphertext. Both directions refuse: a destination inside the home is also a destination the home's own loss
 * takes with it.
 *
 * Both sides are resolved with `realPlace` and compared by identity with `heldByIdentity`, the containment
 * test the transport's writes are gated on, so `/tmp` against `/private/tmp`, a firmlink or a case-insensitive
 * spelling is still one place. A side that cannot be resolved refuses: nothing is written on a check that could
 * not run.
 *
 * @param root the destination root
 * @param places every place this run writes plaintext to
 * @param identityOf how an entry's identity is read; a seam for a test
 * @returns nothing when every place is clear of the destination, else the first overlap or unresolvable side
 */
export function refusePlaintextInsideDestination({
  root,
  places,
  identityOf = statIdentity,
}: {
  root: string;
  places: readonly PlaintextPlace[];
  identityOf?: IdentityOf;
}): Result<void, BackupError> {
  const destination = realPlace({ path: root });
  if (destination.isErr()) {
    return err(BackupErrors.stepFailed({ reasons: [destination.error.message] }));
  }
  for (const place of places) {
    const written = realPlace({ path: place.path });
    if (written.isErr()) {
      return err(BackupErrors.stepFailed({ reasons: [written.error.message] }));
    }
    const overlaps =
      heldByIdentity({ identityOf, place: written.value, root: destination.value }) ||
      heldByIdentity({ identityOf, place: destination.value, root: written.value });
    if (overlaps) {
      return err(BackupErrors.destinationOverlaps({ destination: root, path: place.path, role: place.role }));
    }
  }
  return ok(undefined);
}

/** Where a restore reads its files from. */
export type BackupSourceAddress =
  | { readonly kind: "staging"; readonly directory: string }
  | {
      readonly kind: "local-destination";
      /** The destination root, everything above `<project>/<instant>`. */
      readonly root: string;
      /** The object prefix under the root, `<project>/<instant>/`, as `backupPrefix` writes it. */
      readonly prefix: string;
      /** The address as a reader should see it echoed. */
      readonly display: string;
    };

/**
 * Read a restore's `--from` into one of its two shapes.
 *
 * Pure: it decides by spelling and touches no file. Whether the place it names holds a backup is the
 * resolver's question, asked once it knows which reader to use.
 *
 * @param from the address as typed
 * @param project the project segment this build writes under, `SUPABASE_PROJECT_ID`
 * @returns the staging or destination arm, or why the address is neither
 */
export function parseBackupSourceAddress({
  from,
  project,
}: {
  from: string;
  project: string;
}): Result<BackupSourceAddress, BackupError> {
  // Judged on the spelling, before a URL parser or `resolve` folds a `..` away.
  if (from.split("/").includes("..")) {
    return err(BackupErrors.sourceAddressInvalid({ address: from, why: "it climbs with a .. segment" }));
  }
  const scheme = ADDRESS_SCHEME.exec(from)?.[1];
  if (scheme !== undefined && scheme.toLowerCase() !== "file") {
    return err(BackupErrors.destinationKindNotBuilt({ address: from, scheme: scheme.toLowerCase() }));
  }
  const path = pathOfAddress({ from });
  if (path.isErr()) {
    return err(path.error);
  }
  if (!isAbsolute(path.value)) {
    return err(BackupErrors.sourceAddressInvalid({ address: from, why: "it is not an absolute path" }));
  }
  const directory = resolve(path.value);
  const instant = basename(directory);
  const projectDirectory = dirname(directory);
  if (basename(projectDirectory) !== project) {
    return ok({ directory, kind: "staging" });
  }
  if (!INSTANT_SEGMENT.test(instant)) {
    return err(
      BackupErrors.sourceAddressInvalid({
        address: from,
        why: `it sits under a ${project}/ directory but "${instant}" is not a backup instant`,
      }),
    );
  }
  return ok({
    display: directory,
    kind: "local-destination",
    prefix: `${project}/${instant}/`,
    root: dirname(projectDirectory),
  });
}

/**
 * A path without its trailing separators, unless that would leave nothing (the filesystem root).
 *
 * @param path the path as spelled
 * @returns the trimmed path
 */
function withoutTrailingSeparators({ path }: { path: string }): string {
  const trimmed = path.replace(/\/+$/, "");
  if (trimmed === "") {
    return path;
  }
  return trimmed;
}

/**
 * The filesystem path an address spells, unwrapping a `file://` URL.
 *
 * @param from the address as typed
 * @returns the path, or why a URL spelling carried something a path cannot
 */
function pathOfAddress({ from }: { from: string }): Result<string, BackupError> {
  if (!from.startsWith("file:")) {
    return ok(withoutTrailingSeparators({ path: from }));
  }
  let url: URL;
  try {
    url = new URL(from);
  } catch {
    return err(BackupErrors.sourceAddressInvalid({ address: from, why: "it is not a well-formed file:// URL" }));
  }
  if (url.search !== "" || url.hash !== "") {
    return err(
      BackupErrors.sourceAddressInvalid({ address: from, why: "a file:// address carries no query or fragment" }),
    );
  }
  try {
    return ok(withoutTrailingSeparators({ path: fileURLToPath(url) }));
  } catch (cause: unknown) {
    return err(BackupErrors.sourceAddressInvalid({ address: from, why: errorMessage({ error: cause }) }));
  }
}
