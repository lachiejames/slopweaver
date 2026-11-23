/**
 * Write one seat's cached-pass marker, dated to the instant its check BEGAN rather than the instant it finished.
 *
 * WHY the back-dating: the bash reader (`hooks/lib/seat-pass.sh`) trusts a marker only while it is strictly newer
 * than the plan register's accounts file and the plan's usage snapshot. A check that began before a plan change or a
 * new reading landed, and wrote its pass after, would otherwise outrank the very input that should have invalidated
 * it. Dated to its start, anything written once the check's reads were under way wins.
 *
 * The date is set on the STAGED file, before the rename that publishes it, so the marker is never visible carrying
 * the instant it was written: a stamp after the rename left a window in which a fresh-dated marker outranked a
 * snapshot published during the check.
 *
 * Every write and removal of a marker lives here, so the door-coverage register names one local-state seam for the
 * whole `$SLOPWEAVER_HOME/live/seat-pass` tree.
 */

import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";
import { writeFileAtomic } from "../lib/writeAtomic.js";
import type { SeatPassWrite } from "./seatPass.js";

/** A marker that was not written: its check's start was not an instant, or the write itself failed. */
export interface SeatPassNotWrittenError {
  readonly code: "SEAT_PASS_NOT_WRITTEN";
  readonly message: string;
  readonly path: string;
}

/** The markers' directory exists but could not be listed, so the newest pass is unknown. */
export interface SeatPassesNotListedError {
  readonly code: "SEAT_PASSES_NOT_LISTED";
  readonly message: string;
  readonly path: string;
}

/** One listed marker could not be stat'd, so the newest pass is unknown. */
export interface SeatPassNotDatedError {
  readonly code: "SEAT_PASS_NOT_DATED";
  readonly message: string;
  readonly path: string;
}

/** A marker, or the whole directory of them, may still stand. */
export interface SeatPassNotRemovedError {
  readonly code: "SEAT_PASS_NOT_REMOVED";
  readonly message: string;
  readonly path: string;
}

/** Every way a cached seat pass's write, listing or removal fails. */
export type SeatPassMarkerError =
  SeatPassNotDatedError | SeatPassNotRemovedError | SeatPassNotWrittenError | SeatPassesNotListedError;

/** The one factory every seat-pass marker failure is built through. */
export const SeatPassMarkerErrors = {
  notDated: ({ dir, name, cause }: { dir: string; name: string; cause: unknown }): SeatPassNotDatedError => ({
    code: "SEAT_PASS_NOT_DATED",
    message: `the cached pass ${name} in ${dir} could not be dated (${String(cause)})`,
    path: join(dir, name),
  }),
  notListed: ({ dir, cause }: { dir: string; cause: unknown }): SeatPassesNotListedError => ({
    code: "SEAT_PASSES_NOT_LISTED",
    message: `the cached passes in ${dir} could not be listed (${String(cause)})`,
    path: dir,
  }),
  notRemoved: ({ path, cause }: { path: string; cause: unknown }): SeatPassNotRemovedError => ({
    code: "SEAT_PASS_NOT_REMOVED",
    message: `the cached pass at ${path} was not removed (${String(cause)})`,
    path,
  }),
  notWritten: ({ path, why }: { path: string; why: string }): SeatPassNotWrittenError => ({
    code: "SEAT_PASS_NOT_WRITTEN",
    message: `the cached pass at ${path} was not written: ${why}`,
    path,
  }),
} as const;

/**
 * Write the marker atomically, already dated to when the check began.
 *
 * @param marker where the marker goes and its exact contents, from `seatPassWrite`
 * @param judgedAtIso the instant the check began, before any of its reads
 * @returns ok once the marker stands with that mtime, else why it does not
 */
export function writeDatedSeatPass({
  marker,
  judgedAtIso,
}: {
  marker: SeatPassWrite;
  judgedAtIso: string;
}): Result<void, SeatPassMarkerError> {
  const judgedAt = new Date(judgedAtIso);
  if (Number.isNaN(judgedAt.getTime())) {
    return err(SeatPassMarkerErrors.notWritten({ path: marker.path, why: `${judgedAtIso} is not an instant` }));
  }
  try {
    writeFileAtomic({ contents: marker.contents, path: marker.path, stagedMtime: judgedAt });
  } catch (error: unknown) {
    return err(SeatPassMarkerErrors.notWritten({ path: marker.path, why: String(error) }));
  }
  return ok(undefined);
}

/** True when a thrown filesystem error says the path is simply not there. */
function isAbsent({ error }: { error: unknown }): boolean {
  return isRecord(error) && error["code"] === "ENOENT";
}

/**
 * One marker's mtime; a marker removed since the listing is undefined, not an error.
 *
 * @returns the mtime in epoch milliseconds, undefined when it is gone, else why it could not be read
 */
function passMtimeMs({ dir, name }: { dir: string; name: string }): Result<number | undefined, SeatPassMarkerError> {
  try {
    return ok(statSync(join(dir, name)).mtimeMs);
  } catch (error: unknown) {
    if (isAbsent({ error })) {
      return ok(undefined);
    }
    return err(SeatPassMarkerErrors.notDated({ cause: error, dir, name }));
  }
}

/**
 * The newest mtime among the cached passes, so a usage snapshot can be dated past every one of them. An absent
 * directory holds none.
 *
 * @param dir the markers' directory, `stateHomePaths().live.seatPassDir`
 * @returns the newest marker's mtime in epoch milliseconds, undefined when there are none, else why it is unknown
 */
export function newestSeatPassMs({ dir }: { dir: string }): Result<number | undefined, SeatPassMarkerError> {
  let names: readonly string[];
  try {
    names = readdirSync(dir);
  } catch (error: unknown) {
    if (isAbsent({ error })) {
      return ok(undefined);
    }
    return err(SeatPassMarkerErrors.notListed({ cause: error, dir }));
  }
  let newest: number | undefined;
  for (const name of names) {
    const mtime = passMtimeMs({ dir, name });
    if (mtime.isErr()) {
      return err(mtime.error);
    }
    if (mtime.value !== undefined && (newest === undefined || mtime.value > newest)) {
      newest = mtime.value;
    }
  }
  return ok(newest);
}

/**
 * Remove one cached pass, or the whole directory of them. An absent path is already removed.
 *
 * @param path one marker, or the markers' directory when every pass must go
 * @returns ok once nothing stands at the path, else why something still may
 */
export function removeSeatPasses({ path }: { path: string }): Result<void, SeatPassMarkerError> {
  try {
    rmSync(path, { force: true, recursive: true });
  } catch (error: unknown) {
    return err(SeatPassMarkerErrors.notRemoved({ cause: error, path }));
  }
  return ok(undefined);
}
