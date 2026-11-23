/**
 * What a page LOOKS like to the attach pass: the bounded block walk, and the one question that walk exists
 * to answer.
 *
 * Split out of the pass because reading the page and writing to it have different failure modes — nothing
 * here performs a write, and `alreadyInserted` is pure, so both can be reasoned about with no upload
 * anywhere in the picture.
 */
import type { NotionMediaApi, PageBlock } from "../../../corpus/notion/mediaApi.js";
import { appendAll } from "../../../lib/arrays.js";
import { type MarkerCandidate, MEDIA_BLOCK_TYPES } from "../../../outbound/notion/mediaPlaceholder.js";

/** How deep the block walk descends. Top level plus toggles and columns, never an unbounded crawl. */
const MARKER_SEARCH_DEPTH = 3;

/** How many blocks the walk reads before it stops looking. Far above any document this lane publishes. */
const MARKER_SEARCH_BLOCKS_MAX = 500;

/** Every child of one parent, following Notion's cursor to the end or to the budget. */
async function childrenOf({
  api,
  parentId,
  budget,
}: {
  api: NotionMediaApi;
  parentId: string;
  budget: number;
}): Promise<{ readonly blocks: readonly PageBlock[] } | { readonly error: string }> {
  const blocks: PageBlock[] = [];
  let cursor: string | undefined;
  do {
    const page = await api.listChildren({ cursor, parentId });
    if (page.isErr()) {
      return { error: `could not read the page's blocks: ${page.error.message}` };
    }
    appendAll({ from: page.value.blocks, into: blocks });
    cursor = page.value.nextCursor;
  } while (cursor !== undefined && blocks.length < budget);
  return { blocks };
}

/**
 * Every block under `pageId`, to {@link MARKER_SEARCH_DEPTH}, or the reason the page could not be read.
 *
 * A breadth-first walk rather than a flat read of the top level, because a golden proposal folds its
 * appendix into a `<details>` toggle and a placeholder inside one is a CHILD block. Bounded on both axes so
 * an unexpected page shape costs a handful of calls rather than a crawl.
 *
 * @param pageId the page whose markers are being looked for
 * @returns every block found, or the one reason the walk could not finish
 */
export async function readBlocks({
  api,
  pageId,
}: {
  api: NotionMediaApi;
  pageId: string;
}): Promise<{ readonly blocks: readonly MarkerCandidate[] } | { readonly error: string }> {
  const found: MarkerCandidate[] = [];
  let frontier: readonly string[] = [pageId];
  for (let depth = 0; depth < MARKER_SEARCH_DEPTH && frontier.length > 0; depth += 1) {
    const next: string[] = [];
    for (const parentId of frontier) {
      const page = await childrenOf({ api, budget: MARKER_SEARCH_BLOCKS_MAX, parentId });
      if ("error" in page) {
        return page;
      }
      collect({ blocks: page.blocks, found, next });
    }
    frontier = found.length < MARKER_SEARCH_BLOCKS_MAX ? next : [];
  }
  return { blocks: found };
}

/** Record one parent's children, and queue the ones that have children of their own. */
function collect({
  blocks,
  found,
  next,
}: {
  blocks: readonly PageBlock[];
  found: MarkerCandidate[];
  next: string[];
}): void {
  for (const block of blocks) {
    found.push({ id: block.id, parentId: block.parentId, text: block.text, type: block.type });
    if (block.hasChildren) {
      next.push(block.id);
    }
  }
}

/**
 * Whether this marker's file has ALREADY been inserted and only the marker's deletion failed.
 *
 * `attachOne` inserts first and deletes the marker last, so a marker can survive a pass that did all
 * the work. Absence of the marker was once the only already-attached signal, which made that state
 * indistinguishable from one whose upload never happened — and a re-run then attached a SECOND copy.
 * The block listed immediately after the marker under the same parent is the witness: this lane only
 * ever puts a media block there, so finding one means the insert landed.
 *
 * @param blocks the page as the walk read it, in order
 * @param marker the marker block still standing, and the parent it sits under
 * @returns true when the file is already on the page and only the marker needs clearing
 */
export function alreadyInserted({
  blocks,
  marker,
}: {
  blocks: readonly MarkerCandidate[];
  marker: { readonly blockId: string; readonly parentId: string };
}): boolean {
  const at = blocks.findIndex((block) => block.id === marker.blockId);
  if (at === -1) {
    return false;
  }
  const after = blocks[at + 1];
  if (after === undefined || after.parentId !== marker.parentId) {
    return false;
  }
  return MEDIA_BLOCK_TYPES.has(after.type);
}
