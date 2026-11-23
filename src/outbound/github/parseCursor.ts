/**
 * The block cursor `./parse.ts` and `./parseWhat.ts` read a C3 body with: the main part split on
 * blank lines, consumed in order, plus the few framing readers every section shares.
 *
 * Every reader here answers `undefined` (or a typed `STRUCTURE` refusal naming where it stopped) rather than a
 * guess, because the caller re-renders what it read and compares bytes — a reader that guessed would only
 * move the refusal later and make it vaguer.
 */
import { err, type Result } from "#lib/result.js";
import { type PrBodyError, PrBodyErrors } from "./errors.js";
import { parseContent } from "./parseContent.js";
import type { Content } from "./types.js";

/** The blocks of the main part, consumed in order. */
export interface Cursor {
  readonly blocks: readonly string[];
  at: number;
}

/**
 * A refusal naming the block the reading stopped at.
 *
 * @param at the block, in words, the reading could not get past
 * @returns the `STRUCTURE` refusal
 */
export function stop<T>({ at }: { at: string }): Result<T, PrBodyError> {
  return err(PrBodyErrors.structure({ at }));
}

/**
 * The next block, consumed.
 *
 * @returns the block, or undefined past the end (nothing consumed)
 */
export function take({ cursor }: { cursor: Cursor }): string | undefined {
  const block = cursor.blocks[cursor.at];
  if (block !== undefined) {
    cursor.at += 1;
  }
  return block;
}

/**
 * Consume the next block when it is exactly `literal`.
 *
 * @param literal the fixed bytes a heading or marker renders as
 * @returns whether it matched, and so was consumed
 */
export function takeLiteral({ cursor, literal }: { cursor: Cursor; literal: string }): boolean {
  if (cursor.blocks[cursor.at] !== literal) {
    return false;
  }
  cursor.at += 1;
  return true;
}

/**
 * Content between a fixed open and close.
 *
 * @param block the block to unwrap, absent past the end
 * @param open the fixed opening bytes
 * @param close the fixed closing bytes
 * @returns the content inside, or undefined when the block is absent or not wrapped so
 */
export function between({
  block,
  open,
  close,
}: {
  block: string | undefined;
  open: string;
  close: string;
}): Content | undefined {
  if (block?.startsWith(open) !== true || !block.endsWith(close) || block.length < open.length + close.length) {
    return undefined;
  }
  return parseContent({ source: block.slice(open.length, block.length - close.length) });
}

/**
 * The rows of a one-row-per-line list.
 *
 * @param block the candidate list block
 * @param tag which list element frames it
 * @returns the lines between the open and close tags, or undefined when the block is not such a list
 */
export function listRows({
  block,
  tag,
}: {
  block: string | undefined;
  tag: "ol" | "ul";
}): readonly string[] | undefined {
  const lines = block?.split("\n");
  if (lines === undefined || lines.length < 3 || lines[0] !== `<${tag}>` || lines.at(-1) !== `</${tag}>`) {
    return undefined;
  }
  return lines.slice(1, -1);
}

/**
 * Every item of a list, each read with `read`.
 *
 * @param rows the list's rows, absent when the list itself did not frame
 * @param read the reader for one row, undefined when that row is unreadable
 * @returns every item in order, or undefined when the rows are absent or any one row is unreadable
 */
export function allOf<T>({
  rows,
  read,
}: {
  rows: readonly string[] | undefined;
  read: (row: string) => T | undefined;
}): T[] | undefined {
  if (rows === undefined) {
    return undefined;
  }
  const items: T[] = [];
  for (const row of rows) {
    const item = read(row);
    if (item === undefined) {
      return undefined;
    }
    items.push(item);
  }
  return items;
}
