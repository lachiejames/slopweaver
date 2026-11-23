/**
 * The live `databases` lane: search for `data_source` hits, query each one's rows to exhaustion, and fetch
 * each row's comments — cutoff- and budget-bounded. Split out of `liveApi.ts` (the file this seam belongs
 * to) purely to keep that file under the repo's file-size ratchet; the boundary is "everything downstream
 * of a `data_source` search hit", mirroring the pages lane in `liveApiPagesLane.ts`.
 */
import type { Client, QueryDataSourceParameters } from "@notionhq/client";

import type { IngestError } from "../../lib/ingestError.js";
import { isRecord } from "../../lib/parsers.js";
import { safeProviderCall } from "../../lib/providerCall.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { FetchBudget } from "./budget.js";
import type { GatedCall } from "./callDeadline.js";
import { DEFAULT_NOTION_CAPTURE_CAPS, type NotionCaptureCaps } from "./caps.js";
import {
  cutoffMs,
  lastEditedOf,
  type NotionApi,
  notionNextCursor,
  projectDatabaseItem,
  withinCutoff,
} from "./fetch.js";
import { dataSourceFailureSkip, rowsFromQueryPage } from "./liveApiDataSourceRowPage.js";
import { notionSearch, PAGE_SIZE, pushIfDefined } from "./liveApiShared.js";
import type { NotionCrawlMeter } from "./meter.js";
import type { NotionDatabaseItem, NotionPageItem } from "./project.js";
import type { NotionSeenIndex } from "./seenIndex.js";
import { type NotionSkip, requestStatusSkip } from "./skips.js";

/**
 * The `sorts` + `filter` one row query sends, so `--since` bounds the FETCH and not merely what is kept. Pure.
 *
 * This is what makes unconditional data-source enumeration affordable. Every data source is now queried on
 * every windowed refresh (see {@link databaseSearchHit}), so the row scan has to be server-bounded or the
 * crawl would page every row of all of them. `dataSources.query` accepts both a `last_edited_time` sort and a
 * `TimestampFilter`, which together give the row lane the descending-order early stop the pages lane has had
 * all along.
 *
 * `--all` (no cutoff) sends the sort but NO filter, so a whole re-pull still reaches every row.
 *
 * @param cutoff the `since` cutoff in epoch-ms, or undefined for `--all`
 * @returns the query body fields bounding the scan — the sort always, the filter only under a cutoff
 */
export function rowQueryBounds({
  cutoff,
}: {
  cutoff: number | undefined;
}): Pick<QueryDataSourceParameters, "sorts" | "filter"> {
  const sorts: QueryDataSourceParameters["sorts"] = [{ direction: "descending", timestamp: "last_edited_time" }];
  if (cutoff === undefined) {
    return { sorts };
  }
  return {
    filter: { last_edited_time: { on_or_after: new Date(cutoff).toISOString() }, timestamp: "last_edited_time" },
    sorts,
  };
}

/** One `dataSources.query` page — the sole `client.dataSources` boundary, gated, returning the typed error. */
async function queryDataSourcePage({
  client,
  call,
  scopeId,
  dataSourceId,
  cursor,
  cutoff,
}: {
  client: Client;
  call: GatedCall;
  scopeId: string;
  dataSourceId: string;
  cursor: string | undefined;
  cutoff: number | undefined;
}): Promise<
  Result<{ results: readonly unknown[]; nextCursor: string | undefined; requestStatus: unknown }, IngestError>
> {
  const result = await safeProviderCall({
    execute: () =>
      call(() =>
        client.dataSources.query({
          data_source_id: dataSourceId,
          page_size: PAGE_SIZE,
          ...rowQueryBounds({ cutoff }),
          ...(cursor !== undefined ? { start_cursor: cursor } : {}),
        }),
      ),
    operation: "notion.dataSources.query",
    provider: "notion",
    retryMode: "transient",
    scopeId,
  });
  if (result.isErr()) {
    return err(result.error);
  }
  return ok({
    nextCursor: notionNextCursor({ value: result.value.next_cursor }),
    requestStatus: result.value.request_status,
    results: result.value.results,
  });
}

/**
 * Query a data source's rows (the actual task/decision records) to exhaustion, rate-gated, cutoff-honoured.
 *
 * A query failure is a classified skip for THIS data source rather than a fatal — a data source can be
 * shared as a search hit and still refuse a query, and losing every other data source over one of them is
 * the same all-or-nothing failure this PR exists to remove.
 *
 * `--since` bounds the FETCH here, not merely the rows kept: {@link rowQueryBounds} sends the window as a
 * `last_edited_time` sort plus a `TimestampFilter`, so the scan stops at the cutoff the way the pages lane's
 * descending search already does. The client-side `withinCutoff` in `./liveApiDataSourceRowPage.ts`'s `rowCandidate`
 * stays too: it costs nothing and keeps the KEPT set correct if a provider widens what the filter returns.
 */
async function dataSourceRows({
  client,
  call,
  scopeId,
  dataSourceId,
  cutoff,
  budget,
  seen,
  meter,
  caps,
}: {
  client: Client;
  call: GatedCall;
  scopeId: string;
  dataSourceId: string;
  cutoff: number | undefined;
  budget: FetchBudget;
  seen: NotionSeenIndex;
  meter: NotionCrawlMeter;
  caps: NotionCaptureCaps;
}): Promise<{ rows: readonly NotionPageItem[]; skips: readonly NotionSkip[]; notes: readonly string[] }> {
  const rows: NotionPageItem[] = [];
  const skips: NotionSkip[] = [];
  const notes: string[] = [];
  let cursor: string | undefined;
  for (;;) {
    const result = await queryDataSourcePage({ call, client, cursor, cutoff, dataSourceId, scopeId });
    if (!result.isOk()) {
      skips.push(dataSourceFailureSkip({ error: result.error }));
      return { notes, rows, skips };
    }
    pushIfDefined({
      into: skips,
      value: requestStatusSkip({ operation: "notion.dataSources.query", requestStatus: result.value.requestStatus }),
    });
    const page = await rowsFromQueryPage({
      call,
      caps,
      client,
      cutoff,
      dataSourceId,
      meter,
      results: result.value.results,
      scopeId,
      seen,
    });
    rows.push(...page.rows);
    skips.push(...page.skips);
    notes.push(...page.notes);
    budget.spend({ items: page.rows.length });
    if (result.value.nextCursor === undefined || budget.exhausted()) {
      return { notes, rows, skips };
    }
    cursor = result.value.nextCursor;
  }
}

/**
 * One raw `data_source` search hit, narrowed — or `"skip"` when it carries no id. Pure.
 *
 * **The cutoff is deliberately NOT applied here, and that is the whole point of this function.** A data
 * source's own `last_edited_time` does not move when one of its rows is edited (`seenIndex.ts` states the
 * same property as its reason for never skipping a data source), so filtering the search hit by it made an
 * INCREMENTAL refresh silently skip every row change under any table nobody had restructured lately — the
 * data source was never queried at all. `--all` was unaffected, which is why a whole re-pull never exposed
 * it. Enumeration is therefore unconditional: about 466 data sources, roughly five search calls, and the
 * window is applied to the ROWS instead by {@link rowQueryBounds} inside `dataSources.query`.
 *
 * The data source's OWN record stays windowed — that decision lives in {@link absorbDatabaseHit}, because
 * its own timestamp does faithfully track its own edits. Only the row query is unconditional.
 *
 * @param raw one raw search hit
 * @returns the narrowed hit, or `"skip"` for an id-less one
 */
export function databaseSearchHit({
  raw,
}: {
  raw: unknown;
}): { id: string; lastEdited: string; raw: Record<string, unknown> } | "skip" {
  if (!isRecord(raw) || typeof raw["id"] !== "string") {
    return "skip";
  }
  return { id: raw["id"], lastEdited: lastEditedOf({ raw }), raw };
}

/**
 * Project + query EVERY data-source hit on one search page, stopping only at the budget.
 *
 * There is no cutoff stop here, unlike the pages lane: a data source older than the window can still hold
 * rows newer than it, so every one is queried and the window is applied to its rows instead. See
 * {@link databaseSearchHit}.
 *
 * Exported for the grant-delta backfill in `./liveApi.ts`'s `makeNotionReachApi`, which drives this over a
 * hand-picked hit list (the delta) with `cutoff: undefined` and an EMPTY `seen` index, instead of a live search
 * page — same fetch logic, fed pre-selected results rather than a fresh search call.
 *
 * @param results the raw search hits to project + query (a live search page, or a hand-picked delta)
 * @param cutoff the `since` cutoff in epoch-ms, or undefined to keep every row regardless of edit time
 * @param client the live Notion client
 * @param call the shared rate-gated caller
 * @param scopeId the token's provider-door scope id
 * @param budget the shared item budget, spent as databases + rows are collected
 * @param seen the already-held-unchanged index, consulted before each data source's rows are queried
 * @param meter the crawl's request/skip counter
 * @param caps the per-item depth/request/time bounds each row's own crawl runs under
 * @returns the collected databases + rows + skips/notes
 */
export async function collectDatabaseResults({
  results,
  cutoff,
  client,
  call,
  scopeId,
  budget,
  seen,
  meter,
  caps = DEFAULT_NOTION_CAPTURE_CAPS,
}: {
  results: readonly unknown[];
  cutoff: number | undefined;
  client: Client;
  call: GatedCall;
  scopeId: string;
  budget: FetchBudget;
  seen: NotionSeenIndex;
  meter: NotionCrawlMeter;
  caps?: NotionCaptureCaps;
}): Promise<{
  databases: readonly NotionDatabaseItem[];
  rows: readonly NotionPageItem[];
  skips: readonly NotionSkip[];
  notes: readonly string[];
}> {
  const into: DatabaseCollection = { databases: [], notes: [], rows: [], skips: [] };
  for (const result of results) {
    const hit = databaseSearchHit({ raw: result });
    if (hit === "skip") {
      continue;
    }
    await absorbDatabaseHit({ budget, call, caps, client, cutoff, hit, into, meter, scopeId, seen });
    if (budget.exhausted()) {
      break;
    }
  }
  return asReadonlyCollection({ into });
}

/** The four lists one search page's data sources fill, so the loop has one thing to append to. */
interface DatabaseCollection {
  readonly databases: NotionDatabaseItem[];
  readonly rows: NotionPageItem[];
  readonly skips: NotionSkip[];
  readonly notes: string[];
}

/**
 * The collection as the readonly shape the lane returns. Pure.
 *
 * @param into the filled accumulator
 * @returns the same four lists, narrowed to what a caller may read
 */
function asReadonlyCollection({ into }: { into: DatabaseCollection }): {
  databases: readonly NotionDatabaseItem[];
  rows: readonly NotionPageItem[];
  skips: readonly NotionSkip[];
  notes: readonly string[];
} {
  return { databases: into.databases, notes: into.notes, rows: into.rows, skips: into.skips };
}

/**
 * Query ONE data source's rows, and project the data source itself when its OWN record is in window.
 *
 * The two halves take the cutoff differently, on purpose. A row edit does not move its data source's
 * `last_edited_time`, so the row query runs unconditionally — that is the failure {@link databaseSearchHit}
 * describes. The data source's own record, though, is exactly what that timestamp does track, so an
 * unchanged one is out of the window like any other unchanged object and costs no item against
 * `--fetch-cap`, whose contract is that it bounds what a run YIELDS.
 *
 * @param hit the narrowed search hit
 * @param into the accumulator this hit's database, rows, skips and notes are appended to
 * @param budget the shared item budget, spent for the data source itself and then by its rows
 * @param cutoff the `since` cutoff in epoch-ms — windows the data-source RECORD, and its rows' own scan
 * @param caps the per-item depth/request/time bounds each row's own crawl runs under
 */
async function absorbDatabaseHit({
  hit,
  into,
  budget,
  call,
  caps,
  client,
  cutoff,
  meter,
  scopeId,
  seen,
}: {
  hit: { id: string; lastEdited: string; raw: Record<string, unknown> };
  into: DatabaseCollection;
  budget: FetchBudget;
  call: GatedCall;
  caps: NotionCaptureCaps;
  client: Client;
  cutoff: number | undefined;
  meter: NotionCrawlMeter;
  scopeId: string;
  seen: NotionSeenIndex;
}): Promise<void> {
  if (withinCutoff({ cutoff, lastEdited: hit.lastEdited })) {
    into.databases.push(projectDatabaseItem({ id: hit.id, lastEdited: hit.lastEdited, raw: hit.raw }));
    budget.spend({ items: 1 });
  }
  const queried = await dataSourceRows({
    budget,
    call,
    caps,
    client,
    cutoff,
    dataSourceId: hit.id,
    meter,
    scopeId,
    seen,
  });
  into.rows.push(...queried.rows);
  into.skips.push(...queried.skips);
  into.notes.push(...queried.notes);
}

/**
 * The live `databases` seam method: each `data_source` hit + its queried rows, cutoff-honoured. Exported so
 * `liveApi.ts`'s `makeNotionApi` factory can wire it in — the bulk of the databases lane's code lives here,
 * while the factory that owns the shared client/scheduler/budget stays where the other lane factories are.
 *
 * @param client the live Notion client
 * @param call the shared rate-gated caller
 * @param scopeId the token's provider-door scope id
 * @param budget the shared item budget, spent as databases + rows are collected
 * @param seen the already-held-unchanged index, consulted before each data source's rows are queried
 * @param meter the crawl's request/skip counter
 * @param caps the per-item depth/request/time bounds each row's own crawl runs under
 * @returns the `NotionApi["databases"]` method
 */
export function notionDatabasesMethod({
  client,
  call,
  scopeId,
  budget,
  seen,
  meter,
  caps,
}: {
  client: Client;
  call: GatedCall;
  scopeId: string;
  budget: FetchBudget;
  seen: NotionSeenIndex;
  meter: NotionCrawlMeter;
  caps: NotionCaptureCaps;
}): NotionApi["databases"] {
  return async ({ since, cursor }) => {
    if (budget.exhausted()) {
      return { databases: [], rows: [] };
    }
    const cutoff = cutoffMs({ since });
    const { results, nextCursor, requestStatus } = await notionSearch({
      call,
      client,
      cursor,
      objectType: "data_source",
      operation: "notion.search.databases",
      scopeId,
    });
    const collected = await collectDatabaseResults({
      budget,
      call,
      caps,
      client,
      cutoff,
      meter,
      results,
      scopeId,
      seen,
    });
    const skips = [...collected.skips];
    pushIfDefined({
      into: skips,
      value: requestStatusSkip({ operation: "notion.search.databases", requestStatus }),
    });
    // No cutoff stop: unlike the pages lane, this search pages to exhaustion (~5 calls) so that every data
    // source is queried, however long ago it was itself last restructured.
    const next = budget.exhausted() ? undefined : notionNextCursor({ value: nextCursor });
    return {
      databases: collected.databases,
      rows: collected.rows,
      ...(next !== undefined ? { nextCursor: next } : {}),
      ...(collected.notes.length > 0 ? { notes: collected.notes } : {}),
      ...(skips.length > 0 ? { skips } : {}),
    };
  };
}
