/**
 * Whether a file is genuinely not there, and a strict read that says so only then.
 *
 * ENOENT alone cannot tell "never written" from "there but unreachable": a link to a file that went away
 * answers it, and so does every path beneath a DIRECTORY link whose target went away. A reader that maps
 * every ENOENT to "absent" makes a broken install look like a fresh one, and a config read as absent is read
 * as its documented default — an empty rule list, no declared checkouts — which is the silent fallback this
 * module exists to end.
 */
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, type Stats, statSync } from "node:fs";
import { dirname, parse, sep } from "node:path";

import type { IngestError } from "./ingestError.js";
import { ok, type Result } from "./result.js";
import { safeFs } from "./safeBoundary.js";

/**
 * Whether a caught filesystem error is ENOENT — which alone never proves absence; see {@link isAbsentError}.
 *
 * @returns true for an ENOENT, whatever stands on the way to the path
 */
export function isNotFoundError({ error }: { error: unknown }): boolean {
  return error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT";
}

/** The path itself when it exists (a link is not followed), `null` when it does not, or the error that hid it. */
function lstatIfPresent({ path }: { path: string }): Stats | null | "unknowable" {
  try {
    return lstatSync(path);
  } catch (error: unknown) {
    return isNotFoundError({ error }) ? null : "unknowable";
  }
}

/** The path without trailing separators (`/`, and the platform's own, `\` on Windows), keeping its root. */
function withoutTrailingSlashes({ path }: { path: string }): string {
  const rootLength = Math.max(1, parse(path).root.length);
  let end = path.length;
  while (end > rootLength && (path[end - 1] === "/" || path[end - 1] === sep)) {
    end -= 1;
  }
  return path.slice(0, end);
}

/** Whether a link resolves to something that is there. */
function linkResolves({ path }: { path: string }): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether a path that answered ENOENT is really not there, rather than behind a dangling symlink.
 *
 * Walks up to the nearest component that exists and calls the path absent only when that component is not a
 * dangling link. Something IS there in the dangling case, and reading it as absence would make a broken
 * install look like a fresh one.
 *
 * @param path the path whose read or listing answered ENOENT
 * @returns true when nothing is there, false when a dangling link (or an unreadable component) stands on the way
 */
export function isGenuinelyAbsent({ path }: { path: string }): boolean {
  // Never `resolve()`d: normalising `dangling/..` away erases the very component that dangles. Trailing slashes
  // are stripped at every step instead, because `dirname("link/")` and `dirname("link//x")` skip past `link`.
  let current = path;
  for (;;) {
    current = withoutTrailingSlashes({ path: current });
    const entry = lstatIfPresent({ path: current });
    if (entry === "unknowable") {
      return false;
    }
    if (entry !== null) {
      return !entry.isSymbolicLink() || linkResolves({ path: current });
    }
    const parent = dirname(current);
    if (parent === current) {
      return true;
    }
    current = parent;
  }
}

/**
 * Whether a caught filesystem error means the path simply is not there — see {@link isGenuinelyAbsent}.
 *
 * @param error what the read or listing threw
 * @param path the path it was reading
 * @returns true only for an ENOENT with nothing — not even a dangling link — standing on the way
 */
export function isAbsentError({ error, path }: { error: unknown; path: string }): boolean {
  return isNotFoundError({ error }) && isGenuinelyAbsent({ path });
}

/**
 * A path's bytes, refusing a FIFO, socket or device before opening it.
 *
 * Opening a named pipe with no writer blocks forever, so a `profile.json` that is a FIFO would hang every
 * gate that reads it rather than refuse. Reproduce: `mkfifo /tmp/p && node -e 'require("fs").readFileSync("/tmp/p")'`
 * never returns. The path is opened ONCE, non-blocking, and the kind is judged on that descriptor: a `stat`
 * of the path followed by a second open of it would let the path become a pipe in between. A directory is
 * left to the read, which already answers EISDIR at once. A missing path throws ENOENT as `readFileSync` does,
 * so a reader keeps its own absence handling.
 *
 * @param path the file to read
 * @returns the raw bytes
 */
export function nonBlockingFileBytes({ path }: { path: string }): Buffer {
  const fd = openFileNonBlocking({ path });
  try {
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}

/**
 * Open a path for reading without blocking on a FIFO, and refuse anything that is not a file or directory — the
 * descriptor half of {@link nonBlockingFileBytes}, for a reader that streams (`../corpus/corpusStore.ts`).
 *
 * @param path the file to open
 * @param noFollow open with `O_NOFOLLOW`, so a symlink at the path throws ELOOP rather than being read through — for
 *   a reader that has refused a link and must not have one swapped in between its check and this open
 * @returns an open descriptor the caller closes; throws ENOENT as `openSync` does, and on a pipe, socket or device
 */
export function openFileNonBlocking({ path, noFollow = false }: { path: string; noFollow?: boolean }): number {
  const flags = constants.O_RDONLY | constants.O_NONBLOCK;
  const fd = openSync(path, noFollow ? flags | constants.O_NOFOLLOW : flags);
  const stats = fstatSync(fd);
  if (!stats.isFile() && !stats.isDirectory()) {
    closeSync(fd);
    throw new Error(`${path} is not a regular file (a pipe, socket or device), so it is not read`);
  }
  return fd;
}

/**
 * Read a file as STRICT UTF-8, answering `null` only when it is genuinely absent.
 *
 * `readFileSync(path, "utf8")` repairs rather than refuses: an invalid byte becomes U+FFFD and the caller
 * works from text nobody wrote. Reproduce the class:
 *   printf 'a\226b' > /tmp/bad.txt
 *   node -e 'console.log(require("fs").readFileSync("/tmp/bad.txt","utf8"))'            # a<U+FFFD>b
 *   node -e 'new TextDecoder("utf-8",{fatal:true}).decode(require("fs").readFileSync("/tmp/bad.txt"))'  # throws
 *
 * A leading byte-order mark is KEPT (`ignoreBOM: true`), as `readFileSync(path, "utf8")` keeps it, so a JSON
 * reader refuses it rather than this decoder stripping bytes nobody asked it to.
 *
 * @param path the file to read
 * @param operation the boundary label carried into the typed error
 * @returns the decoded text, `null` when nothing is there, or the typed boundary error for every other failure
 */
export function readStrictFileIfPresent({
  path,
  operation,
}: {
  path: string;
  operation: string;
}): Result<string | null, IngestError> {
  const read = safeFs({
    execute: () => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(nonBlockingFileBytes({ path })),
    operation,
    path,
  });
  if (read.isErr() && read.error.code === "ENOENT" && isGenuinelyAbsent({ path })) {
    return ok(null);
  }
  return read;
}
