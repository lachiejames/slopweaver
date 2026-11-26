/**
 * Media a human PASTED into a pull-request description on github.com, kept where it was across an edit. Pure.
 *
 * Dropping a screenshot into GitHub's editor writes it as its own paragraph — `<img width="1512" height="982"
 * alt="Image" src="https://github.com/user-attachments/assets/<id>" />`, a Markdown `![image](…)`, or a bare
 * attachment URL for a video. Mid-body, that block used to make the whole description unreadable, so an `--edit`
 * refused and the only route left was a whole replace that dropped the screenshot. Both readers lift it: the C3 one
 * (`./parse.ts`) and the frozen reading-order one (`./legacy/parse.ts`, through `./legacy/pastedMedia.ts`).
 *
 * ## The bytes stay outside the form, on purpose
 *
 * A pasted block is the owner's own bytes, never authored content: putting it in the form would let `--form`
 * manufacture raw HTML, which is the boundary every cell's escaping exists to hold. So a reader lifts a pasted block
 * out, reads the rest as a canonical body, and records the block against the KEY of the canonical block it followed,
 * and which occurrence of that key; the renderer puts it back there. A key, not a byte offset or a preceding block's
 * text: an edit that rewrites the block before it still finds the slot.
 *
 * ## The criterion is narrow so no prose rides it
 *
 * One standalone block on ONE line, whose whole text is ONE of: an `<img>` carrying only `src`, `alt`, `width` and
 * `height`, each at most once, with a decimal width and height; a Markdown image; a bare URL. In every case the source
 * is a GitHub user-attachments upload, by the same predicate the form's own hosting rule uses. Anything else mid-body
 * is still not a canonical render, and is still refused.
 */
import { isUserAttachmentUrl } from "./formHosting.js";

/** One rendered block and the key it is anchored by. */
export interface KeyedBlock<Key extends string> {
  readonly key: Key;
  readonly text: string;
}

/**
 * One pasted block: its exact bytes, and where it sat — `start` when it opens the body, else after the
 * `occurrence`-th (one-based) rendered block carrying the key `after`. A key renders more than once only where one
 * section is several blocks, such as a layout-1 body's check paragraphs.
 */
export type PastedMediaBlock<Key extends string> =
  | { readonly after: "start"; readonly raw: string }
  | { readonly after: Key; readonly occurrence: number; readonly raw: string };

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

/**
 * Where a pasted block goes: after its own key's occurrence; else after that key's last remaining occurrence; else
 * after the nearest earlier key in `keyOrder` still rendered; else first.
 */
function insertionIndex<Key extends string>({
  blocks,
  keyOrder,
  paste,
}: {
  blocks: readonly KeyedBlock<Key>[];
  keyOrder: readonly Key[];
  paste: PastedMediaBlock<Key>;
}): number {
  // `Key` may itself admit "start", so the `after` comparison cannot narrow the union; the field the keyed arm alone
  // carries can.
  if (!("occurrence" in paste)) {
    return 0;
  }
  const after = paste.after;
  let seen = 0;
  let lastSame = -1;
  for (const [index, block] of blocks.entries()) {
    if (block.key !== after) {
      continue;
    }
    seen += 1;
    lastSame = index;
    if (seen === paste.occurrence) {
      return index + 1;
    }
  }
  if (lastSame >= 0) {
    return lastSame + 1;
  }
  const rank = keyOrder.indexOf(after);
  let at = 0;
  blocks.forEach((block, index) => {
    if (keyOrder.indexOf(block.key) <= rank) {
      at = index + 1;
    }
  });
  return at;
}

/**
 * The rendered blocks with every pasted block put back, joined by the blank line that separates every block.
 *
 * Several pastes in one slot keep their order, and a paste whose key an edit removed lands after the nearest
 * earlier key that still renders, so an edit never drops one. With no pastes this is the blocks joined, unchanged.
 *
 * @param blocks the canonical blocks, in render order
 * @param keyOrder every key the renderer can emit, in render order, which decides the fallback slot
 * @param pasted the pasted blocks to put back, in the order they were read
 * @returns the blocks' text, pastes included, joined by blank lines
 */
export function joinWithPasted<Key extends string>({
  blocks,
  keyOrder,
  pasted,
}: {
  blocks: readonly KeyedBlock<Key>[];
  keyOrder: readonly Key[];
  pasted: readonly PastedMediaBlock<Key>[];
}): string {
  const slots: string[][] = Array.from({ length: blocks.length + 1 }, () => []);
  for (const paste of pasted) {
    slots[insertionIndex({ blocks, keyOrder, paste })]!.push(paste.raw);
  }
  return slots
    .flatMap((slot, index) => [...slot, ...(index < blocks.length ? [blocks[index]!.text] : [])])
    .join("\n\n");
}

/**
 * The blocks of a description split into the canonical ones and the pasted media between them, each paste recorded
 * by how many canonical blocks preceded it.
 *
 * @param blocks the description's blank-line-separated blocks
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
