/**
 * One `dataSources.query` result page's rows: narrow each in-window row, skip the ones bronze already holds
 * unchanged, fetch the rest's comments concurrently, and classify a refused query. Split out of
 * `liveApiDatabases.ts` purely to keep that file under the repo's file-size ratchet. A leaf: it imports
 * nothing back from that file, which keeps the paging loop, the query bounds and the search-hit handling.
 */
import type { Client } from "@notionhq/client";
import pLimit from "p-limit";

import type { IngestError } from "../../lib/ingestError.js";
import { ingestErrorToThrowable } from "../../lib/ingestError.js";
import { isRecord } from "../../lib/parsers.js";
import type { GatedCall } from "./callDeadline.js";
import type { NotionCaptureCaps } from "./caps.js";
import { lastEditedOf, projectRowItem, withinCutoff } from "./fetch.js";
import { createNotionItemBudget, hitItemDeadline, itemDeadlineNote, pageComments } from "./itemCrawl.js";
import { NOTION_ITEM_CONCURRENCY } from "./liveApiShared.js";
import type { NotionCrawlMeter } from "./meter.js";
import type { NotionPageItem } from "./project.js";
import type { NotionSeenIndex } from "./seenIndex.js";
import { captureWasTruncated, classifyNotionSkip, type NotionSkip, skipIsFatal } from "./skips.js";

/** One in-window row on a query page, already narrowed — the unit the concurrent fetch works over. Pure. */
function rowCandidate({
  raw,
  cutoff,
}: {
  raw: unknown;
  cutoff: number | undefined;
}): { id: string; lastEdited: string; record: Record<string, unknown> } | undefined {
  if (!isRecord(raw) || typeof raw["id"] !== "string") {
    return undefined; // id-less
  }
  const lastEdited = lastEditedOf({ raw });
  if (!withinCutoff({ cutoff, lastEdited })) {
    return undefined; // out of window — rows aren't ordered, so filter rather than stop paging
  }
  return { id: raw["id"], lastEdited, record: raw };
}

/** Fetch ONE row's comments and project it. The only per-row work that costs requests. */
async function fetchOneRow({
  candidate,
  client,
  call,
  scopeId,
  dataSourceId,
  caps,
}: {
  candidate: { id: string; lastEdited: string; record: Record<string, unknown> };
  client: Client;
  call: GatedCall;
  scopeId: string;
  dataSourceId: string;
  caps: NotionCaptureCaps;
}): Promise<{ row: NotionPageItem; skips: readonly NotionSkip[]; notes: readonly string[] }> {
  const startedAtMs = Date.now();
  const itemBudget = createNotionItemBudget({ maxCalls: caps.itemCallBudget, maxMs: caps.itemTimeBudgetMs });
  const comments = await pageComments({
    call,
    client,
    itemBudget,
    pageId: candidate.id,
    scopeId,
  });
  const stoppedBy = itemBudget.stoppedBy();
  return {
    notes:
      hitItemDeadline({ skips: comments.skips }) && stoppedBy !== undefined
        ? [
            itemDeadlineNote({
              calls: itemBudget.spent(),
              id: candidate.id,
              kind: "row",
              parentId: dataSourceId,
              startedAtMs,
              stoppedBy,
            }),
          ]
        : [],
    row: projectRowItem({
      comments: comments.comments,
      dataSourceId,
      id: candidate.id,
      lastEdited: candidate.lastEdited,
      partial: captureWasTruncated({ skips: comments.skips }),
      raw: candidate.record,
    }),
    skips: comments.skips,
  };
}

/**
 * Collect the in-window rows on one `dataSources.query` result page (each with its comments), rate-gated.
 *
 * @returns the fetched rows, with every row's skips and notes flattened beside them
 */
export async function rowsFromQueryPage({
  client,
  call,
  scopeId,
  dataSourceId,
  cutoff,
  results,
  seen,
  meter,
  caps,
}: {
  client: Client;
  call: GatedCall;
  scopeId: string;
  dataSourceId: string;
  cutoff: number | undefined;
  results: readonly unknown[];
  seen: NotionSeenIndex;
  meter: NotionCrawlMeter;
  caps: NotionCaptureCaps;
}): Promise<{ rows: readonly NotionPageItem[]; skips: readonly NotionSkip[]; notes: readonly string[] }> {
  const limit = pLimit(NOTION_ITEM_CONCURRENCY);
  const tasks: Promise<{ row: NotionPageItem; skips: readonly NotionSkip[]; notes: readonly string[] }>[] = [];
  for (const result of results) {
    const candidate = rowCandidate({ cutoff, raw: result });
    if (candidate === undefined) {
      continue;
    }
    // The pages-lane clause is not redundant with the index one. A row the pages lane skipped, then edited
    // before this lane reached it, would otherwise be fetched here WITHOUT its block body and written as a
    // complete capture at the new timestamp — see `meter.ts` for the full counterexample.
    if (
      meter.wasSkippedUnchanged({ id: candidate.id }) ||
      seen.isUnchanged({ id: candidate.id, lastEdited: candidate.lastEdited })
    ) {
      meter.countSkippedUnchanged({ id: candidate.id });
      continue; // bronze already holds this row whole — don't pay for its comments, and don't half-replace it
    }
    tasks.push(limit(() => fetchOneRow({ call, candidate, caps, client, dataSourceId, scopeId })));
  }
  const fetched = await Promise.all(tasks);
  return {
    notes: fetched.flatMap((one) => one.notes),
    rows: fetched.map((one) => one.row),
    skips: fetched.flatMap((one) => one.skips),
  };
}

/**
 * The skip for a refused data-source query — fatal only for `auth`, as everywhere else in this crawl.
 *
 * @returns the classified skip; an `auth` failure throws instead of returning one
 */
export function dataSourceFailureSkip({ error }: { error: IngestError }): NotionSkip {
  const reason = classifyNotionSkip({ error });
  if (skipIsFatal({ reason })) {
    throw ingestErrorToThrowable({ error });
  }
  return { operation: error.operation, reason, subject: "data source rows" };
}
