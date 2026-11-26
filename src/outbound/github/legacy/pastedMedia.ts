/**
 * Media a human PASTED into a reading-order description on github.com, kept where it was across an edit. Pure.
 *
 * The criterion, the lift and the join are shared with the C3 reader (`../pastedMedia.ts`, whose header carries the
 * design: the bytes stay outside the form, keyed to the canonical block they followed, and the criterion is narrow
 * so no prose rides it). What stays here is the reading-order body's own key list, in render order. Every key renders
 * at most once in this shape, so a paste here is always after the FIRST occurrence of its key. Measured on a live
 * pull request before the lift existed: `github pr update --pull` refused at the pasted block (repro
 * `slopweaver github pr update <owner/repo#N> --pull --dry-run`).
 */
import {
  joinWithPasted as joinKeyed,
  type KeyedBlock as SharedKeyedBlock,
  type PastedMediaBlock as SharedPastedMediaBlock,
} from "../pastedMedia.js";

export { isPastedMedia, liftPasted, pastedMediaEnds } from "../pastedMedia.js";

/** Every block a reading-order body renders, in render order — what a pasted block is anchored to. */
const CANONICAL_BLOCK_KEYS = [
  "badges",
  "reviewers-heading",
  "reviewers",
  "risk-heading",
  "risk-line",
  "risk-items",
  "blast-radius",
  "leftovers-heading",
  "leftovers-open",
  "leftovers",
  "leftovers-close",
  "what-heading",
  "origin",
  "problem-heading",
  "problem",
  "change-heading",
  "change",
  "before-after-heading",
  "before-after",
  "fails-on-main",
  "click-through",
  "claims-heading",
  "claims",
  "proof-heading",
  "proof",
  "code-heading",
  "why-heading",
  "why",
  "where-heading",
  "where",
  "notes",
] as const;

/** One canonical block's key. */
type CanonicalBlockKey = (typeof CANONICAL_BLOCK_KEYS)[number];

/** One rendered block and the key it is anchored by. */
export type KeyedBlock = SharedKeyedBlock<CanonicalBlockKey>;

/** One pasted block: its exact bytes, and the canonical block it follows — `start` when it opens the body. */
export interface PastedMediaBlock {
  readonly after: CanonicalBlockKey | "start";
  readonly raw: string;
}

/** A reading-order paste in the shared shape: after the first, and only, occurrence of its key. */
function sharedPaste({ paste }: { paste: PastedMediaBlock }): SharedPastedMediaBlock<CanonicalBlockKey> {
  if (paste.after === "start") {
    return { after: "start", raw: paste.raw };
  }
  return { after: paste.after, occurrence: 1, raw: paste.raw };
}

/**
 * The rendered blocks with every pasted block put back, joined by the blank line that separates every block.
 *
 * Several pastes after one key keep their order, and a paste whose key an edit removed lands after the nearest
 * earlier key that still renders, so an edit never drops one.
 *
 * @param blocks the canonical blocks, in render order
 * @param pasted the pasted blocks to put back, in the order they were read
 * @returns the blocks' text, pastes included, joined by blank lines
 */
export function joinWithPasted({
  blocks,
  pasted,
}: {
  blocks: readonly KeyedBlock[];
  pasted: readonly PastedMediaBlock[];
}): string {
  return joinKeyed({
    blocks,
    keyOrder: CANONICAL_BLOCK_KEYS,
    pasted: pasted.map((paste) => sharedPaste({ paste })),
  });
}
