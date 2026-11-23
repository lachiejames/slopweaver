/**
 * The exact inverse of `./render.ts`'s `renderProofBlock` over a run of blocks joined by blank lines — the
 * reading-order body's Longer notes, read back.
 */
import { decodeCell, IMG, imageRunOf, parseContent } from "../parseContent.js";
import type { ProofBlock, ProofBlockLeaf } from "./types.js";

/** The renderer's own opening tags for a `details` block — the summary shares its line with `<summary>`. */
const DETAILS_OPEN = /^<details>\n<summary>([^\n]*)<\/summary>\n\n/;
/** The bare closing tag, checked right after a blank line — the boundary a nested block must stop before. */
const DETAILS_CLOSE_TAG = "</details>";
/** The exact bytes `renderProofBlock` emits before the closing tag. */
const DETAILS_CLOSE = `\n\n${DETAILS_CLOSE_TAG}`;
/** A canonical code-fence opening, three-or-more backticks and a schema-valid language. */
const CODE_OPEN = /^(`{3,})([A-Za-z0-9_+-]*)\n/;

/**
 * Whether a new block opens at the head of `text` — a code fence, a nested `details`, a canonical image, or
 * (only when parsing INSIDE a `details` block) that block's own close. This is what tells a greedy paragraph
 * where to stop.
 */
function blockBoundaryAt({ text, insideDetails }: { text: string; insideDetails: boolean }): boolean {
  return (
    CODE_OPEN.test(text) ||
    DETAILS_OPEN.test(text) ||
    IMG.test(text) ||
    (insideDetails && text.startsWith(DETAILS_CLOSE_TAG))
  );
}

/**
 * Recover the blocks of a region `renderProofBlock` rendered and joined with blank lines.
 *
 * A code block is recognised only where the renderer could have emitted one: at a block boundary, opening
 * with three or more backticks and a schema-valid language, closing on an identical run alone on its line.
 * The fence length is then REQUIRED to be the minimal collision-proof choice the renderer makes, so a fence
 * that merely happens to close is rejected. A `details` block is recognised the same way, by its own literal
 * open tag, and recurses into its nested leaf blocks up to its own close. An image block is the canonical
 * `<img>` and can appear anywhere.
 *
 * Everything between recognised blocks becomes a single paragraph, blank lines included. Paragraph text may
 * contain arbitrary newlines, so a blank line is not evidence of a boundary — collapsing them loses the
 * original partition and preserves the bytes, which is the trade every reader here makes.
 *
 * A reader that matches is a CANDIDATE, not a commitment: when the rest of the region cannot follow it, the
 * next reader is tried at the same place. A paragraph reading three backticks and `ts` just before a real code block opens
 * like a fence, and only the region after it shows that it was a paragraph.
 *
 * @param source the rendered region
 * @returns the blocks, or undefined when the region is not a canonical render
 */
export function parseProofBlocks({ source }: { source: string }): readonly ProofBlock[] | undefined {
  if (source.length === 0) {
    return [];
  }
  return parseSequence({ at: 0, close: undefined, readers: TOP_LEVEL_READERS, source })?.blocks;
}

/**
 * The blocks from `at` to the region's end, or to `close` when one is given, each separated by a blank line —
 * the first reader, in precedence order, whose block the rest of the region can follow.
 *
 * Two passes over block START positions rather than a recursive search, because a canonical code block is read
 * by both the code and the paragraph reader and both end in the same place: a search retrying each pair costs
 * 2^n on a region that fails, and recursion overflows the stack on a long one. The first pass collects every
 * position a block can start at and what each reader takes there; the second resolves them from the last
 * position back, so each is decided once.
 */
function parseSequence<B>({
  at,
  close,
  readers,
  source,
}: {
  at: number;
  close: string | undefined;
  readers: readonly BlockReader<B>[];
  source: string;
}): { blocks: readonly B[]; next: number } | undefined {
  const endAfter = ({ next }: { next: number }): number | undefined => {
    if (close === undefined) {
      return next === source.length ? next : undefined;
    }
    return source.startsWith(close, next) ? next + close.length : undefined;
  };
  const takes = collectTakes({ at, endAfter, readers, source });
  const resolved = resolveTakes({ endAfter, source, takes });
  const blocks: B[] = [];
  for (let step = resolved.get(at); step !== undefined; step = resolved.get(step.tail!)) {
    blocks.push(step.block);
    if (step.end !== undefined) {
      return { blocks, next: step.end };
    }
  }
  return undefined;
}

/** Where the region ends right after a block that ends at `next`, or undefined when it does not end there. */
type EndAfter = (args: { next: number }) => number | undefined;

/** One reader's block at a start position, and where that block ends. */
type Take<B> = { readonly block: B; readonly next: number };

/** Pass one: every start position a block can open at from `at`, with what each reader takes there. */
function collectTakes<B>({
  at,
  endAfter,
  readers,
  source,
}: {
  at: number;
  endAfter: EndAfter;
  readers: readonly BlockReader<B>[];
  source: string;
}): ReadonlyMap<number, readonly Take<B>[]> {
  const takes = new Map<number, readonly Take<B>[]>();
  const pending = [at];
  while (pending.length > 0) {
    const pos = pending.pop()!;
    if (takes.has(pos)) {
      continue;
    }
    const here = readers.flatMap((read) => {
      const taken = read({ at: pos, source });
      return taken === undefined ? [] : [taken];
    });
    takes.set(pos, here);
    for (const taken of here.filter((t) => endAfter({ next: t.next }) === undefined)) {
      if (source.startsWith("\n\n", taken.next)) {
        pending.push(taken.next + 2);
      }
    }
  }
  return takes;
}

/**
 * Pass two: from the last start position back, the first reader whose block either ends the region or is
 * followed by a blank line and a position already resolved.
 */
function resolveTakes<B>({
  endAfter,
  source,
  takes,
}: {
  endAfter: EndAfter;
  source: string;
  takes: ReadonlyMap<number, readonly Take<B>[]>;
}): ReadonlyMap<number, { block: B; end: number | undefined; tail: number | undefined }> {
  const resolved = new Map<number, { block: B; end: number | undefined; tail: number | undefined }>();
  for (const pos of [...takes.keys()].toSorted((a, b) => b - a)) {
    const step = takes
      .get(pos)!
      .map((taken) => resolveTake({ endAfter, resolved, source, taken }))
      .find((candidate) => candidate !== undefined);
    if (step !== undefined) {
      resolved.set(pos, step);
    }
  }
  return resolved;
}

/** One take resolved: it ends the region, it continues into a resolved position, or it leads nowhere. */
function resolveTake<B>({
  endAfter,
  resolved,
  source,
  taken,
}: {
  endAfter: EndAfter;
  resolved: ReadonlyMap<number, unknown>;
  source: string;
  taken: Take<B>;
}): { block: B; end: number | undefined; tail: number | undefined } | undefined {
  const end = endAfter({ next: taken.next });
  if (end !== undefined) {
    return { block: taken.block, end, tail: undefined };
  }
  const tail = taken.next + 2;
  const continues = source.startsWith("\n\n", taken.next) && resolved.has(tail);
  return continues ? { block: taken.block, end: undefined, tail } : undefined;
}

/** The head of the remaining region as a canonical image, or undefined when none opens there. */
function takeImageBlock({
  source,
  at,
}: {
  source: string;
  at: number;
}): { block: ProofBlockLeaf; next: number } | undefined {
  const opened = IMG.exec(source.slice(at));
  if (opened === null) {
    return undefined;
  }
  return { block: imageRunOf({ match: opened }), next: at + opened[0].length };
}

/** The head of the remaining region as a code block, or undefined when no canonical fence opens there. */
function takeCodeBlock({
  source,
  at,
}: {
  source: string;
  at: number;
}): { block: ProofBlockLeaf; next: number } | undefined {
  const opened = CODE_OPEN.exec(source.slice(at));
  if (opened === null) {
    return undefined;
  }
  const run = opened[1]!;
  const bodyAt = at + opened[0].length;
  const closeAt = source.indexOf(`\n${run}`, bodyAt);
  if (closeAt < 0) {
    return undefined;
  }
  const text = source.slice(bodyAt, closeAt);
  const longest = [...text.matchAll(/`+/g)].reduce((m, r) => Math.max(m, r[0].length), 0);
  // The renderer picks the SHORTEST fence that cannot be closed early. Verifying that, rather than accepting
  // any fence that happens to close, is what stops a hand-written over-long fence parsing as canonical.
  if (run.length !== Math.max(3, longest + 1)) {
    return undefined;
  }
  return { block: { kind: "code", lang: opened[2]!, text }, next: closeAt + 1 + run.length };
}

/**
 * The head of the remaining region as one paragraph, running up to the next block that opens a code fence or
 * a `details` block — or, when `insideDetails`, up to the `details` block's own close.
 */
function takeParagraph({
  source,
  at,
  insideDetails,
}: {
  source: string;
  at: number;
  insideDetails: boolean;
}): { block: ProofBlockLeaf; next: number } | undefined {
  let end = source.length;
  for (let probe = source.indexOf("\n\n", at); probe >= 0; probe = source.indexOf("\n\n", probe + 1)) {
    if (blockBoundaryAt({ insideDetails, text: source.slice(probe + 2) })) {
      end = probe;
      break;
    }
  }
  const content = parseContent({ source: source.slice(at, end) });
  return content === undefined ? undefined : { block: { content, kind: "para" }, next: end };
}

/**
 * The nested leaf blocks of a `details` block whose open tag already matched, stopping at its own close.
 *
 * A nested region ends at the literal `</details>` rather than at the end of the whole region, and may not itself
 * contain another `details` block — one level of nesting is enough, so its readers never include
 * {@link takeDetailsBlock}.
 */
function parseDetailsBody({
  source,
  at,
}: {
  source: string;
  at: number;
}): { blocks: readonly ProofBlockLeaf[]; next: number } | undefined {
  return parseSequence({ at, close: DETAILS_CLOSE, readers: NESTED_READERS, source });
}

/** One block reader: the block opening at `at` and where it ends, or undefined when it does not open there. */
type BlockReader<B> = (args: { at: number; source: string }) => { block: B; next: number } | undefined;

/** A top-level region's readers, in precedence order: a code fence, a `details` block, an image, else a paragraph. */
const TOP_LEVEL_READERS: readonly BlockReader<ProofBlock>[] = [
  takeCodeBlock,
  takeDetailsBlock,
  takeImageBlock,
  ({ at, source }) => takeParagraph({ at, insideDetails: false, source }),
];

/** A `details` block's readers: never another `details`, and a paragraph stops at the block's own close. */
const NESTED_READERS: readonly BlockReader<ProofBlockLeaf>[] = [
  takeCodeBlock,
  takeImageBlock,
  ({ at, source }) => takeParagraph({ at, insideDetails: true, source }),
];

/** The head of the remaining region as a `details` block, or undefined when no canonical open tag starts there. */
function takeDetailsBlock({
  source,
  at,
}: {
  source: string;
  at: number;
}): { block: ProofBlock; next: number } | undefined {
  const opened = DETAILS_OPEN.exec(source.slice(at));
  if (opened === null) {
    return undefined;
  }
  const body = parseDetailsBody({ at: at + opened[0].length, source });
  if (body === undefined) {
    return undefined;
  }
  return {
    block: { blocks: body.blocks, kind: "details", summary: decodeCell({ text: opened[1]! }) },
    next: body.next,
  };
}
