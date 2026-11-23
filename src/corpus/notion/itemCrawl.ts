/**
 * What a lane reaches for once per Notion page or row, beside its body: the item's allowance, its comment
 * thread, and the note an item gets when that allowance ends its crawl.
 *
 * Split out of `liveBlocks.ts` when that file passed its 300-line cap. Both lanes import the allowance, the
 * comments and the note together, and the block render left behind there only spends the allowance. A comment
 * that cannot be read becomes a classified skip rather than a throw — see `skips.ts` for why, and why `auth` is
 * the single exception that still aborts the run.
 */
import type { Client } from "@notionhq/client";

import type { IngestError } from "../../lib/ingestError.js";
import { ingestErrorToThrowable } from "../../lib/ingestError.js";
import { safeProviderCall } from "../../lib/providerCall.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { GatedCall } from "./callDeadline.js";
import { DEFAULT_NOTION_CAPTURE_CAPS } from "./caps.js";
import { notionNextCursor, projectCommentItem } from "./fetch.js";
import type { NotionCommentItem } from "./project.js";
import { classifyNotionSkip, type NotionSkip, type NotionSkipReason, skipIsFatal } from "./skips.js";

/**
 * Which of an item's two bounds ended its crawl, or `undefined` while it still has room.
 *
 * @internal — {@link NotionItemBudget.stoppedBy} returns it and the lanes hand it straight to
 * {@link itemDeadlineNote}; no caller outside this crawl names the type.
 */
export type ItemStoppedBy = "calls" | "time";

/**
 * A shared per-item allowance: spent by every call the item makes, checked before each one.
 *
 * It bounds two different things at once, and both are needed once the request budget is liftable. The
 * REQUEST half bounds the work an item may do — a page issuing hundreds of individually-fast calls is
 * pathological however long it happens to take, and measured live one row held an entire chunked ingest for
 * over 20 minutes that way with every call succeeding. The TIME half bounds how long it may take to do it,
 * and is what still ends an item whose request budget has been lifted (see `caps.ts` for why lifting one
 * without the other makes a run unschedulable).
 */
export interface NotionItemBudget {
  /** Record one request against this item. */
  readonly spendCall: () => void;
  /** Whether the item has used up either bound and must stop. */
  readonly exhausted: () => boolean;
  /** How many requests it has spent — reported in the item's own note. */
  readonly spent: () => number;
  /** Which bound ended it, or undefined while it still has room under both. */
  readonly stoppedBy: () => ItemStoppedBy | undefined;
}

/**
 * A fresh allowance for one page or row.
 *
 * The clock starts HERE rather than at the first call, because the budget is created once per item at the
 * top of its own fetch and an item that spends minutes waiting for a rate slot has spent those minutes.
 *
 * @param maxCalls the request allowance (defaults to the shipped {@link DEFAULT_NOTION_CAPTURE_CAPS})
 * @param maxMs the wall-clock allowance, or undefined for none — the shipped default
 * @param nowMs the clock, injected so the bound is testable without a real one
 * @returns the budget, shared by that item's block recursion and its comment paging
 */
export function createNotionItemBudget({
  maxCalls = DEFAULT_NOTION_CAPTURE_CAPS.itemCallBudget,
  maxMs,
  nowMs = () => Date.now(),
}: { maxCalls?: number; maxMs?: number | undefined; nowMs?: () => number } = {}): NotionItemBudget {
  let spent = 0;
  const startedAtMs = nowMs();
  const stoppedBy = (): ItemStoppedBy | undefined => {
    if (spent >= maxCalls) {
      return "calls";
    }
    if (maxMs !== undefined && nowMs() - startedAtMs >= maxMs) {
      return "time";
    }
    return undefined;
  };
  return {
    exhausted: () => stoppedBy() !== undefined,
    spendCall: () => {
      spent += 1;
    },
    spent: () => spent,
    stoppedBy,
  };
}

/** One `comments.list` page — the sole `client.comments` boundary, gated + safe-wrapped. */
async function listComments({
  client,
  call,
  scopeId,
  pageId,
  cursor,
}: {
  client: Client;
  call: GatedCall;
  scopeId: string;
  pageId: string;
  cursor: string | undefined;
}): Promise<Result<{ results: readonly unknown[]; nextCursor: string | undefined }, IngestError>> {
  const result = await safeProviderCall({
    execute: () =>
      call(() =>
        client.comments.list({
          block_id: pageId,
          ...(cursor !== undefined ? { start_cursor: cursor } : {}),
        }),
      ),
    operation: "notion.comments.list",
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

/** The skip for a failed `comments.list`, or a THROW for the one class that must abort the run. */
function commentsFailureSkip({ error }: { error: IngestError }): NotionSkip {
  const reason = classifyNotionSkip({ error });
  if (skipIsFatal({ reason })) {
    throw ingestErrorToThrowable({ error });
  }
  return { operation: error.operation, reason, subject: "page comments" };
}

/**
 * The skip reason for whichever per-item bound ended an item. Pure.
 *
 * Two reasons rather than one because the two say different things to whoever reads the summary: an item
 * that spent its REQUEST budget did a pathological amount of work, while one that spent its TIME budget may
 * have done very little and waited. Once the request budget is liftable, telling them apart is the only way
 * to know what a lifted re-pull would actually cost.
 *
 * @param stoppedBy which bound the item's budget reports it ran out of
 * @returns the matching skip reason
 */
export function itemBoundReason({ stoppedBy }: { stoppedBy: ItemStoppedBy }): NotionSkipReason {
  return stoppedBy === "calls" ? "item-deadline" : "item-time-cap";
}

/**
 * Fetch a page's comments, paged to exhaustion (rate-gated). A failure is a classified SKIP, never fatal.
 *
 * The reason matters more here than anywhere else in the crawl: an integration without the read-comments
 * capability fails EVERY page with `restricted_resource`, and the old code turned each one into a warning
 * naming the page id. Thousands of near-identical warnings is how a missing capability hides — collapsed
 * into one `restricted: N` count, it reads as the single configuration fact it actually is.
 *
 * `itemBudget` is the same per-item allowance {@link ./liveBlocks.renderBlocks} spends — an item with an unusually large
 * comment thread can otherwise page for a very long time with every individual call succeeding.
 *
 * @param client the live Notion client
 * @param call the shared rate-gated, deadline-raced call runner
 * @param scopeId the provider-door scope this crawl's calls are accounted to
 * @param pageId the page or row whose comments are read
 * @param itemBudget this item's shared request allowance, spent by every call it makes
 * @returns the projected comments plus any classified skip; a skip means the thread is incomplete
 */
export async function pageComments({
  client,
  call,
  scopeId,
  pageId,
  itemBudget,
}: {
  client: Client;
  call: GatedCall;
  scopeId: string;
  pageId: string;
  itemBudget: NotionItemBudget;
}): Promise<{ comments: readonly NotionCommentItem[]; skips: readonly NotionSkip[] }> {
  const comments: NotionCommentItem[] = [];
  let cursor: string | undefined;
  do {
    const stoppedBy = itemBudget.stoppedBy();
    if (stoppedBy !== undefined) {
      return {
        comments,
        skips: [
          { operation: "notion.comments.list", reason: itemBoundReason({ stoppedBy }), subject: "page comments" },
        ],
      };
    }
    itemBudget.spendCall();
    const page = await listComments({ call, client, cursor, pageId, scopeId });
    if (!page.isOk()) {
      return { comments, skips: [commentsFailureSkip({ error: page.error })] };
    }
    for (const raw of page.value.results) {
      const comment = projectCommentItem({ raw });
      if (comment !== undefined) {
        comments.push(comment);
      }
    }
    cursor = page.value.nextCursor;
  } while (cursor !== undefined);
  return { comments, skips: [] };
}

/**
 * An ID-anchored note for an item whose own crawl ran out of one of its two bounds — CLI console output only
 * (`SourceIngestResult.notes`), never the public repo, unlike {@link NotionSkip.subject}'s deliberately
 * non-identifying label. The owner asked for exactly this to find the specific page/row.
 *
 * It reports BOTH numbers and which bound ended the item, because that pair is what sizes a lifted re-pull:
 * a page that spent 400 requests in 23 minutes and one that spent 12 in 23 minutes cost the same wall clock
 * for completely different reasons, and only one of them gets faster when the request budget is raised.
 *
 * @param kind whether the item was a standalone page or a data-source row
 * @param id the item's Notion id
 * @param parentId the owning data source, for a row
 * @param startedAtMs when this item's own crawl began, so the note can report how long it actually ran
 * @param calls the requests the item actually issued
 * @param stoppedBy which of the two bounds ended it
 * @returns the note line
 */
export function itemDeadlineNote({
  kind,
  id,
  parentId,
  startedAtMs,
  calls,
  stoppedBy,
}: {
  kind: "page" | "row";
  id: string;
  parentId?: string;
  startedAtMs: number;
  calls: number;
  stoppedBy: ItemStoppedBy;
}): string {
  const elapsedMin = ((Date.now() - startedAtMs) / 60_000).toFixed(1);
  const parent = parentId !== undefined ? ` (database ${parentId})` : "";
  const bound = stoppedBy === "calls" ? "request" : "time";
  return `notion: ${kind} ${id}${parent} hit its per-item ${bound} bound after ${String(calls)} request(s) and ${elapsedMin}m — kept partial content, skipped the remainder`;
}

/**
 * Whether a skip list includes either per-item bound.
 *
 * @param skips the skips collected for ONE item
 * @returns true when that item's crawl was cut short by its own request or time budget
 */
export function hitItemDeadline({ skips }: { skips: readonly NotionSkip[] }): boolean {
  return skips.some((skip) => skip.reason === "item-deadline" || skip.reason === "item-time-cap");
}
