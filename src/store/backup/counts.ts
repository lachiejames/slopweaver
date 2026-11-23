/**
 * Per-table row counts over one database — the comparison a restore proof is judged on.
 *
 * Exact `count(*)`, never `pg_class.reltuples`: the estimate is what the planner uses and it is stale by
 * design right after a restore, which is precisely when this is read. Every table in `public`, `drizzle`
 * and `storage` is counted, so the migration record and the Storage API's own metadata tables are compared
 * beside the store's — and one full-text recall probe runs on both sides, because "the same number of rows"
 * is not "the same answers".
 *
 * The SQL lives in one narrow adapter ({@link TableCountDatabase}) so the ordering, the recall decision and
 * every failure path are decided over plain functions; the production adapter is the only code that holds a
 * connection.
 */
import postgres from "postgres";

import { err, ok, type Result } from "#lib/result.js";

import { type BackupError, BackupErrors } from "./errors.js";
import type { TableCount } from "./restorePlan.js";

/** The schemas a comparison covers. */
const COUNTED_SCHEMAS = ["public", "drizzle", "storage"] as const;

/**
 * The full-text recall probe run on both sides beside the counts — one word every store here holds many
 * hits for, so a restore whose `searchable` column came back empty (a generated column the dump carries as
 * data, but which a schema drift could leave unpopulated) shows as a differing count rather than passing on
 * row totals alone.
 */
const RECALL_PROBE_TERM = "supabase";

/** The four reads a count makes against one database, each answering a `count(*)` as the text Postgres sends. */
export interface TableCountDatabase {
  /** Every base table in the counted schemas, ordered by schema then table. */
  readonly listTables: () => Promise<readonly { readonly schema: string; readonly table: string }[]>;
  /** One table's exact `count(*)`, or `undefined` when the driver handed back no row at all. */
  readonly countRows: (args: { schema: string; table: string }) => Promise<string | undefined>;
  /** How many `public.content` rows the full-text probe for `term` matches, or `undefined` for no row. */
  readonly countRecallRows: (args: { term: string }) => Promise<string | undefined>;
  /** Release the connection. */
  readonly close: () => Promise<void>;
}

/** Opens the adapter over the database a connection string names. */
export type TableCountConnect = (args: { url: string }) => TableCountDatabase;

/** The production adapter: one pooled `postgres` connection, notices silenced, closed with a 5s grace. */
const connectPostgres: TableCountConnect = ({ url }) => {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  return {
    close: () => sql.end({ timeout: 5 }),
    countRecallRows: async ({ term }) => {
      const [hits] = await sql<
        { rows: string }[]
      >`select count(*)::text as rows from public.content where searchable @@ plainto_tsquery('english', ${term})`;
      return hits?.rows;
    },
    countRows: async ({ schema, table }) => {
      const [counted] = await sql<{ rows: string }[]>`select count(*)::text as rows from ${sql(schema)}.${sql(table)}`;
      return counted?.rows;
    },
    listTables: async () => {
      const rows = await sql<{ table_schema: string; table_name: string }[]>`
        select table_schema, table_name from information_schema.tables
        where table_schema in ${sql(COUNTED_SCHEMAS)} and table_type = 'BASE TABLE'
        order by table_schema, table_name`;
      return rows.map((row) => ({ schema: row.table_schema, table: row.table_name }));
    },
  };
};

/**
 * One count as a number. `count(*)` returns exactly one row or the query threw, so an absent row is a driver
 * fault rather than an empty table, and it fails the count instead of being written down as a zero.
 */
function countedRows({ rows, table }: { rows: string | undefined; table: string }): number {
  if (rows === undefined) {
    throw new Error(`count(*) returned no row for ${table}`);
  }
  return Number(rows);
}

/** Every count, the recall probe first when `public.content` exists, then each table in the database's order. */
async function countEvery({ db }: { db: TableCountDatabase }): Promise<readonly TableCount[]> {
  const tables = await db.listTables();
  const counts: TableCount[] = [];
  if (tables.some((row) => row.schema === "public" && row.table === "content")) {
    const table = `recall:content.searchable(${RECALL_PROBE_TERM})`;
    counts.push({ rows: countedRows({ rows: await db.countRecallRows({ term: RECALL_PROBE_TERM }), table }), table });
  }
  for (const row of tables) {
    const table = `${row.schema}.${row.table}`;
    counts.push({ rows: countedRows({ rows: await db.countRows(row), table }), table });
  }
  return counts;
}

/**
 * Count every table's rows in the database a connection string names.
 *
 * The connection is closed on every path, and a close that fails is a failed count rather than a rejection
 * escaping the `Result` — though a count that already failed keeps its own, earlier reason.
 *
 * @param url the connection string
 * @param connect opens the database adapter; a real Postgres connection unless a test supplies plain functions
 * @returns one count per `schema.table`, the recall probe first, or why the database could not be read
 */
export async function tableCounts({
  url,
  connect = connectPostgres,
}: {
  url: string;
  connect?: TableCountConnect;
}): Promise<Result<readonly TableCount[], BackupError>> {
  const db = connect({ url });
  let counted: Result<readonly TableCount[], BackupError>;
  try {
    counted = ok(await countEvery({ db }));
  } catch (error: unknown) {
    counted = err(BackupErrors.tableCountFailed({ cause: error }));
  }
  try {
    await db.close();
  } catch (error: unknown) {
    if (counted.isOk()) {
      return err(BackupErrors.tableCountFailed({ cause: error }));
    }
  }
  return counted;
}
