/**
 * The two local things `slopweaver wait` can wait on — a process and a file — as readings a wait loop
 * compares. The effectful reads are the two production functions at the bottom; everything above them is pure.
 *
 * A Claude Code background task is a FILE here, not a third kind: its output is written to the path the tool
 * prints when it starts, so waiting on a task is `--file <that path> --contains <marker>`. What the gate
 * refuses about a task is re-calling `TaskOutput`, and a blocking `TaskOutput` with a timeout is still the
 * recipe for that.
 */
import { existsSync, readFileSync } from "node:fs";

/** What one read of a process found. */
export type PidReading = { readonly kind: "alive" } | { readonly kind: "exited" };

/** What one read of a file found. */
export type FileReading =
  | { readonly kind: "absent" }
  | { readonly kind: "present"; readonly matched: boolean }
  | { readonly kind: "unreadable"; readonly reason: string };

/**
 * Whether a file reading satisfies the wait: the file exists, and — when a marker was asked for — carries it.
 * An unreadable file SETTLES the wait rather than spinning on it: reading it again will not make it readable,
 * and the caller reports why.
 *
 * @param reading the file's current reading
 * @param contains the marker asked for, if any
 * @returns whether the wait is over
 */
export function fileSettled({ reading, contains }: { reading: FileReading; contains: string | undefined }): boolean {
  if (reading.kind === "absent") {
    return false;
  }
  if (reading.kind === "unreadable") {
    return true;
  }
  return contains === undefined || reading.matched;
}

/**
 * Probe a pid with signal 0. `EPERM` means the process exists and belongs to someone else, so it is alive.
 *
 * @param pid the process id
 * @returns alive or exited
 */
export function readPid({ pid }: { pid: number }): PidReading {
  try {
    process.kill(pid, 0);
    return { kind: "alive" };
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    return code === "EPERM" ? { kind: "alive" } : { kind: "exited" };
  }
}

/**
 * Read a file for a wait: whether it exists and, when a marker is asked for, whether it carries it.
 *
 * @param path the file to read
 * @param contains the marker to look for, if any
 * @returns the reading
 */
export function readFileForWait({ path, contains }: { path: string; contains: string | undefined }): FileReading {
  if (!existsSync(path)) {
    return { kind: "absent" };
  }
  if (contains === undefined) {
    return { kind: "present", matched: true };
  }
  try {
    return { kind: "present", matched: readFileSync(path, "utf8").includes(contains) };
  } catch (error) {
    return { kind: "unreadable", reason: error instanceof Error ? error.message : String(error) };
  }
}
