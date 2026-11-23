/**
 * The live `pages` lane: search for `page` hits, schedule them against the unchanged-index and the item
 * budget, fetch each one concurrently, then drain the child-page frontier. Split out of `liveApi.ts` (the
 * file this seam belongs to) purely to keep that file under the repo's file-size ratchet, exactly as
 * `liveApiDatabases.ts` was. What ONE page costs is `liveApiPages.ts`; the factories that own the shared
 * client, scheduler and budget stay in `liveApi.ts`, which wires this lane in.
 */
import type { Client } from "@notionhq/client";
import pLimit from "p-limit";

import { isRecord } from "../../lib/parsers.js";
import { type SourceProgress, sourceHeartbeat } from "../progress.js";
import type { FetchBudget } from "./budget.js";
import type { GatedCall } from "./callDeadline.js";
import type { NotionCaptureCaps } from "./caps.js";
import { cutoffMs, lastEditedOf, type NotionApi, withinCutoff } from "./fetch.js";
import { fetchOnePage, type NotionAttachmentPass, type NotionBodyStore } from "./liveApiPages.js";
import { NOTION_ITEM_CONCURRENCY, notionSearch, pushIfDefined, searchNextCursor } from "./liveApiShared.js";
import type { NotionMarkdownReader } from "./liveMarkdown.js";
import type { NotionCrawlMeter } from "./meter.js";
import { drainChildPages, type FetchedNotionPage, type FetchOnePage } from "./pageFrontier.js";
import type { NotionPageItem } from "./project.js";
import type { NotionSeenIndex } from "./seenIndex.js";
import { type NotionSkip, requestStatusSkip } from "./skips.js";

/**
 * The in-window id of a raw search hit, or undefined when it is id-less or past the cutoff.
 *
 * `atCutoff` is reported separately from "skip this one" because the two mean different things to the pager:
 * an id-less hit is skipped and paging continues, while reaching the cutoff means every subsequent hit is
 * older (the search is sorted descending) and paging must STOP.
 */
function searchHitInWindow({
  raw,
  cutoff,
}: {
  raw: unknown;
  cutoff: number | undefined;
}):
  | { atCutoff: false; id: string; lastEdited: string; record: Record<string, unknown> }
  | { atCutoff: boolean; id: undefined } {
  if (!isRecord(raw) || typeof raw["id"] !== "string") {
    return { atCutoff: false, id: undefined };
  }
  const lastEdited = lastEditedOf({ raw });
  if (!withinCutoff({ cutoff, lastEdited })) {
    return { atCutoff: true, id: undefined };
  }
  // The narrowed record is RETURNED rather than re-derived by the caller, so no `as` assertion is needed to
  // get back the type this guard already proved.
  return { atCutoff: false, id: raw["id"], lastEdited, record: raw };
}

/**
 * The nine things every page-lane function needs, as one value.
 *
 * Extracted because they genuinely travel together: the seam's client, its shared gated caller and door
 * scope, the crawl-wide budget, seen-index, meter and caps, the markdown reader, and the attachment
 * capability. Threading them one by one made three signatures over twenty lines each and pushed two of them
 * past the function-length gate for no gain in clarity.
 */
interface NotionPageLane {
  readonly client: Client;
  readonly call: GatedCall;
  readonly scopeId: string;
  readonly budget: FetchBudget;
  readonly seen: NotionSeenIndex;
  readonly meter: NotionCrawlMeter;
  readonly caps: NotionCaptureCaps;
  readonly reader: NotionMarkdownReader;
  readonly attachments: NotionAttachmentPass | undefined;
  readonly storeBody: NotionBodyStore | undefined;
}

/**
 * The live `pages` seam method: each page's recursively-rendered text + comments, cutoff- and budget-bounded.
 *
 * @returns the `NotionApi["pages"]` method
 */
export function notionPagesMethod({
  lane,
  onProgress,
}: {
  lane: NotionPageLane;
  onProgress?: SourceProgress;
}): NotionApi["pages"] {
  const { budget, call, client, scopeId } = lane;
  return async ({ since, cursor }) => {
    if (budget.exhausted()) {
      return { pages: [] };
    }
    const cutoff = cutoffMs({ since });
    const { results, nextCursor, requestStatus } = await notionSearch({
      call,
      client,
      cursor,
      objectType: "page",
      operation: "notion.search.pages",
      scopeId,
    });
    const collected = await collectSearchedPages({
      cutoff,
      lane,
      results,
      ...(onProgress !== undefined ? { onProgress } : {}),
    });
    const skips = [...collected.skips];
    pushIfDefined({ into: skips, value: requestStatusSkip({ operation: "notion.search.pages", requestStatus }) });
    const next = budget.exhausted()
      ? undefined
      : searchNextCursor({ nextCursor, reachedCutoff: collected.reachedCutoff });
    return {
      pages: collected.pages,
      ...(next !== undefined ? { nextCursor: next } : {}),
      ...(collected.notes.length > 0 ? { notes: collected.notes } : {}),
      ...(skips.length > 0 ? { skips } : {}),
    };
  };
}

/**
 * The per-PAGE heartbeat. A search page is 100 pages and each one costs many block calls at ~3 req/s
 * (measured ~29s per page), so ticking only per SEARCH page left the display reading "(stalled)" for tens
 * of minutes while the crawl worked perfectly — a run that looks hung gets killed.
 */
function emitPageHeartbeat({
  onProgress,
  pages,
  skips,
}: {
  onProgress?: SourceProgress;
  pages: readonly NotionPageItem[];
  skips: readonly NotionSkip[];
}): void {
  onProgress?.(
    sourceHeartbeat({
      currentItem: { title: `page ${String(pages.length)}` },
      done: pages.length,
      metrics: { pages: pages.length, unreadable: skips.length },
      phase: "pages",
      source: "notion",
    }),
  );
}

/**
 * The in-window hits on one search page, in order, stopping at the cutoff. Pure — separated from the
 * fetching so the whole page's work is known before any of it is issued, which is what lets the fetches
 * run concurrently without losing the descending-sort "everything after this is older" stop condition.
 *
 * @param results one search page's raw hits
 * @param cutoff the `since` cutoff in ms, or undefined for `--all`
 * @returns the in-window hits and whether the cutoff was reached on this page (⇒ stop paging)
 */
export function inWindowSearchHits({ results, cutoff }: { results: readonly unknown[]; cutoff: number | undefined }): {
  hits: readonly { id: string; lastEdited: string; record: Record<string, unknown> }[];
  reachedCutoff: boolean;
} {
  const hits: { id: string; lastEdited: string; record: Record<string, unknown> }[] = [];
  for (const result of results) {
    const hit = searchHitInWindow({ cutoff, raw: result });
    if (hit.atCutoff) {
      return { hits, reachedCutoff: true };
    }
    if (hit.id !== undefined) {
      hits.push({ id: hit.id, lastEdited: hit.lastEdited, record: hit.record });
    }
  }
  return { hits, reachedCutoff: false };
}

/**
 * Decide, synchronously and in order, which of one search page's hits are actually fetched — so the item
 * budget is reserved exactly (no concurrent overshoot) and an unchanged page costs nothing at all.
 *
 * A skipped-as-unchanged page deliberately does NOT spend budget: it yields no item, and `--fetch-cap`'s
 * whole contract is that it bounds what a run YIELDS. Search paging is 100 hits per request, so even a
 * window where everything is unchanged walks the workspace in seconds rather than becoming an unbounded
 * crawl under a cap.
 *
 * @param hits the in-window hits from {@link inWindowSearchHits}, in search order
 * @param seen the already-held-unchanged index
 * @param meter the crawl counter, credited one skip per hit the index answered for
 * @param budget the shared item budget, spent HERE rather than after each fetch so concurrency cannot
 *   overshoot the cap
 * @returns the hits to fetch, in order
 */
export function scheduleSearchHits({
  hits,
  seen,
  meter,
  budget,
}: {
  hits: readonly { id: string; lastEdited: string; record: Record<string, unknown> }[];
  seen: NotionSeenIndex;
  meter: NotionCrawlMeter;
  budget: FetchBudget;
}): readonly { id: string; lastEdited: string; record: Record<string, unknown> }[] {
  const scheduled: { id: string; lastEdited: string; record: Record<string, unknown> }[] = [];
  for (const hit of hits) {
    if (seen.isUnchanged({ id: hit.id, lastEdited: hit.lastEdited })) {
      meter.countSkippedUnchanged({ id: hit.id });
      continue;
    }
    if (budget.exhausted()) {
      break;
    }
    budget.spend({ items: 1 });
    scheduled.push(hit);
  }
  return scheduled;
}

/**
 * Fetch every in-window page on ONE batch of search hits, stopping at the cutoff or budget and rendering
 * blocks + comments concurrently.
 *
 * Exported for `liveApi.ts#makeNotionReachApi`'s grant-delta backfill, which drives this over a hand-picked hit
 * list (the delta) with `cutoff: undefined` and an EMPTY `seen` index — same fetch logic, fed pre-selected
 * results rather than a fresh search page.
 *
 * @param results the raw search hits to fetch (a live search page, or a hand-picked delta)
 * @param cutoff the `since` cutoff in epoch-ms, or undefined to keep every hit regardless of edit time
 * @param lane the client, caller, budget, seen-index, meter, caps, reader and attachment capability
 * @param onProgress the heartbeat sink, ticked per page as it lands
 * @returns the fetched pages + skips/notes, and whether this batch reached the `since` cutoff
 */
export async function collectSearchedPages({
  results,
  cutoff,
  lane,
  onProgress,
}: {
  results: readonly unknown[];
  cutoff: number | undefined;
  lane: NotionPageLane;
  onProgress?: SourceProgress;
}): Promise<{
  pages: readonly NotionPageItem[];
  skips: readonly NotionSkip[];
  notes: readonly string[];
  reachedCutoff: boolean;
}> {
  const { attachments, budget, call, caps, client, meter, reader, scopeId, seen, storeBody } = lane;
  const scanned = inWindowSearchHits({ cutoff, results });
  const scheduled = scheduleSearchHits({ budget, hits: scanned.hits, meter, seen });
  const fetchPage: FetchOnePage = (args) =>
    fetchOnePage({ attachments, call, caps, client, reader, scopeId, storeBody, ...args });
  const fetched = await fetchScheduledPages({
    fetchPage,
    scheduled,
    ...(onProgress !== undefined ? { onProgress } : {}),
  });
  const children = await drainChildPages({
    budget,
    call,
    client,
    fetchPage,
    meter,
    scopeId,
    seedIds: fetched.flatMap((one) => one.childPageIds),
    seen,
    // Every id this batch touched, so the frontier never re-fetches one and a cycle terminates.
    visited: new Set(scheduled.map((hit) => hit.id)),
  });
  const batch = foldFetchedPages({ fetched });
  return {
    notes: [...batch.notes, ...children.notes],
    pages: [...batch.pages, ...children.pages],
    reachedCutoff: scanned.reachedCutoff,
    skips: [...batch.skips, ...children.skips],
  };
}

/**
 * Fetch one search page's scheduled hits concurrently, ticking the display as each one LANDS.
 *
 * The tick is per-item rather than per-batch on purpose: nothing is emitted during a long fan-out, so a
 * batch-level tick leaves the display reading stalled for minutes and a run that looks hung gets killed.
 *
 * @param scheduled the hits that survived the seen-index and the budget
 * @param fetchPage how one page is fetched, injected so this holds no client
 * @param onProgress the heartbeat sink, when the caller wants one
 * @returns each item's own fetch result, in schedule order
 */
async function fetchScheduledPages({
  scheduled,
  fetchPage,
  onProgress,
}: {
  scheduled: readonly { id: string; lastEdited: string; record: Record<string, unknown> }[];
  fetchPage: FetchOnePage;
  onProgress?: SourceProgress;
}): Promise<readonly FetchedNotionPage[]> {
  const limit = pLimit(NOTION_ITEM_CONCURRENCY);
  const done: NotionPageItem[] = [];
  const seenSkips: NotionSkip[] = [];
  return Promise.all(
    scheduled.map((hit) =>
      limit(async () => {
        const one = await fetchPage({ id: hit.id, lastEdited: hit.lastEdited, raw: hit.record });
        done.push(one.item);
        seenSkips.push(...one.skips);
        emitPageHeartbeat({ pages: done, skips: seenSkips, ...(onProgress !== undefined ? { onProgress } : {}) });
        return one;
      }),
    ),
  );
}

/**
 * Fold one batch's per-item results into the three lists the lane returns. Pure.
 *
 * @param fetched what each item's own fetch produced, in schedule order
 * @returns the pages, their skips, and their notes
 */
function foldFetchedPages({
  fetched,
}: {
  fetched: readonly { item: NotionPageItem; skips: readonly NotionSkip[]; notes: readonly string[] }[];
}): { pages: readonly NotionPageItem[]; skips: readonly NotionSkip[]; notes: readonly string[] } {
  return {
    notes: fetched.flatMap((one) => one.notes),
    pages: fetched.map((one) => one.item),
    skips: fetched.flatMap((one) => one.skips),
  };
}
