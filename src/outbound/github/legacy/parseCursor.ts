/**
 * The block cursor `./parse.ts` and `./parseWhat.ts` read a reading-order body with. The cursor and its framing
 * readers are the C3 reader's own (`../parseCursor.ts`), shared rather than copied; only the refusal, which is
 * this reader's {@link ReadingOrderError}, and the table-row reader the C3 shape has no use for, live here.
 */
import { err, type Result } from "#lib/result.js";
import { type ReadingOrderError, ReadingOrderErrors } from "./errors.js";

export { allOf, between, type Cursor, listRows, take, takeLiteral } from "../parseCursor.js";

/**
 * A refusal naming the block the reading stopped at.
 *
 * @param at the block, in words, the reading could not get past
 * @returns the `STRUCTURE` refusal
 */
export function stop<T>({ at }: { at: string }): Result<T, ReadingOrderError> {
  return err(ReadingOrderErrors.structure({ at }));
}

/**
 * The cells of one table row.
 *
 * @param line the candidate `<tr>` line
 * @param count how many cells the row must have
 * @returns the raw cell interiors, or undefined when the line is not a `<tr>` of exactly `count` cells
 */
export function cellsOf({ line, count }: { line: string | undefined; count: number }): readonly string[] | undefined {
  if (line?.startsWith("<tr><td>") !== true || !line.endsWith("</td></tr>")) {
    return undefined;
  }
  const cells = line.slice("<tr><td>".length, -"</td></tr>".length).split("</td><td>");
  return cells.length === count ? cells : undefined;
}
