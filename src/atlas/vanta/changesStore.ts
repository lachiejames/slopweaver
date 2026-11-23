/**
 * The Vanta change log on disk: one file per sync under `$SLOPWEAVER_HOME/vanta/changes/`, and one cursor
 * naming the latest file a visible session has judged.
 *
 * Outside `atlas/vanta/` on purpose — a publish replaces that directory whole and `atlas vanta reset`
 * archives it, and either would take the log with it. Files are named by the sync's instant with `:` made
 * `-` (the shape `kit/archive.ts` uses); the record's own `at` is what ordering and the cursor compare, and
 * a fixed-width UTC ISO string sorts as its instant.
 *
 * Local bookkeeping only: nothing here reaches Vanta or Slack.
 */
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { err, ok, type Result } from "#lib/result.js";
import { safeJsonParse } from "#lib/safeJson.js";
import { stableStringify } from "#lib/stableStringify.js";
import { writeFileAtomic } from "#lib/writeAtomic.js";
import { stateHomePaths } from "../../stateHome.js";
import { type VantaChangeRecord, vantaChangeRecordSchema } from "./changes.js";
import { type VantaChangesError, VantaChangesErrors } from "./changesErrors.js";

const cursorSchema = z.object({ throughAt: z.iso.datetime() }).strict();

/** What is waiting to be judged: every record past the cursor, oldest first. */
export interface UnreadVantaChanges {
  /** The latest record already judged, or `null` when no session has marked one. */
  readonly throughAt: string | null;
  readonly records: readonly VantaChangeRecord[];
}

/**
 * Where one sync's change record lives.
 *
 * @returns the absolute path for the record a sync at that instant writes
 */
export function vantaChangeFilePath({ home, at }: { home: string; at: string }): string {
  return join(stateHomePaths({ home }).vantaChanges, `${at.replaceAll(":", "-")}.json`);
}

/**
 * Record one sync's changes.
 *
 * @returns the path written, or why it could not be
 */
export function writeVantaChangeRecord({
  home,
  record,
}: {
  home: string;
  record: VantaChangeRecord;
}): Result<string, VantaChangesError> {
  const path = vantaChangeFilePath({ at: record.at, home });
  try {
    writeFileAtomic({ contents: `${stableStringify({ value: record })}\n`, path });
  } catch (error: unknown) {
    return err(VantaChangesErrors.changeFileUnwritable({ cause: error, path }));
  }
  return ok(path);
}

/**
 * Remove one sync's change record — the record of a generation that never published.
 *
 * @param path the record's path, as `writeVantaChangeRecord` answered it
 * @returns nothing, or why it could not be removed
 */
export function removeVantaChangeRecord({ path }: { path: string }): Result<void, VantaChangesError> {
  try {
    rmSync(path, { force: true });
  } catch (error: unknown) {
    return err(VantaChangesErrors.changeFileUnremovable({ cause: error, path }));
  }
  return ok(undefined);
}

/** Read the cursor: `null` when no session has marked anything, a typed refusal when it will not parse. */
function readCursor({ home }: { home: string }): Result<string | null, VantaChangesError> {
  const path = stateHomePaths({ home }).vantaChangesCursorJson;
  if (!existsSync(path)) {
    return ok(null);
  }
  try {
    const parsed = cursorSchema.parse(safeJsonParse({ label: path, text: readFileSync(path, "utf8") }));
    return ok(parsed.throughAt);
  } catch (error: unknown) {
    return err(VantaChangesErrors.cursorUnreadable({ cause: error, path }));
  }
}

/** Every recorded change, oldest first; an absent directory is a log nothing has written to yet. */
function readAllRecords({ home }: { home: string }): Result<readonly VantaChangeRecord[], VantaChangesError> {
  const directory = stateHomePaths({ home }).vantaChanges;
  if (!existsSync(directory)) {
    return ok([]);
  }
  let names: readonly string[];
  try {
    names = readdirSync(directory).filter((name) => name.endsWith(".json"));
  } catch (error: unknown) {
    return err(VantaChangesErrors.changesDirectoryUnreadable({ cause: error, path: directory }));
  }
  const records: VantaChangeRecord[] = [];
  for (const name of names) {
    const path = join(directory, name);
    try {
      records.push(vantaChangeRecordSchema.parse(safeJsonParse({ label: path, text: readFileSync(path, "utf8") })));
    } catch (error: unknown) {
      return err(VantaChangesErrors.changeFileUnreadable({ cause: error, path }));
    }
  }
  return ok(records.toSorted((left, right) => left.at.localeCompare(right.at)));
}

/**
 * Every change record no session has judged yet.
 *
 * @returns the cursor and the records past it, oldest first, or why the log will not read
 */
export function readUnreadVantaChanges({ home }: { home: string }): Result<UnreadVantaChanges, VantaChangesError> {
  const cursor = readCursor({ home });
  if (cursor.isErr()) {
    return err(cursor.error);
  }
  const all = readAllRecords({ home });
  if (all.isErr()) {
    return err(all.error);
  }
  const throughAt = cursor.value;
  return ok({
    records: throughAt === null ? all.value : all.value.filter((record) => record.at > throughAt),
    throughAt,
  });
}

/**
 * Mark every record up to and including one instant as judged.
 *
 * Marking names the instant the session actually read, never "everything", so a sync landing while the
 * session was judging stays unread for the next one.
 *
 * @param at the `at` of the latest record the session judged
 * @returns the cursor before and after, or why the move was refused
 */
export function markVantaChangesRead({
  home,
  at,
}: {
  home: string;
  at: string;
}): Result<{ readonly previous: string | null; readonly through: string }, VantaChangesError> {
  const cursor = readCursor({ home });
  if (cursor.isErr()) {
    return err(cursor.error);
  }
  const all = readAllRecords({ home });
  if (all.isErr()) {
    return err(all.error);
  }
  if (!all.value.some((record) => record.at === at)) {
    return err(VantaChangesErrors.unknownChange({ at }));
  }
  const previous = cursor.value;
  if (previous !== null && at < previous) {
    return err(VantaChangesErrors.cursorBackwards({ at, through: previous }));
  }
  const path = stateHomePaths({ home }).vantaChangesCursorJson;
  try {
    writeFileAtomic({ contents: `${stableStringify({ value: { throughAt: at } })}\n`, path });
  } catch (error: unknown) {
    return err(VantaChangesErrors.cursorUnwritable({ cause: error, path }));
  }
  return ok({ previous, through: at });
}
