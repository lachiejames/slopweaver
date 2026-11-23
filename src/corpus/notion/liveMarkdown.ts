/**
 * Reading ONE Notion page's body as markdown, in one request, with no way to descend into another page.
 *
 * This replaces the recursive `blocks.children.list` walk as the pages lane's body source. The property that
 * matters is not that it is faster, though it is: it is that **this module cannot recurse into a page at
 * all.** `renderMarkdownBody` returns the child page ids it found and fetches none of them. The lane that
 * calls it decides what to do with that list, so the descent has nowhere to happen.
 *
 * ## Why the old shape had to go
 *
 * `blockChildId` (`fetchProject.ts`) returns the id of any block with `has_children`, and a `child_page` IS
 * such a block. So `renderBlocks` walked out of the page it was capturing and inlined other pages' whole
 * bodies into their ancestor. MEASURED over the 287 pages one stopped run reached: 23 of the 188
 * pages with a checkable body, **12.2%**, had their own text also stored inside another page's record, and
 * one carrier page held 527,140 characters. At the shipped depth cap of 6 that was bounded; lifted to 50 it
 * was not, which is where a whole re-pull's twelve days came from.
 *
 * ## What one request gets instead, measured back to back
 *
 * Six pages that hold their whole body themselves, read twice in the same minutes: the recursive renderer at
 * depth 50 spent **73 requests and 42.3s for 106,661 characters**, and `pages.retrieveMarkdown` spent
 * **6 requests and 4.0s for 125,699**, with no skip reported on either side. Twelve times fewer requests,
 * ten times faster, and slightly MORE text. Reproduce it by reading the same page id both ways through this
 * repository's own seams and comparing the character counts.
 *
 * ## The one thing that is genuinely harder here
 *
 * A child page is a REFERENCE in markdown, not a body, and **51% of child pages are invisible to `search`**
 * (`docs/notion-coverage.md`, measured: 98 found by recursion, 48 also searchable). The old
 * recursion was the only path to the other half. So dropping the descent without carrying the ids forward
 * would lose those pages outright, which is why {@link RenderedMarkdownBody.childPageIds} exists and why the
 * lane treats it as work rather than as trivia.
 */
import type { Client } from "@notionhq/client";

import type { IngestError } from "../../lib/ingestError.js";
import { ingestErrorToThrowable } from "../../lib/ingestError.js";
import { safeProviderCall } from "../../lib/providerCall.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { GatedCall } from "./callDeadline.js";
import { canonicalNotionId } from "./canonicalId.js";
import type { NotionItemBudget } from "./itemCrawl.js";
import type { NotionMdNode } from "./markdownNodes.js";
import { type ProjectedNotionMarkdown, projectNotionMarkdown } from "./projectNotionMarkdown.js";
import { classifyNotionSkip, type NotionSkip, skipIsFatal } from "./skips.js";

/** The API version that serves the markdown retrieve endpoint. */
export const NOTION_MARKDOWN_READ_VERSION = "2026-03-11";

/** One page or block body as Notion returns it, with the two completeness flags it reports. */
export interface CanonicalNotionMarkdown {
  readonly markdown: string;
  readonly truncated: boolean;
  readonly unknownBlockIds: readonly string[];
}

/** The single provider seam this module reads through. */
export interface NotionMarkdownReader {
  retrieveMarkdown(args: { id: string }): Promise<Result<CanonicalNotionMarkdown, IngestError>>;
}

/**
 * A page body as the corpus needs it, deliberately the same shape the recursive renderer returned.
 *
 * `childPageIds` is the one addition, and it is what makes the swap safe rather than lossy.
 */
export interface RenderedMarkdownBody {
  readonly text: string;
  readonly mentions: readonly string[];
  readonly fileRefs: readonly string[];
  readonly skips: readonly NotionSkip[];
  readonly borrowsContent: boolean;
  /** Child pages this body REFERENCES. Never fetched here; the lane schedules them. */
  readonly childPageIds: readonly string[];
  /** The parsed tree, stored on the record so re-derivation never has to call Notion again. */
  readonly tree: readonly NotionMdNode[];
  /**
   * Whether the body read ITSELF failed, so this body was never seen at all.
   *
   * Reported as its own field rather than inferred from `skips`, because the two states it separates are
   * INDISTINGUISHABLE in every other field: a page with a genuinely blank body and a page whose
   * `pages.retrieveMarkdown` call errored both come back with empty `text` and an empty `tree`. A caller
   * that stores the tree needs to know which it is holding — storing the empty tree for an unread page
   * records the claim "read, and empty" about a page nobody read (`liveApi.ts#storedBodyArg`). Sniffing a
   * skip's `subject` string for `"page body"` would have worked today and broken silently the first time
   * that wording changed.
   */
  readonly bodyUnread: boolean;
}

/**
 * The Notion id at the end of a page or block url, in its canonical dashed spelling, or undefined. Pure.
 *
 * Notion writes an id both dashed and undashed depending on the surface, so the dashes are stripped to find
 * it and then put back: the id this returns becomes a child page's `sourceId` and is checked against the
 * frontier's `visited` set of search-hit ids, both of which are dashed (`canonicalId.ts`). A url that carries
 * no id yields undefined rather than a guess.
 *
 * @param url the `url` attribute off a `page`, `unknown` or mention tag
 * @returns the `8-4-4-4-12` lowercase id, or undefined
 */
export function notionIdFromUrl({ url }: { url: string }): string | undefined {
  const tail = url.split(/[/?#]/).findLast((part) => part.length > 0);
  if (tail === undefined) {
    return undefined;
  }
  // Strip dashes across the WHOLE tail before taking the id, not after splitting on them. Splitting first
  // reads an all-ones dashed id as its last segment alone, which is 12 characters and
  // fails the test — caught by this module's own unit test rather than in a crawl.
  const bare = tail.replaceAll("-", "");
  if (bare.length < 32) {
    return undefined;
  }
  return canonicalNotionId({ id: bare.slice(-32) });
}

/**
 * One `pages.retrieveMarkdown` call, gated and safe-wrapped. The sole provider boundary in this module.
 *
 * @param client a client pinned to {@link NOTION_MARKDOWN_READ_VERSION}, since the default version does not
 *   serve this endpoint
 * @param call the lane's shared rate-gated, deadline-raced runner
 * @param scopeId the provider-door scope these calls are accounted to
 * @returns the reader seam {@link renderMarkdownBody} takes
 */
export function makeNotionMarkdownReader({
  client,
  call,
  scopeId,
}: {
  client: Client;
  call: GatedCall;
  scopeId: string;
}): NotionMarkdownReader {
  return {
    retrieveMarkdown: async ({ id }) => {
      const called = await safeProviderCall({
        execute: () => call(() => client.pages.retrieveMarkdown({ page_id: id })),
        operation: "notion.pages.retrieveMarkdown",
        provider: "notion",
        retryMode: "transient",
        scopeId,
      });
      if (called.isErr()) {
        return err(called.error);
      }
      return ok({
        markdown: called.value.markdown,
        truncated: called.value.truncated,
        unknownBlockIds: called.value.unknown_block_ids,
      });
    },
  };
}

/**
 * The skip for a failed markdown read, or a THROW for the one class that must abort the run.
 *
 * Same contract as the block reader it replaces: an `auth` failure is a property of the RUN rather than of
 * this page, so skipping every page under it would report a near-empty corpus as a successful one.
 */
function markdownFailureSkip({ error, subject }: { error: IngestError; subject: string }): NotionSkip {
  const reason = classifyNotionSkip({ error });
  if (skipIsFatal({ reason })) {
    throw ingestErrorToThrowable({ error });
  }
  return { operation: error.operation, reason, subject };
}

/** The ids an unknown-block placeholder names, deduplicated and in document order. Pure. */
function unknownIdsOf({ projected }: { projected: ProjectedNotionMarkdown }): readonly string[] {
  const seen = new Set<string>();
  for (const url of projected.unknownUrls) {
    const id = notionIdFromUrl({ url });
    if (id !== undefined) {
      seen.add(id);
    }
  }
  return [...seen];
}

/** Everything one projection contributes, merged into the accumulating body. Pure. */
function foldProjection({
  into,
  projected,
}: {
  into: RenderedMarkdownBody;
  projected: ProjectedNotionMarkdown;
}): RenderedMarkdownBody {
  const text = [into.text, projected.text].filter((part) => part.length > 0).join("\n\n");
  return {
    // Carried, never recomputed: a fold only ever runs over a projection that CAME BACK, so it can never
    // turn an unread body into a read one, and it must not silently clear the flag either.
    bodyUnread: into.bodyUnread,
    borrowsContent: into.borrowsContent || projected.borrowsContent,
    childPageIds: [
      ...into.childPageIds,
      ...projected.childPageUrls.flatMap((url) => {
        const id = notionIdFromUrl({ url });
        return id === undefined ? [] : [id];
      }),
    ],
    fileRefs: [...into.fileRefs, ...projected.mediaSrcs],
    mentions: [...into.mentions, ...projected.mentionUrls],
    skips: into.skips,
    text,
    tree: [...into.tree, ...projected.tree],
  };
}

/** An empty body, the identity the fold starts from. */
const EMPTY_BODY: RenderedMarkdownBody = {
  bodyUnread: false,
  borrowsContent: false,
  childPageIds: [],
  fileRefs: [],
  mentions: [],
  skips: [],
  text: "",
  tree: [],
};

/**
 * Read one page's body as markdown, then recover whatever Notion reported it could not render.
 *
 * Recovery is ONE level deep and bounded by the item budget: an unknown block inside a recovered subtree is
 * recorded as a skip rather than chased. That is a deliberate ceiling, because the unknown list does not
 * distinguish "truncated" from "you cannot see this", so an unbounded chase can spend a whole budget on
 * blocks that will never resolve.
 *
 * There is NO path from here into a child page. Their ids come back on the result instead.
 *
 * @param reader the markdown seam
 * @param pageId the page whose body is read
 * @param itemBudget the per-item allowance shared with this item's comment paging
 * @returns the rendered body, its child page ids, its parsed tree, and every skip on the way
 */
export async function renderMarkdownBody({
  reader,
  pageId,
  itemBudget,
}: {
  reader: NotionMarkdownReader;
  pageId: string;
  itemBudget: NotionItemBudget;
}): Promise<RenderedMarkdownBody> {
  itemBudget.spendCall();
  const first = await reader.retrieveMarkdown({ id: pageId });
  if (first.isErr()) {
    return {
      ...EMPTY_BODY,
      bodyUnread: true,
      skips: [markdownFailureSkip({ error: first.error, subject: "page body" })],
    };
  }
  const projected = projectNotionMarkdown({ markdown: first.value.markdown });
  let body = foldProjection({ into: EMPTY_BODY, projected });
  const skips: NotionSkip[] = [];
  for (const gap of projected.gaps) {
    skips.push({ operation: "notion.pages.retrieveMarkdown", reason: "unknown", subject: `markdown tag ${gap.tag}` });
  }
  for (const id of unknownIdsOf({ projected })) {
    if (itemBudget.exhausted()) {
      skips.push({ operation: "notion.pages.retrieveMarkdown", reason: "item-deadline", subject: "unknown block" });
      break;
    }
    itemBudget.spendCall();
    const recovered = await reader.retrieveMarkdown({ id });
    if (recovered.isErr()) {
      skips.push(markdownFailureSkip({ error: recovered.error, subject: "unknown block" }));
      continue;
    }
    const inner = projectNotionMarkdown({ markdown: recovered.value.markdown });
    body = foldProjection({ into: body, projected: inner });
    if (inner.unknownUrls.length > 0 || recovered.value.truncated) {
      skips.push({
        operation: "notion.pages.retrieveMarkdown",
        reason: "result-limit",
        subject: "nested unknown block",
      });
    }
  }
  if (first.value.truncated && projected.unknownUrls.length === 0) {
    // Notion said the body is incomplete but named nothing to fetch, so there is no recovery to attempt and
    // the capture must say so rather than look whole.
    skips.push({ operation: "notion.pages.retrieveMarkdown", reason: "result-limit", subject: "page body" });
  }
  return { ...body, skips };
}
