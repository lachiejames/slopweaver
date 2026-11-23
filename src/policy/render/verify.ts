/**
 * Proving that the PDF a render produced still says what the markdown said.
 *
 * ## Why the render is checked at all, when it is the "lossless" direction
 *
 * It is lossless in TYPOGRAPHY — the markdown is the source and the renderer decides how it looks — and
 * that is exactly what makes a DROP invisible. A construct the layout skipped, a line the pagination lost,
 * a word the wrapper swallowed: none of them show up as an error, and none of them are visible in the
 * screenshot of the upload that is the only other evidence this flow produces. So the render is judged by
 * reading its own output back.
 *
 * ## Characters with every space removed, not words
 *
 * The comparison is over the CHARACTER sequence with all whitespace stripped, and the whitespace is what
 * this is deliberately blind to: line breaks, page breaks and the bullet glyph are layout, and all differ
 * by construction. A word-sequence comparison was tried first and rejected — the renderer hard-breaks a
 * word wider than the whole column, so a long URL in a policy's body is one word in the markdown and
 * several in the PDF while the text is byte-identical. Removing the spaces makes that
 * non-difference invisible and leaves every real one visible.
 *
 * Markdown syntax is stripped from the source side — a `#`, a `-`, a `>`, a table's pipes and an image
 * line are instructions to the renderer, not words of the policy — while the inline emphasis the renderer
 * passes through verbatim is kept on both sides, so `**must**` has to survive as `**must**`. A numbered
 * item's `1.` is kept: the renderer draws it, because the number is content.
 *
 * A mismatch reports the FIRST divergence in context rather than a count. "3 differences" sends a reader
 * hunting; `… used in any [markdown: official | pdf: offical] capacity …` shows them the defect.
 */
import { CELL_SEPARATOR } from "./layout.js";
import { bodyStart, fenceStep, imageSourceOf, isTableSeparator, sourceLines } from "./source.js";

/** The words one side of the comparison contributed, in order.
 * @internal
 *
 * @param text one side's whole text
 * @returns its words, in order, with every empty one dropped
 */
export function policyWords({ text }: { text: string }): readonly string[] {
  return text
    .replace(/ /g, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 0);
}

/**
 * One line with its leading markdown marker removed, if it has one.
 *
 * String checks rather than `/^(#{1,6})\s+/` and `/^-\s+/`: both are polynomial by the `redos-check`
 * gate's criterion, and `layout.ts` strips the same two markers the same way, so the two sides of the
 * comparison agree by construction rather than by two regexes happening to match.
 */
function withoutLeadingSyntax({ raw }: { raw: string }): string {
  // Trimmed at both ends, as the layout trims before it classifies: `- ` alone is the layout's text `-`.
  const line = raw.trim();
  if (line.startsWith(">")) {
    return line.slice(1);
  }
  // The layout reads a heading only under four spaces of indent; deeper, `#` is a continuation's text.
  let marker = 0;
  if (raw.length - raw.trimStart().length < 4) {
    while (marker < line.length && line.charAt(marker) === "#") {
      marker += 1;
    }
  }
  if (marker === 0 && line.startsWith("-")) {
    marker = 1;
  }
  if (marker === 0 || marker > 6) {
    return line;
  }
  const rest = line.slice(marker);
  return rest.trimStart().length < rest.length ? rest.trimStart() : line;
}

/**
 * What one source line outside a fence contributes: nothing for a table's separator row or a line that is
 * one image, a table row's cells without their pipes, otherwise the line without its leading marker. Only
 * the row directly under a table's header is its separator; a body row of dashes is a row the layout draws.
 */
function lineText({ raw, underHeader }: { raw: string; underHeader: boolean }): string {
  const trimmed = raw.trim();
  if (underHeader && isTableSeparator({ trimmed })) {
    return "";
  }
  if (imageSourceOf({ trimmed }) !== null) {
    return "";
  }
  if (trimmed.startsWith("|")) {
    return trimmed.replaceAll("|", " ");
  }
  return withoutLeadingSyntax({ raw });
}

/**
 * The markdown's own words, with the syntax that is an instruction to the renderer removed — read line by
 * line here rather than through `layout.ts`'s block reader, so a block the reader wrongly swallowed is
 * still on this side of the comparison and shows up as a divergence. A fenced block's lines are kept
 * verbatim, as the renderer draws them.
 *
 * @param markdown the policy markdown file's whole contents
 * @returns its words, in order
 */
export function markdownWords({ markdown }: { markdown: string }): readonly string[] {
  const rows = sourceLines({ markdown });
  const body: string[] = [];
  let openTicks = 0;
  let tableRun = 0;
  for (let index = bodyStart({ rows }); index < rows.length; index += 1) {
    const raw = rows[index]!;
    const trimmed = raw.trim();
    const step = fenceStep({ openTicks, trimmed });
    if (step.kind === "content") {
      body.push(raw);
    } else if (step.kind === "text") {
      body.push(lineText({ raw, underHeader: tableRun === 1 }));
    }
    if (step.kind === "open") {
      openTicks = step.ticks;
    } else if (step.kind === "close") {
      openTicks = 0;
    }
    const continuesTable = step.kind === "text" && trimmed.startsWith("|");
    tableRun = continuesTable ? tableRun + 1 : 0;
  }
  return withoutDrawnMarks({ words: policyWords({ text: body.join("\n") }) });
}

/**
 * Words without the bullet and the header-cell separator the renderer draws. Dropped from BOTH sides, so a
 * policy that writes a standalone `•` or `·` itself still verifies — at the cost of not noticing a render
 * that lost one of those two marks and nothing else.
 */
function withoutDrawnMarks({ words }: { words: readonly string[] }): readonly string[] {
  return words.filter((word) => word !== "•" && word !== CELL_SEPARATOR);
}

/**
 * The rendered PDF's own words, with the bullet and the header-cell separator the renderer draws removed.
 *
 * @param text the text extracted back out of the rendered PDF
 * @returns its words, in order
 */
export function renderedWords({ text }: { text: string }): readonly string[] {
  return withoutDrawnMarks({ words: policyWords({ text }) });
}

/** What a verification concluded. */
export interface RenderVerification {
  readonly matched: boolean;
  /** How many non-space characters the markdown contributed. */
  readonly sourceLength: number;
  /** How many came back out of the PDF. */
  readonly renderedLength: number;
  /** The index of the first character that differs, or -1 when the two agree. */
  readonly firstDivergence: number;
  /** The divergence in context, or an empty string when there is none. */
  readonly context: string;
}

/** How many characters either side of a divergence are shown. */
const CONTEXT_CHARS = 40;

/** One side's characters, with every space removed — see the module note on why. */
function squeezed({ words }: { words: readonly string[] }): string {
  return words.join("");
}

/**
 * Compare what the markdown said with what the rendered PDF says.
 *
 * @param source the markdown's own words, in order
 * @param rendered the words extracted back out of the PDF, in order
 * @returns whether they agree, and where they first do not
 */
export function verifyRender({
  source,
  rendered,
}: {
  source: readonly string[];
  rendered: readonly string[];
}): RenderVerification {
  const left = squeezed({ words: source });
  const right = squeezed({ words: rendered });
  const shortest = Math.min(left.length, right.length);
  let at = -1;
  for (let index = 0; index < shortest; index += 1) {
    if (left.charAt(index) !== right.charAt(index)) {
      at = index;
      break;
    }
  }
  if (at === -1 && left.length === right.length) {
    return { context: "", firstDivergence: -1, matched: true, renderedLength: right.length, sourceLength: left.length };
  }
  const divergence = at === -1 ? shortest : at;
  const before = left.slice(Math.max(0, divergence - CONTEXT_CHARS), divergence);
  // An empty side has run out of text at the divergence, which reads as `<end>` rather than as nothing.
  const markdownAfter = left.slice(divergence, divergence + CONTEXT_CHARS);
  const pdfAfter = right.slice(divergence, divergence + CONTEXT_CHARS);
  return {
    context:
      `… ${before} [markdown: ${markdownAfter === "" ? "<end>" : markdownAfter} ` +
      `| pdf: ${pdfAfter === "" ? "<end>" : pdfAfter}] …`,
    firstDivergence: divergence,
    matched: false,
    renderedLength: right.length,
    sourceLength: left.length,
  };
}
