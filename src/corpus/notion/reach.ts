/**
 * Grant-delta detection + full-history backfill — the retroactive-backfill half of Notion ingest.
 *
 * `fetch.ts`'s pages/databases lanes search newest-first and stop paging at the first hit older than
 * `since` (Notion `search` has no server-side date filter), so a page the integration was JUST granted but
 * that was last edited long ago sits below every incremental refresh's cutoff and is never reached at all —
 * a freshly granted workspace needed hand-picked `--since` chunks to surface it
 * (`handovers/notion-bronze-expansion-after-access-grant.md`; a human noticed, the tool didn't).
 *
 * This module makes that automatic and runs on every refresh: enumerate every id the integration can
 * currently see (cheap — `search`, no block/row fetch), diff against what bronze + the structures store
 * already hold, and fully backfill only the delta — the ids that turned out to be newly reachable —
 * regardless of their `last_edited_time`, before the normal incremental pass runs. See
 * `docs/notion-reach.md` for the reach contract this implements.
 */
import { readStructureRows } from "../structures/store.js";
import { reconcileRowDuplicates, titleFrom } from "./fetch.js";
import type { NotionDatabaseItem, NotionPageItem } from "./project.js";
import type { NotionSkip } from "./skips.js";

/** One id the integration can currently see, with no content fetched yet. */
export interface NotionReachHit {
  readonly id: string;
  readonly lastEdited: string;
  readonly raw: Record<string, unknown>;
}

/** The injected reach seam: cheap full-workspace enumeration + targeted full-history backfill. */
export interface NotionReachApi {
  /** Every page id the integration can currently see (no cutoff, no content fetch). */
  enumeratePages: () => Promise<{ hits: readonly NotionReachHit[]; skips: readonly NotionSkip[] }>;
  /** Every data-source (database) id the integration can currently see (no cutoff, no content fetch). */
  enumerateDatabases: () => Promise<{ hits: readonly NotionReachHit[]; skips: readonly NotionSkip[] }>;
  /** Fully fetch each given page (block body + comments), regardless of `last_edited_time`. */
  backfillPages: (args: { hits: readonly NotionReachHit[] }) => Promise<{
    pages: readonly NotionPageItem[];
    skips: readonly NotionSkip[];
    notes: readonly string[];
  }>;
  /** Fully fetch each given data source's schema + every row, regardless of `last_edited_time`. */
  backfillDatabases: (args: { hits: readonly NotionReachHit[] }) => Promise<{
    databases: readonly NotionDatabaseItem[];
    rows: readonly NotionPageItem[];
    skips: readonly NotionSkip[];
    notes: readonly string[];
  }>;
}

/** The ids newly visible since the last time reach was measured, vs. what was already held. */
export interface NotionGrantDelta {
  readonly newPages: readonly NotionReachHit[];
  readonly newDatabases: readonly NotionReachHit[];
}

/**
 * Set-difference the enumerated reach against what's already held. Pure — everything else about a refresh
 * keeps working exactly as it did before this module existed.
 *
 * @param pages every page id the integration can currently see
 * @param databases every data-source id the integration can currently see
 * @param heldPageIds page ids bronze already holds at least one capture of, regardless of freshness
 * @param heldDatabaseIds data-source ids already known, from bronze + the structures store
 * @returns the newly-reachable ids only, in enumeration order
 */
export function computeGrantDelta({
  pages,
  databases,
  heldPageIds,
  heldDatabaseIds,
}: {
  pages: readonly NotionReachHit[];
  databases: readonly NotionReachHit[];
  heldPageIds: ReadonlySet<string>;
  heldDatabaseIds: ReadonlySet<string>;
}): NotionGrantDelta {
  return {
    newDatabases: databases.filter((hit) => !heldDatabaseIds.has(hit.id)),
    newPages: pages.filter((hit) => !heldPageIds.has(hit.id)),
  };
}

const REPORTED_ROOTS = 5;

/** The best-effort title of a reach hit, for the human-readable report only — empty stays empty. Pure. */
function reachTitle({ hit }: { hit: NotionReachHit }): string {
  const title = titleFrom({ raw: hit.raw });
  return title === "(untitled)" ? "" : title;
}

/**
 * The plain-English grant-delta report line — what `ingestNotion` folds into the run's notes. Reports the
 * FULL reach (reachable vs. held), never just the delta count, so the line answers "how much of the
 * workspace can we see" as well as "what's new" — the reach contract's coverage half. Pure.
 *
 * @param totalPages every page id currently reachable (held + new)
 * @param totalDatabases every data-source id currently reachable (held + new)
 * @param delta the computed delta
 * @returns a plain-English summary — never silent, including for an empty delta
 */
export function summariseGrantDelta({
  totalPages,
  totalDatabases,
  delta,
}: {
  totalPages: number;
  totalDatabases: number;
  delta: NotionGrantDelta;
}): string {
  const heldPages = totalPages - delta.newPages.length;
  const heldDatabases = totalDatabases - delta.newDatabases.length;
  if (delta.newPages.length === 0 && delta.newDatabases.length === 0) {
    return `reach: ${String(totalPages)} page(s) + ${String(totalDatabases)} database(s) reachable, all already held — nothing newly reachable this run`;
  }
  const roots = [...delta.newPages, ...delta.newDatabases]
    .map((hit) => reachTitle({ hit }))
    .filter((title) => title.length > 0)
    .slice(0, REPORTED_ROOTS);
  const rootsText = roots.length > 0 ? `; roots: ${roots.join(", ")}` : "";
  return (
    `reach: ${String(totalPages)} page(s) + ${String(totalDatabases)} database(s) reachable — ` +
    `${String(heldPages)} page(s) + ${String(heldDatabases)} database(s) already held, ` +
    `+${String(delta.newPages.length)} page(s) + ${String(delta.newDatabases.length)} database(s) newly reachable this run, ` +
    `backfilled regardless of edit date${rootsText}`
  );
}

/**
 * Data-source ids the structures store already knows about, independent of whether bronze holds any of
 * their ROW content yet. `structures.ts`'s own crawl discovers every accessible data source
 * unconditionally on every `derive`, so a data source it has already recorded must never be reported as
 * newly granted just because this refresh hasn't captured a row from it yet.
 *
 * The one impure function in this module — reads `structures/notion.jsonl` — because `heldDatabaseIds` is
 * meaningless without it: a bronze-only view would report every data source with zero captured rows as a
 * fresh grant on every single refresh.
 *
 * @param home the Slopweaver home whose structures store is read
 * @returns the known Notion data-source ids
 */
export function structureNotionDataSourceIds({ home }: { home: string }): ReadonlySet<string> {
  return new Set(
    readStructureRows({ home, source: "notion" })
      .rows.filter((row) => row.kind === "data_source")
      .map((row) => row.sourceId),
  );
}

/**
 * Enumerate the workspace's current reach, diff it against what's already held, and fully backfill the
 * delta — every newly-reachable page and database, fetched completely regardless of `last_edited_time`.
 *
 * A backfilled data-source row is ALSO independently found by the pages-lane enumeration (a row is itself a
 * Notion `page` object), so the two are reconciled exactly as the normal incremental crawl reconciles them
 * ({@link reconcileRowDuplicates}) — without it, a newly-granted database's rows would double-emit.
 *
 * Enumeration failures are not fatal here — a `search` hiccup narrows this run's delta (and is carried
 * through as a skip, never silently absorbed as "nothing new"); the caller's own top-level catch is what
 * turns a genuinely fatal failure (an auth rejection) into the run's error, exactly as it already does for
 * the main crawl.
 *
 * @param api the injected reach seam
 * @param heldPageIds page ids bronze already holds at least one capture of
 * @param heldDatabaseIds data-source ids already known, from bronze + the structures store
 * @returns the delta's backfilled pages/databases, its plain-English report line, and every skip/note
 *   collected across enumeration and backfill
 */
export async function backfillNotionGrantDelta({
  api,
  heldPageIds,
  heldDatabaseIds,
}: {
  api: NotionReachApi;
  heldPageIds: ReadonlySet<string>;
  heldDatabaseIds: ReadonlySet<string>;
}): Promise<{
  pages: readonly NotionPageItem[];
  databases: readonly NotionDatabaseItem[];
  summary: string;
  skips: readonly NotionSkip[];
  notes: readonly string[];
}> {
  const [enumeratedPages, enumeratedDatabases] = await Promise.all([api.enumeratePages(), api.enumerateDatabases()]);
  const delta = computeGrantDelta({
    databases: enumeratedDatabases.hits,
    heldDatabaseIds,
    heldPageIds,
    pages: enumeratedPages.hits,
  });
  const summary = summariseGrantDelta({
    delta,
    totalDatabases: enumeratedDatabases.hits.length,
    totalPages: enumeratedPages.hits.length,
  });
  const [pageBackfill, databaseBackfill] = await Promise.all([
    api.backfillPages({ hits: delta.newPages }),
    api.backfillDatabases({ hits: delta.newDatabases }),
  ]);
  return {
    databases: databaseBackfill.databases,
    notes: [...pageBackfill.notes, ...databaseBackfill.notes],
    pages: reconcileRowDuplicates({ pages: pageBackfill.pages, rows: databaseBackfill.rows }),
    skips: [...enumeratedPages.skips, ...enumeratedDatabases.skips, ...pageBackfill.skips, ...databaseBackfill.skips],
    summary,
  };
}
