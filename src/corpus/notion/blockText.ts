/**
 * Pure per-block-type text rendering — the dispatch table that decides what a Notion block contributes to
 * a page's indexed body.
 *
 * ## Why this module exists, measured
 *
 * The shipped renderer had ONE rule: read `block[block.type].rich_text` and render it. That rule is right
 * for a paragraph and silently wrong for every block type that carries its text somewhere else. Measured
 * against the real workspace over 5,000+ blocks, the rule produced empty text for:
 *
 *   table_row  429   every cell of every table — `cells` is `rich_text[][]`, not `rich_text`
 *   child_page 139   the inlined sub-page's own title — `title` is a bare string
 *   image       75   the caption — `caption`, not `rich_text`
 *   link_preview 6 · child_database 4 · bookmark 1 · video/embed/file 1 each
 *
 * `table_row` is the one that mattered. A control matrix, a decision log, a risk register — the documents an
 * auditor asks for — are tables, and every one of them indexed as an empty string. A query for a control
 * would return fewer citations and nothing anywhere would say why. Blocks are rendered to text and the raw
 * blocks are NOT retained, so this was not recoverable by re-deriving silver: only a re-fetch could fix it.
 *
 * `divider`, `table_of_contents`, `column`, `column_list` and `table` itself render empty CORRECTLY — they
 * carry no text of their own, and the last three carry their content in children the crawl already
 * recurses into. Emptiness is only a defect when text existed and was dropped.
 *
 * ## What is deliberately still not rendered
 *
 * `synced_block` — a DUPLICATE synced block stores its content under the original's id, so rendering it
 * needs a second fetch against a different block. None occurred in the measured workspace, so the correct
 * shape is unproven and it is listed as a known blind spot rather than guessed at. `link_to_page` carries
 * only a target id and no prose, so it contributes no text; its edge belongs to the curated layer.
 */
import { isRecord } from "../../lib/parsers.js";

/** Render a `rich_text` array to plain text, links preserved as `text (url)`. Injected to avoid a cycle. */
export type RichTextRenderer = (args: { richText: unknown }) => string;

/** A checkbox glyph for a `to_do`, so a completed control reads differently from an outstanding one. */
function todoPrefix({ body }: { body: Record<string, unknown> }): string {
  return body["checked"] === true ? "[x] " : "[ ] ";
}

/** The rendered `caption` of a media/bookmark block (empty when it has none). */
function captionOf({ body, render }: { body: Record<string, unknown>; render: RichTextRenderer }): string {
  return render({ richText: body["caption"] });
}

/** A bare string field off a block body (empty when absent or not a string). */
function stringField({ body, key }: { body: Record<string, unknown>; key: string }): string {
  const value = body[key];
  return typeof value === "string" ? value : "";
}

/** Join the non-empty parts of a line with a separator, dropping the separator when a part is missing. */
function joinParts({ parts, separator }: { parts: readonly string[]; separator: string }): string {
  return parts.filter((part) => part.trim().length > 0).join(separator);
}

/**
 * One table row rendered as a pipe-delimited line — `cells` is an ARRAY of rich-text arrays, one per column.
 *
 * Pipe-delimited rather than a single space because column boundaries carry meaning in exactly the documents
 * this was written for: "control | owner | status" collapsed into one run of words loses which word was the
 * status. It is not full markdown — there is no header/separator row, because a `table_row` block does not
 * know whether it is the header (its parent `table` carries `has_column_header`).
 */
function tableRowText({ body, render }: { body: Record<string, unknown>; render: RichTextRenderer }): string {
  const cells = body["cells"];
  if (!Array.isArray(cells)) {
    return "";
  }
  return joinParts({ parts: cells.map((cell) => render({ richText: cell }).trim()), separator: " | " });
}

/** The default renderer: the block body's own `rich_text`, which is what most block types carry. */
function richTextBody({ body, render }: { body: Record<string, unknown>; render: RichTextRenderer }): string {
  return render({ richText: body["rich_text"] });
}

/** A media/bookmark block's contribution: its url and caption, whichever it has. */
function urlAndCaption({ body, render }: { body: Record<string, unknown>; render: RichTextRenderer }): string {
  return joinParts({ parts: [stringField({ body, key: "url" }), captionOf({ body, render })], separator: " — " });
}

/**
 * The per-type renderers, keyed by block `type`. A type absent from this table falls back to
 * {@link richTextBody}, which is correct for every text-bearing type Notion has and harmlessly empty for
 * the rest — so a block type Notion adds later degrades to the old behaviour rather than throwing.
 */
const BLOCK_RENDERERS: Readonly<
  Record<string, (args: { body: Record<string, unknown>; render: RichTextRenderer }) => string>
> = {
  audio: urlAndCaption,
  bookmark: urlAndCaption,
  child_database: ({ body }) => stringField({ body, key: "title" }),
  child_page: ({ body }) => stringField({ body, key: "title" }),
  code: ({ body, render }) => {
    const language = stringField({ body, key: "language" });
    const text = richTextBody({ body, render });
    return text.length > 0 && language.length > 0 ? `${language}:\n${text}` : text;
  },
  embed: urlAndCaption,
  equation: ({ body }) => stringField({ body, key: "expression" }),
  file: urlAndCaption,
  image: urlAndCaption,
  link_preview: ({ body }) => stringField({ body, key: "url" }),
  pdf: urlAndCaption,
  table_row: tableRowText,
  to_do: ({ body, render }) => {
    const text = richTextBody({ body, render });
    return text.length > 0 ? `${todoPrefix({ body })}${text}` : "";
  },
  video: urlAndCaption,
};

/**
 * The rendered text line of one raw block, dispatched on its own `type`. Pure.
 *
 * @param block one raw block; its body lives under a key named by its own `type` field, so the shape is read
 *   dynamically rather than typed
 * @param render the rich-text renderer to use, injected so this module does not import the fetch edge
 * @returns the rendered line, or empty for a block that genuinely carries no text (a divider, a column)
 */
export function renderBlockText({
  block,
  render,
}: {
  block: Record<string, unknown>;
  render: RichTextRenderer;
}): string {
  const type = typeof block["type"] === "string" ? block["type"] : undefined;
  const body = type !== undefined ? block[type] : undefined;
  if (type === undefined || !isRecord(body)) {
    return "";
  }
  const renderer = BLOCK_RENDERERS[type] ?? richTextBody;
  return renderer({ body, render });
}

/**
 * A media block's caption keys, for the file-ref layer to avoid double-reporting a caption it already has.
 * Exported so the audit surface can name what this table covers without re-deriving the list.
 *
 * @returns the block types this module renders with a type-specific rule, sorted
 */
export function specialisedBlockTypes(): readonly string[] {
  return Object.keys(BLOCK_RENDERERS).toSorted();
}
