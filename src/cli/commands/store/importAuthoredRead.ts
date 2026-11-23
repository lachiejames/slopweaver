/**
 * Reading one file the authored walk listed — the effectful edge of `./importAuthoredLeg.ts`, which tells a file
 * deleted since the walk from one that will not read.
 *
 * The walk and the read are two moments, and a live home changes between them. MEASURED: the nightly
 * (`store-import-fleet-nightly`) listed `talk/chair-wake.json.lock`, a lock
 * `../../../talk/chairWakeShell.ts` holds for milliseconds, met ENOENT at the read and exited 1 on it; the next
 * dry run hit the same lock and named it here instead (repro: `slopweaver store import-fleet --only authored
 * --dry-run`, whose notes name any such path). A deletion is not a file the store refuses, so it is skipped and
 * named, never a refusal and never silent.
 */
import { closeSync, fstatSync, readFileSync } from "node:fs";

import { errorMessage } from "#lib/errorMessage.js";
import { isAbsentError, openFileNonBlocking } from "#lib/presentFile.js";

/** One listed file as the read found it. */
export type ListedFileRead =
  | { readonly kind: "read"; readonly bytes: Buffer; readonly fileModifiedAt: Date }
  | { readonly kind: "vanished" }
  | { readonly kind: "unreadable"; readonly reason: string };

/** Whether a caught error's `code` is ENOTDIR — a directory on the way to the path replaced by a file. */
function isNotDirectoryError({ error }: { error: unknown }): boolean {
  return error !== null && typeof error === "object" && "code" in error && error.code === "ENOTDIR";
}

/**
 * Read one file the walk listed.
 *
 * The path is opened ONCE and the bytes and mtime both come from that descriptor, so only the OPEN can find the
 * file gone: a file unlinked after it opened was there at its read and is projected. A read then a second `stat`
 * of the path would call such a file vanished, which is what review found in the first cut. `vanished` is ENOENT
 * at the open with nothing — not even a dangling link — at the path (`isAbsentError`), or ENOTDIR, where a
 * directory on the way became a file. Every other failure, EISDIR and EACCES included, is `unreadable`: something
 * still occupies the path, so it stays a refusal.
 *
 * @param path the absolute path the walk listed
 * @returns the bytes and mtime, `vanished`, or why it would not read
 */
export function readListedFile({ path }: { path: string }): ListedFileRead {
  let fd: number;
  try {
    fd = openFileNonBlocking({ path });
  } catch (cause) {
    if (isAbsentError({ error: cause, path }) || isNotDirectoryError({ error: cause })) {
      return { kind: "vanished" };
    }
    return { kind: "unreadable", reason: errorMessage({ error: cause }) };
  }
  try {
    return { bytes: readFileSync(fd), fileModifiedAt: fstatSync(fd).mtime, kind: "read" };
  } catch (cause) {
    return { kind: "unreadable", reason: errorMessage({ error: cause }) };
  } finally {
    closeSync(fd);
  }
}

/**
 * The listed paths still on disk once the read is done — what `authored_absent` is computed against, so a stored
 * path deleted mid-run is recorded absent on THIS run rather than the next.
 *
 * @param listed every home-relative path the walk listed, in walk order
 * @param vanished the home-relative paths the read found gone
 * @returns the listed paths less the vanished ones, in walk order
 */
export function listedFilesStillPresent({
  listed,
  vanished,
}: {
  listed: readonly string[];
  vanished: readonly string[];
}): readonly string[] {
  const gone = new Set(vanished);
  return listed.filter((path) => !gone.has(path));
}

/**
 * The note naming every listed file deleted before it could be read.
 *
 * @param paths the home-relative paths gone by the read, in walk order
 * @returns no line when there are none, else a count and the paths
 */
export function vanishedListedFileNotes({ paths }: { paths: readonly string[] }): readonly string[] {
  if (paths.length === 0) {
    return [];
  }
  return [`${String(paths.length)} file(s) deleted between the walk and the read, not stored: ${paths.join(", ")}`];
}
