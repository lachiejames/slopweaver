/**
 * The tick ledger on disk: where it lives, how a row is appended, and how the briefing's own window is read
 * back without holding the file.
 *
 * ## The read is STREAMED, and that is categorical
 *
 * `supervisor-ticks.jsonl` is an append-only record stream with no ceiling — one row per sweep tick, every
 * ~20 minutes, forever — so its size is the fleet's history rather than this code's. The repository bars a
 * `.jsonl` from passing through one JS string with no exception (`src/devLint/wholeFileJson.ts`), and the
 * one reader allowed is `readJsonlLines` (`../corpus/corpusStore.ts`). `readJsonlRows` accumulates every row
 * and is therefore NOT that reader for this file.
 *
 * {@link readSupervisorTickWindow} holds a bounded working set whatever the ledger's length: the newest row,
 * the rows of the newest row's own local day, and a bounded number of prior days' rows. Everything older is
 * COUNTED and dropped, so the projection can disclose what it did not show without the ledger ever being
 * resident.
 *
 * ## A malformed row is a REFUSAL, not a skip
 *
 * Every other ledger in this home can afford to ignore a line it cannot read. This one cannot: it carries
 * the owner's words, and a silently skipped row is a silently dropped owner turn. So a line that will not parse, a
 * duplicate `tickId` and a `finalisedIso` that goes backwards each fail the read by name.
 *
 * ## An absent ledger is not an empty one
 *
 * `readSupervisorTickWindow` refuses a ledger that is not there. A caller asking for the derived narrative
 * has asked for the ledger; answering "no history" would render a page claiming a quiet fleet from a missing
 * file, which is the exact class every `unavailable` arm in `./tickTypes.ts` exists to close.
 */
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { acquireOperationLockDetailed } from "../admit/operationLock.js";
import { localDayKey } from "../briefing/localDay.js";
import { readJsonlLines } from "../corpus/corpusStore.js";
import { slopweaverHome } from "../homeDir.js";
import { appendLines, needsSeparator } from "../lib/appendSeparator.js";
import { err, ok, type Result } from "../lib/result.js";
import { safeFs } from "../lib/safeBoundary.js";
import { safeJsonStringify } from "../lib/safeJson.js";
import { stateHomePaths } from "../stateHome.js";
import { type SupervisorCoreError, SupervisorCoreErrors } from "./errors.js";
import { checkedTickRow, emptyTickLedgerCheck, type TickLedgerCheck } from "./tickLedgerCheck.js";
import type { SupervisorTickRow } from "./tickTypes.js";

export { parseSupervisorTickLine } from "./tickLedgerCheck.js";

/**
 * How many prior local days the window keeps rows for, unless a caller asks for fewer.
 *
 * Four, because `../briefing/caps.ts`'s `HISTORY_MAX_SECTIONS` is four and the projection renders one
 * section per day. Reading a fifth would be reading rows nothing can show.
 *
 * **It is the CEILING, not the answer, and the reason is measured.** A five-day window of this installation's
 * own ledger renders to 932,162 bytes of page text against `PAGE_TEXT_MAX_BYTES`'s 262,144 — the owner's recorded
 * turns alone are 213 KB of it (repro:
 * `jq -r '.ownerTurns.turns[]?.text' "$SLOPWEAVER_HOME/ledgers/supervisor/supervisor-ticks.jsonl" | sort -u | wc -c`,
 * 343 rows over five days). A projection may not truncate the owner's words to fit, so the only lever
 * that stays honest is showing fewer DAYS and saying how many are not shown — which the window already
 * counts in `olderDaysOmitted` and the page already states. `briefing render --ticks-days <n>` is that lever.
 */
export const TICK_WINDOW_PRIOR_DAYS = 4;

/**
 * The ledger's directory — `$home/ledgers/supervisor`.
 *
 * Its own leaf rather than a file directly under `ledgers/`, matching `../sessionStart/lockIn.ts`'s
 * `session-start/`: a supervisor cursor and a shadow-comparison receipt both belong beside this file, and a
 * directory is where they will go.
 *
 * @param home the state home (defaults to the resolved home)
 * @returns the absolute directory path
 *
 * @internal — read by this module and its own tests; nothing outside the tick ledger names it.
 */
export function supervisorLedgerDir({ home }: { home?: string } = {}): string {
  return join(stateHomePaths(home !== undefined ? { home } : {}).ledgers, "supervisor");
}

/**
 * The ledger file itself.
 *
 * @param home the state home (defaults to the resolved home)
 * @returns the absolute path to `supervisor-ticks.jsonl`
 */
export function supervisorTickLedgerPath({ home }: { home?: string } = {}): string {
  return join(supervisorLedgerDir(home !== undefined ? { home } : {}), "supervisor-ticks.jsonl");
}

/**
 * Render one row as its ledger line — deterministic, so two writers of the same row produce the same bytes.
 *
 * @param row the row to write
 * @returns the JSON line, with no trailing newline
 */
export function supervisorTickLine({ row }: { row: SupervisorTickRow }): string {
  return safeJsonStringify({ label: "a supervisor tick row", value: row });
}

/** The lock key every writer of the tick ledger takes — the append and `./tickReseal.ts`'s rewrite alike. */
export const TICK_LEDGER_LOCK_KEY = "supervisor-tick-ledger";

/**
 * Run one critical section against the tick ledger under its lock, and release it.
 *
 * ONE lock for every writer, because the reseal REWRITES the file: an append landing between its read and its
 * rename would be a row the rename silently discards. Never stale while its holder lives, as `../hand/store.ts`'s
 * register lock is not — an aged-out live reseal would rename over an append made after the takeover. A dead holder
 * is still recovered at once, by its pid.
 *
 * @param home the state home the lock lives under
 * @param nowIso the instant the lock is taken at
 * @param section the read-check-write, run only while the lock is held
 * @param onBusy how the caller's own error union names a lock it could not take
 * @returns what the section returned, or the caller's busy error
 */
export function withTickLedgerLock<T, E>({
  home,
  nowIso,
  section,
  onBusy,
}: {
  home: string;
  nowIso: string;
  section: () => Result<T, E>;
  onBusy: (args: { why: string }) => E;
}): Result<T, E> {
  const lock = acquireOperationLockDetailed({
    home,
    key: TICK_LEDGER_LOCK_KEY,
    nowIso,
    staleAfterMs: Number.POSITIVE_INFINITY,
  });
  if (lock.isErr()) {
    return err(onBusy({ why: lock.error.message }));
  }
  try {
    return section();
  } finally {
    lock.value.release();
  }
}

/**
 * Append one finalised tick, under the ledger's lock.
 *
 * A ledger whose last write was torn ends mid-record. This ledger's read refuses rather than skips a line that will
 * not parse, so a torn tail already fails every read from then on; the append refuses too, and says which file to
 * look at, rather than separating itself from the fragment the way `appendLines` would.
 *
 * @param row the row to record
 * @param home the state home (defaults to the resolved home)
 * @param nowIso the instant the lock is taken at (defaults to the clock)
 * @returns the path written, or one line per reason the append was refused
 */
export function appendSupervisorTick({
  row,
  home = slopweaverHome(),
  nowIso = new Date().toISOString(),
}: {
  row: SupervisorTickRow;
  home?: string;
  nowIso?: string;
}): Result<string, SupervisorCoreError> {
  return withTickLedgerLock({
    home,
    nowIso,
    onBusy: SupervisorCoreErrors.ledgerBusy,
    section: () => appendUnderLock({ home, row }),
  });
}

/**
 * The append's critical section: refuse a torn tail, else append the row's one line.
 *
 * @param row the row to record
 * @param home the state home
 * @returns the path written, or why the append was refused
 */
function appendUnderLock({ row, home }: { row: SupervisorTickRow; home: string }): Result<string, SupervisorCoreError> {
  const dir = supervisorLedgerDir({ home });
  const path = supervisorTickLedgerPath({ home });
  if (needsSeparator({ path })) {
    return err(SupervisorCoreErrors.ledgerTorn({ path }));
  }
  const written = safeFs({
    execute: (): string => {
      mkdirSync(dir, { mode: 0o700, recursive: true });
      appendLines({ mode: 0o600, path, text: `${supervisorTickLine({ row })}\n` });
      return path;
    },
    operation: "appendSupervisorTick",
    path,
  });
  if (written.isErr()) {
    return err(SupervisorCoreErrors.ledgerIoFailed({ cause: written.error }));
  }
  return ok(written.value);
}

/**
 * The bounded slice of the ledger the briefing's three sections are projected from.
 *
 * `newest` is what `recent` reads; `currentDay` is what `earlierToday` rolls up; `priorDays` is what
 * `history` renders, newest day first. `olderDaysOmitted` is what the page has to disclose rather than
 * quietly not show.
 */
export interface SupervisorTickWindow {
  /** The newest finalised row, and the one whose local day defines "today" for this page. */
  readonly newest: SupervisorTickRow;
  /** Every row on the newest row's own local day, oldest first, the newest included. */
  readonly currentDay: readonly SupervisorTickRow[];
  /** Up to {@link TICK_WINDOW_PRIOR_DAYS} prior local days, newest day first, each oldest row first. */
  readonly priorDays: readonly { readonly dayKey: string; readonly ticks: readonly SupervisorTickRow[] }[];
  /** How many local days the ledger holds that this window did not read. */
  readonly olderDaysOmitted: number;
  /** How many rows the ledger holds in total, so a receipt can say what share was projected. */
  readonly ticksInLedger: number;
}

/**
 * One pass's accumulating state. Bounded: it holds at most the current day and four prior days of rows.
 *
 * @internal — the shape {@link readSupervisorTickWindow} folds each line into.
 */
interface WindowAccumulator {
  readonly byDay: Map<string, SupervisorTickRow[]>;
  readonly dayOrder: string[];
  /** How many local days BEFORE the newest row's own this pass keeps rows for. */
  readonly priorDays: number;
  newest: SupervisorTickRow | undefined;
  count: number;
}

/**
 * Drop every day older than the newest `priorDays` plus the current one, counting them.
 *
 * @param accumulator the state so far
 * @returns how many days were dropped by this call
 */
function trimOlderDays({ accumulator }: { accumulator: WindowAccumulator }): number {
  const keep = accumulator.priorDays + 1;
  let dropped = 0;
  while (accumulator.dayOrder.length > keep) {
    const oldest = accumulator.dayOrder.shift();
    if (oldest === undefined) {
      break;
    }
    accumulator.byDay.delete(oldest);
    dropped += 1;
  }
  return dropped;
}

/**
 * Fold one ledger line into the accumulator, or let the shared check push the defect that stops the read
 * (`./tickLedgerCheck.ts` owns what makes a line valid, for this reader and the whole-history walk alike).
 *
 * @param line the ledger line
 * @param index its zero-based position in the file
 * @param path the ledger, so a defect names the file and the line
 * @param state the pass's mutable state
 * @returns nothing; the state carries the result
 */
function foldLine({
  line,
  index,
  path,
  state,
}: {
  line: string;
  index: number;
  path: string;
  state: WindowPass;
}): void {
  const row = checkedTickRow({ check: state.check, index, line, path });
  if (row === undefined) {
    return;
  }
  state.accumulator.newest = row;
  state.accumulator.count += 1;
  const dayKey = localDayKey({ iso: row.finalisedIso });
  const existing = state.accumulator.byDay.get(dayKey);
  if (existing === undefined) {
    state.accumulator.byDay.set(dayKey, [row]);
    state.accumulator.dayOrder.push(dayKey);
    state.olderDaysOmitted += trimOlderDays({ accumulator: state.accumulator });
    return;
  }
  existing.push(row);
}

/**
 * One pass over the ledger: the bounded row set, the ids already seen, the defects and the day count.
 *
 * @internal — the state {@link foldLine} mutates and {@link readSupervisorTickWindow} reads back.
 */
interface WindowPass {
  readonly accumulator: WindowAccumulator;
  readonly check: TickLedgerCheck;
  olderDaysOmitted: number;
}

/**
 * A fresh pass's state, so the two readers below fold into the identical shape.
 *
 * @returns the empty accumulator one forward pass over a ledger mutates
 */
function emptyPass({ priorDays }: { priorDays: number }): WindowPass {
  return {
    accumulator: {
      byDay: new Map<string, SupervisorTickRow[]>(),
      count: 0,
      dayOrder: [],
      newest: undefined,
      priorDays,
    },
    check: emptyTickLedgerCheck(),
    olderDaysOmitted: 0,
  };
}

/**
 * Turn a completed pass into the window, or into the reason there is none.
 *
 * Shared by both readers rather than written twice, because every refusal below is about the LEDGER rather
 * than about where its bytes came from: a pass whose lines arrived on stdin must refuse a duplicate row and
 * an empty file in exactly the words a pass over a path does, or the two inputs would be two contracts.
 *
 * @param state the pass, after every line has been folded
 * @param label the ledger as a refusal should name it — a path, or what the stream is
 * @returns the window, or one line per reason it could not be built
 */
function finaliseWindow({
  state,
  label,
}: {
  state: WindowPass;
  label: string;
}): Result<SupervisorTickWindow, SupervisorCoreError> {
  if (state.check.defects.length > 0) {
    return err(SupervisorCoreErrors.ledgerDefective({ reasons: state.check.defects }));
  }
  const newest = state.accumulator.newest;
  if (newest === undefined) {
    return err(SupervisorCoreErrors.ledgerNoRows({ label }));
  }
  const currentKey = localDayKey({ iso: newest.finalisedIso });
  return ok({
    // The newest row's own day is in the map by construction — `foldLine` put it there as it read it — so
    // the assertion is that invariant rather than a fallback papering over a hole.
    currentDay: state.accumulator.byDay.get(currentKey)!,
    newest,
    olderDaysOmitted: state.olderDaysOmitted,
    priorDays: state.accumulator.dayOrder
      .filter((key) => key !== currentKey)
      // Every key in `dayOrder` was pushed at the same moment its entry was set, and `trimOlderDays` removes
      // both together — so the assertion is the map's own invariant rather than a fallback hiding a hole.
      .toReversed()
      .map((dayKey) => ({ dayKey, ticks: state.accumulator.byDay.get(dayKey)! })),
    ticksInLedger: state.accumulator.count,
  });
}

/**
 * Read the window the briefing needs, streaming the ledger and holding a bounded set of rows.
 *
 * The ledger is append-only and written in finalisation order, so a single forward pass keeping the newest
 * five local days is enough — and is the only shape that stays constant-memory as the file grows.
 *
 * @param path the ledger to read
 * @param priorDays how many local days before the newest row's own to keep rows for; defaults to
 *   {@link TICK_WINDOW_PRIOR_DAYS}, and a smaller number is how a caller fits the page — see that constant
 * @returns the window, or one line per reason the ledger could not be read
 */
export function readSupervisorTickWindow({
  path,
  priorDays = TICK_WINDOW_PRIOR_DAYS,
}: {
  path: string;
  priorDays?: number;
}): Result<SupervisorTickWindow, SupervisorCoreError> {
  if (!existsSync(path)) {
    return err(SupervisorCoreErrors.ledgerAbsent({ path }));
  }
  const state = emptyPass({ priorDays });
  const read = safeFs({
    execute: (): void => {
      readJsonlLines({
        onLine: ({ line, index }) => {
          foldLine({ index, line, path, state });
        },
        path,
      });
    },
    operation: "readSupervisorTickWindow",
    path,
  });
  if (read.isErr()) {
    return err(SupervisorCoreErrors.ledgerIoFailed({ cause: read.error }));
  }
  return finaliseWindow({ label: path, state });
}

/**
 * Read the same window from a stream of lines rather than from a path.
 *
 * This is what `briefing render --ticks -` uses, and it exists for the reason the file overview gives about
 * the path reader: the ledger has no ceiling, so the bytes may not pass through one JS string. A caller
 * hands over an async line iterator — `node:readline` over stdin is the one production caller — and this
 * folds it with the identical `foldLine`, so a malformed row, a duplicate `tickId` and a row written out of
 * turn are refused here exactly as they are off disk.
 *
 * ASYNC where the path reader is synchronous, and that asymmetry is the input's rather than a choice: a
 * file can be read line by line with a synchronous descriptor, and a pipe cannot.
 *
 * @param lines the ledger's lines, in file order
 * @param label how a refusal should name this stream, since there is no path to name
 * @param priorDays how many local days before the newest row's own to keep rows for
 * @returns the window, or one line per reason the ledger could not be read
 */
export async function readSupervisorTickWindowFromLines({
  lines,
  label,
  priorDays = TICK_WINDOW_PRIOR_DAYS,
}: {
  lines: AsyncIterable<string>;
  label: string;
  priorDays?: number;
}): Promise<Result<SupervisorTickWindow, SupervisorCoreError>> {
  const state = emptyPass({ priorDays });
  let index = 0;
  for await (const line of lines) {
    foldLine({ index, line, path: label, state });
    index += 1;
  }
  return finaliseWindow({ label, state });
}
