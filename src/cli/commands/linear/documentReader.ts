/**
 * A Linear document's stored markdown as a READER sees it, one block at a time — what an inline comment's quote
 * is checked against before the door sends it.
 *
 * It renders the markdown with micromark and its GFM extensions and reads the HTML that draws, rather than
 * re-deriving CommonMark with regexes. Three fallback review passes (r1–r3 on the pull request that added document
 * comments) each broke a hand-written reader on a construct the next one had not modelled: a table row, a bracketed
 * link label, a URL holding a parenthesis, a thematic break. A parser answers every one of those the way a renderer
 * does, so the class closes rather than the instance.
 *
 * Every choice past the parser leans the same way: text whose visibility is uncertain is NOT readable, so an unusual
 * construct costs a refused quote, never a quote anchored to something a reader cannot see.
 *
 *  - A BLOCK is a paragraph, heading, list item, table cell, code block or definition term. A quote must sit inside
 *    one, since an inline comment anchors to a selection within one block.
 *  - A LINE is the unit inside a block: a soft break and a code block's line ending both split one, since whether
 *    Linear draws a soft break as a space or a new line is not something this reader can see (fallback review r4).
 *  - Text is kept EXACTLY as it draws — no whitespace collapsed — so a quote that matches is a quote the content
 *    holds, and it is sent as matched (r4: a collapsed quote anchored across a double space it did not carry).
 *  - An image, a line break, a rule, a footnote mark and any element outside the sets below read as a BREAK: nothing
 *    on either side of one can be quoted across it. An autolink and a code span's line ending are breaks before any
 *    HTML is drawn — {@link BREAK_UNREADABLE} says why. A link definition draws nothing at all.
 *  - A document holding raw HTML anywhere, a comment included, has no readable runs — {@link RAW_HTML} says why.
 *  - Linear's `+++ Title` collapsible marker is stripped from a line of block text AFTER parsing, so a `+++` line
 *    inside a code block stays the code it is (r4: a diff's `+++ b/…` header was read as a collapsible title).
 *  - A markdown mark CommonMark left standing in prose — `*`, `_`, `~`, `|`, a backtick, a backslash — reads as a
 *    BREAK unless the content escaped it: Linear's own parser pairs marks CommonMark cannot, so whether it draws one
 *    is not visible here (r13: 40 of 384 readable corpus documents held an unpaired `**` or `~~`). {@link ESCAPED}.
 */
import { micromark, type Options, parse, postprocess, preprocess } from "micromark";
import { gfm, gfmHtml } from "micromark-extension-gfm";
// Its declarations name the `literalAutolink*` token types that `BREAK_UNREADABLE` handles; `gfm()` already loads it.
import "micromark-extension-gfm-autolink-literal";
import { parseFragment } from "parse5";

import { childrenOf, type Element, isElement, type Node } from "../../../prformat/drawnNodes.js";

/** The elements that hold one block of text a reader can select within. */
const BLOCKS = new Set(["caption", "dd", "dt", "h1", "h2", "h3", "h4", "h5", "h6", "li", "p", "pre", "td", "th"]);

/** The elements markdown draws that only group blocks, holding no text of their own. */
const GROUPS = new Set(["blockquote", "ol", "table", "tbody", "thead", "tr", "ul"]);

/** The inline elements markdown draws whose text a reader reads straight through. */
const INLINE = new Set(["a", "code", "del", "em", "strong"]);

/** The one inline element markdown draws that carries no text: a task list's checkbox. */
const SILENT = new Set(["input"]);

/**
 * The character a break reads as. It is a private-use code point, and blocks are split on it before any quote is
 * compared, so no quote can match across one whatever it holds.
 */
const BREAK = "\u{E000}";

/**
 * Marks raw HTML anywhere in the document, which then anchors NO quote at all. What raw HTML hides has no boundary
 * this reader can find: text between two tags (`<style>`, `<span hidden>`, fallback review r6), an element left
 * open into every block after it, a comment or `<script>` a container ends early while a browser keeps it open
 * (r7), and a `<style>` that hides text ABOVE it. Linear's own editor escapes a typed `<`, so only content written
 * through the API carries any, and a refused quote there costs a top-level comment instead.
 */
const RAW_HTML = "\u{E001}";

/**
 * Marks a character the content escaped (`\*`, `\|`), which every renderer draws as itself. It is dropped once a
 * text node is read; what it marks is the one kind of markdown mark that survives into a readable run.
 */
const ESCAPED = "\u{E002}";

/** A markdown mark left standing in prose that the content did not escape — see the file overview. */
const UNESCAPED_MARK = /(?<!\u{E002})[*_~|`\\]/gu;

/**
 * An unescaped `|` in prose, kept apart from other breaks until its line is judged — see `blockLines` — and then read
 * as a break like any other mark.
 */
const PIPE = "\u{E003}";

/** A list, task, heading or quote marker anywhere in a cell line, which Linear draws as that block. */
const CELL_MARKER = /(?:[-+]|\d{1,9}[.)]|#{1,6}|>|\[[ xX]\])(?=[ \t]|$)/gu;

/** {@link ESCAPED} as it lands in a link's address, percent-encoded. */
const ENCODED_ESCAPE = "%EE%80%82";

/** A character reference decoding to one of this reader's own markers, which must never come from the content. */
const MARKER_REFERENCE = /&#(?:x0*e00[0-2]|0*5734[4-6]);/iu;

/** A line holding only a task box, which Linear draws as a checkbox rather than as text (fallback review r14). */
const LONE_TASK_BOX = /^[ \t]*\[[ xX]\][ \t]*$/;

/** A line ending in drawn text: a soft break in a paragraph, or a line of a code block — Unicode's own included. */
const LINE_ENDING = /\r\n|[\n\r\v\f\x85\p{Zl}\p{Zp}]/u;

/** A line ending as micromark counts lines. */
const MICROMARK_LINE_ENDING = /\r\n|\r|\n/u;

/** A code line starting with three backticks, which Linear writes inside a plain three-backtick fence as it is. */
const FENCE_LIKE = /^\s*`{3,}/u;

/** A blank line, a block quote's included. */
const BLANK_LINE = /^[\s>]*$/u;

/** A list item's line, capturing what sits left of its marker. */
const LIST_ITEM = /^([\s>]*)(?:[-*+]|\d{1,9}[.)])[ \t]/u;

/** A line ending, or a {@link BREAK}: either one starts a fresh line for Linear's line markers. */
const LINE_OR_BREAK = /\r\n|[\n\r\v\f\x85\p{Zl}\p{Zp}\u{E000}]/u;

/**
 * Text shaped like a character reference, a backslash before it included. A cell's code span keeps one as written,
 * and Linear writes a cell's own newline as `&#10;`, so what the page draws there is uncertain (fallback review r19).
 */
const REFERENCE_SHAPED = /\\?&(?:#\d+|#[xX][\da-fA-F]+|[A-Za-z][A-Za-z\d]*);/gu;

/** Linear's collapsible marker at the start of a line: `+++` alone, or `+++` then a space and a title. */
const COLLAPSIBLE = /^[ \t]*\+\+\+(?:[ \t]|$)/;

/**
 * A heading opener at the start of a collapsible's title. Linear stores a heading title as `+++ ### Title` and draws
 * it as a heading, so the `#` marks are not text a reader sees (fallback review r11). Where the rest of that heading
 * ends is not visible here, so the whole title is unreadable rather than guessed at.
 */
const HEADING_TITLE = /^[ \t]*#{1,6}(?:[ \t]|$)/;

/** The micromark tokens for a shape Linear's editor never writes: a link reference definition, an indented code block. */
const UNWRITTEN_BY_LINEAR = new Set<string>(["codeIndented", "definition"]);

/** The elements that are one table cell. */
const CELLS = new Set(["td", "th"]);

/** One block's drawn text, read whole before any of its lines is judged. */
type Block = { tag: string; text: string };

/** micromark's parse events for one document. */
type Events = ReturnType<typeof postprocess>;

/** One micromark HTML extension, the shape `htmlExtensions` takes. */
type HtmlExtension = NonNullable<Options["htmlExtensions"]>[number];

/**
 * Where micromark would draw something this reader cannot vouch for, it draws a BREAK instead. Judged on micromark's
 * own TOKENS, before any HTML exists, because every earlier attempt judged the drawn HTML and lost the case the
 * HTML no longer showed (fallback review r5):
 *
 *  - Raw HTML, inline or block, marks {@link RAW_HTML}. Passed through, a tag the HTML parser DISCARDS
 *    (`foo<input>bar`, `</em\n>`) joined the text on its two sides; escaped, it would read as literal tag text Linear
 *    may not draw.
 *  - An autolink, `<url>` or a bare URL GFM links. Linear draws a URL to its own objects as a chip rather than as its
 *    text, and comparing a link's text to its percent-encoded address missed every URL with an encoded character.
 *  - A character reference, `&amp;` or `&#10;`. Linear keeps what its author typed, so the page may show the
 *    reference itself rather than the character it names (fallback review r18).
 *  - The one space CommonMark strips from each edge of a code span, `` ` && ` ``. Linear draws a code mark's text as
 *    typed, so the page may keep it (fallback review r20).
 *  - A line ending inside a code span. CommonMark draws it as a space, and whether Linear does is not visible here,
 *    exactly as with a paragraph's soft break. The rest of this handler is micromark's own `onexitlineending`,
 *    unchanged; `documentReader.test.ts` pins the soft break and the code block it also handles.
 */
const BREAK_UNREADABLE = {
  exit: {
    autolinkEmail() {
      this.raw(BREAK);
    },
    autolinkProtocol() {
      this.raw(BREAK);
    },
    characterEscapeValue(token) {
      this.raw(ESCAPED + this.encode(this.sliceSerialize(token)));
    },
    characterReferenceValue() {
      this.raw(BREAK);
    },
    codeTextPadding() {
      this.raw(BREAK);
    },
    htmlFlowData() {
      this.raw(RAW_HTML);
    },
    htmlTextData() {
      this.raw(RAW_HTML);
    },
    lineEnding(token) {
      if (this.getData("slurpAllLineEndings")) {
        return;
      }
      if (this.getData("slurpOneLineEnding")) {
        this.setData("slurpOneLineEnding");
        return;
      }
      if (this.getData("inCodeText")) {
        this.raw(BREAK);
        return;
      }
      this.raw(this.encode(this.sliceSerialize(token)));
    },
    literalAutolinkEmail() {
      this.raw(BREAK);
    },
    literalAutolinkHttp() {
      this.raw(BREAK);
    },
    literalAutolinkWww() {
      this.raw(BREAK);
    },
  },
} satisfies HtmlExtension;

/**
 * A block's drawn text as its lines, each an unbroken run; outside a code block, a collapsible marker is dropped. A
 * line of a table cell — or of prose holding an unescaped `|`, a row the parser stopped reading as a table — has each
 * block marker read as a break WHEREVER it sits: Linear exports a cell's blocks with nothing between them
 * (`pattern for:1. Pause`), and draws a list, heading, quote or task box there, so the marker is not text
 * (fallback reviews r13, r15). The pipe is judged per DOCUMENT — `stranded` — since a broken row's later paragraphs
 * hold no pipe of their own (r16, r17), and the collapsible marker is read first, so the cell rule never eats a `+`
 * of `+++` (r16). In a cell, reference-shaped text is a break, and a break starts a line as a newline does, since a
 * `&#10;` Linear wrote there is one (r19).
 */
function blockLines({ tag, text, stranded }: Block & { stranded: boolean }): string {
  if (tag === "pre") {
    return text.split(LINE_ENDING).join(BREAK);
  }
  if (CELLS.has(tag) || stranded) {
    return text
      .replace(REFERENCE_SHAPED, BREAK)
      .split(LINE_OR_BREAK)
      .map((line) => drawnLine({ line }).replace(CELL_MARKER, BREAK).replaceAll(PIPE, BREAK))
      .join(BREAK);
  }
  return text
    .split(LINE_ENDING)
    .map((line) => drawnLine({ line }))
    .join(BREAK);
}

/** A line with Linear's collapsible marker dropped; a title drawn as a heading, or a lone task box, reads as nothing. */
function drawnLine({ line }: { line: string }): string {
  if (LONE_TASK_BOX.test(line)) {
    return "";
  }
  if (!COLLAPSIBLE.test(line)) {
    return line;
  }
  const title = line.replace(COLLAPSIBLE, "");
  if (HEADING_TITLE.test(title)) {
    return "";
  }
  return title;
}

/** Read every child of a node into the same buffer. */
function readChildren({ node, into, blocks }: { node: Node; into: string[]; blocks: Block[] }): void {
  for (const child of childrenOf({ node })) {
    read({ blocks, into, node: child });
  }
}

/**
 * Whether a code block's language is one Linear draws as a picture rather than as its code — a mermaid block is a
 * diagram, so its source is not text a reader can select (fallback review r8). Compared case-blind and as a prefix
 * (`mermaid{x}`, r9), since which spellings Linear accepts is not visible here and a wider match only refuses more.
 */
function drawnAsDiagram({ element }: { element: Element }): boolean {
  return element.attrs.some(
    (attr) =>
      attr.name === "class" &&
      attr.value
        .toLowerCase()
        .split(/\s+/)
        .some((name) => name.startsWith("language-mermaid")),
  );
}

/**
 * Whether a link points at Linear itself — an issue, project, document, review or uploaded file. Linear stores its
 * own object mentions as a labelled link, `[CCCC-1044](https://linear.app/…)`, and draws one as a chip rather than
 * as its label (fallback review r10), so the label is not text a reader can select.
 */
function drawnAsChip({ element }: { element: Element }): boolean {
  return element.attrs.some((attr) => {
    if (attr.name !== "href") {
      return false;
    }
    // An escape in the destination (`linear\.app`, `https\:`) leaves the escape marker encoded in the address or
    // empties it, so the host is not knowable here and the link may still be a chip (fallback review r14).
    if (attr.value === "" || attr.value.includes(ENCODED_ESCAPE)) {
      return true;
    }
    if (!URL.canParse(attr.value)) {
      return false;
    }
    const host = new URL(attr.value).hostname.toLowerCase();
    return host === "linear.app" || host.endsWith(".linear.app");
  });
}

/** A code element's text, verbatim: code draws every character it holds. */
function codeText({ element }: { element: Element }): string {
  return childrenOf({ node: element })
    .map((child) => ("value" in child ? child.value : ""))
    .join("");
}

/**
 * Whether an inline code span holds `~~` or a backtick. Linear stores struck-through code as `` ~~`~~Name~~`~~ ``,
 * putting its strike marks INSIDE the backticks (fallback review r12), and two spans side by side as one holding
 * ` `` ` (r13); either draws as something other than the span's text. A code block always ends in a line ending, a
 * span never does, so only a span is judged.
 */
function markedCode({ element }: { element: Element }): boolean {
  const text = codeText({ element });
  return !text.includes("\n") && (text.includes("~~") || text.includes("`"));
}

/** Whether an element draws as something other than its own text: a diagram, a chip or a mark. */
function drawnAsOther({ element }: { element: Element }): boolean {
  if (element.tagName === "code") {
    return drawnAsDiagram({ element }) || markedCode({ element });
  }
  return element.tagName === "a" && drawnAsChip({ element });
}

/** Read one element: a block closes into `blocks`, a group is bracketed by breaks, inline text reads through. */
function readElement({ element, into, blocks }: { element: Element; into: string[]; blocks: Block[] }): void {
  const tag = element.tagName;
  if (drawnAsOther({ element })) {
    into.push(BREAK);
    return;
  }
  if (tag === "code") {
    into.push(codeText({ element }));
    return;
  }
  if (BLOCKS.has(tag)) {
    const own: string[] = [];
    readChildren({ blocks, into: own, node: element });
    blocks.push({ tag, text: own.join("") });
    into.push(BREAK);
    return;
  }
  if (GROUPS.has(tag)) {
    into.push(BREAK);
    readChildren({ blocks, into, node: element });
    into.push(BREAK);
    return;
  }
  if (INLINE.has(tag)) {
    readChildren({ blocks, into, node: element });
    return;
  }
  if (!SILENT.has(tag)) {
    into.push(BREAK);
  }
}

/** Read one node into the text of the block it sits in, closing a nested block into `blocks` as it ends. */
function read({ node, into, blocks }: { node: Node; into: string[]; blocks: Block[] }): void {
  if (node.nodeName === "#text" && "value" in node) {
    // Prose only: a code element's text is read verbatim by `readElement` and never reaches here.
    into.push(node.value.replace(UNESCAPED_MARK, (mark) => (mark === "|" ? PIPE : BREAK)).replaceAll(ESCAPED, ""));
    return;
  }
  if (isElement(node)) {
    readElement({ blocks, element: node, into });
    return;
  }
  // A fragment holds the whole document; raw HTML, comments included, never reaches the parse.
  readChildren({ blocks, into, node });
}

/** A reader's characters: a quote may start and end only between two of them. */
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * Something a reader can see: not whitespace, not a control, and not a format or default-ignorable character — a
 * zero-width space, a variation selector, a Hangul filler — which Unicode draws as nothing (fallback review r9).
 */
const VISIBLE = /[^\p{White_Space}\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/u;

/** Whether a run holds the quote starting and ending between two characters a reader sees — never mid-character. */
function holdsWhole({ run, quote }: { run: string; quote: string }): boolean {
  const boundaries = new Set([...GRAPHEMES.segment(run)].map((segment) => segment.index));
  boundaries.add(run.length);
  for (let at = run.indexOf(quote); at !== -1; at = run.indexOf(quote, at + 1)) {
    if (boundaries.has(at) && boundaries.has(at + quote.length)) {
      return true;
    }
  }
  return false;
}

/**
 * Whether a reader could select exactly this quote in the document (fallback review r8): well-formed Unicode, since a
 * lone surrogate cannot survive the wire; at least one visible character, since a zero-width space alone selects
 * nothing; no whitespace at either end, since where a drawn run's edge falls — after a task box, beside a cell border —
 * is not visible here (fallback review r14); and held by one run starting and ending on character boundaries, so half
 * of `é` or of a flag is refused.
 *
 * @param content the document's stored markdown
 * @param quote the passage as it will be sent
 * @returns true when one readable run holds the quote whole
 */
export function readerHolds({ content, quote }: { content: string; quote: string }): boolean {
  if (!quote.isWellFormed() || !VISIBLE.test(quote) || quote.trim() !== quote) {
    return false;
  }
  return drawnRuns({ content }).some((run) => holdsWhole({ quote, run }));
}

/**
 * Every readable run EXACTLY as it draws — untrimmed, because a space a combining mark follows draws as one character
 * with it, and a run trimmed of that space puts a character boundary where the reader has none (fallback review r9).
 * A run with nothing visible is dropped.
 */
function drawnRuns({ content }: { content: string }): readonly string[] {
  // Carried by the content itself, literally or as a character reference, the escape marker would let a mark through
  // as escaped, so the document reads as nothing (fallback review r14).
  if (content.includes(ESCAPED) || MARKER_REFERENCE.test(content)) {
    return [];
  }
  // Single-tilde strikethrough off: whether Linear pairs `~x~` is not visible here, and a stray `~` is a break (r14).
  const extensions = [gfm({ singleTilde: false })];
  // A shape Linear's editor never writes, so what it draws for one is not visible here, and the document reads as
  // nothing: a link reference definition, which draws every matching `[label]` without its brackets (fallback review
  // r21), and an indented code block, which draws a paragraph's escapes and marks verbatim (r22).
  const events = postprocess(
    parse({ extensions })
      .document()
      .write(preprocess()(content, undefined, true)),
  );
  if (events.some(([, token]) => UNWRITTEN_BY_LINEAR.has(token.type))) {
    return [];
  }
  // Linear fences a code block in three backticks whatever its text holds, so a code line of backticks is a fence
  // here, and which fence closes which block is not visible (fallback review r23).
  if (fenceInDoubt({ content, events })) {
    return [];
  }
  // BREAK_UNREADABLE last, so its handlers replace GFM's own for the same tokens.
  const html = micromark(content, { extensions, htmlExtensions: [gfmHtml(), BREAK_UNREADABLE] });
  // A marker the content itself carries lands here too, and only ever makes less of the document readable.
  if (html.includes(RAW_HTML)) {
    return [];
  }
  const blocks: Block[] = [];
  const loose: string[] = [];
  read({ blocks, into: loose, node: parseFragment(html) });
  const all = [...blocks, { tag: "", text: loose.join("") }];
  const stranded = all.some((block) => block.text.includes(PIPE));
  return all.flatMap((block) => blockLines({ ...block, stranded }).split(BREAK)).filter((run) => VISIBLE.test(run));
}

/**
 * Whether any fenced code block may pair its fences differently from how Linear wrote them. Linear closes every block,
 * writes none empty, and sets each apart from its neighbours by a blank line or a list item, so a block that is
 * unclosed, empty, holds a line starting with three backticks, or touches any other line of text is in doubt. What
 * stays unseen is a code line of backticks with a blank line on both sides, byte-identical to a real fence.
 */
function fenceInDoubt({ content, events }: { content: string; events: Events }): boolean {
  const lines = content.split(MICROMARK_LINE_ENDING);
  return events.some(([kind, token], index) => {
    if (kind !== "enter" || token.type !== "codeFenced") {
      return false;
    }
    const end = events.findIndex(([closing, closed], at) => at > index && closing === "exit" && closed === token);
    const entered = events.slice(index, end).filter(([inner]) => inner === "enter");
    const fences = entered.filter(([, inner]) => inner.type === "codeFencedFence").length;
    const values = entered.filter(([, inner]) => inner.type === "codeFlowValue");
    const backticked = values.some(([, inner, context]) => FENCE_LIKE.test(context.sliceSerialize(inner)));
    const apart = [lines[token.start.line - 2], lines[token.end.line]].every(
      (line) => line === undefined || setsApart({ column: token.start.column, line }),
    );
    return fences < 2 || values.length === 0 || backticked || !apart;
  });
}

/**
 * Whether a line beside a fence sets its block apart as Linear writes one: blank, or a list item whose marker sits left
 * of the fence — the item the block belongs to, or one that ends it. A code line of the block itself carries the
 * block's own indent, so its marker never sits left of the fence (fallback review r24).
 */
function setsApart({ column, line }: { column: number; line: string }): boolean {
  if (BLANK_LINE.test(line)) {
    return true;
  }
  const item = LIST_ITEM.exec(line);
  return item !== null && item[1]!.length + 1 < column;
}

/**
 * Every run of text a reader can select within in a document, in document order, trimmed of the whitespace at its
 * two ends for display. The quote check reads the untrimmed runs, so a trimmed end never shifts a character boundary.
 *
 * @param content the document's stored markdown
 * @returns the readable runs, trimmed
 */
export function readerRuns({ content }: { content: string }): readonly string[] {
  return drawnRuns({ content }).map((run) => run.trim());
}
