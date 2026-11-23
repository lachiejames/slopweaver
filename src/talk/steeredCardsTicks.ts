/**
 * The chair's passes `./steeredCardsRead.ts` judges a waiting steer against, read from the end of the tick ledger.
 *
 * `supervisor-ticks.jsonl` is ~240 KB a row and 176 MB on a measured install (`ls -l
 * ~/.slopweaver/ledgers/supervisor/supervisor-ticks.jsonl`, `tail -n 3 … | wc -c`), and `talk steers` is polled every
 * 20 seconds, so it reads only the last {@link TICK_TAIL_BYTES} — about 12 hours of ticks — and only when some steer
 * is still waiting on a pass. The first eligible tick for a relay older than that tail is not the earliest one, but
 * any tick that started after it settles the same verdict.
 */
import { closeSync, existsSync, fstatSync, openSync, readSync } from "node:fs";

import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";
import { safeJsonParse } from "../lib/safeJson.js";

/** How much of the tick ledger's end is read. */
const TICK_TAIL_BYTES = 8 * 1024 * 1024;

/** One chair pass: when it started and when it finished. */
export interface ChairTick {
  readonly startedIso: string;
  readonly finalisedIso: string;
}

/** Why the tick ledger's tail could not be read: the file itself, or one whole line in it. */
export interface TickTailError {
  readonly code: "TICK_LEDGER_UNREADABLE" | "TICK_LINE_NOT_JSON" | "TICK_ROW_MALFORMED";
  readonly message: string;
}

const TickTailErrors = {
  lineNotJson: (): TickTailError => ({
    code: "TICK_LINE_NOT_JSON",
    message: "a tick ledger line in the tail is not JSON",
  }),
  rowMalformed: ({ why }: { why: string }): TickTailError => ({
    code: "TICK_ROW_MALFORMED",
    message: `a tick ledger row in the tail ${why}`,
  }),
  unreadable: ({ cause }: { cause: unknown }): TickTailError => ({
    code: "TICK_LEDGER_UNREADABLE",
    message: cause instanceof Error ? cause.message : "the tick ledger would not open",
  }),
} as const;

/** The ledger's last {@link TICK_TAIL_BYTES}, and whether that cut its start off. */
function readTail({ path }: { path: string }): Result<{ text: string; cut: boolean }, TickTailError> {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const size = fstatSync(fd).size;
    const length = Math.min(size, TICK_TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, size - length);
    return ok({ cut: size > length, text: buffer.toString("utf8") });
  } catch (cause: unknown) {
    return err(TickTailErrors.unreadable({ cause }));
  } finally {
    if (fd !== undefined) {
      closeSync(fd);
    }
  }
}

/** One whole tick line as a record, or why it is not one. */
function parseRecord({ line }: { line: string }): Result<Record<string, unknown>, TickTailError> {
  let value: unknown;
  try {
    value = safeJsonParse({ label: "a supervisor tick ledger line", text: line });
  } catch {
    return err(TickTailErrors.lineNotJson());
  }
  if (!isRecord(value)) {
    return err(TickTailErrors.rowMalformed({ why: "is not an object" }));
  }
  return ok(value);
}

/** One tick record's start and finish, or why it does not carry them. */
function parseTick({ value }: { value: Record<string, unknown> }): Result<ChairTick, TickTailError> {
  if (typeof value["startedIso"] !== "string" || typeof value["finalisedIso"] !== "string") {
    return err(TickTailErrors.rowMalformed({ why: "carries no startedIso/finalisedIso" }));
  }
  // An instant that does not parse would drop the tick from every comparison and read as no pass at all.
  if (Number.isNaN(Date.parse(value["startedIso"])) || Number.isNaN(Date.parse(value["finalisedIso"]))) {
    return err(TickTailErrors.rowMalformed({ why: "carries an instant that does not parse" }));
  }
  return ok({ finalisedIso: value["finalisedIso"], startedIso: value["startedIso"] });
}

/**
 * Every whole tick row the end of the ledger holds, as a record, oldest first. A first line cut by the tail's start
 * is dropped; a whole line that is not a JSON object is a refusal, never a skip. Each reader checks the fields it
 * needs itself — `fleet health` reads a row's workspace, this module its two instants.
 *
 * @param path the tick ledger
 * @returns the rows the tail holds, none when the ledger was never written, or why they could not be read
 */
export function readTickTailRecords({
  path,
}: {
  path: string;
}): Result<readonly Record<string, unknown>[], TickTailError> {
  if (!existsSync(path)) {
    return ok([]);
  }
  const tail = readTail({ path });
  if (tail.isErr()) {
    return err(tail.error);
  }
  const lines = tail.value.text.split("\n");
  const whole = tail.value.cut ? lines.slice(1) : lines;
  const records: Record<string, unknown>[] = [];
  for (const line of whole.filter((one) => one.trim() !== "")) {
    const record = parseRecord({ line });
    if (record.isErr()) {
      return err(record.error);
    }
    records.push(record.value);
  }
  return ok(records);
}

/**
 * The tick rows' start and finish, from the end of the ledger. A whole line that does not carry both instants is a
 * refusal, never a skip.
 *
 * @param path the tick ledger
 * @returns the ticks the tail holds, none when the ledger was never written, or why they could not be read
 */
export function readTickTail({ path }: { path: string }): Result<readonly ChairTick[], TickTailError> {
  const records = readTickTailRecords({ path });
  if (records.isErr()) {
    return err(records.error);
  }
  const ticks: ChairTick[] = [];
  for (const value of records.value) {
    const tick = parseTick({ value });
    if (tick.isErr()) {
      return err(tick.error);
    }
    ticks.push(tick.value);
  }
  return ok(ticks);
}
