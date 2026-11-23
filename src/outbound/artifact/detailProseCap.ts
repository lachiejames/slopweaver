/**
 * The aggregate prose pass of `./truncate.ts`: how much of a card/answer's detail survives its total visible prose
 * cap, and the warning paragraph a truncation carries. The warning sits here because its exact width is part of
 * the pass's stopping condition. The row, item, block-count and index caps, the overages and the refusal stay in
 * `./truncate.ts`, whose module doc says why a truncation is refused by default.
 */
import type { CitationWidth, DetailBlock } from "./types.js";
import { visibleLengthOfDetailBlock } from "./visibleLength.js";

/**
 * The total visible prose of `detail`, which is both what {@link capDetailProse} holds to its cap and what an
 * authored overage reports.
 *
 * @param citations the artifact's citations, used to measure visible width
 * @returns the summed visible width of every block
 */
export function sumDetailProse({
  detail,
  citations,
}: {
  detail: readonly DetailBlock[];
  citations: readonly CitationWidth[];
}): number {
  return detail.reduce((total, block) => total + visibleLengthOfDetailBlock({ block, citations }), 0);
}

/** The index, scanning back-to-front, of the last block that still contributes to the prose total. */
function lastProseBlockIndex({ detail }: { detail: readonly DetailBlock[] }): number {
  for (let index = detail.length - 1; index >= 0; index -= 1) {
    if (detail[index]!.type !== "table") {
      return index;
    }
  }
  return -1;
}

/**
 * Whether `working`'s visible prose — plus the exact warning paragraph a truncation with `blocksDropped`/
 * `itemsDropped`/`rowsDropped` would produce — fits `maxProse`. Skips the warning entirely when nothing has
 * been dropped anywhere yet: a hypothetical "0 items dropped" warning still has real (nonsensical) text and
 * would otherwise make a card that never needed truncation start losing content it never had to.
 */
function detailProseFitsWithWarning({
  working,
  citations,
  maxProse,
  anyDropSoFar,
  blocksDropped,
  itemsDropped,
  rowsDropped,
}: {
  working: readonly DetailBlock[];
  citations: readonly CitationWidth[];
  maxProse: number;
  anyDropSoFar: boolean;
  blocksDropped: number;
  itemsDropped: number;
  rowsDropped: number;
}): boolean {
  const contentWidth = sumDetailProse({ citations, detail: working });
  if (!anyDropSoFar) {
    return contentWidth <= maxProse;
  }
  const warning = buildDetailTruncationWarning({ blocksDropped, cap: maxProse, itemsDropped, rowsDropped });
  return contentWidth + visibleLengthOfDetailBlock({ block: warning, citations: [] }) <= maxProse;
}

/**
 * Drop exactly one prose-contributing unit off the tail of `working`, IN PLACE — the last item of a
 * bullets/list block when more than one remains, otherwise the whole block, unless `working` is already
 * down to its last block (which may never be removed entirely).
 *
 * @param working the mutable working copy of detail/body sub-blocks, mutated in place
 * @returns which kind of unit was dropped, or `undefined` when nothing more could be
 */
function dropOneProseUnit({ working }: { working: DetailBlock[] }): "block" | "item" | undefined {
  const index = lastProseBlockIndex({ detail: working });
  if (index === -1) {
    return undefined;
  }
  const block = working[index]!;
  if (block.type !== "table" && block.type !== "paragraph" && block.items.length > 1) {
    working[index] = { ...block, items: block.items.slice(0, -1) };
    return "item";
  }
  if (working.length <= 1) {
    return undefined;
  }
  if (block.type === "table") {
    return undefined; // unreachable: lastProseBlockIndex never returns a table index.
  }
  working.splice(index, 1);
  return "block";
}

/**
 * Drop whole prose-contributing units off the tail of `detail` — a whole `paragraph` block, or the last item
 * of a `bullets`/`list` block, falling back to the whole block once only one item is left, since a bullets
 * block may never go to zero items — until the total visible prose, PLUS the exact warning paragraph this
 * drop count would produce, fits `maxProse`. Checking the real warning's width at each candidate stop —
 * rather than reserving a fixed estimate up front — is what guarantees the appended warning can never itself
 * push the total back over the cap it is reporting, regardless of how large `baseItemsDropped`/`rowsDropped`
 * (and so the warning's own digits) turn out to be. Tables never contribute prose and are never touched
 * here. A no-op (returns the input unchanged, nothing dropped) when the total is already within `maxProse`.
 *
 * PRECONDITION, stated rather than enforced: `maxProse` must be large enough to hold one surviving block at
 * its own per-item width cap ({@link "./contentLimits.js".PARAGRAPH_VISIBLE_MAX} — the wider of the two) PLUS
 * this module's own warning at its widest realistic drop count. The floor never removes the sole remaining
 * block, so if `maxProse` is smaller than that sum, the returned total CAN exceed `maxProse` — an adversarial
 * review found exactly this with `maxProse: 100`. `contentLimits.test.ts` pins that the actual constant this
 * repository calls with (`DETAIL_PROSE_VISIBLE_MAX` = 1800) clears that sum with roughly 1,000 characters of
 * margin, so the gap is real for an arbitrary caller but not reachable through either schema in this repo.
 *
 * @param detail the ordered detail/body sub-blocks
 * @param citations the artifact's citations, used to measure visible width
 * @param maxProse the aggregate prose cap ({@link "./contentLimits.js".DETAIL_PROSE_VISIBLE_MAX})
 * @param baseBlocksDropped whole blocks already dropped by an earlier block-count pass, counted into the warning
 * @param baseItemsDropped items already dropped by an earlier per-block item-count pass, counted into the warning
 * @param rowsDropped table rows already dropped by an earlier pass, counted into the warning
 * @returns the trimmed blocks, and how many whole blocks vs. individual items THIS pass dropped
 */
export function capDetailProse({
  detail,
  citations,
  maxProse,
  baseBlocksDropped,
  baseItemsDropped,
  rowsDropped,
}: {
  detail: readonly DetailBlock[];
  citations: readonly CitationWidth[];
  maxProse: number;
  baseBlocksDropped: number;
  baseItemsDropped: number;
  rowsDropped: number;
}): { detail: readonly DetailBlock[]; blocksDropped: number; itemsDropped: number } {
  const anyBaseDrop = baseBlocksDropped > 0 || baseItemsDropped > 0 || rowsDropped > 0;
  if (!anyBaseDrop && sumDetailProse({ citations, detail }) <= maxProse) {
    return { blocksDropped: 0, detail, itemsDropped: 0 };
  }
  const working = detail.map((block) => ({ ...block }));
  let blocksDropped = 0;
  let itemsDropped = 0;
  // Once ANY pass has dropped something — an earlier one, or this one on a prior iteration — a warning is
  // owed regardless of whether the raw content alone would already fit, which is exactly what a bare
  // content-vs-cap check misses: `anyBaseDrop` alone is not enough, since a base drop combined with content
  // already at the raw cap still needs THIS loop to make room for the warning it now owes.
  const fitsWithWarning = (): boolean =>
    detailProseFitsWithWarning({
      anyDropSoFar: anyBaseDrop || blocksDropped > 0 || itemsDropped > 0,
      blocksDropped: baseBlocksDropped + blocksDropped,
      citations,
      itemsDropped: baseItemsDropped + itemsDropped,
      maxProse,
      rowsDropped,
      working,
    });
  // The "at least one block survives" floor only blocks REMOVING a block outright — trimming one item off a
  // bullets/list block that still has others left is always safe, even when it is the sole remaining block.
  while (!fitsWithWarning()) {
    const dropped = dropOneProseUnit({ working });
    if (dropped === undefined) {
      break;
    }
    if (dropped === "block") {
      blocksDropped += 1;
    } else {
      itemsDropped += 1;
    }
  }
  return { blocksDropped, detail: working, itemsDropped };
}

/**
 * The trailing paragraph a truncated card/answer carries below the fold, naming what was dropped and why —
 * never silent. Stays comfortably under {@link DETAIL_WARNING_RESERVED_VISIBLE_MAX} so it is never itself
 * refused for width.
 *
 * @param blocksDropped whole detail/body blocks dropped
 * @param itemsDropped individual bullet/list items dropped
 * @param rowsDropped table rows dropped
 * @param cap the prose cap this truncation was enforcing
 * @returns a paragraph block reporting the drop
 */
export function buildDetailTruncationWarning({
  blocksDropped,
  itemsDropped,
  rowsDropped,
  cap,
}: {
  blocksDropped: number;
  itemsDropped: number;
  rowsDropped: number;
  cap: number;
}): DetailBlock {
  const droppedUnits = blocksDropped + itemsDropped;
  const parts: string[] = [];
  if (droppedUnits > 0) {
    parts.push(`${String(droppedUnits)} item${droppedUnits === 1 ? "" : "s"}`);
  }
  if (rowsDropped > 0) {
    parts.push(`${String(rowsDropped)} table row${rowsDropped === 1 ? "" : "s"}`);
  }
  return {
    runs: [
      {
        text:
          `⚠️ Truncated: ${parts.join(" and ")} dropped — this card was over the ${String(cap)}-character cap. ` +
          "See the source for the full list.",
        type: "text",
      },
    ],
    type: "paragraph",
  };
}
