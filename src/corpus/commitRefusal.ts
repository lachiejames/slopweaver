/**
 * The sentence a bronze write is refused with when its dedup index came back incomplete — pure, and its own module
 * because it is the one thing a reader of a frozen corpus ever sees of that failure.
 *
 * It takes the index build's counts as plain fields rather than naming `./corpusWriter.ts`'s build type, so this
 * module stays a leaf the writer imports and never the other way round.
 */
import { type HeapShortfall, toMib } from "#lib/heapBudget.js";

import type { CorpusSource } from "./types.js";

/**
 * The one line a refused bronze write says — or `undefined` when the index is complete and the write may
 * proceed.
 *
 * It has to name which of the two failures happened and what closes it: an unreadable path is a `chmod` on a
 * named file, and a heap shortfall is a corpus this process cannot index at its ceiling.
 *
 * The heap sentence names `slopweaver compact` as the standing fix, and that is load-bearing rather than
 * decorative: for one day it could not. Measured through the real verb, against the live multi-GiB
 * Slack window symlinked into a throwaway home, `compact --source slack` failed with
 * `Cannot create a string longer than 0x1fffffe8 characters` and left the source UNFINISHED, because it read
 * each window file into one string — so a corpus big enough to reach this refusal was by construction a
 * corpus compaction could not rewrite, and naming it would have repeated the defect this refusal exists to
 * end. Compaction now streams (see {@link ./compact}), so the sentence points at a verb that runs on
 * exactly this shape. If compaction ever stops streaming, this sentence goes back to being a lie.
 *
 * @param source the source whose write is being refused
 * @param stored the index build that was supposed to make the write safe
 * @returns the refusal sentence, or `undefined` when nothing is wrong
 */
export function commitRefusal({
  source,
  stored,
}: {
  source: CorpusSource;
  stored: {
    readonly shortfall: HeapShortfall | undefined;
    readonly unreadable: readonly string[];
    readonly fileCount: number;
    readonly diskBytes: number;
    readonly rows: number;
  };
}): string | undefined {
  if (stored.shortfall !== undefined) {
    const { shortfall } = stored;
    return (
      `refusing to write ${source}: its dedup index needs more heap than this process has, so the index is ` +
      `incomplete and this write would duplicate records already on disk. ` +
      `${String(stored.fileCount)} file(s), ${String(toMib({ bytes: stored.diskBytes }))} MiB on disk, ` +
      `${String(stored.rows)} row(s) indexed before the guard refused; ` +
      `${String(toMib({ bytes: shortfall.usedBytes }))} MiB in use against a ` +
      `${String(toMib({ bytes: shortfall.limitBytes }))} MiB ceiling. ` +
      `NODE_OPTIONS=--max-old-space-size=${String(shortfall.suggestedLimitMib)} runs this one refresh; the ` +
      `standing fix is to reduce what ${source} holds, which \`slopweaver compact --source ${source}\` does — ` +
      `it streams, so a window file past V8's 512 MiB string ceiling is exactly the shape it rewrites`
    );
  }
  if (stored.unreadable.length > 0) {
    return (
      `refusing to write ${source}: ${String(stored.unreadable.length)} stored path(s) could not be read, so ` +
      `the dedup index is incomplete and this write would duplicate records already on disk — ` +
      `${stored.unreadable.join(", ")}`
    );
  }
  return undefined;
}
