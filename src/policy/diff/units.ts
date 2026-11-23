/**
 * A policy or evidence document as the units a diff lines up: its front matter, headings, list items, paragraphs,
 * images and fenced blocks, each with its inline markdown and its nesting — plus the text forms a unit is compared
 * and matched by.
 *
 * Pure. The grammar is the subset these documents are written in, not CommonMark: one unit per heading, list item,
 * image line or fence, and a paragraph runs until a blank line. An indented paragraph under a list item keeps that
 * item's depth, so a paragraph split out of a list reads as structure, not as a new thought. The front matter is a
 * unit like any other, so a changed header value is a change the record has to explain.
 */

/** What a unit is. */
type DocUnitKind = "front" | "heading" | "item" | "paragraph" | "image" | "fence";

/** One unit of a document. */
export interface DocUnit {
  readonly kind: DocUnitKind;
  /** A heading's level, 1 to 6; 0 for anything else. */
  readonly level: number;
  /** List nesting: 0 at the margin, one per two spaces of indent. */
  readonly depth: number;
  /**
   * The unit's inline markdown with its marker (`##`, `-`, `1.`) removed; a fence keeps its whole text, and the
   * front matter its YAML body without the `---` fences.
   */
  readonly raw: string;
}

/** A document split into its units. */
export interface DocumentUnits {
  readonly units: readonly DocUnit[];
}

/** A document's front matter: a YAML body between two `---` lines, closed, at the very top. */
export const FRONT_MATTER = /^---\n([\s\S]*?)\n---\n/;
/** A heading's marker, through the one space that ends it; the rest of the line, trimmed, is its text. */
const HEADING = /^(#{1,6})\s/;
/** A list item's indent and marker, through the one space that ends it; the rest, trimmed, is its text. */
const ITEM = /^(\s*)(?:[-*+]|\d+\.)\s/;
/** A line terminator `.` never matches and splitting on `\n` leaves in a line: carriage return, U+2028, U+2029. */
const LINE_TERMINATOR = /[\r\p{Zl}\p{Zp}]/u;
const IMAGE_LINE = /^!\[[^\]]*\]\([^)]*\)\s*$/;
const FENCE = /^\s*(```|~~~)/;

/** The depth an indent of `spaces` spaces means. */
function depthOf({ spaces }: { spaces: number }): number {
  return Math.floor(spaces / 2);
}

/** The count of leading spaces on a line. */
function indentOf({ line }: { line: string }): number {
  const match = /^ */.exec(line);
  if (match === null) {
    return 0;
  }
  return match[0].length;
}

/** A document part-way through being split: the units so far, and the paragraph or fence still open. */
interface UnitScan {
  readonly units: DocUnit[];
  paragraph: { readonly depth: number; readonly lines: string[] } | null;
  fence: { readonly marker: string; readonly lines: string[] } | null;
  lastWasBlank: boolean;
}

/**
 * The text after a heading or item marker, or null when that text holds a line terminator past its leading space
 * (a lone `\r`, U+2028, U+2029): such a line is read as a paragraph, never a heading or item.
 */
function markerText({ line, marker }: { line: string; marker: RegExpExecArray | null }): string | null {
  if (marker === null) {
    return null;
  }
  const rest = line.slice(marker[0].length).trimStart();
  if (LINE_TERMINATOR.test(rest)) {
    return null;
  }
  return rest.trimEnd();
}

/** The unit a line is on its own — a heading, an image or a list item — or null for a line of a paragraph. */
function lineUnit({ line }: { line: string }): DocUnit | null {
  const heading = HEADING.exec(line);
  const headingText = markerText({ line, marker: heading });
  if (headingText !== null) {
    return { depth: 0, kind: "heading", level: heading![1]!.length, raw: headingText };
  }
  if (IMAGE_LINE.test(line.trim())) {
    return { depth: 0, kind: "image", level: 0, raw: line.trim() };
  }
  const item = ITEM.exec(line);
  const itemText = markerText({ line, marker: item });
  if (itemText !== null) {
    return { depth: depthOf({ spaces: item![1]!.length }), kind: "item", level: 0, raw: itemText };
  }
  return null;
}

/** Close the open paragraph, if there is one, into a unit. */
function closeParagraph({ scan }: { scan: UnitScan }): void {
  if (scan.paragraph !== null) {
    scan.units.push({ depth: scan.paragraph.depth, kind: "paragraph", level: 0, raw: scan.paragraph.lines.join(" ") });
    scan.paragraph = null;
  }
}

/** Whether an open fence takes the line, closing into a unit on its closing marker. */
function fenceTakes({ scan, line }: { scan: UnitScan; line: string }): boolean {
  if (scan.fence === null) {
    return false;
  }
  scan.fence.lines.push(line);
  if (line.trim().startsWith(scan.fence.marker)) {
    scan.units.push({ depth: 0, kind: "fence", level: 0, raw: scan.fence.lines.join("\n") });
    scan.fence = null;
  }
  return true;
}

/**
 * A line of running text: the continuation of the list item right above it, or a line of the open paragraph, or the
 * first line of a new one.
 */
function continueText({ scan, line }: { scan: UnitScan; line: string }): void {
  const previous = scan.units.at(-1);
  if (scan.paragraph === null && !scan.lastWasBlank && previous?.kind === "item") {
    scan.units[scan.units.length - 1] = { ...previous, raw: `${previous.raw} ${line.trim()}` };
    return;
  }
  if (scan.paragraph !== null) {
    scan.paragraph.lines.push(line.trim());
  } else {
    scan.paragraph = { depth: depthOf({ spaces: indentOf({ line }) }), lines: [line.trim()] };
  }
  scan.lastWasBlank = false;
}

/** Take one line into the scan. */
function scanLine({ scan, line }: { scan: UnitScan; line: string }): void {
  if (fenceTakes({ line, scan })) {
    return;
  }
  if (line.trim() === "") {
    closeParagraph({ scan });
    scan.lastWasBlank = true;
    return;
  }
  const fenceOpen = FENCE.exec(line);
  if (fenceOpen !== null) {
    closeParagraph({ scan });
    scan.fence = { lines: [line], marker: fenceOpen[1]! };
    scan.lastWasBlank = false;
    return;
  }
  const unit = lineUnit({ line });
  if (unit === null) {
    continueText({ line, scan });
    return;
  }
  closeParagraph({ scan });
  scan.units.push(unit);
  scan.lastWasBlank = false;
}

/**
 * Split a document into its units.
 *
 * @param markdown the whole document
 * @returns the units in document order, the front matter first when there is one
 */
export function documentUnits({ markdown }: { markdown: string }): DocumentUnits {
  const normalised = markdown.replace(/\r\n/g, "\n");
  const front = FRONT_MATTER.exec(normalised);
  const scan: UnitScan = { fence: null, lastWasBlank: true, paragraph: null, units: [] };
  let body = normalised;
  if (front !== null) {
    scan.units.push({ depth: 0, kind: "front", level: 0, raw: front[1]! });
    body = normalised.slice(front[0].length);
  }
  for (const line of body.split("\n")) {
    scanLine({ line, scan });
  }
  closeParagraph({ scan });
  if (scan.fence !== null) {
    scan.units.push({ depth: 0, kind: "fence", level: 0, raw: scan.fence.lines.join("\n") });
  }
  return { units: scan.units };
}

/**
 * A unit's text as a reader sees it: link and image syntax reduced to their text, emphasis and code markers
 * removed, whitespace collapsed. What a record's `match` strings are compared against.
 *
 * @param markdown inline markdown
 * @returns the plain text
 */
export function plainText({ markdown }: { markdown: string }): string {
  return markdown
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*|__|`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * What counts as a word: a run of letters and digits, and every other character that is not whitespace, SOFT
 * punctuation or an emphasis marker. Soft punctuation is the short list a restyle moves without changing what is
 * said — `.`, `,`, `;`, `:`, quotes, dashes, an ellipsis — and a marker is a `*`, a backtick, or an `_` that is not
 * inside a word (`PROD_DB_KEY` keeps its underscores). Soft characters still count where they carry meaning: a dot
 * inside a word or number (`backup.acme.com`, `1.000`), a comma or colon between two digits, and the minus of a signed
 * number. Everything else — `<`, `?`, `!`, `(`, `/`, `#`, `$` — is a word, so `f(x)` becoming `f(x` or `< 30`
 * becoming `> 30` is a change: the list says what may be ignored, never what must be kept.
 */
const WORD =
  /[\p{L}\p{N}]+|(?<=[\p{L}\p{N}])[_.](?=[\p{L}\p{N}])|(?<=\p{N})[,:](?=\p{N})|(?<![\p{L}\p{N}])-(?=\p{N})|[^\s\p{L}\p{N}.,;:'"‘’“”–—…\-*_`]/gu;

/** The words of some visible text, each with where it sits, lowercased; a `−` or a `–` before a number is a minus. */
function wordsIn({ text }: { text: string }): readonly { word: string; index: number }[] {
  const minus = text.replace(/−/g, "-").replace(/(?<![\p{L}\p{N}])–(?=\p{N})/gu, "-");
  return Array.from(minus.matchAll(WORD), (match) => ({
    index: match.index,
    word: match[0].toLowerCase(),
  }));
}

/**
 * The words a unit says, lowercased, with soft punctuation and markup gone ({@link WORD}). Two units saying the same
 * words in the same order are the same content whatever their formatting — the first half of the test for a
 * formatting-only change, the second being what {@link sideTokens} places under each word. It IS that function's
 * words, so the two can never disagree about where a word starts.
 *
 * @param markdown inline markdown
 * @returns the words, in order
 */
export function canonicalWords({ markdown }: { markdown: string }): readonly string[] {
  return sideTokens({ units: [{ depth: 0, kind: "paragraph", level: 0, raw: markdown }] }).tokens.map(
    (token) => token.word,
  );
}

/** One word of a side, where it sits in that side's visible text, the link it is under and the code it is in. */
interface WordToken {
  /** The word as {@link canonicalWords} gives it. */
  readonly word: string;
  readonly start: number;
  readonly end: number;
  /** The address of the link the word is the text of; null outside a link. */
  readonly link: string | null;
  /** Which of {@link SideTokens}'s `code` the word is in; null outside code. */
  readonly code: number | null;
}

/** One side of a row as positioned words, so what sits UNDER each word can be compared word for word. */
export interface SideTokens {
  readonly tokens: readonly WordToken[];
  /** The side's text as a reader sees it: link syntax reduced to its words, code markers gone, all else kept. */
  readonly visible: string;
  /** Every code span's contents, and every fence's and front matter's body, as {@link codeText} reads it, in order. */
  readonly code: readonly string[];
  /** Where each of `code` sits in `visible`, every character of it. */
  readonly codeSpans: readonly { readonly start: number; readonly end: number }[];
  /**
   * Every link or code span that holds no word (`[—](…)`, `` `--` ``), as the count of words before it, what it is and
   * its address or text — so one moved to another phrase, or re-pointed, is a different entry.
   */
  readonly anchors: readonly string[];
  /** Every image, as its caption's words and its address, in order. */
  readonly images: readonly string[];
}

/** A link or image, or a code span, inside a unit's inline markdown. */
const INLINE = /(!?)\[([^\]]*)\]\(([^)\s]*)\)|`([^`]+)`/g;

/**
 * Code as it is compared: every character, with only the space at the end of a line and the blank lines before and
 * after the whole piece gone. Nothing inside counts as layout — indentation re-nests a YAML key or moves a statement
 * into a block, a space splits `/tmp` into `/` and `tmp`, two spaces in `"login  failed"` are part of what a search
 * matches, a tab is a TSV's delimiter, and a blank line ends an HTTP request's headers.
 *
 * @param text a code span's contents, or a fence's or front matter's body
 * @returns the text compared, character for character
 */
export function codeText({ text }: { text: string }): string {
  return text
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/^\n+|\n+$/g, "");
}

/** A fence's body: its lines without the opening and closing markers. */
function fenceBody({ raw }: { raw: string }): string {
  const lines = raw.split("\n").slice(1);
  if (lines.length > 0 && FENCE.test(lines.at(-1)!)) {
    lines.pop();
  }
  return lines.join("\n");
}

/**
 * What some units say that {@link canonicalWords} cannot see, word by word. Words drop every address and most
 * punctuation, so two sides can say the same words while a link was re-pointed or moved to another phrase, a diagram
 * swapped, or `env.prod` became `env-prod` as code was unmarked; keeping the link and code a word sits under, at the
 * word's own position, is what tells them apart.
 *
 * @param units the units of one side of a row
 * @returns the side's words in order with what each sits under, its visible text, its code and its images
 */
export function sideTokens({ units }: { units: readonly DocUnit[] }): SideTokens {
  const side: SideBuild = { anchors: [], code: [], codeSpans: [], images: [], tokens: [], visible: "" };
  for (const unit of units) {
    if (side.visible !== "") {
      side.visible += "\n";
    }
    appendUnit({ side, unit });
  }
  return side;
}

/** A side part-way through being read. */
interface SideBuild {
  readonly tokens: WordToken[];
  readonly code: string[];
  readonly codeSpans: { start: number; end: number }[];
  readonly anchors: string[];
  readonly images: string[];
  visible: string;
}

/** Append some text to a side: its words, under the link and in the code given, and any of those holding no word. */
function appendText({
  side,
  text,
  link,
  inCode,
}: {
  side: SideBuild;
  text: string;
  link: string | null;
  inCode: boolean;
}): void {
  let codeIndex: number | null = null;
  if (inCode) {
    side.code.push(codeText({ text }));
    side.codeSpans.push({ end: side.visible.length + text.length, start: side.visible.length });
    codeIndex = side.code.length - 1;
  }
  const before = side.tokens.length;
  for (const { word, index } of wordsIn({ text })) {
    const start = side.visible.length + index;
    side.tokens.push({ code: codeIndex, end: start + word.length, link, start, word });
  }
  if (inCode && side.tokens.length === before) {
    side.anchors.push(`${String(before)}\u0000code\u0000${codeText({ text })}`);
  }
  if (link !== null && side.tokens.length === before) {
    side.anchors.push(`${String(before)}\u0000link\u0000${link}`);
  }
  side.visible += text;
}

/** Append one link, image or code span found in a unit's inline markdown. */
function appendInline({ side, match }: { side: SideBuild; match: RegExpExecArray }): void {
  if (match[4] !== undefined) {
    appendText({ inCode: true, link: null, side, text: match[4] });
    return;
  }
  if (match[1] === "!") {
    const caption = wordsIn({ text: match[2]! }).map(({ word }) => word);
    side.images.push(`${caption.join(" ")}\u0000${match[3]!}`);
    appendText({ inCode: false, link: null, side, text: match[2]! });
    return;
  }
  appendText({ inCode: false, link: match[3]!, side, text: match[2]! });
}

/** Append one unit: a fence or the front matter as one piece of code, else its inline markdown piece by piece. */
function appendUnit({ side, unit }: { side: SideBuild; unit: DocUnit }): void {
  if (unit.kind === "fence" || unit.kind === "front") {
    const body = unit.kind === "fence" ? fenceBody({ raw: unit.raw }) : unit.raw;
    appendText({ inCode: true, link: null, side, text: codeText({ text: body }) });
    return;
  }
  let cursor = 0;
  for (const match of unit.raw.matchAll(INLINE)) {
    appendText({ inCode: false, link: null, side, text: unit.raw.slice(cursor, match.index) });
    appendInline({ match, side });
    cursor = match.index + match[0].length;
  }
  appendText({ inCode: false, link: null, side, text: unit.raw.slice(cursor) });
}
