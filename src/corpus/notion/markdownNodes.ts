/**
 * The typed tree a parsed Notion enhanced-markdown body becomes. Types only, so the lexer, the tag tables and the
 * parser can each name a node without importing one another.
 *
 * The measured grammar behind these shapes, and why block markdown stays as text runs: {@link ./markdownProjection.js}.
 */

/** A verbatim run of markdown source carrying no Notion-specific tag. */
interface NotionMdText {
  readonly kind: "text";
  readonly text: string;
}

/** A fenced code block, kept whole and never scanned for tags. */
export interface NotionMdCode {
  readonly kind: "code";
  readonly language: string | undefined;
  readonly text: string;
}

/** A table, with its cells already resolved to the text each one renders. */
export interface NotionMdTable {
  readonly kind: "table";
  readonly headerRow: boolean;
  readonly headerColumn: boolean;
  readonly rows: readonly (readonly string[])[];
}

/** A reference to another page or database — a POINTER, never that object's body. */
interface NotionMdReference {
  readonly kind: "childPage" | "childDatabase";
  readonly url: string | undefined;
  readonly dataSourceUrl: string | undefined;
  readonly title: string;
}

/** An explicit mention of a person, page, database, data source or date. */
export interface NotionMdMention {
  readonly kind: "mention";
  readonly target: "user" | "page" | "database" | "dataSource" | "date";
  readonly url: string | undefined;
  readonly text: string;
}

/** A file, image, video or embed, as the reference Notion returns for it. */
export interface NotionMdMedia {
  readonly kind: "media";
  readonly media: "file" | "video" | "embed";
  readonly src: string | undefined;
  readonly caption: string;
}

/**
 * A block Notion itself could not render, or that the token cannot see.
 *
 * Never collapsed into surrounding text. `url` is what a follow-up fetch would use, and its presence in a
 * body is what tells a caller the capture is incomplete even when the response's own `truncated` flag is false.
 */
interface NotionMdUnknown {
  readonly kind: "unknown";
  readonly url: string | undefined;
  readonly alt: string | undefined;
}

/** A container that holds other nodes: a callout, a toggle, a column set, or one column. */
export interface NotionMdContainer {
  readonly kind: "callout" | "toggle" | "columns" | "column";
  readonly label: string | undefined;
  readonly children: readonly NotionMdNode[];
}

/** One node of a parsed Notion markdown body. */
export type NotionMdNode =
  | NotionMdText
  | NotionMdCode
  | NotionMdTable
  | NotionMdReference
  | NotionMdMention
  | NotionMdMedia
  | NotionMdUnknown
  | NotionMdContainer;
