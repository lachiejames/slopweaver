/**
 * What each Notion tag means to the parser: the tables naming the node a tag builds, the sink one parse lifts urls
 * and gaps onto, and the two tag handlers that read only attributes.
 *
 * The measured grammar behind the tables: {@link ./markdownProjection.js}.
 */

import type { NotionMdContainer, NotionMdMedia, NotionMdMention, NotionMdNode } from "./markdownNodes.js";

/** Tags that carry children and are modelled as containers, mapped to the node kind each produces. */
export const CONTAINER_TAGS: Readonly<Record<string, NotionMdContainer["kind"]>> = {
  callout: "callout",
  column: "column",
  columns: "columns",
  details: "toggle",
};

/**
 * Tags that are structural noise once their text is taken: they wrap or space content and model nothing a
 * re-derivation reads. `span` is here because its only load-bearing attribute is `discussion-urls`, which is
 * lifted out separately before the wrapper is discarded.
 */
export const TRANSPARENT_TAGS: ReadonlySet<string> = new Set([
  "br",
  "col",
  "colgroup",
  "empty-block",
  "span",
  "summary",
  "table_of_contents",
]);

/** The mention tags, mapped to the target each names. */
export const MENTION_TARGETS: Readonly<Record<string, NotionMdMention["target"]>> = {
  "mention-data-source": "dataSource",
  "mention-database": "database",
  "mention-date": "date",
  "mention-page": "page",
  "mention-user": "user",
};

/** The media tags, mapped to the media kind each names. */
export const MEDIA_KINDS: Readonly<Record<string, NotionMdMedia["media"]>> = {
  embed: "embed",
  file: "file",
  video: "video",
};

/** The accumulator one parse fills — the node list under construction plus everything lifted out of it. */
export interface ParseSink {
  readonly nodes: NotionMdNode[];
  readonly childPageUrls: string[];
  readonly childDatabaseUrls: string[];
  readonly mentionUrls: string[];
  readonly mediaSrcs: string[];
  readonly unknownUrls: string[];
  readonly discussionUrls: string[];
  readonly gaps: Map<string, number>;
  borrowsContent: boolean;
}

/**
 * A fresh sink for one parse. ONE instance is threaded through every nested run, so a url lifted out of a
 * table cell six containers deep lands in the same place as one at the top level.
 *
 * @returns an empty sink
 */
export function makeSink(): ParseSink {
  return {
    borrowsContent: false,
    childDatabaseUrls: [],
    childPageUrls: [],
    discussionUrls: [],
    gaps: new Map<string, number>(),
    mediaSrcs: [],
    mentionUrls: [],
    nodes: [],
    unknownUrls: [],
  };
}

/** What every tag handler is given: the tag's own attributes, its parsed children, and the shared sink. */
export interface TagContext {
  readonly attrs: Readonly<Record<string, string>>;
  readonly tag: string;
  readonly children: readonly NotionMdNode[];
  readonly sink: ParseSink;
}

/**
 * An unknown-block node, with its follow-up url lifted onto the sink.
 *
 * @returns the one node this tag contributes
 */
export function unknownNode({ attrs, sink }: TagContext): readonly NotionMdNode[] {
  const url = attrs["url"];
  if (url !== undefined) {
    sink.unknownUrls.push(url);
  }
  return [{ alt: attrs["alt"], kind: "unknown", url }];
}

/**
 * A transparent wrapper: its children stand in for it, and any inline discussion urls are lifted first.
 *
 * @returns the wrapper's children, unchanged
 */
export function transparentNodes({ attrs, children, sink }: TagContext): readonly NotionMdNode[] {
  const discussions = attrs["discussion-urls"];
  if (discussions !== undefined) {
    sink.discussionUrls.push(...discussions.split(",").filter((url) => url.length > 0));
  }
  return children;
}
