/**
 * Durable I/O for the sync-run ledger: append one row to a run's file, and read a source's newest runs back.
 *
 * One file per run, named `<compact start instant>-<runId>.jsonl` under `live/sync-runs/<source>/`, so the names
 * sort by start and a reader takes the newest few without opening the rest. Every decision about a row is made by
 * a pure function in `./event.ts` or `./fold.ts`; this module only moves bytes.
 *
 * **Nothing prunes these files yet.** A run is a few kilobytes and a scheduled source refreshes a handful of times
 * a day, so the directory grows slowly, and the reader's cost does not grow with it: it lists names and opens only
 * `limit` files. When a rule for retiring old runs exists it belongs here.
 */
import { mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { readJsonlLines } from "../corpus/corpusStore.js";
import { appendLines } from "../lib/appendSeparator.js";
import { err, ok, type Result } from "../lib/result.js";
import { stateHomePaths } from "../stateHome.js";
import { parseSyncRunEvent, type SyncRunEvent, syncRunEventLine } from "./event.js";

/** Owner-only, like the rest of `live/`: these rows name channels and pids. */
const DIR_MODE = 0o700;

/** Owner-only file mode. */
const FILE_MODE = 0o600;

/**
 * A run file's name: its start instant with the punctuation a filename should not carry, then its id.
 *
 * @param startedAtIso the run's start instant
 * @returns the bare file name
 */
export function syncRunFileName({ startedAtIso, runId }: { startedAtIso: string; runId: string }): string {
  return `${startedAtIso.replace(/[:.]/gu, "-")}-${runId}.jsonl`;
}

/**
 * The directory a source's run files live in.
 *
 * @param home the Slopweaver home
 * @param source the corpus source
 * @returns the absolute directory
 */
export function syncRunDir({ home, source }: { home: string; source: string }): string {
  return join(stateHomePaths({ home }).live.syncRunsDir, source);
}

/**
 * Append one row to a run's file, fsync'd — the rows worth having are the ones written just before a crash.
 *
 * @param home the Slopweaver home
 * @param source the corpus source the run belongs to
 * @param fileName the run's file name, from {@link syncRunFileName}
 * @param event the row
 * @returns ok, or the one-line reason the append failed
 */
export function appendSyncRunEvent({
  home,
  source,
  fileName,
  event,
}: {
  home: string;
  source: string;
  fileName: string;
  event: SyncRunEvent;
}): Result<void> {
  const dir = syncRunDir({ home, source });
  const path = join(dir, fileName);
  try {
    mkdirSync(dir, { mode: DIR_MODE, recursive: true });
    appendLines({ durable: true, mode: FILE_MODE, path, text: `${syncRunEventLine({ event })}\n` });
  } catch (error: unknown) {
    return err([`could not append to the sync-run ledger at ${path}: ${String(error)}`]);
  }
  return ok(undefined);
}

/** One run file read back. */
export interface StoredSyncRun {
  readonly source: string;
  readonly runId: string;
  readonly fileName: string;
  readonly events: readonly SyncRunEvent[];
  /** Non-empty lines that did not decode — including a half-written last line. */
  readonly malformedLines: number;
}

/** The run id a file name carries: everything after the 24-character start stamp and its dash. */
function runIdOf({ fileName }: { fileName: string }): string {
  return fileName.replace(/\.jsonl$/u, "").slice("2026-01-01T00-00-00-000Z-".length);
}

/**
 * Read a source's newest runs, newest first.
 *
 * An absent directory is no runs, which is a true reading for a source that has never been synced since the
 * ledger began. An unreadable one is an error, because "no runs" would then be a lie.
 *
 * @param home the Slopweaver home
 * @param source the corpus source
 * @param limit how many of the newest runs to open
 * @returns the runs, newest first, or why the directory could not be read
 */
export function readRecentSyncRuns({
  home,
  source,
  limit,
}: {
  home: string;
  source: string;
  limit: number;
}): Result<readonly StoredSyncRun[]> {
  const dir = syncRunDir({ home, source });
  let names: string[];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith(".jsonl"));
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return ok([]);
    }
    return err([`could not list the sync-run ledger at ${dir}: ${String(error)}`]);
  }
  const newest = names.toSorted().toReversed().slice(0, limit);
  const runs: StoredSyncRun[] = [];
  for (const fileName of newest) {
    const read = readOneRun({ path: join(dir, fileName) });
    if (read.isErr()) {
      return err(read.error);
    }
    runs.push({ ...read.value, fileName, runId: runIdOf({ fileName }), source });
  }
  return ok(runs);
}

/**
 * How many of a run's newest progress rows a read keeps. The fold reads only the newest two of one phase and the
 * newest instant, and a day-long backfill writes thousands, so the rest are dropped as they stream past.
 */
const KEPT_PROGRESS_ROWS = 64;

/** Stream one run file's rows, keeping every non-progress row and only the newest progress rows. */
function readOneRun({ path }: { path: string }): Result<{ events: SyncRunEvent[]; malformedLines: number }> {
  const events: SyncRunEvent[] = [];
  let malformedLines = 0;
  let progressRows = 0;
  try {
    readJsonlLines({
      onLine: ({ line }) => {
        if (line.trim().length === 0) {
          return;
        }
        const event = parseSyncRunEvent({ line });
        if (event === undefined) {
          malformedLines += 1;
          return;
        }
        events.push(event);
        if (event.type === "progress") {
          progressRows += 1;
        }
        if (progressRows > KEPT_PROGRESS_ROWS) {
          const oldest = events.findIndex((kept) => kept.type === "progress");
          events.splice(oldest, 1);
          progressRows -= 1;
        }
      },
      path,
      // A row holding a byte that is not UTF-8 arrives as one lone U+FFFD and counts as malformed, never as its
      // silently repaired text parsing clean, so a corrupt history reads as incomplete.
      strictUtf8: true,
    });
  } catch (error: unknown) {
    return err([`could not read sync run ${path}: ${String(error)}`]);
  }
  return ok({ events, malformedLines });
}
