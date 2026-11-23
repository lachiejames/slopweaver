/**
 * The tombstone's real effects (`./retiredRegister.ts`): `lstat`, `mkdir`, the marker's write, a strict `fsync` of a
 * file or a directory, and the old register's operation lock. Every one throws on failure; the shell types it.
 *
 * Both `fsync`s open the path read-only and sync that descriptor. darwin and Linux, the only platforms this runs on,
 * accept `fsync` on a directory descriptor, so a refusal there is a real failure and is reported, never swallowed the
 * way `#lib/writeAtomic.js`'s best-effort directory sync swallows one.
 *
 * A link is refused at the two components the tombstone OWNS — `register.json` and its `RETIRED` marker — and
 * followed in every parent, deliberately. The old writer resolves `home/workstreams` through
 * any link exactly this way, so the tombstone must stand at that same resolved path to fence it; and the directory
 * holding the entry is the link's target, so syncing the target is what makes the entry durable.
 */
import {
  closeSync,
  constants,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  type Stats,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { isRecord } from "#lib/parsers.js";

import { acquireOperationLock } from "../../admit/operationLock.js";

import {
  RETIRED_REGISTER_LOCK_KEY,
  RETIRED_REGISTER_MARKER_NAME,
  type RetiredRegisterNode,
  type RetiredRegisterSeams,
} from "./retiredRegister.js";

/** Owner-only, like every register under the home. */
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;

/**
 * Open a path read-only, `fsync` the descriptor and close it, the close attempted even when the sync throws.
 *
 * @param path the file or directory to make durable
 * @param flags how to open it; the marker opens with `O_NOFOLLOW`, so a link swapped in is an error, never its target
 */
function syncPath({ flags, path }: { flags: number; path: string }): void {
  const handle = openSync(path, flags);
  try {
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
}

/**
 * What one `lstat` found at the path, a directory listed and its marker read.
 *
 * @returns the node, `absent` only for ENOENT; every other failure throws
 */
function inspectPath({ path }: { path: string }): RetiredRegisterNode {
  let stats: Stats;
  try {
    stats = lstatSync(path);
  } catch (error: unknown) {
    if (isRecord(error) && error["code"] === "ENOENT") {
      return { kind: "absent" };
    }
    throw error;
  }
  if (stats.isSymbolicLink()) {
    return { kind: "symlink" };
  }
  if (stats.isFile()) {
    return { kind: "file" };
  }
  if (!stats.isDirectory()) {
    return { kind: "other" };
  }
  const entries = readdirSync(path).toSorted();
  return { entries, kind: "directory", marker: inspectMarker({ entries, path }) };
}

/**
 * The marker entry, `lstat`ed first so a link or a directory of that name is reported, never followed or read.
 *
 * @param entries the tombstone directory's entries
 * @param path the tombstone directory
 * @returns the marker as {@link RetiredRegisterNode} carries it
 */
function inspectMarker({
  entries,
  path,
}: {
  entries: readonly string[];
  path: string;
}): Extract<RetiredRegisterNode, { kind: "directory" }>["marker"] {
  if (!entries.includes(RETIRED_REGISTER_MARKER_NAME)) {
    return null;
  }
  const markerPath = join(path, RETIRED_REGISTER_MARKER_NAME);
  if (!lstatSync(markerPath).isFile()) {
    return { kind: "not-a-file" };
  }
  return { contents: readFileSync(markerPath, "utf8"), kind: "file" };
}

/**
 * The seams production fences a home with.
 *
 * @param nowIso the clock the lock stamps its holder with
 * @returns the seams
 */
export function productionRetiredRegisterSeams({ nowIso }: { nowIso: () => string }): RetiredRegisterSeams {
  return {
    inspect: ({ path }) => inspectPath({ path }),
    lock: ({ home }) => acquireOperationLock({ home, key: RETIRED_REGISTER_LOCK_KEY, nowIso: nowIso() }),
    makeDirectory: ({ path }) => {
      mkdirSync(path, { mode: DIRECTORY_MODE, recursive: true });
    },
    syncDirectory: ({ followLink, path }) => {
      const nofollow = followLink ? 0 : constants.O_NOFOLLOW;
      syncPath({ flags: constants.O_RDONLY | constants.O_DIRECTORY | nofollow, path });
    },
    syncFile: ({ path }) => {
      syncPath({ flags: constants.O_RDONLY | constants.O_NOFOLLOW, path });
    },
    writeMarker: ({ contents, path }) => {
      writeFileSync(path, contents, { mode: FILE_MODE });
    },
  };
}
