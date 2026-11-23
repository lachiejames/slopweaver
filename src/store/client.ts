/**
 * The typed query layer — list, filter, facets and retrieve-detail over the store, in one place.
 *
 * Owner turn 99, the row this belongs to: a client "like a TypeScript SDK exposing list, filter, facets,
 * retrieve-detail, Datadog-style queryability, never a blind grep, fail loudly, fast feedback, scalable
 * because atlases only grow". Four properties fall out of that and each is visible in the code below, or in
 * {@link ./predicates}, which builds the filter and facet SQL these readers run.
 *
 * **Nothing here builds SQL from a string a caller supplied.** Every filter goes through Drizzle's
 * parameterised builders, and the two places a raw fragment IS needed — full-text search and the day
 * bucket — are `sql` templates with bound parameters rather than interpolation. A query layer whose
 * escape hatch is string concatenation is a grep with extra steps.
 *
 * **The types are the schema's own.** `ContentRow` is `typeof contentTable.$inferSelect`, so a column
 * rename is a compile error at every call site rather than a runtime surprise at one. That is the half of
 * the archive's design the owner named directly, and it is why there is no hand-written row interface
 * anywhere in this module.
 *
 * **A refusal names what it refused.** A bad source is caught by the schema in `query.ts` before a
 * connection is opened, and a database failure comes back as a typed `STORE_QUERY_FAILED` carrying the
 * cause. Neither is an empty result set, which is the failure mode this replaces — an empty answer and a
 * misspelled filter look identical, and only one of them is a real fact about the corpus.
 *
 * **Every filter is an index seek.** The facets are a closed list precisely so that each maps onto an
 * index the migration creates, and `list` orders by `occurred_at` descending inside whatever the filters
 * narrowed, which is what `idx_content_source_time` and `idx_content_container_time` are for.
 */
import { and, count, desc, eq, sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js/session";
import postgres from "postgres";

import { installedTreeRoot } from "#lib/pluginRoot.js";
import { err, ok, type Result } from "../lib/result.js";

import { catchUpOrSay, staleHatchOpen, staleStoreRefusal } from "./catchUp.js";
import { STORE_URL_ENV, storeUrl } from "./config.js";
import { driverReasonWithin, isUnreachableReason, type StoreError, StoreErrors, storeErrorLines } from "./errors.js";
import { readMigrationState } from "./lifecycle.js";
import { resolvePeople } from "./person.js";
import { facetColumn, predicateFor, type StoreScope } from "./predicates.js";
import type { StoreFacet, StoreQuery } from "./query.js";
import { containerTable } from "./schema/container.js";
import { type ContentRow, contentTable } from "./schema/content.js";
import { personTable } from "./schema/person.js";
import { hasSourceRowTable, SOURCE_ROW_TABLES } from "./schema/sourceRows.js";
import * as storeSchema from "./schema.js";

/**
 * The two configuration symbols the store VERBS reach through this module, re-exported from
 * {@link ./config} so their existing imports keep working. `config.ts` is where they are declared, and
 * where the reason a remembered selection is not a guessed one is written down; a caller wanting the
 * selection's ORIGIN imports `storeUrlSelection` from there directly rather than through here.
 */
export { STORE_URL_ENV, storeUrl };

/**
 * Anything a READ can run against — the pooled connection, or one transaction opened on it.
 *
 * Both the pool's database and a transaction handle extend drizzle's `PgDatabase` over the postgres-js result
 * type, so a reader that takes this runs unchanged inside a snapshot. That is what lets the bake-off's retrieve
 * phase put every leg in ONE `repeatable read` transaction without a cast or a second copy of any query.
 */
export interface StoreReader {
  readonly db: PgDatabase<PostgresJsQueryResultHKT, typeof storeSchema>;
}

/**
 * The ambient variable that admits a database whose migration record is not current — the `stale-store`
 * row's key, spelled here so the refusal, the reader and the register agree on one name.
 *
 * @internal — the `escape-hatch` gate reads this file for the row's key; nothing imports the constant
 */
export const ALLOW_STALE_STORE_ENV = "SLOPWEAVER_ALLOW_STALE_STORE";

/**
 * The typed database: drizzle over postgres-js, carrying the whole schema barrel so `db.query.<table>`
 * is typed — the archive's `Database = ReturnType<typeof drizzle<typeof schema>>`, pointed the same way.
 *
 * @internal — named so `StoreWriter` and `StoreClient` derive from one place
 */
export type StoreDatabase = PostgresJsDatabase<typeof storeSchema>;

/** An open connection to the store, and the handle that closes it. */
export interface StoreClient {
  readonly db: StoreDatabase;
  readonly close: () => Promise<void>;
}

/**
 * The handle a write runs against inside a transaction.
 *
 * Derived from Drizzle's own `transaction` signature rather than named as a concrete class, so a version
 * bump that changes the transaction type is a compile error in one place instead of a `never` that
 * silently accepts anything at four call sites.
 */
export type StoreWriter = Parameters<Parameters<StoreDatabase["transaction"]>[0]>[0];

/** One row of a facet count: the value, and how many rows carry it. */
export interface FacetCount {
  readonly value: string;
  readonly rows: number;
}

/** A content row with the two names every reader needs, off the joins `list` already makes. */
export interface ContentWithNames {
  readonly row: ContentRow;
  readonly container: string | null;
  readonly author: string | null;
}

/** A content row with its container, author and per-source columns resolved for a reader. */
export interface ContentDetail {
  readonly row: ContentRow;
  readonly container: string | null;
  readonly author: string | null;
  /**
   * The row from this source's own table, when it has one.
   *
   * Typed as an open record rather than the union of four row types, because a detail read is the one
   * place that genuinely does not branch on source — it prints whatever columns the row has. A caller
   * that wants Slack's columns typed selects from `contentSlackTable` directly and gets `ContentSlackRow`.
   */
  readonly sourceRow: Record<string, unknown> | null;
}

/**
 * Open a RAW connection to the store — no check that the database matches the schema.
 *
 * For the lifecycle verbs, which are what moves a database between states, and for nothing else: every
 * reader and writer goes through {@link connectStore}, which refuses a database the journal does not
 * describe. A raw open elsewhere is the hole that check exists to close.
 *
 * @param url the connection string
 * @param max how many pooled connections to open, one for a CLI read and more for a bulk ingest
 * @returns the client, whose `close` must be awaited
 */
export function openStore({ url, max = 1 }: { url: string; max?: number }): StoreClient {
  const sqlClient = postgres(url, { max, onnotice: () => {} });
  return {
    close: async (): Promise<void> => sqlClient.end({ timeout: 5 }),
    db: drizzle(sqlClient, { schema: storeSchema }),
  };
}

/**
 * Which failure a migration-state read was: the stack is not there, or the database answered no.
 *
 * Split out of {@link connectStore} to keep it under this repo's `max-function-lines` and
 * `cognitive-complexity` ceilings, and because the distinction is worth naming. The first query every store
 * verb makes is this one, so it is where a stopped stack surfaces for ALL of them — which is why the two
 * are separated once here rather than at each call site. See `./errors.ts`'s `StoreUnreachableError` for
 * the owner ruling that makes the unreachable case loud.
 *
 * @param problems the lines of what `readMigrationState` reported
 * @returns the typed failure
 */
function migrationReadFailure({ problems }: { problems: readonly string[] }): StoreError {
  const reported = problems.join("; ");
  if (isUnreachableReason({ reason: reported })) {
    // `reported` is ALREADY `unreachableMessage(...)`, built by the lifecycle read, so the MESSAGE is
    // carried through rather than re-wrapped — the operator reads one sentence, not two nested ones. The
    // `reason` field is recovered from it rather than set to the whole paragraph: r1
    // `unreachable-classification` caught the two construction paths disagreeing about what that field
    // holds, which made its own doc comment ("what the driver actually reported") false on this path.
    return StoreErrors.unreachable({ reason: driverReasonWithin({ message: reported }) });
  }
  return StoreErrors.queryFailed({ cause: new Error(reported), what: "read the migration state" });
}

/**
 * Select the store, open it, and REFUSE unless the database matches the journal.
 *
 * This is the runtime half of "a table existing in code but not in the database is structurally
 * impossible". The static half is the `drizzle-migrations` gate, which
 * holds the schema and the committed migrations together; this holds the committed migrations and the
 * DATABASE together, at the one point every verb passes through. A database that is `behind`,
 * `unrecorded`, `fresh` or `foreign` is one where a typed query can name a column Postgres has never
 * had, and the failure that produces is a runtime error at whichever call site is unlucky — or, worse,
 * a policy that a migration declares and the database does not enforce.
 *
 * MEASURED on this install's own store (`postgres` on the local stack): zero bookkeeping rows,
 * eight of ten declared tables present, `memories` and `content_vector` absent — so `knowledge remember`
 * would have failed on a missing relation while `store status` reported the store reachable. This check
 * is what makes that a refusal naming `store baseline` and `store push` instead.
 *
 * **A `behind` database is caught up first, when it can be** ({@link ./catchUp.catchUpStore}): local, every
 * pending file landed on `origin/main`, every statement additive, nothing added since `initdb` that runs unnamed. MEASURED: refusing that case bricked
 * every store verb, the plans register and so every Claude session boot for five minutes after a new migration
 * reached the main checkout with nothing pushing the store. Any other `behind` still refuses, saying which
 * condition failed.
 *
 * The `stale-store` hatch is the one way past it, and an open one skips the catch-up too, so a database held at an
 * older schema on purpose opens unchanged. It is ambient, never journalled, because nothing outbound is involved;
 * and it is a hatch rather than a flag so the refusal prints the row's own exceptions.
 *
 * @param home the Slopweaver home the remembered selection is read under
 * @param max how many pooled connections to open
 * @param cwd the tree the migration journal is read from; defaults to the tree this build lives in, never the operator's cwd
 * @param env the environment the selection and the hatch are read from; defaults to the process's own
 * @param catchUp whether a `behind` database may be caught up; `false` for a dry run, which promises to change nothing
 * @returns the open client, or the typed refusal — no selection, a remote host, or a stale database
 */
export async function connectStore({
  home,
  max = 1,
  cwd = installedTreeRoot({ importMetaUrl: import.meta.url }),
  env = process.env,
  catchUp = true,
}: {
  home?: string;
  max?: number;
  cwd?: string;
  env?: Readonly<Record<string, string | undefined>>;
  catchUp?: boolean;
} = {}): Promise<Result<StoreClient, StoreError>> {
  const url = storeUrl({ env, ...(home === undefined ? {} : { home }) });
  if (url.isErr()) {
    return err(url.error);
  }
  const probe = postgres(url.value, { max: 1, onnotice: () => {} });
  let state;
  try {
    state = await readMigrationState({ cwd, sql: probe });
  } finally {
    await probe.end({ timeout: 5 });
  }
  if (state.isErr()) {
    return err(migrationReadFailure({ problems: storeErrorLines({ error: state.error }) }));
  }
  let notCaughtUp: string | undefined;
  const held = staleHatchOpen({ env, ...(home === undefined ? {} : { home }) });
  if (state.value.kind === "behind" && !held) {
    const outcome = await catchUpOrSay({ catchUp, cwd, state: state.value, url: url.value });
    if (outcome.isErr()) {
      return err(outcome.error);
    }
    if (outcome.value.kind !== "declined") {
      return ok(openStore({ max, url: url.value }));
    }
    notCaughtUp = outcome.value.why;
  }
  const refused = staleStoreRefusal({
    cwd,
    env,
    notCaughtUp,
    state: state.value,
    ...(home === undefined ? {} : { home }),
  });
  return refused === undefined ? ok(openStore({ max, url: url.value })) : err(refused);
}

/** The scope of a query that names no person — the common case, and a value rather than an `undefined`. */
const EMPTY_SCOPE: StoreScope = { people: [] };

/**
 * Resolve every name-shaped filter a query carries, refusing rather than filtering on nothing.
 *
 * Called at the top of each read rather than inside {@link predicateFor}, for two reasons that are the
 * same reason: resolution is a database read and a predicate builder is pure, and a `--person` nobody
 * matches has to REFUSE rather than contribute an empty `IN ()` — an empty page reads exactly like a
 * person who said nothing on any platform.
 *
 * @param client the open store
 * @param query the validated query
 * @returns the resolved scope, or the refusal naming what the store does hold
 *
 * @internal
 */
export async function scopeFor({
  client,
  query,
}: {
  client: StoreClient;
  query: StoreQuery;
}): Promise<Result<StoreScope, StoreError>> {
  const named = query.person;
  if (named === undefined) {
    return ok(EMPTY_SCOPE);
  }
  const people = await resolvePeople({ client, name: named });
  if (people.isErr()) {
    return err(people.error);
  }
  return ok({ people: people.value });
}

/**
 * List the rows a query selects, newest first.
 *
 * @param client the open store
 * @param query the validated query
 * @returns the page of rows, or the typed database failure
 */
export async function listContent({
  client,
  query,
}: {
  client: StoreClient;
  query: StoreQuery;
}): Promise<Result<readonly ContentRow[], StoreError>> {
  const listed = await listContentWithNames({ client, query });
  return listed.map((rows) => rows.map((entry) => entry.row));
}

/**
 * List the rows a query selects, newest first, with the container and author names already resolved.
 *
 * The same statement `list` runs — it is what `list` now delegates to — differing only in what it keeps
 * off the two joins it was already making. A caller that turns rows back into corpus records
 * ({@link ./record.recordFromStoreRow}) needs the container's native id to compute a citation token and
 * the author's name to render a line, and reading them here costs nothing because the joins are already
 * in the plan.
 *
 * @param client the open store
 * @param query the validated query
 * @returns the page of rows with their names, or the typed database failure
 */
export async function listContentWithNames({
  client,
  query,
}: {
  client: StoreClient;
  query: StoreQuery;
}): Promise<Result<readonly ContentWithNames[], StoreError>> {
  const scope = await scopeFor({ client, query });
  if (scope.isErr()) {
    return err(scope.error);
  }
  try {
    const rows = await client.db
      .select({
        author: sql<string | null>`coalesce(${personTable.displayName}, ${contentTable.authorNativeId})`,
        container: containerTable.nativeId,
        content: contentTable,
      })
      .from(contentTable)
      .leftJoin(containerTable, eq(contentTable.containerId, containerTable.id))
      .leftJoin(personTable, eq(contentTable.authorId, personTable.id))
      .where(predicateFor({ query, scope: scope.value }))
      .orderBy(desc(contentTable.occurredAt))
      .limit(query.limit)
      .offset(query.offset);
    return ok(rows.map((row) => ({ author: row.author, container: row.container, row: row.content })));
  } catch (error: unknown) {
    return err(StoreErrors.queryFailed({ cause: error, what: "store list" }));
  }
}

/**
 * Count the rows a query selects, grouped by one facet, largest group first.
 *
 * This is the verb that answers "what is actually in here" without reading any of it, and it is the one
 * the nearly-half-of-records Slack container was found with. A facet read is bounded by the number of DISTINCT
 * values rather than by the corpus, which is why it stays usable as the store grows.
 *
 * @param client the open store
 * @param facet which column to group by
 * @param query the validated query narrowing what is counted
 * @returns the counts, or the typed database failure
 */
export async function facetContent({
  client,
  facet,
  query,
}: {
  client: StoreClient;
  facet: StoreFacet;
  query: StoreQuery;
}): Promise<Result<readonly FacetCount[], StoreError>> {
  const column = facetColumn({ facet });
  const scope = await scopeFor({ client, query });
  if (scope.isErr()) {
    return err(scope.error);
  }
  try {
    const rows = await client.db
      .select({ rows: count(), value: column })
      .from(contentTable)
      .leftJoin(containerTable, eq(contentTable.containerId, containerTable.id))
      .leftJoin(personTable, eq(contentTable.authorId, personTable.id))
      .where(predicateFor({ query, scope: scope.value }))
      .groupBy(column)
      .orderBy(desc(count()))
      .limit(query.limit);
    return ok(rows.map((row) => ({ rows: row.rows, value: row.value })));
  } catch (error: unknown) {
    return err(StoreErrors.queryFailed({ cause: error, what: `store facet ${facet}` }));
  }
}

/**
 * Retrieve one row whole, with its container and author resolved.
 *
 * Addressed by `(source, sourceId)` rather than by the surrogate key, because that pair is what a
 * citation, a bronze line and a provider URL all already carry — a uuid is knowable only by having
 * queried for it first.
 *
 * @param client the open store
 * @param source which platform the row came from
 * @param sourceId that platform's own id for it
 * @returns the row and its resolved names, `null` when nothing carries that pair, or the failure
 */
export async function contentDetail({
  client,
  source,
  sourceId,
}: {
  client: StoreClient;
  source: StoreQuery["source"];
  sourceId: string;
}): Promise<Result<ContentDetail | null, StoreError>> {
  if (source === undefined) {
    return err(StoreErrors.queryFailed({ cause: new Error("no source named"), what: "store detail" }));
  }
  try {
    const rows = await client.db
      .select({
        author: sql<string | null>`coalesce(${personTable.displayName}, ${contentTable.authorNativeId})`,
        container: containerTable.nativeId,
        content: contentTable,
      })
      .from(contentTable)
      .leftJoin(containerTable, eq(contentTable.containerId, containerTable.id))
      .leftJoin(personTable, eq(contentTable.authorId, personTable.id))
      .where(and(eq(contentTable.source, source), eq(contentTable.sourceId, sourceId)))
      .limit(1);
    const first = rows[0];
    if (first === undefined) {
      return ok(null);
    }
    return ok({
      author: first.author,
      container: first.container,
      row: first.content,
      sourceRow: await sourceRowFor({ client, contentId: first.content.id, source }),
    });
  } catch (error: unknown) {
    return err(StoreErrors.queryFailed({ cause: error, what: "store detail" }));
  }
}

/**
 * How many rows the store holds in total, and how many a query selects.
 *
 * @param client the open store
 * @param query the validated query
 * @returns the matching row count, or the typed database failure
 */
export async function countContent({
  client,
  query,
}: {
  client: StoreClient;
  query: StoreQuery;
}): Promise<Result<number, StoreError>> {
  const scope = await scopeFor({ client, query });
  if (scope.isErr()) {
    return err(scope.error);
  }
  try {
    const rows = await client.db
      .select({ rows: count() })
      .from(contentTable)
      .leftJoin(containerTable, eq(contentTable.containerId, containerTable.id))
      .leftJoin(personTable, eq(contentTable.authorId, personTable.id))
      .where(predicateFor({ query, scope: scope.value }));
    return ok(rows[0]?.rows ?? 0);
  } catch (error: unknown) {
    return err(StoreErrors.queryFailed({ cause: error, what: "store count" }));
  }
}

/**
 * Read the per-source columns of one content row, when its source has a table.
 *
 * A second statement rather than a join on the detail query, because it is one primary-key lookup and
 * joining four optional tables onto every detail read would cost every caller for what one of them wants.
 *
 * No visibility filter here, on purpose: the private lane is the side table's own `bot_read` policy
 * (`schema/rls.ts` `botSeesPublicParent`), which correlates on the parent row, so a bot connection
 * reading by `content_id` alone gets nothing for a private parent whether or not this caller remembered.
 *
 * @param client the open store
 * @param contentId the row's surrogate key
 * @param source which platform the row came from
 * @returns the side row as an open record, or `null` when the source has no table or holds no row
 */
async function sourceRowFor({
  client,
  contentId,
  source,
}: {
  client: StoreClient;
  contentId: string;
  source: string;
}): Promise<Record<string, unknown> | null> {
  if (!hasSourceRowTable(source)) {
    return null;
  }
  const table = SOURCE_ROW_TABLES[source];
  const rows = await client.db.select().from(table).where(eq(table.contentId, contentId)).limit(1);
  return rows[0] ?? null;
}
