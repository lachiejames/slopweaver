/**
 * The quote proof slot, read back from the blocks `./render.ts` wrote: the proves line and the `Source:` line as one
 * block, then the `Quoted output` fold's opening, the fenced output and the fold's close, each a block of its own.
 * `./parse.ts` calls it once the second line of a slot's block opens with the source prefix.
 */
import { between, type Cursor, take, takeLiteral } from "./parseCursor.js";
import { fenceFor, QUOTE_FOLD, QUOTE_SOURCE_PREFIX } from "./render.js";
import type { Content, ProofActor, ProofSlot, QuoteSource } from "./types.js";

/** A canonical fence opening: three or more backticks and a bare language word. */
const FENCE_OPEN = /^(`{3,})([A-Za-z0-9_+-]*)\n/;

/**
 * A quote's fold after its proves and source lines. The fence must be the one the renderer would pick, so a fence
 * that merely happens to close is refused.
 */
function quoteFoldAt({ cursor }: { cursor: Cursor }): { lang: string; text: string } | undefined {
  if (!takeLiteral({ cursor, literal: QUOTE_FOLD.open })) {
    return undefined;
  }
  const fenced = take({ cursor });
  const opened = fenced === undefined ? null : FENCE_OPEN.exec(fenced);
  if (fenced === undefined || opened === null || !fenced.endsWith(`\n${opened[1]!}`)) {
    return undefined;
  }
  const text = fenced.slice(opened[0].length, fenced.length - opened[1]!.length - 1);
  if (text.length === 0 || fenceFor({ text }) !== opened[1] || !takeLiteral({ cursor, literal: QUOTE_FOLD.close })) {
    return undefined;
  }
  return { lang: opened[2]!, text };
}

/** A quote's source line: one link run, or one code run. */
function quoteSourceOf({ line }: { line: string }): QuoteSource | undefined {
  const runs = between({ block: line, close: "</p>", open: `<p>${QUOTE_SOURCE_PREFIX}` });
  const run = runs?.length === 1 ? runs[0] : undefined;
  if (run?.kind === "link" || run?.kind === "code") {
    return run;
  }
  return undefined;
}

/**
 * Whether a slot block's second line is a quote's source line rather than a screenshot's picture.
 *
 * @param line the block's second line
 * @returns true when it opens the way a quote's source line does
 */
export function isQuoteSourceLine({ line }: { line: string }): boolean {
  return line.startsWith(`<p>${QUOTE_SOURCE_PREFIX}`);
}

/**
 * A quote slot whose proves line is already read, its source line and the fold after it taken from the cursor.
 *
 * @param cursor positioned just after the slot's first block, where the fold opens
 * @param proves the proves line's runs, absent when that line did not read
 * @param sourceLine the block's second line
 * @param runBy who ran it, from the proof hover
 * @returns the slot, or undefined when any part is not what the renderer writes
 */
export function quoteSlotAt({
  cursor,
  proves,
  sourceLine,
  runBy,
}: {
  cursor: Cursor;
  proves: Content | undefined;
  sourceLine: string;
  runBy: ProofActor;
}): ProofSlot | undefined {
  const source = quoteSourceOf({ line: sourceLine });
  const fold = source === undefined ? undefined : quoteFoldAt({ cursor });
  if (proves === undefined || source === undefined || fold === undefined) {
    return undefined;
  }
  return { kind: "quote", lang: fold.lang, proves, runBy, source, text: fold.text };
}
