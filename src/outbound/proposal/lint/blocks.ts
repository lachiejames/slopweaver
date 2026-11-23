/**
 * The ordered-block model behind the structure detectors, and the markdown parser that produces it.
 *
 * Separate from the renderer on purpose. `proposal lint` runs over a markdown FILE, which is usually
 * `proposal draft`'s output but may equally be a draft a person edited by hand — the whole point of writing
 * the draft to disk is that it can be edited. So the linter reads blocks out of text rather than trusting a
 * form, and stays honest about a document nobody rendered.
 *
 * Pure: text in, blocks out. No I/O.
 */

/** The block kinds the golden shape uses. Anything else is prose. */
type ProposalBlockType =
  "heading" | "paragraph" | "blockquote" | "image" | "table" | "code" | "list" | "toc" | "toggle-open" | "toggle-close";

/** One ordered block, with the line it started on so a finding can point at it. */
export interface ProposalBlock {
  readonly type: ProposalBlockType;
  readonly text: string;
  /** 1-indexed line the block starts on. */
  readonly line: number;
}

const IMAGE_LINE = /^!\[[^\]]*\]\([^)]*\)\s*$/;
const HEADING_LINE = /^(#{1,6})\s+/;
const TOC_LINE = /^<table_of_contents\b/i;
const DETAILS_OPEN = /^<details>\s*$/i;
const DETAILS_CLOSE = /^<\/details>\s*$/i;
const SUMMARY_LINE = /^<summary>(.*)<\/summary>\s*$/i;

/** The run kinds whose consecutive lines collapse into ONE block. */
const RUN_MATCHERS: readonly (readonly [ProposalBlockType, RegExp])[] = [
  ["blockquote", /^\s*>/],
  ["table", /^\s*\|/],
  ["list", /^\s*(?:[-*+]|\d+\.)\s+/],
];

/** Which run kind a line opens, or nothing. */
function runTypeFor({ line }: { line: string }): ProposalBlockType | undefined {
  return RUN_MATCHERS.find(([, matcher]) => matcher.test(line))?.[0];
}

/** Accumulated parser state, so the walk stays one short loop. */
interface Parse {
  readonly blocks: ProposalBlock[];
  buffer: string[];
  bufferLine: number;
  /** Whether a summary line opening no toggle is kept as a paragraph rather than dropped. */
  readonly keepStraySummary: boolean;
}

/** Flush the buffered prose lines into one paragraph block. */
function flush({ parse }: { parse: Parse }): void {
  const text = parse.buffer.join("\n").trim();
  parse.buffer = [];
  if (text.length > 0) {
    parse.blocks.push({ line: parse.bufferLine, text, type: "paragraph" });
  }
}

/** Consume a fenced code block, returning the index of its closing fence. */
function collectFence({ lines, start, parse }: { lines: readonly string[]; start: number; parse: Parse }): number {
  let at = start + 1;
  const body: string[] = [lines[start]!];
  while (at < lines.length && !lines[at]!.startsWith("```")) {
    body.push(lines[at]!);
    at += 1;
  }
  parse.blocks.push({ line: start + 1, text: body.join("\n"), type: "code" });
  return at;
}

/** Consume a run of same-kind lines, returning the index of its last line. The buffer is already flushed. */
function collectRun({
  lines,
  start,
  type,
  parse,
}: {
  lines: readonly string[];
  start: number;
  type: ProposalBlockType;
  parse: Parse;
}): number {
  // `!` rather than a guard inside the loop: `collectRun` is only ever reached through `runTypeFor`, which
  // returns a type BECAUSE its matcher matched, so an absent matcher here is unreachable by construction.
  const matcher = RUN_MATCHERS.find(([kind]) => kind === type)![1];
  const run: string[] = [];
  let at = start;
  while (at < lines.length && matcher.test(lines[at]!)) {
    run.push(lines[at]!);
    at += 1;
  }
  parse.blocks.push({ line: start + 1, text: run.join("\n").trim(), type });
  return at - 1;
}

/** The single-line block openers, tested before the buffer is flushed so prose keeps accumulating. */
const SINGLE_LINE = [HEADING_LINE, TOC_LINE, IMAGE_LINE, DETAILS_OPEN, DETAILS_CLOSE, SUMMARY_LINE] as const;

/** Whether a line opens a single-line block rather than continuing a paragraph. */
function isSingleLineBlock({ line }: { line: string }): boolean {
  return SINGLE_LINE.some((matcher) => matcher.test(line.trim()));
}

/** Push the block a single-line opener names. The caller has already flushed the paragraph buffer. */
function singleLineBlock({ line, at, parse }: { line: string; at: number; parse: Parse }): void {
  const trimmed = line.trim();
  if (HEADING_LINE.test(line)) {
    parse.blocks.push({ line: at + 1, text: line.replace(HEADING_LINE, "").trim(), type: "heading" });
    return;
  }
  if (TOC_LINE.test(trimmed)) {
    parse.blocks.push({ line: at + 1, text: trimmed, type: "toc" });
    return;
  }
  if (IMAGE_LINE.test(trimmed)) {
    parse.blocks.push({ line: at + 1, text: trimmed, type: "image" });
    return;
  }
  if (DETAILS_OPEN.test(trimmed)) {
    parse.blocks.push({ line: at + 1, text: "", type: "toggle-open" });
    return;
  }
  if (DETAILS_CLOSE.test(trimmed)) {
    parse.blocks.push({ line: at + 1, text: "", type: "toggle-close" });
    return;
  }
  const summary = SUMMARY_LINE.exec(trimmed);
  // A summary belongs to the toggle it opened, so it is recorded ON that block rather than left as prose the
  // section-order check would then have to interpret.
  const open = parse.blocks.at(-1);
  if (summary !== null && open?.type === "toggle-open") {
    parse.blocks[parse.blocks.length - 1] = { ...open, text: summary[1]!.trim() };
    return;
  }
  // One that opens no toggle is dropped for the linter, whose block counts it would otherwise shift, and kept
  // as a paragraph for a publisher, which must not lose a line the author wrote.
  if (parse.keepStraySummary) {
    parse.blocks.push({ line: at + 1, text: trimmed, type: "paragraph" });
  }
}

/**
 * Split golden-proposal markdown into ordered blocks.
 *
 * @param markdown the document body
 * @param keepStraySummary keep a summary line that opens no toggle as a paragraph — a publisher must not lose
 *   it; the linter leaves it out, so its block counts stay what they were
 * @returns the blocks, in document order, each carrying the 1-indexed line it starts on
 */
export function parseProposalBlocks({
  markdown,
  keepStraySummary = false,
}: {
  markdown: string;
  keepStraySummary?: boolean;
}): readonly ProposalBlock[] {
  const lines = markdown.split("\n");
  const parse: Parse = { blocks: [], buffer: [], bufferLine: 1, keepStraySummary };
  for (let at = 0; at < lines.length; at += 1) {
    const line = lines[at]!;
    if (line.trim().length === 0) {
      flush({ parse });
      continue;
    }
    // Every branch below flushes BEFORE pushing its own block. Flushing afterwards would record a paragraph
    // buffered above a heading as coming AFTER it, and the section-order check reads document order.
    if (line.startsWith("```")) {
      flush({ parse });
      at = collectFence({ lines, parse, start: at });
      continue;
    }
    if (isSingleLineBlock({ line })) {
      flush({ parse });
      singleLineBlock({ at, line, parse });
      continue;
    }
    const runType = runTypeFor({ line });
    if (runType !== undefined) {
      flush({ parse });
      at = collectRun({ lines, parse, start: at, type: runType });
      continue;
    }
    if (parse.buffer.length === 0) {
      parse.bufferLine = at + 1;
    }
    parse.buffer.push(line);
  }
  flush({ parse });
  return parse.blocks;
}
