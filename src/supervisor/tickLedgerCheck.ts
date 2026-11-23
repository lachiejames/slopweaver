/**
 * What makes a supervisor tick ledger line VALID, said once, and a streamed walk over every valid row.
 *
 * `./tickStore.ts` reads a bounded WINDOW for the briefing — the newest local day and a few before it. A reader
 * that needs the whole history since some instant (why an automation stopped: every pass that read it due since it
 * last ran, which may be weeks back) cannot use that window, and must not grow a second idea of a valid ledger
 * either. So the three refusals live here — a line that will not parse, a duplicate `tickId`, a `finalisedIso`
 * that goes backwards — and both the window reader and {@link visitSupervisorTicks} apply them through
 * {@link checkedTickRow}. The walk is streamed through `readJsonlLines`, never one string, because the ledger has
 * no ceiling (`./tickStore.ts` § The read is STREAMED).
 */
import { existsSync } from "node:fs";

import { readJsonlLines } from "../corpus/corpusStore.js";
import { err, ok, type Result } from "../lib/result.js";
import { safeFs } from "../lib/safeBoundary.js";
import { safeJsonParse } from "../lib/safeJson.js";
import { type SupervisorCoreError, SupervisorCoreErrors } from "./errors.js";
import { parseSupervisorTickRow } from "./tickSchema.js";
import type { SupervisorTickRow } from "./tickTypes.js";

/**
 * Read one ledger line: JSON first, then the row schema of `./tickSchema.ts`.
 *
 * @param line one line of the ledger, without its newline
 * @returns the typed row, or why it was refused — unreadable JSON, or every reason the row schema gave
 */
export function parseSupervisorTickLine({ line }: { line: string }): Result<SupervisorTickRow, SupervisorCoreError> {
  let value: unknown;
  try {
    value = safeJsonParse({ label: "a supervisor tick ledger line", text: line });
  } catch (error: unknown) {
    return err(SupervisorCoreErrors.tickLineUnreadable({ cause: error }));
  }
  return parseSupervisorTickRow({ value }).mapErr((reasons) => SupervisorCoreErrors.tickRowRefused({ reasons }));
}

/** One forward pass's validation state: the ids already seen, the defects so far, and the newest finalisation. */
export interface TickLedgerCheck {
  readonly seen: Set<string>;
  readonly defects: string[];
  lastFinalisedMs: number;
}

/**
 * A fresh pass's validation state.
 *
 * @returns the empty state one forward pass over a ledger mutates
 */
export function emptyTickLedgerCheck(): TickLedgerCheck {
  return { defects: [], lastFinalisedMs: Number.NEGATIVE_INFINITY, seen: new Set<string>() };
}

/**
 * Validate one ledger line against the pass so far: the row it carries, or nothing when it is blank or refused.
 *
 * A refusal is pushed onto `check.defects` naming the file and line, and every later line is then skipped: this
 * ledger carries the owner's words, so a read past a bad row would silently drop one.
 *
 * @param line the ledger line
 * @param index its zero-based position in the file
 * @param path the ledger, so a defect names the file and the line
 * @param check the pass's validation state
 * @returns the row, or `undefined` for a blank line, a refused one, or any line after a refusal
 */
export function checkedTickRow({
  line,
  index,
  path,
  check,
}: {
  line: string;
  index: number;
  path: string;
  check: TickLedgerCheck;
}): SupervisorTickRow | undefined {
  if (line.trim().length === 0 || check.defects.length > 0) {
    return undefined;
  }
  const where = `${path}:${String(index + 1)}`;
  const parsed = parseSupervisorTickLine({ line });
  if (parsed.isErr()) {
    check.defects.push(`${where}: ${parsed.error.message}`);
    return undefined;
  }
  const row = parsed.value;
  return admitTickRowInOrder({ check, row, where }) ? row : undefined;
}

/**
 * The two CROSS-ROW checks, said once: a `tickId` seen before, and a `finalisedIso` that goes backwards.
 *
 * Separate from {@link checkedTickRow} because `./tickReseal.ts` reads rows through a different row check — one
 * tolerating a stale `stats` — and must still refuse a ledger the ordinary reader would refuse for its order.
 *
 * @param row a row that has already passed its own checks
 * @param where `<ledger>:<line>`, so a defect names the file and the line
 * @param check the pass's validation state; a refusal is pushed onto its `defects`
 * @returns whether the row stands in order
 */
export function admitTickRowInOrder({
  row,
  where,
  check,
}: {
  row: SupervisorTickRow;
  where: string;
  check: TickLedgerCheck;
}): boolean {
  if (check.seen.has(row.tickId)) {
    check.defects.push(`${where}: tickId ${row.tickId} appears twice — one of them is a copy`);
    return false;
  }
  check.seen.add(row.tickId);
  const finalisedMs = Date.parse(row.finalisedIso);
  if (finalisedMs < check.lastFinalisedMs) {
    check.defects.push(
      `${where}: finalisedIso ${row.finalisedIso} goes backwards — the ledger is ` +
        "append-only in finalisation order, so this row was written out of turn",
    );
    return false;
  }
  check.lastFinalisedMs = finalisedMs;
  return true;
}

/**
 * The newest instant anywhere in a row: every `…Iso` field at any depth, its own span and every stamp inside it.
 * The supervisor stamps a judgement or action by hand, sometimes after the tick finalised, so `finalisedIso` alone
 * cannot prove a row holds nothing a later window folds.
 */
function newestInstantMs({ value }: { value: unknown }): number {
  let newest = Number.NEGATIVE_INFINITY;
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (typeof node !== "object" || node === null) {
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (key.endsWith("Iso") && typeof child === "string") {
        const ms = Date.parse(child);
        // An instant that will not parse cannot be shown to predate anything, so it holds the row in.
        newest = Number.isNaN(ms) ? Number.POSITIVE_INFINITY : Math.max(newest, ms);
      }
      visit(child);
    }
  };
  visit(value);
  return newest;
}

/**
 * Walk every valid row of the ledger in file order, holding none of them: the caller folds what it needs.
 *
 * Refuses exactly what the window reader refuses — an absent ledger (absence is not an empty history), an I/O
 * failure, a defective row, a ledger with no rows — so a caller never reads "no passes" off a file it could not
 * read. The callback has already seen the rows before a defect further down: a caller must discard what it
 * folded when this returns an error.
 *
 * **`fromIso` bounds the walk to what the caller can use.** A leading row is passed over only when EVERY stamp in
 * it predates `fromIso`, not only `finalisedIso`, since a hold may be stamped after its tick closed.
 * Such a row must still parse, and one that does not is refused wherever it sits, so a malformed line cannot pass
 * by claiming an old instant. It is not visited, and the CROSS-ROW checks forgive it: a repeated `tickId` or a
 * backwards instant among rows the caller never folds cannot refuse the answer it does need. Only that prefix: a
 * row in the window repeating an earlier `tickId`, finalised before a row passed over, or an
 * old-dated row after the first one visited, is still refused. MEASURED on the real ledger: it carried eleven
 * duplicated `tickId` rows, and a whole walk
 * refused every stopped automation's reason, though each had run more recently than the newest duplicate. Repro: walk
 * `$SLOPWEAVER_HOME/ledgers/supervisor/supervisor-ticks.jsonl` through {@link checkedTickRow}, clearing
 * `check.defects` after each push, and count.
 *
 * @param path the ledger to read
 * @param fromIso the oldest finalisation the caller folds, or `null` to walk and check the whole ledger
 * @param onTick called once per valid row, oldest first
 * @returns how many rows were walked, or why the ledger could not be read
 */
export function visitSupervisorTicks({
  path,
  fromIso = null,
  onTick,
}: {
  path: string;
  fromIso?: string | null;
  onTick: (args: { row: SupervisorTickRow }) => void;
}): Result<{ readonly ticksRead: number }, SupervisorCoreError> {
  if (!existsSync(path)) {
    return err(SupervisorCoreErrors.ledgerAbsent({ path }));
  }
  const check = emptyTickLedgerCheck();
  const fromMs = fromIso === null ? Number.NEGATIVE_INFINITY : Date.parse(fromIso);
  let ticksRead = 0;
  let ticksBefore = 0;
  const read = safeFs({
    execute: (): void => {
      readJsonlLines({
        onLine: ({ line, index }) => {
          // Only the PREFIX before the first row in the window is forgiven: once one is visited, an old-dated row
          // after it is written out of turn, and checkedTickRow refuses it.
          if (fromIso !== null && ticksRead === 0 && check.defects.length === 0 && line.trim().length > 0) {
            const earlier = parseSupervisorTickLine({ line });
            if (earlier.isOk() && newestInstantMs({ value: earlier.value }) < fromMs) {
              check.seen.add(earlier.value.tickId);
              // The first visited row must still not go back past any of them.
              check.lastFinalisedMs = Math.max(check.lastFinalisedMs, Date.parse(earlier.value.finalisedIso));
              ticksBefore += 1;
              return;
            }
          }
          const row = checkedTickRow({ check, index, line, path });
          if (row !== undefined) {
            ticksRead += 1;
            onTick({ row });
          }
        },
        path,
        // A byte that is not UTF-8 is a defect, never repaired text a row then passes its schema with.
        strictUtf8: true,
      });
    },
    operation: "visitSupervisorTicks",
    path,
  });
  if (read.isErr()) {
    return err(SupervisorCoreErrors.ledgerIoFailed({ cause: read.error }));
  }
  if (check.defects.length > 0) {
    return err(SupervisorCoreErrors.ledgerDefective({ reasons: check.defects }));
  }
  // A ledger whose every row predates the walk is a history with nothing since, never an empty one.
  if (ticksRead === 0 && ticksBefore === 0) {
    return err(SupervisorCoreErrors.ledgerNoRows({ label: path }));
  }
  return ok({ ticksRead });
}
