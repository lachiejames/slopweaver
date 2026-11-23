/**
 * Capturing ONE page: its markdown body, its comments, any attachment pass, and the parsed body it stores.
 *
 * Split out of `liveApi.ts` (the seam this belongs to) purely to keep that file under the repo's file-size
 * ratchet, exactly as `liveApiDatabases.ts` was. The boundary is a real one rather than a line count,
 * though, and it is worth naming: everything here is what ONE page costs, while the LANE in
 * `liveApiPagesLane.ts` is searching, scheduling against the unchanged-index, draining the child-page
 * frontier and collecting the results. This file has no path into another page at all, which is the structural property the flat
 * walk exists to hold (`docs/notion-coverage.md`).
 */
import type { Client } from "@notionhq/client";

import type { AttachmentTransport } from "./attachmentFetch.js";
import type { StoredAttachment } from "./attachmentStore.js";
import type { StoredBody } from "./bodyStore.js";
import type { GatedCall } from "./callDeadline.js";
import type { NotionCaptureCaps } from "./caps.js";
import { projectPageItem } from "./fetch.js";
import { createNotionItemBudget, hitItemDeadline, itemDeadlineNote, pageComments } from "./itemCrawl.js";
import { type NotionMarkdownReader, type RenderedMarkdownBody, renderMarkdownBody } from "./liveMarkdown.js";
import { recoverOmittedTranscripts } from "./liveTranscripts.js";
import type { NotionMdNode } from "./markdownNodes.js";
import { fetchPageAttachments, type PageAttachments } from "./pageAttachments.js";
import type { NotionPageItem } from "./project.js";
import { captureWasTruncated, type NotionSkip } from "./skips.js";

/**
 * The attachment capability a lane may be given.
 *
 * OPTIONAL on purpose. Storing a provider's file bytes is new data at rest and the first time this corpus
 * has done it, so a caller that does not pass this gets exactly the behaviour that shipped before: the
 * reference line, and no bytes. `refresh --no-notion-attachments` is what withholds it.
 */
export interface NotionAttachmentPass {
  readonly ceilingBytes: number;
  readonly transport: AttachmentTransport;
  readonly store: (args: { bytes: Buffer; contentType: string | undefined }) => StoredAttachment;
}

/**
 * The body-sidecar capability a lane may be given: where a page's parsed tree is put once it is read.
 *
 * A SEAM rather than a home path, for the same reason the attachment store is one — this module resolves no
 * `$SLOPWEAVER_HOME` sub-path of its own, and a test can hand it a function that writes into a temp
 * directory it controls. A lane given none still captures the whole body; what it loses is the ability to
 * re-derive that body's text later without calling Notion again (`bodyStore.ts`).
 */
export type NotionBodyStore = (args: { tree: readonly NotionMdNode[] }) => StoredBody;

/**
 * One page's attachment pass, empty when there is none to run.
 *
 * Only a page whose body actually references media pays for the extra top-level `blocks.children.list`
 * pass, and a lane given no attachment capability pays for none at all. The body read cannot supply a
 * fetchable url (see `pageAttachments.ts`), which is why that second pass is where the bytes come from.
 *
 * Answers the EMPTY pass rather than `undefined` when there is nothing to do. The caller only ever folds
 * these two lists into its own, so "no pass ran" and "a pass ran and found nothing" are the same fact to
 * it — and modelling them apart bought two `??` substitutions and nothing else.
 *
 * @param attachments the lane's attachment capability, absent when it was given none
 * @param fileRefs the media references the body render found; an empty list means there is nothing to fetch
 * @param itemBudget the allowance this item's whole capture shares
 * @returns what the pass pulled, empty when none ran
 */
async function pullPageAttachments({
  attachments,
  fileRefs,
  call,
  client,
  itemBudget,
  pageId,
  scopeId,
}: {
  attachments: NotionAttachmentPass | undefined;
  fileRefs: readonly string[];
  call: GatedCall;
  client: Client;
  itemBudget: ReturnType<typeof createNotionItemBudget>;
  pageId: string;
  scopeId: string;
}): Promise<PageAttachments> {
  if (attachments === undefined || fileRefs.length === 0) {
    return { fetched: 0, refs: [], refused: 0, skips: [] };
  }
  return fetchPageAttachments({ ...attachments, call, client, itemBudget, pageId, scopeId });
}

/**
 * The one note an item that ran out of its allowance owes, or none at all.
 *
 * Both halves of the condition are load-bearing: a capture can carry a deadline skip while the budget
 * reports nothing stopped it (a recovered failure), and the note is only honest when the budget itself
 * names what it ran out of.
 *
 * @param id the page the note is about
 * @param itemBudget the allowance the whole capture shared, read for what it spent and what stopped it
 * @param skips every skip the capture collected — where a deadline hit is recorded
 * @param startedAtMs when this item's capture began
 * @returns zero or one note line
 */
function itemDeadlineNotes({
  id,
  itemBudget,
  skips,
  startedAtMs,
}: {
  id: string;
  itemBudget: ReturnType<typeof createNotionItemBudget>;
  skips: readonly NotionSkip[];
  startedAtMs: number;
}): readonly string[] {
  const stoppedBy = itemBudget.stoppedBy();
  if (!hitItemDeadline({ skips }) || stoppedBy === undefined) {
    return [];
  }
  return [itemDeadlineNote({ calls: itemBudget.spent(), id, kind: "page", startedAtMs, stoppedBy })];
}

/**
 * The `bodyDigest` argument for a page item: the stored tree's digest, or nothing at all.
 *
 * **An EMPTY tree from a successful read is stored, and one from a FAILED read is not**, and the difference
 * is the whole reason this is a function rather than one expression. A digest naming the empty tree is a
 * claim — "this body was read and there was nothing in it" — that a later re-derivation acts on by
 * rendering nothing rather than re-fetching. When `pages.retrieveMarkdown` errors, `renderMarkdownBody`
 * answers the same empty tree it answers for a genuinely blank page, so storing unconditionally would write
 * that claim about a page nobody has read. Such a row IS also marked `capture: partial`, so `seenIndex.ts`
 * would force the re-fetch and nothing would be lost — but a false statement on the record that another
 * mechanism happens to cover is still a false statement, and the next reader has no way to know which one
 * they are holding.
 *
 * @param storeBody the sidecar seam, absent when the lane was given none
 * @param tree the parsed body the render produced
 * @param bodyFailed whether the body read itself failed, so the empty tree means "unread", not "empty"
 * @returns a one-key object to spread into the item, or an empty one
 */
function storedBodyArg({
  storeBody,
  tree,
  bodyFailed,
}: {
  storeBody: NotionBodyStore | undefined;
  tree: readonly NotionMdNode[];
  bodyFailed: boolean;
}): { bodyDigest?: string } {
  if (storeBody === undefined || bodyFailed) {
    return {};
  }
  return { bodyDigest: storeBody({ tree }).digest };
}

/**
 * One page's body: the markdown read, then any meeting-note transcript that read omitted, spliced back in.
 *
 * @param pageId the page whose body is read
 * @param itemBudget the allowance this item's whole capture shares
 * @returns the rendered body, with the transcript recovery's skips folded into its own
 */
async function renderPageBody({
  call,
  client,
  itemBudget,
  pageId,
  reader,
  scopeId,
}: {
  call: GatedCall;
  client: Client;
  itemBudget: ReturnType<typeof createNotionItemBudget>;
  pageId: string;
  reader: NotionMarkdownReader;
  scopeId: string;
}): Promise<RenderedMarkdownBody> {
  const markdown = await renderMarkdownBody({ itemBudget, pageId, reader });
  const transcripts = await recoverOmittedTranscripts({
    call,
    client,
    itemBudget,
    scopeId,
    text: markdown.text,
    tree: markdown.tree,
  });
  return {
    ...markdown,
    skips: [...markdown.skips, ...transcripts.skips],
    text: transcripts.text,
    tree: transcripts.tree,
  };
}

/**
 * Fetch and shape ONE page: its markdown body plus its comments, with every skip collected.
 *
 * The body now comes from ONE `pages.retrieveMarkdown` call rather than a recursive `blocks.children.list`
 * descent, and the difference that matters is structural rather than numeric. {@link renderMarkdownBody}
 * has no path into another page at all, so this function CANNOT walk out of the page it is capturing. The
 * child pages it meets come back as ids on the result, and the lane schedules them as work of their own.
 * The one block read a body pays for is a meeting note's transcript, which markdown omits by design
 * (`liveTranscripts.ts`).
 *
 * ONE allowance is shared by the body render, the comment paging and any attachment pass: the three
 * together are what this item costs, and splitting it would let a page spend twice the budget by using
 * two halves.
 *
 * @param storeBody the body sidecar seam; a lane given none still captures the body, it just stores no tree
 * @returns the shaped item, the child pages to schedule, every skip, and any deadline note
 */
export async function fetchOnePage({
  raw,
  id,
  lastEdited,
  client,
  call,
  scopeId,
  caps,
  reader,
  attachments,
  storeBody,
}: {
  raw: Record<string, unknown>;
  id: string;
  lastEdited: string;
  client: Client;
  call: GatedCall;
  scopeId: string;
  caps: NotionCaptureCaps;
  reader: NotionMarkdownReader;
  attachments: NotionAttachmentPass | undefined;
  storeBody: NotionBodyStore | undefined;
}): Promise<{
  item: NotionPageItem;
  skips: readonly NotionSkip[];
  notes: readonly string[];
  childPageIds: readonly string[];
}> {
  const startedAtMs = Date.now();
  const itemBudget = createNotionItemBudget({ maxCalls: caps.itemCallBudget, maxMs: caps.itemTimeBudgetMs });
  const rendered = await renderPageBody({ call, client, itemBudget, pageId: id, reader, scopeId });
  const comments = await pageComments({ call, client, itemBudget, pageId: id, scopeId });
  const pulled = await pullPageAttachments({
    attachments,
    call,
    client,
    fileRefs: rendered.fileRefs,
    itemBudget,
    pageId: id,
    scopeId,
  });
  const skips = [...rendered.skips, ...comments.skips, ...pulled.skips];
  return {
    childPageIds: rendered.childPageIds,
    item: projectPageItem({
      ...storedBodyArg({ bodyFailed: rendered.bodyUnread, storeBody, tree: rendered.tree }),
      comments: comments.comments,
      fileRefs: [...rendered.fileRefs, ...pulled.refs],
      id,
      lastEdited,
      mentionTargets: rendered.mentions,
      // Not self-contained ⇒ not skippable: a truncated capture, or one holding another object's bytes.
      partial: captureWasTruncated({ skips }) || rendered.borrowsContent,
      raw,
      text: rendered.text,
    }),
    notes: itemDeadlineNotes({ id, itemBudget, skips, startedAtMs }),
    skips,
  };
}
