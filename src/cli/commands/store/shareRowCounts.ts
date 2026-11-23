/**
 * The store half of `slopweaver store share`: one row count per table a home register mirrors into, or per
 * filtered slice of one when several registers share a table — the four measurement roots all project into
 * `measurement_location`, so each is counted by its own `class`.
 */
import postgres from "postgres";

import { storeUrl } from "../../../store/config.js";
import type { HomeRegister } from "../../../store/homeRegisters.js";

/** How long one row count may take before the whole store side is abandoned. */
const STORE_TIMEOUT_SECONDS = 20;

/** One row count to ask for: a table, narrowed to one register's rows when several registers share it. */
export interface RowCountTarget {
  readonly table: string;
  readonly rowFilter: HomeRegister["rowFilter"];
}

/**
 * The key one count is filed under, so two registers sharing a table but not a filter never share a count.
 *
 * @param target the table and its filter
 * @returns `table` alone, or `table|column=value`
 */
export function rowCountKey({ target }: { target: RowCountTarget }): string {
  if (target.rowFilter === undefined) {
    return target.table;
  }
  return `${target.table}|${target.rowFilter.column}=${target.rowFilter.value}`;
}

/** What the store side read: each count it could, and why one it could not is missing. */
export interface StoreRowCounts {
  /** A count per {@link rowCountKey} the store answered. */
  readonly counts: ReadonlyMap<string, number>;
  /** Why the store could not be read at all, or part way; `undefined` when every count it asked for came back. */
  readonly unreadBecause: string | undefined;
  /** The mirrored tables `pg_tables` does not list: not counted, because there is nothing there to count. */
  readonly absentTables: ReadonlySet<string>;
}

/**
 * Ask the database for one row count per table, or per filtered slice of one, that a register mirrors into.
 *
 * The table and column names come from `HOME_REGISTERS`, a declaration in this repository, and only a
 * table `pg_tables` lists is counted; a filter VALUE is a bound parameter.
 *
 * @param targets the mirrored tables, each with the filter its register declares
 * @returns each count it could read, why the rest are missing, and the tables the store does not hold; an unreachable
 *   store is a reason here rather than a failure
 */
export async function storeRowsFor({ targets }: { targets: readonly RowCountTarget[] }): Promise<StoreRowCounts> {
  const counts = new Map<string, number>();
  const absentTables = new Set<string>();
  const url = storeUrl();
  if (url.isErr()) {
    return { absentTables, counts, unreadBecause: url.error.message };
  }
  const sql = postgres(url.value, {
    connect_timeout: STORE_TIMEOUT_SECONDS,
    max: 1,
    onnotice: () => {},
  });
  try {
    const present = new Set(
      (await sql<{ tablename: string }[]>`select tablename from pg_tables where schemaname = 'public'`).map(
        (row) => row.tablename,
      ),
    );
    for (const target of targets.filter((candidate) => !present.has(candidate.table))) {
      absentTables.add(target.table);
    }
    for (const target of targets.filter((candidate) => present.has(candidate.table))) {
      const rows =
        target.rowFilter === undefined
          ? await sql.unsafe<{ n: string }[]>(`select count(*)::text as n from "${target.table}"`)
          : await sql.unsafe<{ n: string }[]>(
              `select count(*)::text as n from "${target.table}" where "${target.rowFilter.column}" = $1`,
              [target.rowFilter.value],
            );
      const first = rows[0];
      if (first !== undefined) {
        counts.set(rowCountKey({ target }), Number(first.n));
      }
    }
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    return { absentTables, counts, unreadBecause: `the store did not answer: ${why}` };
  } finally {
    await sql.end({ timeout: 5 });
  }
  return { absentTables, counts, unreadBecause: undefined };
}
