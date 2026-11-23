/**
 * The marks a failed landing leaves, so the next batch of ANY call sweeps the other calls again rather than only the
 * batch that opens a call. A board that refuses a write across a call's last batch and the next
 * call's open batch otherwise leaves the earlier call's words on disk and on no card until a third call opens.
 *
 * Each failure writes its own file, named for a fresh id, and takes no lock: the failure it records is often the
 * ledger's lock held past its wait, and a mark that waited on that lock would be lost with the landing.
 * A sweep that lands everything removes exactly the marks it read before it swept, so one another batch wrote while
 * it swept stays and is swept on the batch after.
 *
 * The residue, stated: a mark that cannot be written at all — the disk full — leaves no mark, so the earlier call's
 * words wait on disk for the next call's open line, as they did before marks existed.
 */
import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { IngestError } from "../lib/ingestError.js";
import { ok, type Result } from "../lib/result.js";
import { safeFs } from "../lib/safeBoundary.js";
import { callsDir } from "./callStore.js";

/**
 * `$home/talk/sweep-owed/` (`0700`): one empty `0600` file per failed landing no sweep since has cleared.
 *
 * @returns the marks' directory
 */
export function sweepOwedDir({ home }: { home: string }): string {
  return join(dirname(callsDir({ home })), "sweep-owed");
}

/**
 * The marks standing now, which a sweep that lands everything removes.
 *
 * @returns their names — empty when no sweep is owed — or why the directory could not be read
 */
export function sweepOwedMarks({ home }: { home: string }): Result<readonly string[], string> {
  const dir = sweepOwedDir({ home });
  // Absent only when nothing at all is there: a dangling link refuses every mark, so it must read as unreadable —
  // a sweep owed — never as none.
  if (!existsSync(dir) && !linkAt({ path: dir })) {
    return ok([]);
  }
  return safeFs({ execute: () => readdirSync(dir), operation: "readSweepOwed", path: dir }).mapErr(
    (error: IngestError) => error.message,
  );
}

/**
 * Leave one mark: a sweep is owed.
 *
 * @returns nothing on success, or why the mark could not be written
 */
export function markSweepOwed({ home }: { home: string }): Result<void, string> {
  const dir = sweepOwedDir({ home });
  return safeFs({
    execute: () => {
      mkdirSync(dir, { mode: 0o700, recursive: true });
      writeFileSync(join(dir, randomUUID()), "", { flag: "wx", mode: 0o600 });
    },
    operation: "markSweepOwed",
    path: dir,
  }).mapErr((error: IngestError) => error.message);
}

/**
 * Remove the marks a sweep read before it landed everything, and none written since.
 *
 * @param marks what {@link sweepOwedMarks} read before that sweep
 * @returns nothing on success, or why a mark could not be removed
 */
export function clearSweepOwed({ home, marks }: { home: string; marks: readonly string[] }): Result<void, string> {
  const dir = sweepOwedDir({ home });
  return safeFs({
    execute: () => {
      for (const mark of marks) {
        rmSync(join(dir, mark), { force: true });
      }
    },
    operation: "clearSweepOwed",
    path: dir,
  }).mapErr((error: IngestError) => error.message);
}

/** Whether a link, followed or not, sits at `path` — what `existsSync` misses when the link dangles. */
function linkAt({ path }: { path: string }): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}
