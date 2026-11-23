/**
 * The line-level reads a pasted card-page export is parsed with: find the one line a field sits on, refusing a
 * missing or repeated one by name, and read an amount or a day off it. Pure. `./parse.ts` composes these into a
 * snapshot.
 */
import { err, ok, type Result } from "../lib/result.js";
import { type SpendError, SpendErrors } from "./errors.js";
import { parseMoney } from "./money.js";
import type { Money } from "./types.js";

/** One export line and its 1-based number. */
export interface NumberedLine {
  readonly lineNumber: number;
  readonly text: string;
}

/**
 * Whether a string is a real calendar day in `YYYY-MM-DD` form.
 *
 * @param text the candidate
 * @returns true only for a day that exists
 */
export function isIsoDay({ text }: { text: string }): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return false;
  }
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

/**
 * The calendar day after a day.
 *
 * @param day a real `YYYY-MM-DD` day
 * @returns the next day, `YYYY-MM-DD`
 */
export function dayAfter({ day }: { day: string }): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/**
 * The line starting with a prefix when there is one, refusing two.
 *
 * @param lines the export's lines
 * @param prefix what the line starts with
 * @param line the name a refusal calls it by
 * @returns the line, undefined when there is none, or the refusal of a second
 */
export function atMostOneLine({
  line,
  lines,
  prefix,
}: {
  line: string;
  lines: readonly NumberedLine[];
  prefix: string;
}): Result<NumberedLine | undefined, SpendError> {
  const hits = lines.filter((candidate) => candidate.text.startsWith(prefix));
  if (hits.length > 1) {
    return err(SpendErrors.exportLineMalformed({ line, lineNumber: hits[1]!.lineNumber, text: "it appears twice" }));
  }
  return ok(hits[0]);
}

/**
 * The one line starting with a prefix, refusing zero and refusing two.
 *
 * @param lines the export's lines
 * @param prefix what the line starts with
 * @param line the name a refusal calls it by
 * @returns the line, or why there is not exactly one
 */
export function onlyLine({
  line,
  lines,
  prefix,
}: {
  line: string;
  lines: readonly NumberedLine[];
  prefix: string;
}): Result<NumberedLine, SpendError> {
  const hit = atMostOneLine({ line, lines, prefix });
  if (hit.isErr()) {
    return err(hit.error);
  }
  if (hit.value === undefined) {
    return err(SpendErrors.exportLineMissing({ line }));
  }
  return ok(hit.value);
}

/**
 * The one line starting with a prefix, which must also sit inside a block — a limit line must be in the unbroken
 * run of lines under `Limits`, not anywhere else in the file.
 *
 * @param lines the export's lines
 * @param prefix what the line starts with
 * @param line the name a refusal calls it by
 * @param from the block's heading line number; the line must come after it
 * @param to the line number ending the block; the line must come before it
 * @returns the line, or why there is not exactly one inside the block
 */
export function onlyLineIn({
  from,
  line,
  lines,
  prefix,
  to,
}: {
  from: number;
  line: string;
  lines: readonly NumberedLine[];
  prefix: string;
  to: number;
}): Result<NumberedLine, SpendError> {
  const hit = onlyLine({ line, lines, prefix });
  if (hit.isErr()) {
    return err(hit.error);
  }
  if (hit.value.lineNumber <= from || hit.value.lineNumber >= to) {
    return err(
      SpendErrors.exportLineMalformed({
        line,
        lineNumber: hit.value.lineNumber,
        text: "it sits outside the block under the Limits heading",
      }),
    );
  }
  return ok(hit.value);
}

/**
 * Parse an amount on a known line, refusing it by line number.
 *
 * @param text the amount text
 * @param lineNumber the line it sits on
 * @returns the amount, or the refusal naming the line
 */
export function amountOn({ lineNumber, text }: { lineNumber: number; text: string }): Result<Money, SpendError> {
  const money = parseMoney({ text });
  if (money === undefined) {
    return err(SpendErrors.amountUnparseable({ lineNumber, text }));
  }
  return ok(money);
}
