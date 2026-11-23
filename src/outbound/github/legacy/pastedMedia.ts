/**
 * Media a human PASTED into a reading-order description on github.com, kept where it was across an edit. Pure.
 *
 * Dropping a screenshot into GitHub's editor writes it as its own paragraph — `<img width="1512" height="982"
 * alt="Image" src="https://github.com/user-attachments/assets/<id>" />`, a Markdown `![image](…)`, or a bare
 * attachment URL for a video. Mid-body, that block used to make the whole description unreadable to `./parse.ts`,
 * so an `--edit` refused and the only route left was a whole replace that rewrote everything. Measured on a live
 * pull request: `github pr update --pull` refused at the pasted block (repro `slopweaver github pr update <owner/repo#N> --pull --dry-run`).
 *
 * ## The bytes stay outside the form, on purpose
 *
 * A pasted block is the owner's own bytes, never authored content: putting it in the form would let `--form`
 * manufacture raw HTML, which is the boundary every cell's escaping exists to hold. So the parser lifts a pasted
 * block out, reads the rest as a canonical body, and records the block against the KEY of the canonical block it
 * followed; the renderer puts it back after that key. A key, not a byte offset or a preceding block's text: an
 * edit that rewrites the block before it still finds the slot.
 *
 * ## The criterion is narrow so no prose rides it
 *
 * One standalone block on ONE line, whose whole text is ONE of: an `<img>` carrying only `src`, `alt`, `width` and `height`,
 * each at most once, with a decimal width and height; a Markdown image; a bare URL. In every case the source is a
 * GitHub user-attachments upload, by the same predicate the form's own hosting rule uses. Anything else mid-body is
 * still not a canonical render, and is still refused.
 */
import { isUserAttachmentUrl } from "../formHosting.js";

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
export interface KeyedBlock {
  readonly key: CanonicalBlockKey;
  readonly text: string;
}

/** One pasted block: its exact bytes, and the canonical block it follows — `start` when it opens the body. */
export interface PastedMediaBlock {
  readonly after: CanonicalBlockKey | "start";
  readonly raw: string;
}

/**
 * Any character that could part a paste across lines or hide in it: every control, format, private-use and
 * unassigned code point (LF, CR, tab, vertical tab and U+0085 among them), a line or paragraph separator, and any
 * whitespace but a plain space. A description is read with CRLF as LF, so a paste spanning lines would not come
 * back byte for byte; refusing the whole class closes it rather than naming one break at a time.
 */
const NOT_PLAIN_TEXT = /[\p{C}\p{Zl}\p{Zp}]|[^\S ]/u;

/** The `<img>` attributes a paste may carry, each at most once. */
const PASTE_ATTRIBUTES: ReadonlySet<string> = new Set(["alt", "height", "src", "width"]);

/** A whole `<img …>` or `<img … />` tag, its attribute run captured; attributes part on spaces only, as GitHub writes them. */
const PASTED_IMG = /^<img((?: +[a-z]+="[^"<>]*")+) *\/?>$/;

/** One `name="value"` attribute inside {@link PASTED_IMG}'s run. */
const ATTRIBUTE = / +([a-z]+)="([^"<>]*)"/g;

/**
 * A whole Markdown image whose url carries no space or parenthesis, and whose alt is plain words: letters, digits,
 * spaces and `.,:;'()-`, so it can carry no Markdown or HTML markup (`**`, `_`, a backtick, a tag) at all.
 */
const PASTED_MARKDOWN_IMAGE = /^!\[[\p{L}\p{N} .,:;'()-]*\]\(([^()\s]+)\)$/u;

/** The source of a pasted `<img>`, or undefined when its attributes are not exactly the allowed shape. */
function pastedImgSource({ text }: { text: string }): string | undefined {
  const tag = PASTED_IMG.exec(text);
  if (tag === null) {
    return undefined;
  }
  const attributes = new Map<string, string>();
  for (const [, name, value] of tag[1]!.matchAll(ATTRIBUTE)) {
    if (!PASTE_ATTRIBUTES.has(name!) || attributes.has(name!)) {
      return undefined;
    }
    attributes.set(name!, value!);
  }
  const sized = [...attributes].every(([name, value]) => name === "src" || name === "alt" || /^[0-9]+$/.test(value));
  return sized ? attributes.get("src") : undefined;
}

/**
 * Whether one top-level block is pasted media: a single user-attachments image or video, and nothing else.
 *
 * @param block one blank-line-separated block of a description
 * @returns true only for the three paste spellings, sourced from a GitHub user-attachments upload
 */
export function isPastedMedia({ block }: { block: string }): boolean {
  if (NOT_PLAIN_TEXT.test(block)) {
    return false;
  }
  const markdown = PASTED_MARKDOWN_IMAGE.exec(block);
  const source = markdown === null ? pastedImgSource({ text: block }) : markdown[1];
  if (source === undefined) {
    // Neither image spelling matched, so the only paste left is a bare video url standing alone as the block.
    return isUserAttachmentUrl({ url: block });
  }
  return isUserAttachmentUrl({ url: source });
}

/**
 * Where each top-level pasted-media block in a text ends, as the offset just past the newline closing it — the
 * places a description could end with a paste after its last rendered block, so the paste is lifted and keyed
 * rather than read as appended content. A final paste no newline closes, as github.com saves one typed at the
 * end, ends at the end of the text.
 *
 * @param text a whole description, read from its first byte so blocks split where the renderer split them
 * @returns each offset, in order; empty when the text holds no pasted block
 */
export function pastedMediaEnds({ text }: { text: string }): readonly number[] {
  const ends: number[] = [];
  let start = 0;
  while (start < text.length) {
    const gap = text.indexOf("\n\n", start);
    const final = gap < 0;
    const closedByNewline = text.endsWith("\n");
    let stop = gap;
    if (final) {
      stop = closedByNewline ? text.length - 1 : text.length;
    }
    if (isPastedMedia({ block: text.slice(start, stop) })) {
      ends.push(Math.min(stop + 1, text.length));
    }
    if (final) {
      break;
    }
    start = gap + 2;
  }
  return ends;
}

/** Where a pasted block goes: after its own key, else after the nearest earlier key still rendered, else first. */
function insertionIndex({
  blocks,
  after,
}: {
  blocks: readonly KeyedBlock[];
  after: CanonicalBlockKey | "start";
}): number {
  if (after === "start") {
    return 0;
  }
  const rank = CANONICAL_BLOCK_KEYS.indexOf(after);
  let at = 0;
  blocks.forEach((block, index) => {
    if (CANONICAL_BLOCK_KEYS.indexOf(block.key) <= rank) {
      at = index + 1;
    }
  });
  return at;
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
  const slots: string[][] = Array.from({ length: blocks.length + 1 }, () => []);
  for (const block of pasted) {
    slots[insertionIndex({ after: block.after, blocks })]!.push(block.raw);
  }
  return slots
    .flatMap((slot, index) => [...slot, ...(index < blocks.length ? [blocks[index]!.text] : [])])
    .join("\n\n");
}

/**
 * The blocks of a description's main part split into the canonical ones and the pasted media between them, each
 * paste recorded by how many canonical blocks preceded it.
 *
 * @param blocks the main part's blank-line-separated blocks, before the Longer notes
 * @returns the canonical blocks, and each paste with its count of preceding canonical blocks
 */
export function liftPasted({ blocks }: { blocks: readonly string[] }): {
  readonly canonical: readonly string[];
  readonly pasted: readonly { readonly before: number; readonly raw: string }[];
} {
  const canonical: string[] = [];
  const pasted: { before: number; raw: string }[] = [];
  for (const block of blocks) {
    if (isPastedMedia({ block })) {
      pasted.push({ before: canonical.length, raw: block });
    } else {
      canonical.push(block);
    }
  }
  return { canonical, pasted };
}
