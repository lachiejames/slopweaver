/**
 * Reading one policy's markdown into logical blocks — the first of the layout's two passes, split from
 * `layout.ts` so the reading and the placing can each be held in a reader's head.
 *
 * The source is read the way CommonMark reads it — consecutive plain lines are one paragraph, an indented
 * line under a list item continues that item, `>` lines are one quote — and every construct the renderer
 * will not draw is refused by line rather than dropped. The line rules that decide what a line IS (a fence
 * step, an image line, a table separator) are exported, because `verify.ts` must read the markdown the same
 * way the layout drew it for the comparison to mean anything.
 */

/** What the renderer refuses, and why. */
export interface RenderRefusal {
  readonly line: number;
  readonly reason: string;
}

/**
 * One logical block of the source, before wrapping, carrying the line it starts on.
 *
 * @internal
 */
export type SourceBlock =
  | { readonly kind: "heading"; readonly level: number; readonly text: string; readonly line: number }
  | { readonly kind: "paragraph"; readonly depth: number; text: string; readonly line: number }
  | { readonly kind: "item"; readonly marker: string; readonly depth: number; text: string; readonly line: number }
  | { readonly kind: "quote"; text: string; readonly line: number }
  | {
      readonly kind: "table";
      readonly header: readonly string[];
      readonly rows: (readonly string[])[];
      readonly line: number;
      /** Whether the separator row under the header has been read; only that one row is an instruction. */
      separated: boolean;
    }
  | { readonly kind: "fence"; readonly lines: string[]; readonly line: number }
  | { readonly kind: "image"; readonly source: string; readonly line: number };

/** How many leading spaces make one level of list nesting. */
const SPACES_PER_LEVEL = 4;

/**
 * The deepest a list item or its continuation may sit. Each level indents 18pt, and nothing bounded it: past
 * about 26 levels the wrap width went negative and the text was set beyond the page edge, unreadable and
 * unverifiable. Six keeps every level above 340pt of column.
 */
const MAX_LIST_DEPTH = 6;

/** Which markdown constructs this renderer refuses, matched on the line as written. */
const UNSUPPORTED: readonly { readonly test: RegExp; readonly what: string }[] = [
  { test: /^\s*(?:[*+])\s/, what: "a list item written with * or + (use -)" },
  { test: /^\s*(?:---|\*\*\*|___)\s*$/, what: "a horizontal rule" },
  { test: /^\s*~~~/, what: "a code fence written with ~~~ (use ```)" },
];

/**
 * A markdown heading's level and text, or null when the line is not one.
 *
 * String checks rather than `/^(#{1,6})\s+(.*)$/`, because that pattern's `\s+` and `(.*)` can both match
 * a space and the `redos-check` gate refuses it as polynomial backtracking. A policy file's own lines are
 * the input, so this is not theoretical: one pathological line would hang the render.
 */
function headingOf({ raw }: { raw: string }): { level: number; text: string } | null {
  let level = 0;
  while (level < raw.length && raw.charAt(level) === "#") {
    level += 1;
  }
  if (level === 0 || level > 6) {
    return null;
  }
  const rest = raw.slice(level);
  return rest.trimStart().length < rest.length ? { level, text: rest.trim() } : null;
}

/**
 * A `-` list item's text, or null when the line is not one.
 *
 * The same reasoning as {@link headingOf}: `/^-\s+(.*)$/` is polynomial by the same gate's criterion.
 */
function listItemOf({ raw }: { raw: string }): string | null {
  if (!raw.startsWith("-")) {
    return null;
  }
  const rest = raw.slice(1);
  return rest.trimStart().length < rest.length ? rest.trim() : null;
}

/**
 * A numbered list item's number and text, or null when the line is not one. The number is CONTENT — a
 * policy's "part 3" is cited by it — so it is kept as the item's marker rather than renumbered.
 */
function numberedItemOf({ raw }: { raw: string }): { marker: string; text: string } | null {
  let digits = 0;
  while (digits < raw.length && raw.charAt(digits) >= "0" && raw.charAt(digits) <= "9") {
    digits += 1;
  }
  const punctuation = raw.charAt(digits);
  if (digits === 0 || (punctuation !== "." && punctuation !== ")")) {
    return null;
  }
  const rest = raw.slice(digits + 1);
  return rest.trimStart().length < rest.length ? { marker: raw.slice(0, digits + 1), text: rest.trim() } : null;
}

/**
 * One image filling the whole line: alt text with no `]`, then a path with no bracket or space. Each part is
 * a negated class bounded by the literal after it, so it is linear by the `redos-check` criterion — and two
 * images on one line cannot match, since the first path's `)` cannot be consumed by `[^()\s]`.
 */
const WHOLE_LINE_IMAGE = /^!\[[^\]]*\]\(([^()\s]+)\)$/;

/**
 * An image's path when the WHOLE line is exactly one image, or null. `![alt](path)` — the alt text is not
 * drawn, because the figure caption in the surrounding text is what a reader reads. Shared with `verify.ts`,
 * so the line the layout draws as a figure is exactly the line the verification leaves out.
 *
 * @param trimmed the source line, trimmed
 * @returns the image's path, or null when the line is anything other than one image
 */
export function imageSourceOf({ trimmed }: { trimmed: string }): string | null {
  const match = WHOLE_LINE_IMAGE.exec(trimmed);
  return match === null ? null : match[1]!;
}

/**
 * The markdown's source lines, with a CRLF file's carriage returns removed — read the same way by the
 * layout, the undrawable-character check and the verification, so a `\r` is never a character any of the
 * three sees.
 *
 * @param markdown the whole file
 * @returns one entry per source line, line N at index N-1
 */
export function sourceLines({ markdown }: { markdown: string }): readonly string[] {
  return markdown.split("\n").map((row) => (row.endsWith("\r") ? row.slice(0, -1) : row));
}

/**
 * The index of the first line after the front matter — a `---` block of provenance at the top of the
 * file — or 0 when there is none. A leading `---` with no closing one is not front matter, so it is
 * read (and refused as a horizontal rule) rather than swallowing the whole document.
 *
 * @param rows the file's source lines
 * @returns the index of the first body line
 */
export function bodyStart({ rows }: { rows: readonly string[] }): number {
  if (rows[0]?.trim() !== "---") {
    return 0;
  }
  const closing = rows.findIndex((row, index) => index > 0 && row.trim() === "---");
  return closing === -1 ? 0 : closing + 1;
}

/** A table row's cells, with the outer pipes removed and each cell trimmed. */
function cellsOf({ trimmed }: { trimmed: string }): readonly string[] {
  const inner = trimmed.endsWith("|") && trimmed.length > 1 ? trimmed.slice(1, -1) : trimmed.slice(1);
  return inner.split("|").map((cell) => cell.trim());
}

/**
 * Whether a table row is the `|---|:--:|` line under the header, which is an instruction rather than a row.
 *
 * @param trimmed the row as written, trimmed
 * @returns true when every character is a pipe, a dash, a colon or a space
 */
export function isTableSeparator({ trimmed }: { trimmed: string }): boolean {
  return trimmed.startsWith("|") && /^[\s|:-]+$/.test(trimmed) && trimmed.includes("-");
}

/** How deep a list item or continuation sits, from its leading spaces. */
function depthOf({ leading }: { leading: number }): number {
  return Math.ceil(leading / SPACES_PER_LEVEL);
}

/** The state the block reader carries from one source line to the next. */
interface ReaderState {
  readonly blocks: SourceBlock[];
  readonly refusals: RenderRefusal[];
  /** The block a following line may still join, or null once a blank line or a new block closed it. */
  open: SourceBlock | null;
  /** Whether the last block read was a list item, so an indented line after a blank still belongs to it. */
  inList: boolean;
}

/** Refuse a list line nested past {@link MAX_LIST_DEPTH}, reporting whether it was refused. */
function refusedTooDeep({ state, depth, line }: { state: ReaderState; depth: number; line: number }): boolean {
  if (depth <= MAX_LIST_DEPTH) {
    return false;
  }
  state.refusals.push({
    line,
    reason: `a list nested ${String(depth)} levels deep, deeper than the ${String(MAX_LIST_DEPTH)} this renderer sets`,
  });
  return true;
}

/** Start a new block, closing whatever was open. */
function begin({ state, block }: { state: ReaderState; block: SourceBlock }): void {
  state.blocks.push(block);
  state.open = block;
  state.inList = block.kind === "item";
}

/** Join a continuation line onto an open paragraph, item or quote. */
function joinText({ block, text }: { block: { text: string }; text: string }): void {
  block.text = `${block.text} ${text}`;
}

/**
 * Read one table row: the header of a new table, the separator under it, or a body row.
 */
function readTableRow({ state, trimmed, line }: { state: ReaderState; trimmed: string; line: number }): void {
  const open = state.open;
  if (open?.kind === "table") {
    if (!open.separated && open.rows.length === 0 && isTableSeparator({ trimmed })) {
      open.separated = true;
      return;
    }
    open.rows.push(cellsOf({ trimmed }));
    return;
  }
  if (isTableSeparator({ trimmed })) {
    state.refusals.push({ line, reason: "a table separator row with no header row above it is not a table" });
    return;
  }
  begin({ block: { header: cellsOf({ trimmed }), kind: "table", line, rows: [], separated: false }, state });
}

/** Read one `>` line: a continuation of the open quote, or a new one. */
function readQuote({ state, trimmed, line }: { state: ReaderState; trimmed: string; line: number }): void {
  const text = trimmed.slice(1).trim();
  const open = state.open;
  if (open?.kind === "quote") {
    joinText({ block: open, text });
    return;
  }
  begin({ block: { kind: "quote", line, text }, state });
}

/** Read a list item, bulleted or numbered, at the depth its indent gives it. Returns whether it was one. */
function readListItem({
  state,
  trimmed,
  leading,
  line,
}: {
  state: ReaderState;
  trimmed: string;
  leading: number;
  line: number;
}): boolean {
  const depth = depthOf({ leading });
  const bullet = listItemOf({ raw: trimmed });
  const numbered = numberedItemOf({ raw: trimmed });
  if ((bullet !== null || numbered !== null) && refusedTooDeep({ depth, line, state })) {
    return true;
  }
  if (bullet !== null) {
    begin({ block: { depth, kind: "item", line, marker: "•", text: bullet }, state });
    return true;
  }
  if (numbered !== null) {
    begin({ block: { depth, kind: "item", line, marker: numbered.marker, text: numbered.text }, state });
    return true;
  }
  return false;
}

/** Read a line that is plain text: a continuation of what is open, or a new paragraph. */
function readPlain({
  state,
  trimmed,
  leading,
  line,
}: {
  state: ReaderState;
  trimmed: string;
  leading: number;
  line: number;
}): void {
  const open = state.open;
  const joinable = open !== null && (open.kind === "paragraph" || open.kind === "item" || open.kind === "quote");
  if (joinable) {
    joinText({ block: open, text: trimmed });
    return;
  }
  if (state.inList && leading > 0) {
    const depth = Math.max(1, depthOf({ leading }));
    if (refusedTooDeep({ depth, line, state })) {
      return;
    }
    begin({ block: { depth, kind: "paragraph", line, text: trimmed }, state });
    state.inList = true;
    return;
  }
  if (leading >= SPACES_PER_LEVEL) {
    state.refusals.push({ line, reason: "an indented code block is not one of the constructs this renderer supports" });
    return;
  }
  begin({ block: { depth: 0, kind: "paragraph", line, text: trimmed }, state });
}

/** Why a line is refused before it is read as any block, or null when it is not. */
function refusalOf({ raw, trimmed }: { raw: string; trimmed: string }): string | null {
  const unsupported = UNSUPPORTED.find((entry) => entry.test.test(raw));
  if (unsupported !== undefined) {
    return `${unsupported.what} is not one of the constructs this renderer supports`;
  }
  if (imageSourceOf({ trimmed }) === null && trimmed.includes("![")) {
    return "an image inside a line of text is not one this renderer can draw";
  }
  return null;
}

/** Read one source line outside a fence and outside the front matter. */
function readLine({ state, raw, line }: { state: ReaderState; raw: string; line: number }): void {
  const trimmed = raw.trim();
  if (trimmed === "") {
    state.open = null;
    return;
  }
  const refused = refusalOf({ raw, trimmed });
  if (refused !== null) {
    state.refusals.push({ line, reason: refused });
    return;
  }
  const leading = raw.length - raw.trimStart().length;
  const image = imageSourceOf({ trimmed });
  const heading = leading < SPACES_PER_LEVEL ? headingOf({ raw: trimmed }) : null;
  if (image !== null) {
    begin({ block: { kind: "image", line, source: image }, state });
  } else if (heading !== null) {
    begin({ block: { kind: "heading", level: heading.level, line, text: heading.text }, state });
  } else if (trimmed.startsWith("|")) {
    readTableRow({ line, state, trimmed });
  } else if (trimmed.startsWith(">")) {
    readQuote({ line, state, trimmed });
  } else if (!readListItem({ leading, line, state, trimmed })) {
    readPlain({ leading, line, state, trimmed });
  }
}

/**
 * What one source line does to a fenced block, by CommonMark's rule: a run of three or more backticks opens
 * a fence and may carry an info string with no backtick in it; only a line that is NOTHING but a run at least
 * as long as the opening one closes it. Any other line inside the fence is the fence's own content — so a
 * line of three backticks then text, or a shorter fence quoted inside a longer one, is drawn rather than read as the end.
 * Shared with `verify.ts`, so both sides agree on exactly which lines a fence holds.
 *
 * @param trimmed the source line, trimmed
 * @param openTicks the length of the open fence's backtick run, or 0 outside a fence
 * @returns open (with its run length), close, content inside a fence, inline (refused), or text outside one
 */
export function fenceStep({ trimmed, openTicks }: { trimmed: string; openTicks: number }): FenceStep {
  let ticks = 0;
  while (ticks < trimmed.length && trimmed.charAt(ticks) === "`") {
    ticks += 1;
  }
  if (openTicks > 0) {
    return ticks >= openTicks && ticks === trimmed.length ? { kind: "close" } : { kind: "content" };
  }
  if (ticks < 3) {
    return { kind: "text" };
  }
  return trimmed.slice(ticks).includes("`") ? { kind: "inline" } : { kind: "open", ticks };
}

/** What {@link fenceStep} decided about one line. */
export type FenceStep =
  | { readonly kind: "open"; readonly ticks: number }
  | { readonly kind: "close" }
  | { readonly kind: "content" }
  | { readonly kind: "inline" }
  | { readonly kind: "text" };

/**
 * Read the markdown into logical blocks, collecting every construct refused on the way.
 *
 * Front matter — a `---` block of provenance at the top of the file — is skipped rather than rendered: it
 * is for whoever edits the markdown, and putting it into the PDF would put tooling metadata into a
 * compliance document.
 *
 * @param markdown the markdown file's whole contents
 * @returns the blocks in source order, and every refusal met on the way
 */
export function readBlocks({ markdown }: { markdown: string }): {
  blocks: readonly SourceBlock[];
  refusals: readonly RenderRefusal[];
} {
  const rows = sourceLines({ markdown });
  const state: ReaderState = { blocks: [], inList: false, open: null, refusals: [] };
  let fence: { readonly kind: "fence"; readonly lines: string[]; readonly line: number } | null = null;
  let openTicks = 0;
  for (let index = bodyStart({ rows }); index < rows.length; index += 1) {
    const raw = rows[index]!;
    const step = fenceStep({ openTicks, trimmed: raw.trim() });
    if (step.kind === "inline") {
      state.refusals.push({
        line: index + 1,
        reason: "a line that opens and closes ``` itself is not one of the constructs this renderer supports",
      });
    } else if (step.kind === "open") {
      fence = { kind: "fence", line: index + 1, lines: [] };
      openTicks = step.ticks;
      begin({ block: fence, state });
    } else if (step.kind === "close") {
      fence = null;
      openTicks = 0;
      state.open = null;
    } else if (fence !== null) {
      fence.lines.push(raw);
    } else {
      readLine({ line: index + 1, raw, state });
    }
  }
  return { blocks: state.blocks, refusals: state.refusals };
}

/**
 * Every line carrying a character the emitter's fonts cannot draw, refused by line.
 *
 * The standard PDF faces encode WinAnsi only, and `pdf-lib` THROWS on anything outside it — mid-draw, after
 * the measuring pass had already thrown first, so a box-drawing diagram crashed the verb rather than being
 * named. This runs before layout and names the character and the line, so the fix is one edit.
 *
 * @param markdown the whole file, front matter included
 * @param drawable the code points every face the emitter uses can encode
 * @returns one refusal per line that carries at least one undrawable character
 */
export function undrawableCharacters({
  markdown,
  drawable,
}: {
  markdown: string;
  drawable: ReadonlySet<number>;
}): readonly RenderRefusal[] {
  const rows = sourceLines({ markdown });
  const refusals: RenderRefusal[] = [];
  for (let index = bodyStart({ rows }); index < rows.length; index += 1) {
    const raw = rows[index]!;
    for (const character of raw) {
      const code = character.codePointAt(0)!;
      if (!drawable.has(code)) {
        const hex = code.toString(16).toUpperCase().padStart(4, "0");
        refusals.push({
          line: index + 1,
          reason: `${JSON.stringify(character)} (U+${hex}) is a character the PDF's standard fonts cannot draw`,
        });
        break;
      }
    }
  }
  return refusals;
}
