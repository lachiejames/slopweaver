/**
 * The LIVE Notion seam — everything that touches a real `@notionhq/client` `Client`.
 *
 * Split from `fetch.ts` because that file had grown past its line ceiling holding two different jobs: the
 * pure projections plus seam-agnostic paging (which stayed there, and which a fake seam drives under test),
 * and the client wiring here. The boundary is the {@link NotionApi} interface: nothing below this line is
 * reachable without a token, and nothing above it needs one.
 *
 * Every call routes through the shared provider door and ONE rate scheduler (~3 req/s). A node that cannot
 * be read becomes a classified {@link NotionSkip} rather than a throw — see `skips.ts` for why, and why
 * `auth` is the single exception that still aborts the run.
 */
import { Client } from "@notionhq/client";

import type { IngestError } from "../../lib/ingestError.js";
import { isRecord } from "../../lib/parsers.js";
import { safeProviderCall, scopeIdForToken } from "../../lib/providerCall.js";
import { err, ok, type Result } from "../../lib/result.js";
import { orThrow } from "../../lib/safeBoundary.js";
import type { SourceProgress } from "../progress.js";
import { createFetchBudget } from "./budget.js";
import { type GatedCall, makeNotionGatedCall, NOTION_FATAL_SEAM_ATTEMPTS } from "./callDeadline.js";
import { DEFAULT_NOTION_CAPTURE_CAPS, type NotionCaptureCaps } from "./caps.js";
import { lastEditedOf, type NotionApi, notionNextCursor } from "./fetch.js";
import { collectDatabaseResults, notionDatabasesMethod } from "./liveApiDatabases.js";
import type { NotionAttachmentPass, NotionBodyStore } from "./liveApiPages.js";
import { collectSearchedPages, notionPagesMethod } from "./liveApiPagesLane.js";
import { notionSearch, PAGE_SIZE, pushIfDefined } from "./liveApiShared.js";
import { makeNotionMarkdownReader, NOTION_MARKDOWN_READ_VERSION, type NotionMarkdownReader } from "./liveMarkdown.js";
import { createNotionCrawlMeter, type NotionCrawlMeter } from "./meter.js";
import type { NotionPageItem } from "./project.js";
import type { NotionReachApi, NotionReachHit } from "./reach.js";
import { EMPTY_NOTION_SEEN_INDEX, type NotionSeenIndex } from "./seenIndex.js";
import { type NotionSkip, requestStatusSkip } from "./skips.js";

/** One bounded page of top-level blocks returned by the named-object reader. */
export interface NotionNamedBlockPage {
  readonly results: readonly unknown[];
  readonly hasMore: boolean;
  readonly nextCursor: string | undefined;
}

/**
 * Official-SDK seams for one current page or database read.
 *
 * `listBlockChildren` answers the boundary's own {@link IngestError} rather than a message list, because the
 * nested-block walk has to tell a revoked token (fatal for the whole read) from one block the integration
 * cannot see (a named gap in an otherwise whole page) — and `classifyNotionSkip` reads that distinction off
 * the typed error. A message list has already thrown it away.
 */
export interface NotionNamedReadApi {
  retrievePage(args: { id: string }): Promise<Result<unknown>>;
  retrieveDatabase(args: { id: string }): Promise<Result<unknown>>;
  listBlockChildren(args: {
    id: string;
    limit: number;
    /** Notion's own opaque `next_cursor` from the previous page, or undefined to start at the beginning. */
    after: string | undefined;
  }): Promise<Result<NotionNamedBlockPage, IngestError>>;
}

/** The live `users.list` seam method: one page of raw workspace members — the sole `client.users` boundary. */
function notionUsersMethod({
  client,
  call,
  scopeId,
}: {
  client: Client;
  call: GatedCall;
  scopeId: string;
}): NotionApi["users"] {
  return async ({ cursor }) => {
    const res = orThrow({
      result: await safeProviderCall({
        execute: () =>
          call(() =>
            client.users.list({
              page_size: PAGE_SIZE,
              ...(cursor !== undefined ? { start_cursor: cursor } : {}),
            }),
          ),
        // Member hydration is lost whole when this fails, so it gets the discovery budget.
        maxAttempts: NOTION_FATAL_SEAM_ATTEMPTS,
        operation: "notion.users.list",
        provider: "notion",
        retryMode: "transient",
        scopeId,
      }),
    });
    const next = notionNextCursor({ value: res.next_cursor });
    return { results: res.results, ...(next !== undefined ? { nextCursor: next } : {}) };
  };
}

/**
 * Build the production Notion seam over a live `Client`. Search discovery, recursive block rendering,
 * chunking, comment fetches, data-source row queries, AND member hydration — every call gated through ONE
 * shared rate scheduler (~3 req/s) + transient retry so a big recursive crawl never self-429s.
 *
 * @param token the Notion integration token
 * @param maxItems the total item cap for this crawl (`--fetch-cap`); omitted ⇒ unbounded, as before
 * @param onProgress the heartbeat sink, so the pages lane can tick per PAGE rather than per search page
 * @param seen the already-held-unchanged index consulted BEFORE any page or row is fetched; omitted ⇒
 *   {@link EMPTY_NOTION_SEEN_INDEX}, i.e. the pre-existing behaviour of re-fetching everything in window
 * @param meter the crawl's request/skip counter, so a run can report its ACHIEVED rate rather than the
 *   configured cap; omitted ⇒ a private one nobody reads
 * @param caps the per-item depth/request/time bounds; omitted ⇒ {@link DEFAULT_NOTION_CAPTURE_CAPS}, the
 *   values these were as constants
 * @returns the live Notion seam
 */
export function makeNotionApi({
  token,
  maxItems,
  onProgress,
  seen = EMPTY_NOTION_SEEN_INDEX,
  meter = createNotionCrawlMeter(),
  caps = DEFAULT_NOTION_CAPTURE_CAPS,
  attachments,
  storeBody,
}: {
  token: string;
  maxItems?: number;
  onProgress?: SourceProgress;
  seen?: NotionSeenIndex;
  meter?: NotionCrawlMeter;
  caps?: NotionCaptureCaps;
  attachments?: NotionAttachmentPass;
  storeBody?: NotionBodyStore;
}): NotionApi {
  const { call, client, reader, scopeId } = notionReadSeam({ meter, token });
  // ONE budget shared by both lanes: the lanes run in sequence and `--fetch-cap` is a total, not a per-lane
  // allowance. `users` is deliberately outside it — member hydration is a separate store with its own
  // lifecycle, and capping it would silently under-populate the roster.
  const budget = createFetchBudget({ maxItems });
  return {
    databases: notionDatabasesMethod({ budget, call, caps, client, meter, scopeId, seen }),
    pages: notionPagesMethod({
      lane: { attachments, budget, call, caps, client, meter, reader, scopeId, seen, storeBody },
      ...(onProgress !== undefined ? { onProgress } : {}),
    }),
    users: notionUsersMethod({ call, client, scopeId }),
  };
}

/**
 * Page ONE search object type to exhaustion, collecting id + `last_edited_time` + the raw hit for every
 * result — no block/row fetch, so this is the cheap half of grant-delta detection (`reach.ts`). Unlike
 * {@link notionPagesMethod}/{@link notionDatabasesMethod} there is no cutoff at all: reach enumeration must
 * see the WHOLE workspace, since the ids it exists to find are exactly the ones a `since`-bounded search
 * would stop short of.
 */
async function enumerateAllHits({
  client,
  call,
  scopeId,
  objectType,
  operation,
}: {
  client: Client;
  call: GatedCall;
  scopeId: string;
  objectType: "page" | "data_source";
  operation: string;
}): Promise<{ hits: readonly NotionReachHit[]; skips: readonly NotionSkip[] }> {
  const hits: NotionReachHit[] = [];
  const skips: NotionSkip[] = [];
  let cursor: string | undefined;
  do {
    const { results, nextCursor, requestStatus } = await notionSearch({
      call,
      client,
      cursor,
      objectType,
      operation,
      scopeId,
    });
    for (const raw of results) {
      if (isRecord(raw) && typeof raw["id"] === "string") {
        hits.push({ id: raw["id"], lastEdited: lastEditedOf({ raw }), raw });
      }
    }
    pushIfDefined({ into: skips, value: requestStatusSkip({ operation, requestStatus }) });
    cursor = notionNextCursor({ value: nextCursor });
  } while (cursor !== undefined && cursor.length > 0);
  return { hits, skips };
}

/**
 * The grant-delta backfill's PAGE half: fetch a hand-picked hit list completely, ignoring every cutoff.
 *
 * Its lane carries no attachment capability — attachments come with the page's own crawl, so a newly
 * reachable page gets them on the pass that indexes it rather than twice. It DOES carry `storeBody`, and
 * that difference is the point: this lane is the one that renders the body, so it is the only chance to
 * store that tree, and a backfilled page without it would carry text whose structure is recoverable only by
 * calling Notion again.
 *
 * @param hits the reach enumeration's chosen ids, whose raw search objects seed the fetch
 * @param fetchCap the `--fetch-cap` item ceiling for this backfill
 * @param storeBody the body sidecar seam, threaded through to each page's capture
 * @returns the pages, the notes and every skip the backfill collected
 */
async function reachBackfillPages({
  hits,
  fetchCap,
  caps,
  call,
  client,
  meter,
  reader,
  scopeId,
  storeBody,
}: {
  hits: readonly NotionReachHit[];
  fetchCap: number | undefined;
  caps: NotionCaptureCaps;
  call: GatedCall;
  client: Client;
  meter: NotionCrawlMeter;
  reader: NotionMarkdownReader;
  scopeId: string;
  storeBody: NotionBodyStore | undefined;
}): Promise<{ pages: readonly NotionPageItem[]; notes: readonly string[]; skips: readonly NotionSkip[] }> {
  const budget = createFetchBudget({ maxItems: fetchCap });
  const collected = await collectSearchedPages({
    cutoff: undefined,
    lane: {
      attachments: undefined,
      budget,
      call,
      caps,
      client,
      meter,
      reader,
      scopeId,
      seen: EMPTY_NOTION_SEEN_INDEX,
      storeBody,
    },
    results: hits.map((hit) => hit.raw),
  });
  return { notes: collected.notes, pages: collected.pages, skips: collected.skips };
}

/**
 * Build the live Notion reach seam: cheap full-workspace id enumeration (both object types, no cutoff, no
 * content fetch) plus targeted full-history backfill for a hand-picked hit list, reusing the exact same
 * page/row fetch logic the incremental crawl uses ({@link collectSearchedPages}/{@link collectDatabaseResults})
 * with `cutoff: undefined` and an empty seen index, so a backfilled id is fetched completely regardless of
 * its `last_edited_time`.
 *
 * Its own client + rate scheduler, like every other Notion lane factory here — reach enumeration runs to
 * completion BEFORE the main crawl starts (see `tokenedJobs.ts#ingestNotion`), so the two never compete for
 * the same 3 req/s budget concurrently.
 *
 * @param token the Notion integration token
 * @param fetchCap the `--fetch-cap` item ceiling for the BACKFILL half only; enumeration is always
 *   unbounded, since a capped enumeration would under-report the delta rather than under-fetch it
 * @param caps the per-item depth/request/time bounds the backfill's own item crawls run under
 * @returns the live reach seam
 */
export function makeNotionReachApi({
  token,
  fetchCap,
  caps = DEFAULT_NOTION_CAPTURE_CAPS,
  storeBody,
}: {
  token: string;
  fetchCap?: number;
  caps?: NotionCaptureCaps;
  storeBody?: NotionBodyStore;
}): NotionReachApi {
  const { client, call, scopeId, reader } = notionReadSeam({ token });
  const meter = createNotionCrawlMeter();
  return {
    backfillDatabases: async ({ hits }) => {
      const budget = createFetchBudget({ maxItems: fetchCap });
      const collected = await collectDatabaseResults({
        budget,
        call,
        caps,
        client,
        cutoff: undefined,
        meter,
        results: hits.map((hit) => hit.raw),
        scopeId,
        seen: EMPTY_NOTION_SEEN_INDEX,
      });
      return { databases: collected.databases, notes: collected.notes, rows: collected.rows, skips: collected.skips };
    },
    backfillPages: async ({ hits }) =>
      reachBackfillPages({ call, caps, client, fetchCap, hits, meter, reader, scopeId, storeBody }),
    enumerateDatabases: () =>
      enumerateAllHits({
        call,
        client,
        objectType: "data_source",
        operation: "notion.search.reach.databases",
        scopeId,
      }),
    enumeratePages: () =>
      enumerateAllHits({ call, client, objectType: "page", operation: "notion.search.reach.pages", scopeId }),
  };
}

/**
 * The two clients, the one scheduler and the markdown reader every read lane needs, built together.
 *
 * Two clients rather than one, deliberately: search, data-source query and comments keep the DEFAULT API
 * version so their response shapes cannot shift under a change made for the body, while only the body read
 * is pinned to {@link NOTION_MARKDOWN_READ_VERSION}. They share one scheduler and one 429 scope, so this is
 * two clients pacing as a single caller rather than two callers racing the same cap.
 *
 * @param token the configured Notion integration token
 * @param meter when given, every gated call is counted at the boundary — the only way to tell a lane that is
 *   rate-capped from one that is latency-bound, since a request count cannot be inferred from item counts
 * @returns the default-version client, the shared gated caller, the door scope id, and the markdown reader
 */
function notionReadSeam({ token, meter }: { token: string; meter?: NotionCrawlMeter }): {
  client: Client;
  call: GatedCall;
  scopeId: string;
  reader: NotionMarkdownReader;
} {
  // devlint: sdk-factory -- the Notion read lane, self-paced by its own scheduler
  const client = new Client({ auth: token });
  // devlint: sdk-factory -- the markdown body read, sharing the read lane's scheduler and 429 scope
  const markdownClient = new Client({ auth: token, notionVersion: NOTION_MARKDOWN_READ_VERSION });
  // PACING ONLY, and the gate sits INSIDE `safeProviderCall`'s `execute` rather than around it, so a
  // post-429 retry re-acquires a rate slot instead of bursting past the cap.
  const gated: GatedCall = makeNotionGatedCall();
  const call: GatedCall =
    meter === undefined
      ? gated
      : (task) => {
          meter.countCall();
          return gated(task);
        };
  const scopeId = scopeIdForToken({ token });
  return { call, client, reader: makeNotionMarkdownReader({ call, client: markdownClient, scopeId }), scopeId };
}

/**
 * Build the bounded named-object seam inside the existing sanctioned Notion client factory.
 *
 * @param token the configured Notion integration token
 * @returns safe current-page, current-database and top-level-block methods sharing one local scheduler
 */
export function makeNotionNamedReadApi({ token }: { token: string }): NotionNamedReadApi {
  // devlint: sdk-factory -- bounded named-object Notion reads, sharing the provider door and local scheduler
  const client = new Client({ auth: token });
  const call = makeNotionGatedCall();
  const scopeId = scopeIdForToken({ token });
  return {
    listBlockChildren: async ({ id, limit, after }) => {
      // Omitting `start_cursor` is Notion's documented "from the beginning"; the key is left off rather than
      // set to undefined so the request matches the SDK's optional-property contract exactly.
      const request =
        after === undefined
          ? { block_id: id, page_size: limit }
          : { block_id: id, page_size: limit, start_cursor: after };
      const called = await safeProviderCall({
        execute: () => call(() => client.blocks.children.list(request)),
        operation: "notion.blocks.children.namedObjectRead",
        provider: "notion",
        retryMode: "transient",
        scopeId,
      });
      return called.map((page) => ({
        hasMore: page.has_more,
        nextCursor: page.next_cursor ?? undefined,
        results: page.results,
      }));
    },
    retrieveDatabase: async ({ id }) => {
      const called = await safeProviderCall({
        execute: () => call(() => client.databases.retrieve({ database_id: id })),
        operation: "notion.databases.retrieve.namedObjectRead",
        provider: "notion",
        retryMode: "transient",
        scopeId,
      });
      return called.isErr() ? err([called.error.message]) : ok(called.value);
    },
    retrievePage: async ({ id }) => {
      const called = await safeProviderCall({
        execute: () => call(() => client.pages.retrieve({ page_id: id })),
        operation: "notion.pages.retrieve.namedObjectRead",
        provider: "notion",
        retryMode: "transient",
        scopeId,
      });
      return called.isErr() ? err([called.error.message]) : ok(called.value);
    },
  };
}
