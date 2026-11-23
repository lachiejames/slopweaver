/**
 * The BYTE arithmetic behind `slopweaver talk code` — pure, so the budget and continuation rules are a unit
 * test rather than a claim about a filesystem.
 *
 * ## Why the window is bytes and not lines
 *
 * The first design continued a truncated read with `nextFrom: <line>`. A Codex pre-mortem
 * killed it with one input: a tracked file holding a single 2 MiB line. Repeating that line
 * never advances, and incrementing past it loses the remainder — so a line cursor cannot express "the rest
 * of this line", and a per-response cap plus lossless continuation are unsatisfiable together on a line
 * cursor. A byte offset expresses both, and a file that is one long line is exactly the machine-generated
 * shape a checkout carries most of.
 *
 * ## Two budgets, because they bound different things
 *
 * {@link readWindow} bounds what one response CARRIES. {@link spendBudget} bounds what a whole search
 * ACCUMULATES across files. A per-file cap alone lets a thousand small hits out; a total cap alone lets one
 * enormous file out. `find` needs both, and neither is the other's default.
 */
import { err, ok, type Result } from "../lib/result.js";

import { type TalkError, TalkErrors } from "./errors.js";

/** The slice of a file one response carries, and where the next one resumes. */
export interface ReadWindow {
  /** First byte carried, inclusive. */
  readonly start: number;
  /** One past the last byte carried. */
  readonly end: number;
  /** Whether bytes were left behind — the falsifiable half of the `nextFrom` contract. */
  readonly truncated: boolean;
  /** The byte offset a continuation resumes at, or `null` when the file is exhausted. */
  readonly nextFrom: number | null;
}

/** How much of a shared budget one file may take, and whether the budget is now gone. */
export interface BudgetGrant {
  /** Bytes this file may carry. Zero when the budget is already spent. */
  readonly grant: number;
  /** Whether no budget remains for any further file. */
  readonly exhausted: boolean;
}

/**
 * The window a read of `size` bytes starting at `from` may carry under a per-response `budget`.
 *
 * A `from` equal to `size` is the legitimate end-of-file continuation — it yields an empty, untruncated
 * window rather than an error, so a caller that followed `nextFrom` to the end is not told it made a
 * mistake. Anything past `size`, or negative, is a caller that computed an offset rather than following one.
 *
 * @param size the file's whole length in bytes
 * @param from the continuation offset a previous window handed back, or 0
 * @param budget the per-response byte cap
 * @returns the window, or `WINDOW_INVALID` when `from` does not describe one
 */
export function readWindow({
  size,
  from,
  budget,
}: {
  size: number;
  from: number;
  budget: number;
}): Result<ReadWindow, TalkError> {
  const offsetIsUsable = Number.isInteger(from) && from >= 0 && from <= size;
  if (!offsetIsUsable) {
    return err(TalkErrors.windowInvalid({ from, size }));
  }
  const remaining = size - from;
  const carried = Math.min(remaining, Math.max(budget, 0));
  const end = from + carried;
  const truncated = end < size;
  return ok({
    end,
    nextFrom: truncated ? end : null,
    start: from,
    truncated,
  });
}

/**
 * How much of a shared total budget the next file may take.
 *
 * @param spent bytes already carried by earlier files in this response
 * @param total the whole-response cap
 * @param want how many bytes this file would carry unbudgeted
 * @returns the grant, and whether the budget is now gone
 */
export function spendBudget({ spent, total, want }: { spent: number; total: number; want: number }): BudgetGrant {
  const left = Math.max(total - spent, 0);
  const grant = Math.min(left, Math.max(want, 0));
  return { exhausted: left - grant <= 0, grant };
}

/**
 * The largest offset at or below `at` that does not split a UTF-8 character.
 *
 * A byte window cut mid-character decodes to a replacement character on both sides of the join, so a
 * continuation stitched back together is not the file. Snapping the END back to a boundary keeps every
 * window independently decodable AND keeps the continuation lossless, because the bytes snapped off are
 * simply the next window's first bytes.
 *
 * **It asks whether the last character FITS, rather than whether `at` sits on a lead byte.** The first
 * version short-circuited when `at` reached the buffer's length, on the assumption that the buffer's end
 * is always a character boundary — true of a whole file and false of exactly the input this function
 * exists for, a TRUNCATED window whose final byte is the first byte of a character the budget cut in half.
 * Caught by `unit/talk/checkout.test.ts`'s accents case, which decoded `// h\uFFFD`.
 *
 * @param bytes the buffer the offset indexes into
 * @param at the unsnapped offset
 * @returns the snapped offset, never above `at` and never below zero
 */
export function utf8BoundaryAtOrBefore({ bytes, at }: { bytes: Uint8Array; at: number }): number {
  const ceiling = Math.min(at, bytes.length);
  if (ceiling <= 0) {
    return 0;
  }
  // Walk back to the lead byte of the last character the window touches. Four is the longest UTF-8
  // sequence, so at most three continuation bytes precede it.
  const floor = Math.max(ceiling - 4, 0);
  let lead = ceiling - 1;
  while (lead > floor && isContinuationByte({ byte: bytes[lead] })) {
    lead -= 1;
  }
  if (isContinuationByte({ byte: bytes[lead] })) {
    // More than three continuation bytes in a row: not valid UTF-8, so there is no boundary to find.
    return ceiling;
  }
  const whole = lead + sequenceLength({ lead: bytes[lead] });
  return whole <= ceiling ? ceiling : lead;
}

/** Whether a byte continues a multi-byte character (`10xxxxxx`). An absent byte is not one. */
function isContinuationByte({ byte }: { byte: number | undefined }): boolean {
  if (byte === undefined) {
    return false;
  }
  return (byte & 0b1100_0000) === 0b1000_0000;
}

/** How many bytes the character starting at this lead byte occupies. */
function sequenceLength({ lead }: { lead: number | undefined }): number {
  if (lead === undefined) {
    return 1;
  }
  if ((lead & 0b1111_1000) === 0b1111_0000) {
    return 4;
  }
  if ((lead & 0b1111_0000) === 0b1110_0000) {
    return 3;
  }
  if ((lead & 0b1110_0000) === 0b1100_0000) {
    return 2;
  }
  return 1;
}
