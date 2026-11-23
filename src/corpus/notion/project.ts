/**
 * Pure projection: shaped Notion items → `CorpusRecord[]`. No I/O — block recursion + rich-text
 * rendering already happened in `fetch.ts`. A page fans out into one **page** record per section chunk
 * (`page:<id>` for a single chunk, `page:<id>:chunk:<i>` for many) so a long doc isn't buried in one
 * giant atom; databases become **database** records (`database:<id>`); comments become **comment**
 * records. A file/image MENTION is reference text; the bytes, when a run fetches them, live in the
 * attachment store and are named on the record by digest (`corpus/notion/attachmentStore.ts`). The page's
 * PARSED BODY is stored the same way and named the same way, on chunk 0's `body` attr
 * (`corpus/notion/bodyStore.ts`), so re-deriving a page's text is a local read rather than a Notion call.
 *
 * ## Notion's expiring signed URLs DO reach bronze — but only by one route, so state the rule not a list
 *
 * This line used to deny them outright, which was false. The correction is easy to get wrong in the other
 * direction too (two review passes caught two different overstatements of it), so the rule rather than the
 * cases: **`raw` is the one upstream object this connector captured for the record — keys carried through
 * rather than filtered, string leaves redacted by the writer.** Three consequences follow, the contract:
 *
 *  1. A signed url sitting ON that object survives — a page/data-source `cover` or `icon`, a comment's
 *     `attachments`.
 *  2. A signed url the connector never captured as an object cannot appear. A child BLOCK's file url is the
 *     case in point: `fetch.ts` renders blocks to ref TEXT and discards the payloads.
 *  3. A record that is never emitted retains nothing at all. An attachment-only comment is dropped a few
 *     lines below for having no body, so its signed url reaches no row.
 *
 * Measured over the real corpus, an `X-Amz-Signature` url appears at exactly three paths, each beside
 * Notion's own `expiry_time`, and at no block path: `raw.cover.file.url` (555 page + 1 data_source),
 * `raw.icon.file.url` (7 pages), `raw.attachments[].file.url` (10 comments). That is the rule's prediction,
 * which is why it is stated as the contract and the counts are left as evidence rather than as the claim.
 *
 * Unlike Slack's locators these ARE pre-authenticated — the query string is the authorisation — but they
 * expire about an hour after capture, so every one already on disk is dead. The retention is the same
 * deliberate choice as the rest of bronze (see `slack/project.ts`, which carries the reasoning and the
 * redaction caveat): keeping the payload's shape is what makes a secret somebody pasted upstream findable.
 */

import { classifyCurated } from "../curated/classify.js";
import { CURATED_CLASS_ATTR, CURATED_EDGES_ATTR, encodeCuratedEdgeRef } from "../curated/types.js";
import { extractRefs } from "../refs.js";
import { BODY_ATTR, CAPTURE_ATTR, CAPTURE_PARTIAL, type CorpusAttributeValue, type CorpusRecord } from "../types.js";

import { bodyRef } from "./bodyStore.js";

/** A Notion comment, already shaped by the fetch edge. */
export interface NotionCommentItem {
  readonly id: string;
  readonly body: string;
  readonly author?: string;
  readonly tsIso: string;
  readonly raw?: Readonly<Record<string, unknown>>;
}

/** A Notion page with its rich text rendered + chunked into sections. */
export interface NotionPageItem {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly tsIso: string;
  readonly parent?: string;
  readonly chunks: readonly string[];
  readonly comments: readonly NotionCommentItem[];
  readonly raw?: Readonly<Record<string, unknown>>;
  /** PR4.3: `notion:page:<id>` targets of this page/row's `relation` properties (curated relation edges). */
  readonly relationTargets?: readonly string[];
  /** PR4.3: explicit `notion:<page|database|user>:<id>` mention targets in the body (curated mention edges). */
  readonly mentionTargets?: readonly string[];
  /**
   * File/media metadata lines: type + name + a STABLE url, and never a signed one, since those expire.
   * A run that fetched the bytes appends an `attachment: sha256:<digest>` line here too.
   */
  readonly fileRefs?: readonly string[];
  /**
   * The lowercase-hex SHA-256 of this page's PARSED BODY as stored in the body sidecar, when a run stored
   * one. Absent when the lane was given no body store — the text is still whole, but re-deriving it would
   * have to call Notion again, which is exactly what the sidecar exists to avoid
   * (`corpus/notion/bodyStore.ts`).
   */
  readonly bodyDigest?: string;
  /**
   * Whether this capture is known NOT to be a complete, self-contained snapshot of the object — a body cut
   * short by the depth cap, the per-item budget or a recoverable failure; a merge whose two lanes read
   * different versions; or a body inlining content another object owns and can change independently.
   * Recorded on the record itself (`capture: "partial"`) because two readers need it: a person reading a
   * short page that is not actually short, and `seenIndex.ts`, which must never let such a capture
   * authorise skipping the re-fetch that would repair it. `seenIndex.ts` enumerates all four causes.
   */
  readonly partial?: boolean;
}

/** A Notion database's metadata. */
export interface NotionDatabaseItem {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly tsIso: string;
  readonly description: string;
  readonly raw?: Readonly<Record<string, unknown>>;
}

/** The `attrs` for one page chunk: `parent` when the page has one, chunk position when multi-chunk. Pure. */
function pageChunkAttrs({
  page,
  index,
  chunkCount,
}: {
  page: NotionPageItem;
  index: number;
  chunkCount: number;
}): Record<string, CorpusAttributeValue> {
  const attrs: Record<string, CorpusAttributeValue> = {};
  if (page.parent !== undefined && page.parent.length > 0) {
    attrs["parent"] = page.parent;
  }
  if (chunkCount > 1) {
    attrs["chunkIndex"] = index;
    attrs["chunkCount"] = chunkCount;
  }
  if (page.partial === true) {
    // On EVERY chunk, not just chunk 0: the truncation applies to the whole page, and `seenIndex.ts` reads
    // one record at a time with no way to find its siblings. A complete capture carries no attr at all, so
    // an unchanged page's fingerprint is byte-identical to what earlier runs already wrote.
    attrs[CAPTURE_ATTR] = CAPTURE_PARTIAL;
  }
  return attrs;
}

/**
 * The page's curated relation edges. The fetch leaves `relationTargets` off a page whose `relation`
 * properties point nowhere, so an absent list is a page declaring no relation edge.
 */
function relationEdges({ page }: { page: NotionPageItem }): readonly string[] {
  const { relationTargets } = page;
  if (relationTargets == null) {
    return [];
  }
  return relationTargets.map((target) => encodeCuratedEdgeRef({ kind: "relation", target }));
}

/**
 * The page's curated mention edges. The fetch leaves `mentionTargets` off a page whose body mentions
 * nothing, so an absent list is a page declaring no mention edge.
 */
function mentionEdges({ page }: { page: NotionPageItem }): readonly string[] {
  const { mentionTargets } = page;
  if (mentionTargets == null) {
    return [];
  }
  return mentionTargets.map((target) => encodeCuratedEdgeRef({ kind: "mention", target }));
}

/**
 * The curated attrs for a page/row — classification + declared relation/mention edges + ref-only files.
 * Anchored to the page's representative record (chunk 0), so an edge's `from` node is the page node. Pure.
 */
function curatedPageAttrs({ page }: { page: NotionPageItem }): Record<string, CorpusAttributeValue> {
  const attrs: Record<string, CorpusAttributeValue> = {};
  const classification = classifyCurated({ kind: "page", text: page.chunks.join("\n"), title: page.title });
  if (classification !== undefined) {
    attrs[CURATED_CLASS_ATTR] = classification;
  }
  const edges = [...relationEdges({ page }), ...mentionEdges({ page })];
  if (edges.length > 0) {
    attrs[CURATED_EDGES_ATTR] = edges;
  }
  if (page.fileRefs !== undefined && page.fileRefs.length > 0) {
    attrs["files"] = page.fileRefs;
  }
  if (page.bodyDigest !== undefined) {
    attrs[BODY_ATTR] = bodyRef({ digest: page.bodyDigest });
  }
  return attrs;
}

/** One page-chunk record (single-chunk pages keep the bare `page:<id>` id + title). Pure. */
function pageChunkRecord({
  page,
  container,
  chunk,
  index,
  chunkCount,
  extraAttrs = {},
}: {
  page: NotionPageItem;
  container: string;
  chunk: string;
  index: number;
  chunkCount: number;
  extraAttrs?: Readonly<Record<string, CorpusAttributeValue>>;
}): CorpusRecord {
  const single = chunkCount === 1;
  const attrs = { ...pageChunkAttrs({ chunkCount, index, page }), ...extraAttrs };
  return {
    container,
    kind: "page",
    refs: extractRefs({ text: chunk }),
    source: "notion",
    sourceId: single ? `page:${page.id}` : `page:${page.id}:chunk:${String(index)}`,
    text: chunk.length > 0 ? chunk : page.title,
    title: single ? page.title : `${page.title} (${String(index + 1)}/${String(chunkCount)})`,
    tsIso: page.tsIso,
    url: page.url,
    ...(Object.keys(attrs).length > 0 ? { attrs } : {}),
    ...(page.raw !== undefined ? { raw: page.raw } : {}),
  };
}

/** One page-comment record. Pure. */
function pageCommentRecord({
  page,
  container,
  comment,
}: {
  page: NotionPageItem;
  container: string;
  comment: NotionCommentItem;
}): CorpusRecord {
  return {
    container,
    kind: "comment",
    refs: extractRefs({ text: comment.body }),
    source: "notion",
    sourceId: `page:${page.id}:comment:${comment.id}`,
    text: comment.body,
    tsIso: comment.tsIso,
    url: page.url,
    ...(comment.author !== undefined ? { author: comment.author } : {}),
    ...(comment.raw !== undefined ? { raw: comment.raw } : {}),
  };
}

/** Page-chunk records + comment records for one page. Composes the pure chunk/comment builders. */
function pageRecords({ page }: { page: NotionPageItem }): CorpusRecord[] {
  const container = page.parent !== undefined && page.parent.length > 0 ? `notion/${page.parent}` : "notion";
  const chunks = page.chunks.length > 0 ? page.chunks : [page.title];
  const curated = curatedPageAttrs({ page });
  const records: CorpusRecord[] = chunks.map((chunk, index) =>
    pageChunkRecord({
      chunk,
      chunkCount: chunks.length,
      container,
      index,
      page,
      ...(index === 0 ? { extraAttrs: curated } : {}),
    }),
  );
  for (const comment of page.comments) {
    if (comment.body.trim().length === 0) {
      continue;
    }
    records.push(pageCommentRecord({ comment, container, page }));
  }
  return records;
}

/** One database metadata record. */
function databaseRecord({ database }: { database: NotionDatabaseItem }): CorpusRecord {
  return {
    container: "notion",
    kind: "database",
    refs: extractRefs({ text: `${database.title}\n${database.description}` }),
    source: "notion",
    sourceId: `database:${database.id}`,
    text: database.description.length > 0 ? database.description : database.title,
    title: database.title,
    tsIso: database.tsIso,
    url: database.url,
    ...(database.raw !== undefined ? { raw: database.raw } : {}),
  };
}

/**
 * Project pages (chunked) + their comments and databases into corpus records.
 *
 * @param pages the fetched pages
 * @param databases the fetched databases
 * @returns the flattened corpus records
 */
export function projectNotionRecords({
  pages,
  databases,
}: {
  pages: readonly NotionPageItem[];
  databases: readonly NotionDatabaseItem[];
}): readonly CorpusRecord[] {
  const records: CorpusRecord[] = [];
  for (const page of pages) {
    records.push(...pageRecords({ page }));
  }
  for (const database of databases) {
    records.push(databaseRecord({ database }));
  }
  return records;
}
