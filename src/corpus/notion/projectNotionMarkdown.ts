/**
 * The entry point to projecting a Notion enhanced-markdown body: lex it, parse it, and gather what the parse lifted
 * out. Pure.
 *
 * The measured grammar, and why the tree is stored at all: {@link ./markdownProjection.js}.
 */

import { lex } from "./markdownLexer.js";
import type { NotionMdNode } from "./markdownNodes.js";
import { childrenText, parseRun } from "./markdownProjection.js";
import { makeSink } from "./markdownTags.js";

/**
 * A tag the parser met and does not model.
 *
 * Reported rather than dropped, and its content is still kept, so a Notion grammar change shows up as a
 * named gap on the record instead of as text that quietly stopped appearing.
 */
interface NotionMdGap {
  readonly tag: string;
  readonly count: number;
}

/** Everything one parsed body yields: the tree to store, the text to index, and what it points at. */
export interface ProjectedNotionMarkdown {
  readonly tree: readonly NotionMdNode[];
  readonly text: string;
  readonly childPageUrls: readonly string[];
  readonly childDatabaseUrls: readonly string[];
  readonly mentionUrls: readonly string[];
  readonly mediaSrcs: readonly string[];
  readonly unknownUrls: readonly string[];
  readonly discussionUrls: readonly string[];
  readonly gaps: readonly NotionMdGap[];
  /**
   * Whether this body inlines content OWNED by another object — a synced block, or a database rendered
   * inline. Such bytes can change without this page's `last_edited_time` moving, so nothing may skip a
   * re-fetch of it.
   */
  readonly borrowsContent: boolean;
}

/**
 * Parse a Notion enhanced-markdown body into a typed tree and everything a re-derivation reads from it.
 *
 * @param markdown the body exactly as `pages.retrieveMarkdown` returned it
 * @returns the tree to store, the plain text to index, every url the body points at, and any unmodelled tag
 */
export function projectNotionMarkdown({ markdown }: { markdown: string }): ProjectedNotionMarkdown {
  const sink = makeSink();
  const tokens = lex({ markdown });
  const run = parseRun({ sink, start: 0, stopTag: undefined, tokens });
  const gaps: readonly NotionMdGap[] = [...sink.gaps.entries()]
    .map(([tag, count]) => ({ count, tag }))
    .toSorted((left, right) => right.count - left.count || left.tag.localeCompare(right.tag));
  return {
    borrowsContent: sink.borrowsContent,
    childDatabaseUrls: sink.childDatabaseUrls,
    childPageUrls: sink.childPageUrls,
    discussionUrls: sink.discussionUrls,
    gaps,
    mediaSrcs: sink.mediaSrcs,
    mentionUrls: sink.mentionUrls,
    text: childrenText({ nodes: run.nodes }).trim(),
    tree: run.nodes,
    unknownUrls: sink.unknownUrls,
  };
}
