/**
 * Reading ONE Notion node's body: its block tree, rendered to plain text. Its comments are `itemCrawl.ts`.
 *
 * Split out of `liveApi.ts` when that file passed its 1,000-line ceiling. The boundary is a natural one
 * rather than an arbitrary cut: everything here answers "what does this single page or row contain",
 * takes only an already-built `Client` plus the shared gated caller, and knows nothing about search,
 * paging lanes, budgets or the unchanged-skip. The lanes that DO know those things live next door and
 * call {@link renderBlocks} once per item.
 *
 * Every call routes through the shared provider door and the caller's ONE rate scheduler. A node that
 * cannot be read becomes a classified skip rather than a throw — see `skips.ts` for why, and why `auth`
 * is the single exception that still aborts the run.
 */
import type { Client } from "@notionhq/client";

import type { IngestError } from "../../lib/ingestError.js";
import { ingestErrorToThrowable } from "../../lib/ingestError.js";
import { isRecord } from "../../lib/parsers.js";
import { safeProviderCall } from "../../lib/providerCall.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { GatedCall } from "./callDeadline.js";
import { DEFAULT_NOTION_CAPTURE_CAPS } from "./caps.js";
import { blockFileRef } from "./curated.js";
import { blockBorrowsContent, blockChildId, blockMentions, blockTextLine, notionNextCursor } from "./fetch.js";
import { itemBoundReason, type NotionItemBudget } from "./itemCrawl.js";
import { classifyNotionSkip, type NotionSkip, skipIsFatal } from "./skips.js";

/** One `blocks.children.list` / `comments.list` page size — Notion's maximum. */
const PAGE_SIZE = 100;

/**
 * One `blocks.children.list` page — the sole `client.blocks` boundary, gated + safe-wrapped.
 *
 * Deliberately does NOT `orThrow`. This is the call that killed whole runs: the typed failure was
 * immediately converted back into a throw, which escaped every frame up to `fetchNotionActivity`'s
 * catch-all and returned `err` — so one nested block in an unshared teamspace meant exit 1, zero records
 * and no watermark. The typed error is returned instead, and {@link renderBlocks} classifies it into a
 * {@link NotionSkip}. See `skips.ts` for why the reason has to be typed rather than a warning string.
 */
async function listBlockChildren({
  client,
  call,
  scopeId,
  blockId,
  cursor,
}: {
  client: Client;
  call: GatedCall;
  scopeId: string;
  blockId: string;
  cursor: string | undefined;
}): Promise<Result<{ results: readonly unknown[]; nextCursor: string | undefined }, IngestError>> {
  const result = await safeProviderCall({
    execute: () =>
      call(() =>
        client.blocks.children.list({
          block_id: blockId,
          page_size: PAGE_SIZE,
          ...(cursor !== undefined ? { start_cursor: cursor } : {}),
        }),
      ),
    operation: "notion.blocks.children.list",
    provider: "notion",
    retryMode: "transient",
    scopeId,
  });
  if (result.isErr()) {
    return err(result.error);
  }
  return ok({
    nextCursor: notionNextCursor({ value: result.value.next_cursor }),
    results: result.value.results,
  });
}

/**
 * A page's rendered body: plain text + the explicit mention targets + ref-only file lines it contains, plus
 * every node that could NOT be read on the way. A non-empty `skips` means `text` is PARTIAL — the body is
 * incomplete and says so, rather than looking like a short page.
 */
interface RenderedBlocks {
  readonly text: string;
  readonly mentions: readonly string[];
  readonly fileRefs: readonly string[];
  readonly skips: readonly NotionSkip[];
  /**
   * Whether anything in this subtree inlined content OWNED by another object (see
   * `fetch.ts#blockBorrowsContent`). Reported so the capture can say it is not self-contained: the borrowed
   * bytes can change without this page's `last_edited_time` moving, so nothing may skip a re-fetch of it.
   */
  readonly borrowsContent: boolean;
}

/** One block's own (non-recursive) contribution: its rendered line, mention targets, and file ref. Pure. */
function blockContribution({ block }: { block: Record<string, unknown> }): {
  line: string;
  mentions: readonly string[];
  fileRefs: readonly string[];
} {
  const fileRef = blockFileRef({ block });
  return {
    fileRefs: fileRef !== undefined ? [fileRef] : [],
    line: blockTextLine({ block }),
    mentions: blockMentions({ block }),
  };
}

/** The mutable accumulator one node's block render fills, so the recursion has one place to append to. */
interface BlockAccumulator {
  readonly lines: string[];
  readonly mentions: string[];
  readonly fileRefs: string[];
  readonly skips: NotionSkip[];
  borrowsContent: boolean;
}

/**
 * The skip for a failed `blocks.children.list`, or a THROW for the one class that must abort the run.
 *
 * An `auth` failure is re-thrown because a rejected token is a property of the run, not of this block:
 * skipping every page under it would report a near-empty corpus as a successful one.
 */
function blockFailureSkip({ error, depth }: { error: IngestError; depth: number }): NotionSkip {
  const reason = classifyNotionSkip({ error });
  if (skipIsFatal({ reason })) {
    throw ingestErrorToThrowable({ error });
  }
  return { operation: error.operation, reason, subject: depth === 0 ? "page body" : "nested block" };
}

/** Absorb one raw block into the accumulator: its own contribution, then its children (bounded by depth). */
async function absorbBlock({
  block,
  acc,
  client,
  call,
  scopeId,
  depth,
  maxDepth,
  itemBudget,
}: {
  block: Record<string, unknown>;
  acc: BlockAccumulator;
  client: Client;
  call: GatedCall;
  scopeId: string;
  depth: number;
  maxDepth: number;
  itemBudget: NotionItemBudget;
}): Promise<void> {
  const contrib = blockContribution({ block });
  acc.lines.push(contrib.line);
  acc.mentions.push(...contrib.mentions);
  acc.fileRefs.push(...contrib.fileRefs);
  acc.borrowsContent = acc.borrowsContent || blockBorrowsContent({ block });
  const childId = blockChildId({ block });
  if (childId === undefined) {
    return;
  }
  const child = await renderBlocks({ blockId: childId, call, client, depth: depth + 1, itemBudget, maxDepth, scopeId });
  acc.lines.push(child.text);
  acc.mentions.push(...child.mentions);
  acc.fileRefs.push(...child.fileRefs);
  acc.skips.push(...child.skips);
  acc.borrowsContent = acc.borrowsContent || child.borrowsContent;
}

/**
 * What a descent past the depth cap renders: nothing, and a named skip saying so.
 *
 * It used to be empty text with no signal at all, so a body truncated by OUR bound was indistinguishable
 * from a block that genuinely had no children — the quiet degradation this repo refuses.
 */
const DEPTH_CAPPED: RenderedBlocks = {
  borrowsContent: false,
  fileRefs: [],
  mentions: [],
  skips: [{ operation: "notion.blocks.children.list", reason: "depth-cap", subject: "nested block" }],
  text: "",
};

/**
 * Recursively render a page's block children to plain text — and collect the explicit mention targets +
 * ref-only file/media lines along the way — bounded by depth. Every call is rate-gated.
 *
 * A node that cannot be read yields a classified skip and the PARTIAL text gathered so far, rather than
 * killing the crawl. See `skips.ts` for why an unreadable nested block is normal rather than exceptional.
 *
 * `itemBudget` is the coarser, per-ITEM bound alongside the per-call watchdog (see
 * {@link ITEM_CALL_BUDGET}): a page with an unusually large block tree can otherwise issue hundreds of
 * requests with every individual call succeeding quickly. Checked at the top of the page loop, so a page
 * that spends it still keeps whatever it rendered beforehand.
 *
 * @param client the live Notion client
 * @param call the shared rate-gated, deadline-raced call runner
 * @param scopeId the provider-door scope this crawl's calls are accounted to
 * @param blockId the node whose children are rendered — a page id at depth 0, a block id below it
 * @param depth how deep this descent already is, against {@link MAX_BLOCK_DEPTH}
 * @param itemBudget this item's shared request allowance, spent by every call it makes
 * @returns the rendered text plus the mention targets, file refs, every skip on the way, and whether the
 *   subtree inlined content owned by another object; a non-empty `skips` means the text is PARTIAL
 *
 * The pages lane reads bodies through `liveMarkdown.ts`; this is the block reader for what markdown cannot
 * express, and its one caller is `liveTranscripts.ts`, rendering the meeting-note transcript markdown omits.
 */
export async function renderBlocks({
  client,
  call,
  scopeId,
  blockId,
  depth,
  maxDepth = DEFAULT_NOTION_CAPTURE_CAPS.maxBlockDepth,
  itemBudget,
}: {
  client: Client;
  call: GatedCall;
  scopeId: string;
  blockId: string;
  depth: number;
  maxDepth?: number;
  itemBudget: NotionItemBudget;
}): Promise<RenderedBlocks> {
  if (depth > maxDepth) {
    return DEPTH_CAPPED;
  }
  const acc: BlockAccumulator = { borrowsContent: false, fileRefs: [], lines: [], mentions: [], skips: [] };
  let cursor: string | undefined;
  do {
    const stoppedBy = itemBudget.stoppedBy();
    if (stoppedBy !== undefined) {
      acc.skips.push({
        operation: "notion.blocks.children.list",
        reason: itemBoundReason({ stoppedBy }),
        subject: "page body",
      });
      break;
    }
    itemBudget.spendCall();
    const page = await listBlockChildren({ blockId, call, client, cursor, scopeId });
    if (!page.isOk()) {
      acc.skips.push(blockFailureSkip({ depth, error: page.error }));
      break;
    }
    for (const result of page.value.results) {
      if (isRecord(result)) {
        await absorbBlock({ acc, block: result, call, client, depth, itemBudget, maxDepth, scopeId });
      }
    }
    cursor = page.value.nextCursor;
  } while (cursor !== undefined);
  return {
    borrowsContent: acc.borrowsContent,
    fileRefs: acc.fileRefs,
    mentions: acc.mentions,
    skips: acc.skips,
    text: acc.lines.filter((line) => line.length > 0).join("\n\n"),
  };
}
