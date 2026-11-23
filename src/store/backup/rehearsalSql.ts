/**
 * The PURE half of a restore rehearsal's reads: the table shapes both sides are folded into, and the exact
 * statement text `./rehearsalVerify.ts` runs against them. Every identifier is quoted here, once, so a table
 * or column named with a quote or a capital cannot reach a statement unquoted.
 */
import { insertionColumn, recordsChangeTime } from "./rehearsalCheck.js";

/** One table on one side: its name and its columns, with each column's type. */
export interface TableShape {
  readonly schema: string;
  readonly table: string;
  readonly columns: readonly { readonly name: string; readonly type: string }[];
  /** The primary key's columns in key order — empty for a table with none. */
  readonly primaryKey: readonly string[];
}

/**
 * Quote one identifier for a dynamically built statement.
 *
 * @param name the identifier
 * @returns it, double-quoted with every embedded quote doubled
 */
function ident({ name }: { name: string }): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/**
 * A table's schema-qualified name, quoted.
 *
 * @param shape the table
 * @returns `"schema"."table"`
 */
function qualified({ shape }: { shape: TableShape }): string {
  return `${ident({ name: shape.schema })}.${ident({ name: shape.table })}`;
}

/**
 * Fold one row per column — in `attnum` order, as the catalog query returns them — into one shape per table.
 *
 * @param rows each column with its table, type, and position in the primary key (`null` when outside it)
 * @returns the tables, sorted by qualified name, each primary key in key order
 */
export function tableShapesOf({
  rows,
}: {
  rows: readonly { schema: string; table: string; column: string; type: string; pk: number | null }[];
}): readonly TableShape[] {
  const byTable = new Map<
    string,
    { schema: string; table: string; columns: { name: string; type: string }[]; pk: { name: string; at: number }[] }
  >();
  for (const row of rows) {
    const key = `${row.schema}.${row.table}`;
    let entry = byTable.get(key);
    if (entry === undefined) {
      entry = { columns: [], pk: [], schema: row.schema, table: row.table };
      byTable.set(key, entry);
    }
    entry.columns.push({ name: row.column, type: row.type });
    if (row.pk !== null) {
      entry.pk.push({ at: row.pk, name: row.column });
    }
  }
  return [...byTable.values()]
    .map((entry) => ({
      columns: entry.columns,
      primaryKey: entry.pk.toSorted((left, right) => left.at - right.at).map((column) => column.name),
      schema: entry.schema,
      table: entry.table,
    }))
    .toSorted((left, right) => `${left.schema}.${left.table}`.localeCompare(`${right.schema}.${right.table}`));
}

/**
 * The statement counting one table's rows.
 *
 * @param shape the table
 * @returns a `select` answering one `rows` column, as text
 */
export function countStatement({ shape }: { shape: TableShape }): string {
  return `select count(*)::text as rows from ${qualified({ shape })}`;
}

/**
 * The two statements a count frontier needs: the copy's newest value of the insertion column, and live's count
 * at or before it — NULLs counted on both sides alike, because the copy's count includes them too.
 *
 * @param shape the table
 * @param column its insertion-time column
 * @returns the copy's `max` statement, and live's `$1`-bound count statement
 */
export function frontierStatements({ shape, column }: { shape: TableShape; column: string }): {
  copyMax: string;
  liveUpTo: string;
} {
  const quoted = ident({ name: column });
  return {
    copyMax: `select max(${quoted})::text as max from ${qualified({ shape })}`,
    liveUpTo: `select count(*)::text as rows from ${qualified({ shape })} where ${quoted} <= $1 or ${quoted} is null`,
  };
}

/**
 * The two statements that sample one table: pick the copy's newest `size` rows, then look each up on live by
 * its primary key.
 *
 * "Newest" is by the table's insertion column when it has one, else by primary key, with the key as the
 * tie-breaker either way, so the pick is deterministic. The lookup also answers whether any of the live row's
 * timestamp columns is later than the dump's start, bound as the parameter after the key.
 *
 * @param shape the table, with a primary key
 * @param size how many rows
 * @returns the pick, the lookup, whether the lookup takes the dump instant, and whether the table records a
 *   change time at all
 */
export function sampleStatements({ shape, size }: { shape: TableShape; size: number }): {
  pick: string;
  lookup: string;
  takesDumpInstant: boolean;
  tableRecordsChanges: boolean;
} {
  const order = insertionColumn({ columns: shape.columns.map((column) => column.name) });
  const keyColumns = shape.primaryKey.map((name) => `t.${ident({ name })}`);
  const orderBy = [
    ...(order === null ? [] : [`t.${ident({ name: order })} desc nulls last`]),
    ...keyColumns.map((column) => `${column} desc`),
  ].join(", ");
  const keyText = `array[${keyColumns.map((column) => `${column}::text`).join(", ")}]`;
  const typeOf = new Map(shape.columns.map((column) => [column.name, column.type]));
  const match = shape.primaryKey
    .map((name, index) => `t.${ident({ name })} = $${String(index + 1)}::${typeOf.get(name)!}`)
    .join(" and ");
  const stamps = shape.columns.filter((column) => column.type.startsWith("timestamp"));
  const latest = stamps.map((column) => `t.${ident({ name: column.name })}::timestamptz`).join(", ");
  const touched =
    stamps.length === 0
      ? "false"
      : `coalesce(greatest(${latest}) > $${String(shape.primaryKey.length + 1)}::timestamptz, false)`;
  return {
    lookup: `select t::text as body, ${touched} as touched from ${qualified({ shape })} t where ${match}`,
    pick: `select ${keyText} as key, t::text as body from ${qualified({ shape })} t order by ${orderBy} limit ${String(size)}`,
    tableRecordsChanges: recordsChangeTime({ columns: stamps.map((column) => column.name) }),
    takesDumpInstant: stamps.length > 0,
  };
}
