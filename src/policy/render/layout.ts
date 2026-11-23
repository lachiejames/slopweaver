/**
 * Laying one policy's markdown out as positioned lines on a page — the pure half of the render.
 *
 * ## Why this exists rather than a markdown-to-PDF library
 *
 * The obvious route is HTML plus a headless browser's print-to-PDF, and it is closed here: **no process
 * this repository starts may launch a browser** ([browser-route](../../../docs/browser-route.md)), gated by
 * `no-private-browser-profile` in `yarn lint`. So the layout is done in this repository and `pdf-lib` is
 * asked only to emit the file — which is the right split anyway, because the thing a test needs to pin is
 * where the words land, not how a PDF object graph is spelled.
 *
 * ## Two passes: logical blocks, then lines
 *
 * The source is first read into BLOCKS (`source.ts`) the way CommonMark reads it, and only then wrapped to
 * the column (`wrap.ts`) and placed here. Reading line by line drew every hard-wrapped source line as a
 * paragraph of its own.
 *
 * ## The supported subset, and an unsupported construct is REFUSED
 *
 * Headings `#`–`######`, paragraphs, `-` and numbered list items (nested by indent), block quotes, tables,
 * a fenced code block's contents as preformatted lines in a monospaced face, and an image alone on its own
 * line. A compliance programme's few dozen policies need the first few; an EVIDENCE document — a change-management set with
 * five tables and nine figures — needs the rest. Anything else refuses by name rather than being
 * silently dropped: a policy whose table quietly vanished on the way back into Vanta would be a compliance
 * document with a hole in it, and the hole would be invisible in the upload screenshot. An image written
 * INSIDE a line of text is refused for the same reason: drawn as text it would look present and be gone.
 *
 * **A table is drawn as stacked rows, not a grid.** The header once, in bold; then each row's first cell
 * in bold and every further cell as an indented paragraph beneath it. A side-by-side grid wraps cells in
 * parallel, and the read-back in `verify.ts` groups extracted text by baseline, so a grid's cells would come
 * back interleaved and the check that nothing was dropped could no longer compare in order.
 *
 * Inline emphasis is DELIBERATELY passed through as written. `**must**` renders as `**must**` rather than
 * as bold, because the alternative is a second font pass whose only effect on a policy's meaning is
 * cosmetic, and because silently deleting the asterisks would make the PDF disagree with the markdown that
 * a reviewer approved. Links are passed through the same way.
 */
import { absentAsNumber } from "#lib/absent.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type RenderRefusal, readBlocks, type SourceBlock } from "./source.js";
import { type TextWidth, wrap } from "./wrap.js";

/** Which face a line is set in: the body, its bold, or the monospaced face a fenced block keeps its columns in. */
export type FontFace = "regular" | "bold" | "mono";

/**
 * One line of text, already wrapped, with the size and face it is set at.
 *
 * @internal
 */
export interface RenderedLine {
  readonly kind: "text";
  readonly text: string;
  readonly size: number;
  readonly font: FontFace;
  /** How far in from the left margin this line starts, in points. */
  readonly indent: number;
  /** Blank space above this line, in points. */
  readonly spaceBefore: number;
}

/**
 * One image, drawn at the column's width or its own, whichever is smaller. Its size is the emitter's to
 * read, since only the decoded file knows it.
 *
 * @internal
 */
export interface RenderedImage {
  readonly kind: "image";
  /** The path as the markdown wrote it, resolved by whoever loads it. */
  readonly source: string;
  /** The markdown line carrying it, so a file that will not load is refused at its line. */
  readonly line: number;
  /** Blank space above the image, in points. */
  readonly spaceBefore: number;
}

/** One thing the emitter draws, in order. */
export type RenderedBlock = RenderedLine | RenderedImage;

/**
 * A layout that succeeded, or every construct that stopped it.
 *
 * The error arm is a LIST rather than one typed refusal, per `.claude/rules/error-handling.md`: the whole
 * point of the pass is to name every construct it will not draw, and a single discriminated error would
 * lose the multiplicity that is the behaviour.
 */
export type RenderLayout = Result<readonly RenderedBlock[], readonly RenderRefusal[]>;

/** The page geometry every rendered policy uses. A4 at 72 dpi, with a 64-point margin. */
export const PAGE = {
  bodySize: 10.5,
  height: 841.89,
  /** Line height as a multiple of the font size. */
  leading: 1.45,
  margin: 64,
  width: 595.28,
} as const;

/** The font size each heading level is set at, largest first. */
const HEADING_SIZES: readonly number[] = [20, 16, 13.5, 12, 11, 11];

/** How far each level of list, quote or table cell is indented from the margin, in points. */
const LIST_INDENT = 18;

/**
 * The glyph between a table header's cells, which wrapping would otherwise run together. Like the list
 * bullet it is drawn by the renderer and is no word of the document, so `verify.ts` drops it on read-back.
 */
export const CELL_SEPARATOR = "·";

/** How far Courier advances per glyph, as a fraction of the font size. Every glyph: it is monospaced. */
const MONO_ADVANCE = 0.6;

/**
 * The smallest size a fence is shrunk to. Below it the text is unreadable, and below about 0.1pt the read-back
 * rounds a glyph's height to zero and drops it — so a 16,000-character line rendered "successfully" and then
 * failed its own verification with no line named.
 */
const MIN_FENCE_SIZE = 5;

/**
 * Wrapped lines of one run of text, set in one face at one indent, the first carrying the space above and,
 * for a list item, its marker — added after wrapping, because wrapping collapses the two spaces after it.
 */
function linesOf({
  text,
  font,
  size,
  indent,
  spaceBefore,
  measure,
  column,
  marker = null,
}: {
  text: string;
  font: FontFace;
  size: number;
  indent: number;
  spaceBefore: number;
  measure: TextWidth;
  column: number;
  marker?: string | null;
}): readonly RenderedLine[] {
  const bold = font === "bold";
  return wrap({ bold, measure, size, text, width: column - indent }).map((wrapped, index) => {
    const first = index === 0;
    return {
      font,
      indent,
      kind: "text",
      size,
      spaceBefore: first ? spaceBefore : 0,
      text: first && marker !== null ? `${marker}  ${wrapped}` : wrapped,
    };
  });
}

/** One table body row: its first non-empty cell bold, every later one indented under it, onto `placed`. */
function placeRow({
  row,
  placed,
  measure,
  column,
}: {
  row: readonly string[];
  placed: RenderedLine[];
  measure: TextWidth;
  column: number;
}): void {
  const size = PAGE.bodySize;
  const cells = row.filter((cell) => cell !== "");
  cells.forEach((cell, index) => {
    const first = index === 0;
    const font: FontFace = first ? "bold" : "regular";
    const indent = first ? 0 : LIST_INDENT;
    const spaceBefore = first ? size * 0.6 : 0;
    // A loop, not `push(...)`: a 16 MB cell wrapped to more lines than a call takes arguments.
    for (const wrapped of linesOf({ column, font, indent, measure, size, spaceBefore, text: cell })) {
      placed.push(wrapped);
    }
  });
}

/** A table as stacked rows: the header once, then each row's first cell bold and the rest indented under it. */
function placeTable({
  block,
  measure,
  column,
}: {
  block: { readonly header: readonly string[]; readonly rows: readonly (readonly string[])[] };
  measure: TextWidth;
  column: number;
}): readonly RenderedLine[] {
  const size = PAGE.bodySize;
  const placed: RenderedLine[] = [
    ...linesOf({
      column,
      font: "bold",
      indent: 0,
      measure,
      size,
      spaceBefore: size * 0.9,
      text: block.header.filter((cell) => cell !== "").join(` ${CELL_SEPARATOR} `),
    }),
  ];
  for (const row of block.rows) {
    placeRow({ column, measure, placed, row });
  }
  return placed;
}

/**
 * The size a fenced block is set at: a point under the body, or smaller when its widest line would not
 * otherwise fit the column. A fenced line is never wrapped — wrapping would break a diagram's columns — and
 * `pdf-lib` does not clip, so a line wider than the column ran off the page edge unread. Courier advances
 * every glyph by the same 0.6 em, so the width is arithmetic rather than a measurement.
 */
function fencedSize({ lines, column }: { lines: readonly string[]; column: number }): number {
  // A loop, not `Math.max(...lines)`: spreading a 200,000-line fence as arguments overflowed the stack.
  let widest = 0;
  for (const line of lines) {
    widest = Math.max(widest, line.length);
  }
  return Math.min(PAGE.bodySize - 1, (column - LIST_INDENT) / (widest * MONO_ADVANCE));
}

/** Every fenced line too wide to fit the column at {@link MIN_FENCE_SIZE}, refused at its own line. */
function overwideFenceLines({
  blocks,
  column,
}: {
  blocks: readonly SourceBlock[];
  column: number;
}): readonly RenderRefusal[] {
  const most = Math.floor((column - LIST_INDENT) / (MIN_FENCE_SIZE * MONO_ADVANCE));
  const refusals: RenderRefusal[] = [];
  for (const block of blocks) {
    if (block.kind !== "fence") {
      continue;
    }
    block.lines.forEach((text, index) => {
      if (text.length > most) {
        refusals.push({
          line: block.line + 1 + index,
          reason: `a fenced line of ${String(text.length)} characters, wider than the page holds at a readable size (at most ${String(most)})`,
        });
      }
    });
  }
  return refusals;
}

/** One logical block as the lines or image the emitter draws. */
function placeBlock({
  block,
  measure,
  column,
}: {
  block: SourceBlock;
  measure: TextWidth;
  column: number;
}): readonly RenderedBlock[] {
  switch (block.kind) {
    case "table":
      return placeTable({ block, column, measure });
    case "fence": {
      const fenceSize = fencedSize({ column, lines: block.lines });
      return block.lines.map((text, index) => ({
        font: "mono",
        indent: LIST_INDENT,
        kind: "text",
        size: fenceSize,
        spaceBefore: index === 0 ? PAGE.bodySize * 0.7 : 0,
        text,
      }));
    }
    case "image":
      return [{ kind: "image", line: block.line, source: block.source, spaceBefore: PAGE.bodySize * 0.7 }];
    case "heading":
    case "paragraph":
    case "item":
    case "quote":
      return linesOf({ column, measure, text: block.text, ...textSettings({ block }) });
    default: {
      const unreachable: never = block;
      return unreachable;
    }
  }
}

/** A block of running text: the four kinds that wrap as one paragraph. */
type TextBlock = Extract<SourceBlock, { kind: "heading" | "paragraph" | "item" | "quote" }>;

/** The face, size, indent, spacing and marker one block of running text is set with. */
function textSettings({ block }: { block: TextBlock }): {
  font: FontFace;
  size: number;
  indent: number;
  spaceBefore: number;
  marker: string | null;
} {
  const size = PAGE.bodySize;
  switch (block.kind) {
    case "heading": {
      const headingSize = absentAsNumber({ value: HEADING_SIZES[block.level - 1], whenAbsent: PAGE.bodySize });
      return { font: "bold", indent: 0, marker: null, size: headingSize, spaceBefore: headingSize * 0.9 };
    }
    case "paragraph":
      return { font: "regular", indent: block.depth * LIST_INDENT, marker: null, size, spaceBefore: size * 0.7 };
    case "item":
      return { font: "regular", indent: (block.depth + 1) * LIST_INDENT, marker: block.marker, size, spaceBefore: 0 };
    case "quote":
      return { font: "regular", indent: LIST_INDENT, marker: null, size, spaceBefore: size * 0.7 };
    default: {
      const unreachable: never = block;
      return unreachable;
    }
  }
}

/**
 * Lay one policy's markdown out as positioned lines and images.
 *
 * @param markdown the policy markdown file's whole contents
 * @param measure how wide a string is in the font the emitter will use
 * @returns the lines and images to draw, or every construct that stopped the render
 */
export function layoutPolicy({ markdown, measure }: { markdown: string; measure: TextWidth }): RenderLayout {
  const column = PAGE.width - PAGE.margin * 2;
  const read = readBlocks({ markdown });
  const blocks = read.blocks;
  const refusals = [...read.refusals, ...overwideFenceLines({ blocks, column })];
  if (refusals.length > 0) {
    return err(refusals);
  }
  return ok(blocks.flatMap((block) => placeBlock({ block, column, measure })));
}
