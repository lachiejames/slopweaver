/**
 * The supervisor tick rows `fleet history` projects, read BACKWARDS from the ledger's end until a row predates the
 * window.
 *
 * Backwards because the ledger is append-only, written in finalisation order and large: 250,276,343 bytes on one
 * install (`ls -l ~/.slopweaver/ledgers/supervisor/supervisor-ticks.jsonl`), at roughly 240 KB a row. A
 * forward pass (`readSupervisorTickWindow`) parses every row to keep five days; a day of history needs only the rows
 * since its start. The read stops at the first whole row finalised before the window, or at {@link MAX_HISTORY_BYTES},
 * and says which — the document's `reachedFrom`.
 *
 * Every whole line read is parsed with the ledger's own strict row schema, and one that will not parse refuses the
 * read: a history that skipped it would show a gap as a quiet fleet. A line cut by the budget is never parsed. The
 * stop is sound only because the ledger is in finalisation order, which `readSupervisorTickWindow` refuses any other
 * ledger for; this read refuses a row out of that order among the rows it reads, and trusts the order past its stop.
 */
import { closeSync, existsSync, fstatSync, openSync, readSync } from "node:fs";

import { err, ok, type Result } from "#lib/result.js";
import { parseSupervisorTickLine } from "../supervisor/tickStore.js";
import type { SupervisorTickRow } from "../supervisor/tickTypes.js";

/** One backward read's size. A row is ~240 KB, so a chunk holds a dozen or so. */
const CHUNK_BYTES = 4 * 1024 * 1024;

/** The most of the ledger one history read will touch — about a week of ticks at today's row size and cadence. */
export const MAX_HISTORY_BYTES = 256 * 1024 * 1024;

/** The ledger does not exist: no supervisor tick was ever recorded on this home. */
interface HistoryLedgerAbsentError {
  readonly code: "HISTORY_LEDGER_ABSENT";
  readonly message: string;
}

/** The ledger exists and would not read. */
interface HistoryLedgerUnreadableError {
  readonly code: "HISTORY_LEDGER_UNREADABLE";
  readonly message: string;
  readonly cause: unknown;
}

/** A whole row in the window would not parse. */
interface HistoryRowRefusedError {
  readonly code: "HISTORY_ROW_REFUSED";
  readonly message: string;
}

/** Why the history could not be read. */
export type FleetHistoryReadError = HistoryLedgerAbsentError | HistoryLedgerUnreadableError | HistoryRowRefusedError;

/** The factories for {@link FleetHistoryReadError}. */
const FleetHistoryReadErrors = {
  absent: ({ path }: { path: string }): HistoryLedgerAbsentError => ({
    code: "HISTORY_LEDGER_ABSENT",
    message: `${path} does not exist, so no supervisor tick has been recorded on this home`,
  }),
  rowRefused: ({ path, why }: { path: string; why: string }): HistoryRowRefusedError => ({
    code: "HISTORY_ROW_REFUSED",
    message: `a tick row in ${path} would not read: ${why}`,
  }),
  unreadable: ({ path, cause }: { path: string; cause: unknown }): HistoryLedgerUnreadableError => ({
    cause,
    code: "HISTORY_LEDGER_UNREADABLE",
    message: `${path} would not read: ${cause instanceof Error ? cause.message : "unknown error"}`,
  }),
} as const;

/** The rows read, newest first, and whether the read reached the window's start. */
export interface TickRowsSince {
  readonly rows: readonly SupervisorTickRow[];
  readonly reachedFrom: boolean;
}

/** What one fold over a whole line decided. */
type LineVerdict = "kept" | "before" | "skipped";

/** An instant as whole milliseconds and the decimal digits past them, trailing zeros dropped. */
interface Instant {
  readonly ms: number;
  readonly beyond: string;
}

/**
 * An ISO instant, exactly. The row schema accepts any fractional precision and `Date.parse` floors past the
 * millisecond, which would tie `.0009Z` with `.0001Z` and keep a row finalised a fraction before the window.
 *
 * @returns the instant
 */
function instantOf({ iso }: { iso: string }): Instant {
  const fraction = /\.(\d+)/u.exec(iso);
  if (fraction === null) {
    return { beyond: "", ms: Date.parse(iso) };
  }
  // The group is not optional, so a match always carries it.
  const digits = fraction[1]!;
  const ms = Date.parse(iso.replace(fraction[0], `.${digits.slice(0, 3).padEnd(3, "0")}`));
  return { beyond: digits.slice(3).replace(/0+$/u, ""), ms };
}

/**
 * Which of two instants is later.
 *
 * @returns negative when `a` is earlier, positive when later, zero when the same instant
 */
function compareInstants({ a, b }: { a: Instant; b: Instant }): number {
  if (a.ms !== b.ms) {
    return a.ms - b.ms;
  }
  // Equal-width digit strings order the way their numbers do.
  const width = Math.max(a.beyond.length, b.beyond.length);
  const left = a.beyond.padEnd(width, "0");
  const right = b.beyond.padEnd(width, "0");
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

/** The rows kept so far, and the finalisation instant of the line read just before this one (the next one down). */
interface FoldState {
  readonly rows: SupervisorTickRow[];
  newer: Instant | undefined;
}

/**
 * Parse one whole line and keep it, or say it predates the window. A line finalised AFTER the one below it refuses
 * the read, as `readSupervisorTickWindow` refuses it: stopping at the first earlier row is sound only on a ledger in
 * finalisation order, so an out-of-turn row among the ones read is named rather than trusted as the stop.
 */
function foldLine({
  line,
  from,
  state,
}: {
  line: string;
  from: Instant;
  state: FoldState;
}): Result<LineVerdict, string> {
  if (line.trim() === "") {
    return ok("skipped");
  }
  const parsed = parseSupervisorTickLine({ line });
  if (parsed.isErr()) {
    return err(parsed.error.message);
  }
  const finalised = instantOf({ iso: parsed.value.finalisedIso });
  if (state.newer !== undefined && compareInstants({ a: finalised, b: state.newer }) > 0) {
    return err(
      `finalisedIso ${parsed.value.finalisedIso} is later than the row after it — the ledger is append-only in finalisation order, so a row was written out of turn`,
    );
  }
  state.newer = finalised;
  if (compareInstants({ a: finalised, b: from }) < 0) {
    return ok("before");
  }
  state.rows.push(parsed.value);
  return ok("kept");
}

/** What folding one buffer's whole lines decided: the read reached the window's start, or these bytes carry over. */
type ChunkVerdict = { readonly stopped: true } | { readonly stopped: false; readonly carry: Buffer };

/**
 * Fold every whole line in `pending`, newest first. The bytes before its first newline belong to a line whose start
 * is further back, so they carry over to the next chunk.
 *
 * @param pending a chunk with the previous chunk's carry appended
 * @returns whether the read stopped at the window's start, else the carry, or why a line was refused
 */
function foldWholeLines({
  pending,
  from,
  state,
}: {
  pending: Buffer;
  from: Instant;
  state: FoldState;
}): Result<ChunkVerdict, string> {
  let end = pending.length;
  // `end === 0` stops the walk: `lastIndexOf` with a negative offset would search from the buffer's end again.
  for (let at = pending.lastIndexOf(0x0a, end - 1); at !== -1 && end > 0; at = pending.lastIndexOf(0x0a, end - 1)) {
    const verdict = foldLine({ from, line: pending.subarray(at + 1, end).toString("utf8"), state });
    if (verdict.isErr()) {
      return err(verdict.error);
    }
    if (verdict.value === "before") {
      return ok({ stopped: true });
    }
    end = at;
  }
  return ok({ carry: pending.subarray(0, end), stopped: false });
}

/**
 * Whether the byte budget's floor falls on a line boundary: the file's start, or just after a newline.
 *
 * @param fd the open ledger
 * @param floor the first byte the budget reaches
 * @returns true when the carry left at the floor is a whole line
 */
function floorIsLineStart({ fd, floor }: { fd: number; floor: number }): boolean {
  if (floor === 0) {
    return true;
  }
  const before = Buffer.alloc(1);
  readSync(fd, before, 0, 1, floor - 1);
  return before[0] === 0x0a;
}

/**
 * Every tick row finalised at or after `fromIso`, read from the ledger's end.
 *
 * @param path the tick ledger
 * @param fromIso the window's start
 * @param maxBytes the most of the ledger to read; {@link MAX_HISTORY_BYTES} in production, small in a test
 * @returns the rows newest first and whether the read reached the window's start, or why it could not be read
 */
export function readTickRowsSince({
  path,
  fromIso,
  maxBytes,
}: {
  path: string;
  fromIso: string;
  maxBytes: number;
}): Result<TickRowsSince, FleetHistoryReadError> {
  if (!existsSync(path)) {
    return err(FleetHistoryReadErrors.absent({ path }));
  }
  const from = instantOf({ iso: fromIso });
  const state: FoldState = { newer: undefined, rows: [] };
  const rows = state.rows;
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const size = fstatSync(fd).size;
    const floor = Math.max(0, size - maxBytes);
    let position = size;
    // The bytes after the last newline seen, which belong to a line whose start is further back.
    let carry: Buffer = Buffer.alloc(0);
    while (position > floor) {
      const start = Math.max(floor, position - CHUNK_BYTES);
      const chunk = Buffer.alloc(position - start);
      readSync(fd, chunk, 0, chunk.length, start);
      position = start;
      const folded = foldWholeLines({ from, pending: Buffer.concat([chunk, carry]), state });
      if (folded.isErr()) {
        return err(FleetHistoryReadErrors.rowRefused({ path, why: folded.error }));
      }
      const chunkVerdict = folded.value;
      if (chunkVerdict.stopped) {
        return ok({ reachedFrom: true, rows });
      }
      carry = chunkVerdict.carry;
    }
    // The carry is a whole line at the file's start, or where the budget ends exactly after a newline; anywhere
    // else under the budget it is a line cut in two, and is dropped.
    if (!floorIsLineStart({ fd, floor })) {
      return ok({ reachedFrom: false, rows });
    }
    const verdict = foldLine({ from, line: carry.toString("utf8"), state });
    if (verdict.isErr()) {
      return err(FleetHistoryReadErrors.rowRefused({ path, why: verdict.error }));
    }
    const reachedStart = floor === 0;
    return ok({ reachedFrom: reachedStart || verdict.value === "before", rows });
  } catch (cause: unknown) {
    return err(FleetHistoryReadErrors.unreadable({ cause, path }));
  } finally {
    if (fd !== undefined) {
      closeSync(fd);
    }
  }
}
