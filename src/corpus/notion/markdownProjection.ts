/**
 * Parsing a Notion **enhanced-markdown** body into a typed tree, and projecting that tree to plain text.
 *
 * Pure: no client, no clock, no I/O. The live seam that fetches a body hands its `markdown` string to this parser and
 * stores what comes back, so every future re-derivation runs against LOCAL structure instead of re-fetching
 * from Notion. That asymmetry is what this module exists to close — a bronze record carries a rendered
 * `text` and a `raw` object, and for GitHub, Slack and Linear `raw` is the provider's own JSON while for
 * Notion it has only ever held the PAGE object, never the body. The body was a one-way render.
 *
 * ## The grammar is MEASURED, not guessed
 *
 * Every tag and attribute it models was censused from 38 real page bodies pulled from the live workspace
 * (621,127 characters). Reproduce the census over any collected sample with:
 *
 * ```sh
 * grep -o '<[a-z][a-z0-9_-]*[^>]*>' <bodies> | sed 's/="[^"]*"/="…"/g' | sort | uniq -c | sort -rn
 * ```
 *
 * The counts that shaped the decisions: `td` 4,638 · `tr` 1,093 · `page` 874 · `br` 249 · `empty-block` 88 ·
 * `table` 79 · `mention-user` 76 · `mention-page` 44 self-closing AND 14 as a container · `callout` 68 ·
 * `column` 43 · `details`/`summary` 24 each · `unknown` 24 · `span` 31 · `database` 20 · `col`/`colgroup` 45 ·
 * `mention-date` 12 · `file` 5 · `video`, `embed`, `table_of_contents` 1 each.
 *
 * Two of those counts are load-bearing rather than trivia. `mention-page` appears in BOTH shapes, so a parser
 * that assumes one silently drops the other. And `unknown` is Notion's own marker for a block it could not
 * render or the caller could not see — it is the thing that must never be swallowed, because a body missing
 * a block it does not mention is exactly the quiet degradation this connector refuses.
 *
 * ## What this deliberately does NOT parse
 *
 * Block markdown — headings, bullets, quotes, fenced code — stays as verbatim TEXT RUNS rather than becoming
 * typed nodes. That is a choice, not an omission: the corpus body is plain text, so keeping the markdown
 * source in a run loses nothing a reader or an index wants, while a second grammar to maintain would be a
 * standing correctness liability for no gain. Structure is typed exactly where structure is load-bearing —
 * tables, child pages, mentions, media, toggles and columns — because those are what re-derivation reads.
 *
 * Fenced code is treated as OPAQUE for the same reason it must be: a code block may legitimately contain a
 * `<` and would otherwise be tokenised as markup.
 */

import type { Token } from "./markdownLexer.js";
import type { NotionMdCode, NotionMdMedia, NotionMdMention, NotionMdNode } from "./markdownNodes.js";
import {
  CONTAINER_TAGS,
  MEDIA_KINDS,
  MENTION_TARGETS,
  type ParseSink,
  type TagContext,
  TRANSPARENT_TAGS,
  transparentNodes,
  unknownNode,
} from "./markdownTags.js";

/**
 * What a reference or a mention renders as when Notion gave it neither text nor a url.
 *
 * A named stand-in rather than an empty string: an empty cell in a body reads as "nothing was here", while
 * these say "something was here and it arrived nameless", which is the true statement and the one a reader
 * chasing a gap needs.
 */
const UNNAMED_REFERENCE = "[unnamed reference]";

/** The same stand-in for a mention with no text and no url. */
const UNNAMED_MENTION = "[unnamed mention]";

/** The plain text one node renders to. Pure, and the single definition the projection and tables share. */
function nodeText({ node }: { node: NotionMdNode }): string {
  switch (node.kind) {
    case "text":
      return node.text;
    case "code":
      return node.text;
    case "table":
      return node.rows.map((row) => row.join(" | ")).join("\n");
    case "childPage":
    case "childDatabase":
      if (node.title.length > 0) {
        return node.title;
      }
      return node.url ?? UNNAMED_REFERENCE;
    case "mention":
      if (node.text.length > 0) {
        return node.text;
      }
      return node.url ?? UNNAMED_MENTION;
    case "media":
      if (node.src === undefined) {
        return node.caption;
      }
      if (node.caption.length > 0) {
        return `${node.caption} (${node.src})`;
      }
      return node.src;
    case "unknown":
      return node.alt !== undefined ? `[unreadable ${node.alt}]` : "[unreadable block]";
    case "callout":
    case "toggle":
    case "columns":
    case "column":
      return childrenText({ nodes: node.children });
    default: {
      const unreachable: never = node;
      return String(unreachable);
    }
  }
}

/**
 * The text a node list renders to, joined so block boundaries survive as blank lines. Pure.
 *
 * @returns each non-blank node's text, separated by blank lines
 */
export function childrenText({ nodes }: { nodes: readonly NotionMdNode[] }): string {
  return nodes
    .map((node) => nodeText({ node }))
    .filter((text) => text.trim().length > 0)
    .join("\n\n");
}

/** Record that a tag the parser does not model was met, so a grammar change surfaces as a named gap. */
function noteGap({ sink, tag }: { sink: ParseSink; tag: string }): void {
  sink.gaps.set(tag, (sink.gaps.get(tag) ?? 0) + 1);
}

/** Where one parse pass stopped, and what it built. */
interface ParsedRun {
  readonly nodes: readonly NotionMdNode[];
  readonly next: number;
}

/**
 * Parse tokens from `start` until `stopTag`'s closing tag, or until the stream ends.
 *
 * Recursive over CONTAINER nesting, which is bounded by the document Notion already rendered — unlike the
 * block crawl this replaces, there is no request behind a descent here and nothing to fetch, so the recursion
 * cannot fan out into other pages.
 *
 * @param tokens the whole lexed stream
 * @param start the index to resume at
 * @param stopTag the tag whose close ends this run, or undefined at the top level
 * @param sink the accumulator every lifted url and gap is recorded on
 * @returns the nodes built and the index just past the closing tag
 */
export function parseRun({
  tokens,
  start,
  stopTag,
  sink,
}: {
  tokens: readonly (Token | NotionMdCode)[];
  start: number;
  stopTag: string | undefined;
  sink: ParseSink;
}): ParsedRun {
  const nodes: NotionMdNode[] = [];
  let index = start;
  while (index < tokens.length) {
    const token = tokens[index];
    if (token === undefined) {
      break;
    }
    if (!("type" in token)) {
      nodes.push(token);
      index += 1;
      continue;
    }
    if (token.type === "text") {
      nodes.push({ kind: "text", text: token.text });
      index += 1;
      continue;
    }
    if (token.type === "close") {
      index += 1;
      if (token.tag === stopTag) {
        return { next: index, nodes };
      }
      continue;
    }
    const built = buildNode({ index, sink, token, tokens });
    nodes.push(...built.nodes);
    index = built.next;
  }
  return { next: index, nodes };
}

/** A reference to another page or database, with the url lifted onto the sink. */
function referenceNode({ attrs, tag, children, sink }: TagContext): readonly NotionMdNode[] {
  const url = attrs["url"];
  if (tag === "database") {
    sink.borrowsContent = true;
  }
  if (url !== undefined) {
    const into = tag === "page" ? sink.childPageUrls : sink.childDatabaseUrls;
    into.push(url);
  }
  return [
    {
      dataSourceUrl: attrs["data-source-url"],
      kind: tag === "page" ? "childPage" : "childDatabase",
      title: childrenText({ nodes: children }),
      url,
    },
  ];
}

/** A mention node, with its target url lifted onto the sink. */
function mentionNode({
  attrs,
  children,
  sink,
  target,
}: TagContext & { target: NotionMdMention["target"] }): readonly NotionMdNode[] {
  const url = attrs["url"];
  if (url !== undefined) {
    sink.mentionUrls.push(url);
  }
  return [{ kind: "mention", target, text: childrenText({ nodes: children }), url }];
}

/** A media node, with its source lifted onto the sink. */
function mediaNode({
  attrs,
  children,
  sink,
  media,
}: TagContext & { media: NotionMdMedia["media"] }): readonly NotionMdNode[] {
  const src = attrs["src"];
  if (src !== undefined) {
    sink.mediaSrcs.push(src);
  }
  return [{ caption: childrenText({ nodes: children }), kind: "media", media, src }];
}

/**
 * Turn one parsed tag and its children into nodes.
 *
 * Split out of the token walk so each tag family is one small function rather than one long branch: the
 * combined version ran to 110 lines at cognitive complexity 22, over both gates.
 *
 * @param context the tag, its attributes, its already-parsed children and the shared sink
 * @returns the nodes this tag contributes, which for a transparent wrapper is just its children
 */
function nodesForTag(context: TagContext): readonly NotionMdNode[] {
  const { tag, sink, children } = context;
  if (tag === "page" || tag === "database") {
    return referenceNode(context);
  }
  const target = MENTION_TARGETS[tag];
  if (target !== undefined) {
    return mentionNode({ ...context, target });
  }
  const media = MEDIA_KINDS[tag];
  if (media !== undefined) {
    return mediaNode({ ...context, media });
  }
  if (tag === "unknown") {
    return unknownNode(context);
  }
  if (tag === "synced_block" || tag === "synced_block_reference") {
    // Content owned elsewhere: the bytes can change without this page's own timestamp moving.
    sink.borrowsContent = true;
    return children;
  }
  const containerKind = CONTAINER_TAGS[tag];
  if (containerKind !== undefined) {
    return [{ children, kind: containerKind, label: context.attrs["icon"] }];
  }
  if (TRANSPARENT_TAGS.has(tag) || tag === "tr" || tag === "td") {
    // `tr`/`td` reached HERE are outside a table, which consumes its own. Malformed, but their text is real.
    return transparentNodes(context);
  }
  noteGap({ sink, tag });
  return children;
}

/**
 * One open or void token turned into nodes, consuming its children when it has any.
 *
 * `table` is the one tag that cannot go through this path, because its `tr`/`td` nesting is information that
 * a flat child list destroys. It gets {@link parseTable} instead.
 *
 * @param token the open or void token to build from
 * @param tokens the whole lexed stream
 * @param index the index of that token
 * @param sink the accumulator lifted urls and gaps are recorded on
 * @returns the nodes built and the index just past this tag
 */
function buildNode({
  token,
  tokens,
  index,
  sink,
}: {
  token: Extract<Token, { type: "open" | "close" | "void" }>;
  tokens: readonly (Token | NotionMdCode)[];
  index: number;
  sink: ParseSink;
}): { nodes: readonly NotionMdNode[]; next: number } {
  const { tag, attrs } = token;
  if (tag === "table") {
    if (token.type === "void") {
      return { next: index + 1, nodes: [{ headerColumn: false, headerRow: false, kind: "table", rows: [] }] };
    }
    return parseTable({ attrs, sink, start: index + 1, tokens });
  }
  const run =
    token.type === "void"
      ? { next: index + 1, nodes: [] as readonly NotionMdNode[] }
      : parseRun({ sink, start: index + 1, stopTag: tag, tokens });
  return { next: run.next, nodes: nodesForTag({ attrs, children: run.nodes, sink, tag }) };
}

/**
 * Consume one `<table>`'s tokens, keeping its ROW structure.
 *
 * A table cannot go through {@link parseRun} like every other container, and that is the whole reason this
 * function exists: `tr` and `td` are the only tags whose NESTING is the information. Flattened into a node
 * list they become a single run of cell text with the row boundaries gone, which is the same class of loss
 * as the empty `table_row` render this connector already carries in its history — 429 cells indexed as empty
 * strings, in the control matrices and decision logs an auditor asks for.
 *
 * Each cell's own content still goes through {@link parseRun}, so a mention or a page reference inside a
 * cell is typed and lifted onto the sink exactly as it would be anywhere else.
 *
 * @param tokens the whole lexed stream
 * @param start the index just past the opening `<table>`
 * @param attrs the table's own attributes, carrying which edges are headers
 * @param sink the accumulator a cell's lifted urls and gaps are recorded on
 * @returns the finished table node and the index just past `</table>`
 */
function parseTable({
  tokens,
  start,
  attrs,
  sink,
}: {
  tokens: readonly (Token | NotionMdCode)[];
  start: number;
  attrs: Readonly<Record<string, string>>;
  sink: ParseSink;
}): { nodes: readonly NotionMdNode[]; next: number } {
  const rows: string[][] = [];
  let cells: string[] | undefined;
  let index = start;
  while (index < tokens.length) {
    const step = tableStep({ cells, index, sink, tokens });
    if (step.done) {
      index = step.next;
      break;
    }
    cells = step.cells;
    if (step.completedRow !== undefined) {
      rows.push(step.completedRow);
    }
    index = step.next;
  }
  if (cells !== undefined) {
    rows.push(cells);
  }
  return {
    next: index,
    nodes: [
      {
        headerColumn: attrs["header-column"] === "true",
        headerRow: attrs["header-row"] === "true",
        kind: "table",
        rows,
      },
    ],
  };
}

/**
 * Advance one token inside a table.
 *
 * Split out so {@link parseTable} stays inside the function-length and complexity gates, and so the row
 * bookkeeping is one small thing to read rather than five branches sharing two mutable locals.
 *
 * @param tokens the whole lexed stream
 * @param index the token to interpret
 * @param cells the row being filled, or undefined when between rows
 * @param sink the accumulator a cell's own lifted urls are recorded on
 * @returns whether the table ended, the row that just completed, the row still filling, and the next index
 */
function tableStep({
  tokens,
  index,
  cells,
  sink,
}: {
  tokens: readonly (Token | NotionMdCode)[];
  index: number;
  cells: string[] | undefined;
  sink: ParseSink;
}): { done: boolean; next: number; cells: string[] | undefined; completedRow?: string[] } {
  const token = tokens[index];
  if (token === undefined || !("type" in token)) {
    return { cells, done: false, next: index + 1 };
  }
  if (token.type === "close" && token.tag === "table") {
    return { cells, done: true, next: index + 1 };
  }
  if (token.type === "close" && token.tag === "tr") {
    if (cells === undefined) {
      return { cells: undefined, done: false, next: index + 1 };
    }
    return { cells: undefined, completedRow: cells, done: false, next: index + 1 };
  }
  if (token.type === "open" && token.tag === "tr") {
    return { cells: [], done: false, next: index + 1 };
  }
  if (token.type === "open" && token.tag === "td") {
    const cell = parseRun({ sink, start: index + 1, stopTag: "td", tokens });
    const filling = cells ?? [];
    filling.push(childrenText({ nodes: cell.nodes }).trim());
    return { cells: filling, done: false, next: cell.next };
  }
  return { cells, done: false, next: index + 1 };
}
