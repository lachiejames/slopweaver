/**
 * A proposal's markdown as the typed form the `linear document` door takes — the same document every other
 * destination receives, read into Linear's block vocabulary rather than passed through as one string.
 *
 * ## Why blocks, and why this reader
 *
 * The Linear door accepts only `FreeformBlock[]`, so its structural checks (a smuggled heading, a `+++`
 * collapsible delimiter, a fence a paragraph cannot close) run over the proposal exactly as they run over any
 * other document. The blocks are read by `parseProposalBlocks`, the reader `proposal lint` already trusts with
 * a hand-edited draft, so no second markdown parser decides what the proposal says.
 *
 * ## What each block becomes
 *
 * - a heading is a heading (Linear renders every document heading at one level);
 * - a paragraph, blockquote, table or list keeps its markdown bytes as a paragraph — Linear renders markdown;
 * - a fenced block is a code block;
 * - an `https?://` image keeps its markdown bytes as a paragraph, so it renders exactly as written (a media
 *   block would need a MIME type a URL does not carry);
 * - a `<details>` toggle's summary becomes a bold label over its body, because a document has no collapsible,
 *   and never a heading, which the draft did not write;
 * - the Notion table-of-contents marker and a toggle's closing line are navigation, not content, and drop.
 *
 * A `file:` image is REFUSED, standalone or inline in prose: Linear cannot reach a file on this machine, and this
 * destination adds no upload. So is any other image address that is not http(s).
 */
import { err, ok, type Result } from "../../lib/result.js";
import type { LinearDocumentDestination, LinearDocumentForm } from "../linear/documentTypes.js";
import type { FreeformBlock } from "../linear/types.js";
import { type ProposalBlock, parseProposalBlocks } from "./lint/blocks.js";

/** A draft line that names a file on this machine, which Linear cannot fetch. */
export interface LocalMediaRefusal {
  readonly code: "LOCAL_MEDIA";
  readonly message: string;
  readonly line: number;
}

/** A fenced block whose info string is not one bare word, which the Linear door refuses. */
export interface CodeLanguageRefusal {
  readonly code: "CODE_LANGUAGE";
  readonly message: string;
  readonly line: number;
}

/** A fenced block with nothing inside it, which the Linear door's code block cannot carry. */
export interface EmptyCodeRefusal {
  readonly code: "EMPTY_CODE";
  readonly message: string;
  readonly line: number;
}

/** An image whose address Linear could neither fetch nor render. */
export interface UnreachableMediaRefusal {
  readonly code: "UNREACHABLE_MEDIA";
  readonly message: string;
  readonly line: number;
}

/** Why a proposal could not be read into a Linear document. */
export type ProposalLinearError = LocalMediaRefusal | CodeLanguageRefusal | EmptyCodeRefusal | UnreachableMediaRefusal;

/** The `ProposalLinearError` factories. */
export const ProposalLinearErrors = {
  codeLanguage: ({ line, lang }: { line: number; lang: string }): CodeLanguageRefusal => ({
    code: "CODE_LANGUAGE",
    line,
    message: `line ${String(line)}: the code block's language "${lang}" is not one bare word (letters, digits, _ + -), which a Linear document refuses`,
  }),
  emptyCode: ({ line }: { line: number }): EmptyCodeRefusal => ({
    code: "EMPTY_CODE",
    line,
    message: `line ${String(line)}: an empty code block, which a Linear document cannot carry. Remove it or fill it`,
  }),
  localMedia: ({ line, source }: { line: number; source: string }): LocalMediaRefusal => ({
    code: "LOCAL_MEDIA",
    line,
    message:
      `line ${String(line)}: ${source} is a file on this machine, which Linear cannot fetch. Host it at an ` +
      "https URL, or publish to a destination that carries local media",
  }),
  unreachableMedia: ({ line, url }: { line: number; url: string }): UnreachableMediaRefusal => ({
    code: "UNREACHABLE_MEDIA",
    line,
    message: `line ${String(line)}: the image address ${url} is not an http(s) URL, so Linear cannot show it`,
  }),
} as const;

/** Every inline markdown image in a text, standalone or mid-sentence, capturing what its parentheses hold. */
const IMAGE = /!\[(?:\\.|[^\]\\])*\]\(([^)]*)\)/g;
/** Every reference-style image — full `![alt][label]`, collapsed `![label][]` or shortcut `![label]` — capturing alt and label. */
const REFERENCE_IMAGE = /!\[((?:\\.|[^\]\\])*)\](?:\[((?:\\.|[^\]\\])*)\])?(?![([])/g;
/** A link reference definition, capturing its label and its address — which may sit on the next line — angle brackets optional. */
const DEFINITION = /^ {0,3}\[((?:\\.|[^\]\\])+)\]:\s*<?([^\s>]+)>?/gm;
/** The table-of-contents marker itself, so text written after it on the same line is kept rather than dropped. */
const TOC_MARKER = /^<table_of_contents\b[^>]*>?/i;
/**
 * Every link or image destination that is a file on this machine, whatever its text holds — an escaped bracket
 * in alt text included, an autolink `<file:…>`, and a reference definition `[label]: file:…` whichever link or
 * image uses it. Swept apart from the image matchers so no quirk of bracket parsing lets one through.
 */
const FILE_DESTINATION = /(?:\]\(\s*<?|\]:\s*<?|<)(file:[^)\s>]*)/g;
/** A summary line standing alone, capturing its label — `parseProposalBlocks` keeps one for a publisher. */
const STRAY_SUMMARY = /^<summary>(.*)<\/summary>$/i;
/** A fence's opening line, capturing its info string. */
const FENCE_OPEN = /^```(.*)$/;
/** An info string the Linear door accepts — its own rule, `../linear/schema.ts`'s `codeSchema`. */
const BARE_WORD = /^[A-Za-z0-9_+-]*$/;

/** A fenced proposal block as a Linear code block. `parseProposalBlocks` keeps the opening fence, not the close. */
function codeBlock({ block }: { block: ProposalBlock }): Result<readonly FreeformBlock[], ProposalLinearError> {
  const [opening, ...body] = block.text.split("\n");
  const lang = FENCE_OPEN.exec(opening!)![1]!.trim();
  if (!BARE_WORD.test(lang)) {
    return err(ProposalLinearErrors.codeLanguage({ lang, line: block.line }));
  }
  const text = body.join("\n");
  if (text.trim().length === 0) {
    return err(ProposalLinearErrors.emptyCode({ line: block.line }));
  }
  return ok([{ kind: "code", lang, text }]);
}

/** A reference label as markdown matches it: case-insensitive, inner whitespace collapsed. */
function normaliseLabel({ label }: { label: string }): string {
  return label.trim().replaceAll(/\s+/g, " ").toLowerCase();
}

/**
 * Every link reference definition in a proposal, label to address. A definition may sit anywhere in the
 * document, so the whole markdown is read once rather than block by block; the first definition of a label wins,
 * as it does in CommonMark.
 */
function referenceDefinitions({ markdown }: { markdown: string }): ReadonlyMap<string, string> {
  const definitions = new Map<string, string>();
  for (const match of markdown.matchAll(DEFINITION)) {
    const label = normaliseLabel({ label: match[1]! });
    if (!definitions.has(label)) {
      definitions.set(label, match[2]!);
    }
  }
  return definitions;
}

/** Every image address a prose block shows, inline and reference-style alike, plus every file: link destination. */
function imageAddresses({
  definitions,
  text,
}: {
  definitions: ReadonlyMap<string, string>;
  text: string;
}): readonly string[] {
  // The parenthesised part is the address then an optional title, so the address is its first token. Split here
  // rather than in the pattern: two adjacent quantifiers there would backtrack polynomially.
  const inline = [...text.matchAll(IMAGE)].map((match) => match[1]!.trim().split(/\s+/)[0]!);
  const referenced = [...text.matchAll(REFERENCE_IMAGE)].flatMap((match) => {
    const label = match[2] === undefined || match[2].length === 0 ? match[1]! : match[2];
    const url = definitions.get(normaliseLabel({ label }));
    return url === undefined ? [] : [url];
  });
  const linkedFiles = [...text.matchAll(FILE_DESTINATION)].map((match) => match[1]!);
  return [...inline, ...referenced, ...linkedFiles];
}

/**
 * A prose block as a paragraph keeping its bytes, or the refusal naming the first image in it Linear cannot show.
 * Every image is checked — inline ones mid-sentence and reference-style ones whose address sits in a definition
 * elsewhere — because a `file:` image is as unreachable written either way.
 */
function proseBlock({
  block,
  definitions,
}: {
  block: ProposalBlock;
  definitions: ReadonlyMap<string, string>;
}): Result<readonly FreeformBlock[], ProposalLinearError> {
  for (const url of imageAddresses({ definitions, text: block.text })) {
    if (url.startsWith("file:")) {
      return err(ProposalLinearErrors.localMedia({ line: block.line, source: url }));
    }
    if (!/^https?:\/\//.test(url)) {
      return err(ProposalLinearErrors.unreachableMedia({ line: block.line, url }));
    }
  }
  return ok([{ kind: "para", text: block.text }]);
}

/**
 * A paragraph, or a stray summary line the parser kept for this publisher. Linear refuses raw HTML, so a stray
 * summary becomes the same bold label a toggle's summary does rather than being sent as a tag.
 */
function strayOrProse({
  block,
  definitions,
}: {
  block: ProposalBlock;
  definitions: ReadonlyMap<string, string>;
}): Result<readonly FreeformBlock[], ProposalLinearError> {
  const stray = STRAY_SUMMARY.exec(block.text);
  if (stray === null) {
    return proseBlock({ block, definitions });
  }
  const label = stray[1]!.trim();
  if (label.length === 0) {
    return ok([]);
  }
  return proseBlock({ block, definitions }).map(() => [{ kind: "para", text: `**${label}**` }]);
}

/** One proposal block as the Linear blocks it becomes — none, for navigation. */
function linearBlocksOf({
  block,
  definitions,
}: {
  block: ProposalBlock;
  definitions: ReadonlyMap<string, string>;
}): Result<readonly FreeformBlock[], ProposalLinearError> {
  switch (block.type) {
    case "heading":
      // A heading can carry an image too, and one Linear cannot show is refused exactly as in prose.
      return proseBlock({ block, definitions }).map(() => [{ kind: "heading", text: block.text }]);
    case "toggle-open":
      // A toggle with no summary line names nothing to label its body with, so the body simply follows. The
      // summary is a label, never a heading: the draft did not write one, so the document does not gain one.
      if (block.text.length === 0) {
        return ok([]);
      }
      return proseBlock({ block, definitions }).map(() => [{ kind: "para", text: `**${block.text}**` }]);
    case "toc": {
      // The marker is navigation Linear draws for itself; text written after it on the same line is the draft's.
      const trailing = block.text.replace(TOC_MARKER, "").trim();
      return trailing.length === 0 ? ok([]) : proseBlock({ block: { ...block, text: trailing }, definitions });
    }
    case "toggle-close":
      return ok([]);
    case "code":
      return codeBlock({ block });
    case "paragraph":
      return strayOrProse({ block, definitions });
    case "image":
    case "blockquote":
    case "table":
    case "list":
      return proseBlock({ block, definitions });
  }
}

/**
 * Read a proposal's markdown into Linear document blocks.
 *
 * @param markdown the linted proposal markdown, exactly as `proposal publish` read it
 * @returns the blocks in document order, or the first block Linear could not carry
 */
export function proposalLinearBlocks({
  markdown,
}: {
  markdown: string;
}): Result<readonly FreeformBlock[], ProposalLinearError> {
  const blocks: FreeformBlock[] = [];
  const definitions = referenceDefinitions({ markdown });
  for (const block of parseProposalBlocks({ keepStraySummary: true, markdown })) {
    const converted = linearBlocksOf({ block, definitions });
    if (converted.isErr()) {
      return err(converted.error);
    }
    blocks.push(...converted.value);
  }
  return ok(blocks);
}

/**
 * The `linear document` form a proposal publishes as. The title carries the icon, because a Linear document's
 * form has no icon of its own and the rendered proposal carries neither.
 *
 * @param markdown the linted proposal markdown
 * @param title the proposal's title
 * @param icon an emoji shown before the title, if one was given
 * @param destination the Linear entity the document belongs to
 * @returns the form for the Linear door, or the block it could not carry
 */
export function proposalLinearDocumentForm({
  markdown,
  title,
  icon,
  destination,
}: {
  markdown: string;
  title: string;
  icon: string | undefined;
  destination: LinearDocumentDestination;
}): Result<LinearDocumentForm, ProposalLinearError> {
  const heading = icon === undefined ? title : `${icon} ${title}`;
  return proposalLinearBlocks({ markdown }).map((content) => ({ content, fields: { destination, title: heading } }));
}
