/**
 * The impure Notion edge. Discovers accessible pages + databases via `search`, recursively pages each
 * page's block children, renders rich text to plain text (links preserved), chunks long pages into
 * stable sections, and pulls comments — shaping into the clean items `project.ts` consumes. The
 * `@notionhq/client` `Client` is confined here behind an injected `NotionApi` seam so the paging
 * orchestration is unit-testable with a fake. `chunkText` (now `corpus/chunkText.ts`) + `renderRichText` are pure +
 * separately tested. File/image mentions are shaped to reference text only, and `renderBlocks` then DISCARDS the block
 * payloads it rendered — so a signed url living on a child block reaches no record. What this edge does
 * carry through is the page/database/comment object, as that record's `raw`. This line used to
 * claim signed urls are never persisted, which was false; `project.ts` states the retention rule and holds
 * the measured paths, so it is not restated here.
 *
 * Rich-text/property rendering lives in `fetchRender.ts`; block/page/user projection lives in
 * `fetchProject.ts`; the paragraph chunker is the corpus-wide `corpus/chunkText.ts`, shared with the Slack
 * huddle lane. All three are re-exported here so every existing `corpus/notion/fetch.js` import keeps
 * resolving.
 */
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { finaliseMemberTrust } from "../members/email.js";
import { aggregateMemberWarnings } from "../members/project.js";
import type { MemberBronzeRow } from "../members/types.js";
import { type SourceProgress, type SourceProgressEvent, sourceHeartbeat, sourcePreview } from "../progress.js";
import type { CorpusRecord, ExportWindow } from "../types.js";
import { type NotionFetchError, NotionFetchErrors } from "./fetchErrors.js";
import { projectNotionUser } from "./fetchProject.js";
import { reconcileRowDuplicates, reconcilingBatchFlush } from "./fetchRender.js";
import type { NotionDatabaseItem, NotionPageItem } from "./project.js";
import { projectNotionRecords } from "./project.js";
import type { NotionSkip } from "./skips.js";

export { chunkText } from "../chunkText.js";
export {
  blockBorrowsContent,
  blockChildId,
  blockMentions,
  blockTextLine,
  cutoffMs,
  lastEditedOf,
  notionNextCursor,
  projectCommentItem,
  projectDatabaseItem,
  projectNotionUser,
  projectPageItem,
  projectRowItem,
  titleFrom,
  withinCutoff,
} from "./fetchProject.js";
export {
  mergeDuplicateRowPage,
  reconcileRowBatch,
  reconcileRowDuplicates,
  renderProperty,
  renderRichText,
  renderRowProperties,
} from "./fetchRender.js";

/** A page of shaped pages from the seam. `nextCursor` absent ⇒ the `since` cutoff was reached (stop). */
interface NotionPagesPage {
  readonly pages: readonly NotionPageItem[];
  readonly nextCursor?: string;
  readonly warnings?: readonly string[];
  /** Nodes that could not be read, with a classified reason (see `skips.ts`). */
  readonly skips?: readonly NotionSkip[];
  /** ID-anchored notes for an item that tripped its own per-item time budget (see `liveApi.ts`'s `itemDeadlineNote`). */
  readonly notes?: readonly string[];
}

/** A page of shaped databases from the seam. `nextCursor` absent ⇒ the search is exhausted (or the item
 * budget is): unlike the pages lane this one never stops at the `since` cutoff, because a data source's own
 * `last_edited_time` does not move when a row under it is edited — see `liveApiDatabases.ts`'s
 * `databaseSearchHit`. `rows` carries each data source's ROW pages (the actual records), projected as pages. */
interface NotionDatabasesPage {
  readonly databases: readonly NotionDatabaseItem[];
  readonly rows: readonly NotionPageItem[];
  readonly nextCursor?: string;
  readonly warnings?: readonly string[];
  /** Nodes that could not be read, with a classified reason (see `skips.ts`). */
  readonly skips?: readonly NotionSkip[];
  /** ID-anchored notes for a row that tripped its own per-item time budget (see `liveApi.ts`'s `itemDeadlineNote`). */
  readonly notes?: readonly string[];
}

/** A page of raw Notion user objects from `users.list` (projected to member rows by {@link fetchNotionMembers}). */
interface NotionUsersPage {
  readonly results: readonly unknown[];
  readonly nextCursor?: string;
}

/** Injected Notion seam — returns fully-shaped items so tests need no live SDK. */
export interface NotionApi {
  pages: (args: { since: string; cursor?: string }) => Promise<NotionPagesPage>;
  databases: (args: { since: string; cursor?: string }) => Promise<NotionDatabasesPage>;
  users: (args: { cursor?: string }) => Promise<NotionUsersPage>;
}

/**
 * Whether this pages-lane item is the SHADOW of a database row — a Notion page whose parent is a data
 * source, which the databases lane will independently discover, fetch and merge. Pure.
 *
 * The pages lane's incremental flush turns on this predicate. A shadow and its merged form share one
 * `sourceId` (`page:<id>`) but carry different content, so the writer's per-id fingerprint dedup treats
 * them as two versions and keeps BOTH — the exact page/row double-emit `reconcileRowDuplicates` was added
 * to remove. Flushing only the pages that no data source can claim keeps the durability checkpoint from
 * re-opening it, and costs those rows nothing: the databases lane flushes them itself.
 *
 * @param page one pages-lane item
 * @returns true when the page's raw parent is a data source or database
 */
export function isDataSourceRowShadow({ page }: { page: NotionPageItem }): boolean {
  const parent = page.raw?.["parent"];
  if (!isRecord(parent)) {
    return false;
  }
  const type = parent["type"];
  return type === "data_source_id" || type === "database_id";
}

/**
 * Build the `onBatch` callback the PAGES lane flushes through: drop the database-row shadows the
 * databases lane will claim (see {@link isDataSourceRowShadow}), project the rest, and forward them.
 *
 * The pages lane runs first and to exhaustion, and on the real workspace that is hours. Before this, only
 * the databases lane flushed, so a crawl killed during the pages lane wrote NOTHING — measured: a
 * `--since <day>` chunk was killed after 4.3 hours having produced zero bytes on disk, on a build
 * whose release notes already claimed incremental writes.
 *
 * @param onBatch the caller's own durability sink
 * @returns the callback to pass as `pageAllPages`'s `onBatch`
 */
function pageLaneBatchFlush({
  onBatch,
}: {
  onBatch: (args: { records: readonly CorpusRecord[] }) => void;
}): (args: { pages: readonly NotionPageItem[] }) => void {
  return ({ pages }) => {
    const standalone = pages.filter((page) => !isDataSourceRowShadow({ page }));
    if (standalone.length === 0) {
      return;
    }
    onBatch({ records: projectNotionRecords({ databases: [], pages: standalone }) });
  };
}

/**
 * Fetch shaped Notion activity — accessible pages (recursively rendered + chunked) and databases — over
 * the window, paging each lane until the seam stops returning a cursor (which the live seam does once the
 * `since` cutoff is reached, since Notion search has no server-side date filter). Top-level failure is
 * fatal; per-page comment-fetch failures surface as warnings.
 *
 * `onBatch`, when given, is a DURABILITY side-channel, not the source of truth. It fires for BOTH lanes:
 * once per pages-lane search page with that page's standalone pages (the database-row shadows are held
 * back for the lane that will merge them — see {@link pageLaneBatchFlush}), and once per databases-lane
 * search page with that page's records already reconciled against the complete pages lane. The final
 * `pages`/`databases` this function returns are computed independently over the complete in-memory result
 * regardless, exactly as before a kill was ever a concern — a successful run's closing write is a safe,
 * deduped no-op over anything `onBatch` already flushed.
 *
 * @param api the injected Notion seam
 * @param window the export window (`since` bounds `last_edited_time`, applied client-side by the seam)
 * @param onProgress the heartbeat/preview sink — omitted when nothing is watching, e.g. under test
 * @param onBatch the incremental-write checkpoint — omitted when the caller wants only the final result
 * @returns the shaped pages + databases + warnings + the classified `skips` for everything unreadable, or
 *   `err` on a genuinely fatal failure (a rejected token, or a failure of the top-level search itself)
 */
export async function fetchNotionActivity({
  api,
  window,
  onProgress,
  onBatch,
}: {
  api: NotionApi;
  window: ExportWindow;
  onProgress?: SourceProgress;
  onBatch?: (args: { records: readonly CorpusRecord[] }) => void;
}): Promise<
  Result<
    {
      pages: readonly NotionPageItem[];
      databases: readonly NotionDatabaseItem[];
      warnings: readonly string[];
      skips: readonly NotionSkip[];
      notes: readonly string[];
    },
    NotionFetchError
  >
> {
  try {
    const pageLane = await pageAllPages({
      api,
      since: window.since,
      ...(onProgress !== undefined ? { onProgress } : {}),
      ...(onBatch !== undefined ? { onBatch: pageLaneBatchFlush({ onBatch }) } : {}),
    });
    const onDbBatch =
      onBatch === undefined ? undefined : reconcilingBatchFlush({ onBatch, pageLanePages: pageLane.pages });
    const dbLane = await pageAllDatabases({
      api,
      since: window.since,
      ...(onProgress !== undefined ? { onProgress } : {}),
      ...(onDbBatch !== undefined ? { onBatch: onDbBatch } : {}),
    });
    // data-source ROWS are the actual records — reconciled against the pages lane rather than concatenated,
    // since a row IS a Notion `page` object and the pages lane's `object:"page"` search finds it too.
    return ok({
      databases: dbLane.databases,
      notes: [...pageLane.notes, ...dbLane.notes],
      pages: reconcileRowDuplicates({ pages: pageLane.pages, rows: dbLane.rows }),
      skips: [...pageLane.skips, ...dbLane.skips],
      warnings: [...pageLane.warnings, ...dbLane.warnings],
    });
  } catch (error: unknown) {
    return err(NotionFetchErrors.fetchFailed({ cause: error }));
  }
}

/** A page's preview line: its first rendered chunk, or its title for a page that rendered to no chunk at all. */
function pagePreviewSnippet({ page }: { page: NotionPageItem }): string {
  const first = page.chunks[0];
  if (first == null) {
    return page.title;
  }
  return first;
}

/**
 * A content-preview from a Notion page (its title + first rendered chunk). Pure.
 *
 * @param page the already-shaped page; its first chunk is the snippet, falling back to the title when the
 *   page rendered to nothing
 * @returns the preview event, tagged to the `pages` phase
 */
export function notionPagePreview({ page }: { page: NotionPageItem }): SourceProgressEvent {
  return sourcePreview({
    phase: "pages",
    snippet: pagePreviewSnippet({ page }),
    source: "notion",
    sourceContentId: page.id,
    subject: page.title,
  });
}

/**
 * A content-preview from a Notion database (its title). Pure.
 *
 * @param database the already-shaped database; only its title is surfaced, since a database has no body
 * @returns the preview event, tagged to the `databases` phase
 */
export function notionDatabasePreview({ database }: { database: NotionDatabaseItem }): SourceProgressEvent {
  return sourcePreview({
    phase: "databases",
    snippet: database.title,
    source: "notion",
    sourceContentId: database.id,
    subject: database.title,
  });
}

/** Append every item of an optional array onto an accumulator — a no-op when the source is absent. */
function pushAllIfDefined<T>({ into, from }: { into: T[]; from: readonly T[] | undefined }): void {
  if (from !== undefined) {
    into.push(...from);
  }
}

/**
 * Page the `pages` lane to exhaustion, collecting shaped pages + per-page comment warnings + heartbeats.
 *
 * `onBatch`, when given, fires once per SEARCH page with that page's own items — the durability
 * checkpoint that makes a kill mid-pages-lane lose one search page rather than the whole run.
 */
async function pageAllPages({
  api,
  since,
  onProgress,
  onBatch,
}: {
  api: NotionApi;
  since: string;
  onProgress?: SourceProgress;
  onBatch?: (args: { pages: readonly NotionPageItem[] }) => void;
}): Promise<{
  pages: readonly NotionPageItem[];
  warnings: readonly string[];
  skips: readonly NotionSkip[];
  notes: readonly string[];
}> {
  const pages: NotionPageItem[] = [];
  const warnings: string[] = [];
  const skips: NotionSkip[] = [];
  const notes: string[] = [];
  let cursor: string | undefined;
  let index = 0;
  do {
    const page = await api.pages({ since, ...(cursor !== undefined ? { cursor } : {}) });
    if (index === 0 && page.pages[0] !== undefined) {
      onProgress?.(notionPagePreview({ page: page.pages[0] }));
    }
    pages.push(...page.pages);
    pushAllIfDefined({ from: page.warnings, into: warnings });
    pushAllIfDefined({ from: page.skips, into: skips });
    pushAllIfDefined({ from: page.notes, into: notes });
    onBatch?.({ pages: page.pages });
    index += 1;
    // Per SEARCH page. The live seam also ticks per individual page (see `notionPagesMethod`) — the two are
    // additive rather than alternatives: this one is the seam-agnostic tick a fake seam can drive and a test
    // can assert, the finer one exists because a search page is 100 pages and minutes of silence.
    onProgress?.(
      sourceHeartbeat({
        currentItem: { title: `page ${String(index)}` },
        done: pages.length,
        metrics: { pages: pages.length, unreadable: skips.length },
        phase: "pages",
        source: "notion",
      }),
    );
    cursor = page.nextCursor;
  } while (cursor !== undefined && cursor.length > 0);
  return { notes, pages, skips, warnings };
}

/**
 * Page the `databases` lane to exhaustion, collecting summaries + row pages + per-page heartbeats.
 *
 * `onBatch`, when given, fires once per search-page (up to 100 data sources' worth of databases + rows)
 * with THAT page's own raw items — the durability checkpoint {@link fetchNotionActivity} wires to an
 * incremental bronze write, so a kill mid-crawl loses at most the in-flight search page.
 */
async function pageAllDatabases({
  api,
  since,
  onProgress,
  onBatch,
}: {
  api: NotionApi;
  since: string;
  onProgress?: SourceProgress;
  onBatch?: (args: { databases: readonly NotionDatabaseItem[]; rows: readonly NotionPageItem[] }) => void;
}): Promise<{
  databases: readonly NotionDatabaseItem[];
  rows: readonly NotionPageItem[];
  warnings: readonly string[];
  skips: readonly NotionSkip[];
  notes: readonly string[];
}> {
  const databases: NotionDatabaseItem[] = [];
  const rows: NotionPageItem[] = [];
  const warnings: string[] = [];
  const skips: NotionSkip[] = [];
  const notes: string[] = [];
  let cursor: string | undefined;
  let index = 0;
  do {
    const page = await api.databases({ since, ...(cursor !== undefined ? { cursor } : {}) });
    if (index === 0 && page.databases[0] !== undefined) {
      onProgress?.(notionDatabasePreview({ database: page.databases[0] }));
    }
    databases.push(...page.databases);
    rows.push(...page.rows);
    pushAllIfDefined({ from: page.warnings, into: warnings });
    pushAllIfDefined({ from: page.skips, into: skips });
    pushAllIfDefined({ from: page.notes, into: notes });
    onBatch?.({ databases: page.databases, rows: page.rows });
    index += 1;
    onProgress?.(
      sourceHeartbeat({
        done: databases.length,
        metrics: { databases: databases.length, rows: rows.length, unreadable: skips.length },
        phase: "databases",
        source: "notion",
      }),
    );
    cursor = page.nextCursor;
  } while (cursor !== undefined && cursor.length > 0);
  return { databases, notes, rows, skips, warnings };
}

/**
 * Hydrate every Notion workspace member (`users.list`, paged), projecting each + finalising trust. A
 * failure is fatal (`err`).
 *
 * @param api the injected Notion seam
 * @param fetchedAtIso the hydration timestamp
 * @returns the member rows + warnings, or `err` on a fatal failure
 */
export async function fetchNotionMembers({
  api,
  fetchedAtIso,
}: {
  api: NotionApi;
  fetchedAtIso: string;
}): Promise<Result<{ rows: readonly MemberBronzeRow[]; warnings: readonly string[] }, NotionFetchError>> {
  const rows: MemberBronzeRow[] = [];
  try {
    let cursor: string | undefined;
    do {
      const page = await api.users(cursor !== undefined ? { cursor } : {});
      for (const raw of page.results) {
        const row = projectNotionUser({ fetchedAtIso, raw });
        if (row !== undefined) {
          rows.push(row);
        }
      }
      cursor = page.nextCursor;
    } while (cursor !== undefined && cursor.length > 0);
  } catch (error: unknown) {
    return err(NotionFetchErrors.memberHydrationFailed({ cause: error }));
  }
  const finalised = finaliseMemberTrust({ rows });
  return ok({ rows: finalised, warnings: aggregateMemberWarnings({ rows: finalised }) });
}
