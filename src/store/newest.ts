/**
 * The instant of one source's newest content row — the clock a scheduled corpus resync is judged by.
 *
 * A corpus source has two clocks and they used to be conflated. Its bronze WATERMARK (`corpus/watermark.ts`)
 * is the newest record a fetch observed, and it moves the moment `refresh` writes the window file. The
 * store's newest row is what a reader can actually query, and it moves only when something ingests that
 * file. MEASURED: `resync-corpus-linear` recorded an `afterClock` off the watermark many hours ahead while
 * `max(occurred_at) where source = 'linear'` in the store stayed behind it — the row said succeeded and
 * the store had not moved. The resync's clock is THIS one now, so the number the freshness page reports
 * is the number the history leg answers from.
 *
 * ## It is BOUNDED, and it opens its own connection to be
 *
 * Reading a clock is now on two paths that must never hang: every scheduled `automation resync` attempt, twice,
 * and every briefing render. `connectStore` sets no `connect_timeout`, so a selected database that is not
 * listening — which is what a stopped Docker looks like — makes a caller wait for the OS default. So this
 * opens its own bounded connection exactly as {@link ./reading.observeStore} does and for the same reason:
 * `connect_timeout` covers a store that is not there and `statement_timeout` is Postgres cancelling its own
 * work, so the budget is enforced where the work is. It bounds each STEP, not the call: the connect gets it
 * once, rounded up to whole seconds, and every source's query gets it again as its own statement timeout, so
 * dating several sources can take several budgets. The migration-state refusal `connectStore` performs is
 * deliberately skipped here, again as `observeStore` skips it: `max(occurred_at)` names two columns that
 * have existed since the first migration, and a clock read is not a session.
 *
 * The statement itself is a per-source `max`, not a census: `idx_content_source_time` covers
 * `(source, occurred_at desc)`, so it is an index read rather than the grouped scan
 * `./reading.ts` takes. Reproduce both on any install with `time slopweaver store facets --facet source`.
 *
 * ## `null` is one answer, with several causes it deliberately does not tell apart
 *
 * An empty source, a store that is unselected, one that is not listening and one whose read missed the
 * budget all read as `null` from {@link readStoreNewest}, because a clock is a `string | null` and the
 * judgement in `live/resync/outcome.ts` treats them the same way: a refresh that exited zero and left no
 * newest row is one whose records reached nowhere a reader can query. {@link newestStoredInstant} keeps the
 * query failure apart for a caller holding its own connection.
 */
import { eq, max } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { err, ok, type Result } from "../lib/result.js";

import type { StoreReader } from "./client.js";
import { storeUrlSelection } from "./config.js";
import { type StoreError, StoreErrors } from "./errors.js";
import { contentTable } from "./schema/content.js";
import type { contentSourceEnum } from "./schema/enums.js";
import * as storeSchema from "./schema.js";

/**
 * The budget, in milliseconds, each step of a clock read is given: the connect timeout (rounded up to whole
 * seconds) and, separately, the statement timeout of each source's query.
 *
 * The same budget `./reading.ts` spends on its own observation, and chosen the same way: a stopped stack
 * must cost a bot turn or a briefing render well under a second. MEASURED on this install's own
 * store, 1,195,483 rows: two sources dated in 28 ms, and a selected database on a port nothing is listening
 * on gave up in 34 ms instead of waiting for the OS default. The grouped form the census takes is the
 * strictly more expensive one — `time slopweaver store facets --facet source` was 7.65s wall —
 * because the per-source `max` here rides `idx_content_source_time` and that scans.
 *
 * Reproduce both halves:
 * `yarn tsx -e 'import {readStoreNewest} from "./src/store/newest.js"; const t=Date.now();
 * console.log(Date.now()-t, [...await readStoreNewest({home: process.env.SLOPWEAVER_HOME, sources:
 * ["linear","slack"]})])'`, once bare and once with
 * `SLOPWEAVER_STORE_URL=postgres://postgres:postgres@127.0.0.1:59999/postgres`.
 *
 * @internal
 */
export const STORE_CLOCK_BUDGET_MS = 2000;

/** A source the store has a column for. */
export type StoredSource = (typeof contentSourceEnum.enumValues)[number];

/**
 * `max(occurred_at)` over one source's content rows.
 *
 * @param reader the open store, or a transaction on it
 * @param source which source's rows to date
 * @returns the newest instant as ISO, `null` when the source has no rows, or the query failure
 * @internal — the one query; callers outside this file go through {@link readStoreNewest}, which owns the
 *   connection. Exported so a caller holding its own open store (a transaction, a verb) can reuse it.
 */
export async function newestStoredInstant({
  reader,
  source,
}: {
  readonly reader: StoreReader;
  readonly source: StoredSource;
}): Promise<Result<string | null, StoreError>> {
  try {
    const [row] = await reader.db
      .select({ newest: max(contentTable.occurredAt) })
      .from(contentTable)
      .where(eq(contentTable.source, source));
    return ok(instantOf({ value: row?.newest }));
  } catch (cause: unknown) {
    return err(StoreErrors.queryFailed({ cause, what: `newest ${source} row` }));
  }
}

/**
 * Open the selected store ONCE under a bounded connect, date every named source's newest row with each query
 * under its own statement timeout, and close.
 *
 * One open for any number of sources, because the briefing's freshness page reads every corpus clock on
 * every render and seven connections is a cost a render should not pay. A resync reads one source, twice —
 * before and after — and pays one open each time.
 *
 * Never throws and never refuses: a store that is unselected or not listening reads `null` for every source,
 * and a query that fails or runs past its statement timeout reads `null` for its own source, the same as a
 * source holding no rows. That is the safe direction for the one judgement that consumes it, since none of
 * those cases is evidence that anything reached the store.
 *
 * @param home the Slopweaver home the remembered store selection is read under
 * @param sources which sources' rows to date
 * @param budgetMs the connect timeout, rounded up to whole seconds and at least one, and each query's own
 *   statement timeout; not a bound on the whole read
 * @returns each source's newest instant as ISO, or `null`, keyed by source
 */
export async function readStoreNewest({
  home,
  sources,
  budgetMs = STORE_CLOCK_BUDGET_MS,
}: {
  readonly home: string;
  readonly sources: readonly StoredSource[];
  readonly budgetMs?: number;
}): Promise<ReadonlyMap<StoredSource, string | null>> {
  const clocks = new Map<StoredSource, string | null>(sources.map((source) => [source, null]));
  const selected = storeUrlSelection({ home });
  if (selected.isErr() || sources.length === 0) {
    return clocks;
  }
  const seconds = Math.max(1, Math.ceil(budgetMs / 1000));
  // Constructed INSIDE the guard: `postgres()` parses the URL synchronously and throws on a malformed
  // remembered selection, which built outside the `try` would take a briefing render down rather than
  // leaving every clock unknown. The same reasoning as `./reading.ts`'s own construction.
  let sql: postgres.Sql | undefined;
  try {
    sql = postgres(selected.value.url, {
      connection: { statement_timeout: budgetMs },
      connect_timeout: seconds,
      max: 1,
      onnotice: () => {},
      prepare: false,
    });
    const reader: StoreReader = { db: drizzle(sql, { schema: storeSchema }) };
    for (const source of sources) {
      const newest = await newestStoredInstant({ reader, source });
      clocks.set(source, newest.isOk() ? newest.value : null);
    }
  } catch {
    return clocks;
  } finally {
    if (sql !== undefined) {
      await sql.end({ timeout: seconds });
    }
  }
  return clocks;
}

/**
 * Render a `max(occurred_at)` as an ISO instant, or `null` when the group had no rows.
 *
 * The driver hands a timestamp aggregate back as a `Date` in `mode: "date"` and as a string under some
 * configurations, so both are accepted, exactly as `./reading.ts` does. No epoch arithmetic — the database
 * already resolved the value.
 */
function instantOf({ value }: { readonly value: unknown }): string | null {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return typeof value === "string" && value.length > 0 ? value : null;
}
