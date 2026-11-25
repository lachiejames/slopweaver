/**
 * The store's catalog, read once per browsing request and reduced to tables and columns. Pure apart from the SQL
 * text: the effectful read lives in `./read.ts`, inside the same read-only transaction as the data statement that
 * the catalog validates.
 *
 * The catalog is the ONLY source of an identifier this module family quotes into SQL. A name the console sent is
 * looked up here first ({@link tableFromCatalog}, {@link columnFromTable}); what comes back is the catalog's own
 * object, and the SQL planners in `./sql.ts` take only those objects.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { type StoreBrowseError, StoreBrowseErrors } from "./errors.js";
import type { StoreColumnDefinition, StoreDisplayKind, StoreTableDefinition } from "./types.js";

/**
 * Every column of every ordinary or partitioned table in the public schema, in table then column order, with the
 * planner's row estimate and each column's place in its table's primary key. Views, sequences and foreign tables are
 * left out on purpose: the page browses stored rows.
 */
export const CATALOG_SQL = `
select c.relname::text as table_name,
       c.reltuples::float8 as reltuples,
       s.n_live_tup::float8 as live_tuples,
       a.attname::text as column_name,
       a.attnum::int as ordinal,
       pg_catalog.format_type(a.atttypid, a.atttypmod) as formatted_type,
       not a.attnotnull as nullable,
       a.attgenerated <> '' as generated,
       a.attidentity <> '' as identity,
       t.typname::text as type_name,
       t.typcategory::text as type_category,
       (select k.ord::int
          from pg_catalog.pg_index i,
               unnest(i.indkey::int2[]) with ordinality as k(attnum, ord)
         where i.indrelid = c.oid and i.indisprimary and k.attnum = a.attnum) as pk_position
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  join pg_catalog.pg_type t on t.oid = a.atttypid
  left join pg_catalog.pg_stat_user_tables s on s.relid = c.oid
 where n.nspname = 'public' and c.relkind in ('r', 'p')
 order by c.relname, a.attnum`;

/** One table as this module family uses it: its definition, plus the column type names SQL planning needs. */
export interface CatalogTable {
  readonly definition: StoreTableDefinition;
  /** Each column's base type name (`pg_type.typname`), by column name, for casts and the bytea rule. */
  readonly typeNames: ReadonlyMap<string, string>;
}

/** One catalog row, decoded. */
interface CatalogRow {
  readonly tableName: string;
  readonly reltuples: number;
  /** `pg_stat_user_tables.n_live_tup`: the statistics collector's live row count, `null` with no statistics row. */
  readonly liveTuples: number | null;
  readonly columnName: string;
  readonly ordinal: number;
  readonly formattedType: string;
  readonly nullable: boolean;
  readonly generated: boolean;
  readonly identity: boolean;
  readonly typeName: string;
  readonly typeCategory: string;
  readonly pkPosition: number | null;
}

/**
 * The lowercase hex of a name's UTF-8 bytes: the token a name travels as through the console and an argv.
 *
 * @returns the token, empty for an empty name
 */
export function tokenOfName({ name }: { name: string }): string {
  return Buffer.from(name, "utf8").toString("hex");
}

/**
 * The name a token carries, refusing anything that is not lowercase hex of whole bytes of valid UTF-8. Every byte is
 * kept: a leading U+FEFF is part of the name or value, never a byte-order mark to strip, so a token always decodes
 * back to exactly what {@link tokenOfName} encoded.
 *
 * @param token the hex a request carried
 * @returns the decoded name, or why the token is not one
 */
export function nameOfToken({ token }: { token: string }): Result<string, string> {
  if (token.length === 0 || token.length % 2 !== 0 || !/^[0-9a-f]+$/.test(token)) {
    return err("not lowercase hex of whole bytes");
  }
  try {
    return ok(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.from(token, "hex")));
  } catch {
    return err("not valid UTF-8");
  }
}

/**
 * How a column's values are drawn, from its catalog type alone.
 *
 * @param typeName `pg_type.typname`, e.g. `jsonb`
 * @param typeCategory `pg_type.typcategory`, e.g. `N` for numeric types
 * @returns the display kind
 */
export function displayKindOf({
  typeName,
  typeCategory,
}: {
  typeName: string;
  typeCategory: string;
}): StoreDisplayKind {
  if (typeName === "json" || typeName === "jsonb") {
    return "json";
  }
  if (typeName === "bytea") {
    return "binary";
  }
  if (typeCategory === "N") {
    return "number";
  }
  if (typeCategory === "B") {
    return "boolean";
  }
  if (typeCategory === "D" || typeCategory === "T") {
    return "temporal";
  }
  return "text";
}

/** One raw catalog row decoded, or why it is not one. */
function catalogRowOf({ raw, index }: { raw: unknown; index: number }): Result<CatalogRow, StoreBrowseError> {
  const bad = ({ field }: { field: string }): Result<CatalogRow, StoreBrowseError> =>
    err(StoreBrowseErrors.catalogMalformed({ why: `row ${String(index)} has no usable ${field}` }));
  if (typeof raw !== "object" || raw === null) {
    return bad({ field: "shape" });
  }
  const row: Readonly<Record<string, unknown>> = Object.fromEntries(Object.entries(raw));
  const strings = ["table_name", "column_name", "formatted_type", "type_name", "type_category"] as const;
  for (const key of strings) {
    if (typeof row[key] !== "string") {
      return bad({ field: key });
    }
  }
  for (const key of ["nullable", "generated", "identity"] as const) {
    if (typeof row[key] !== "boolean") {
      return bad({ field: key });
    }
  }
  const { reltuples, ordinal, pk_position: pkPosition, live_tuples: liveTuples } = row;
  if (typeof reltuples !== "number" || typeof ordinal !== "number") {
    return bad({ field: "reltuples or ordinal" });
  }
  if (liveTuples !== null && typeof liveTuples !== "number") {
    return bad({ field: "live_tuples" });
  }
  if (pkPosition !== null && typeof pkPosition !== "number") {
    return bad({ field: "pk_position" });
  }
  return ok({
    columnName: String(row["column_name"]),
    formattedType: String(row["formatted_type"]),
    generated: row["generated"] === true,
    identity: row["identity"] === true,
    liveTuples,
    nullable: row["nullable"] === true,
    ordinal,
    pkPosition,
    reltuples,
    tableName: String(row["table_name"]),
    typeCategory: String(row["type_category"]),
    typeName: String(row["type_name"]),
  });
}

/**
 * A table's estimated row count from the two estimates Postgres keeps without scanning: the planner's `reltuples`
 * (negative until the table is first analysed) and the statistics collector's `n_live_tup` (kept on every insert and
 * delete, but zeroed by a statistics reset). The larger of whichever exist, so neither a never-analysed table nor a
 * reset collector reads as empty; `null` when neither exists, never a zero.
 *
 * A store whose tables were never analysed left `reltuples` alone blank for each of them (count them with
 * `slopweaver store tables | grep -c "never analysed"`).
 *
 * @param reltuples `pg_class.reltuples`
 * @param liveTuples `pg_stat_user_tables.n_live_tup`, `null` with no statistics row
 * @returns the estimate, rounded, or `null`
 */
export function estimatedRowsOf({
  reltuples,
  liveTuples,
}: {
  reltuples: number;
  liveTuples: number | null;
}): number | null {
  const known = [reltuples, liveTuples].filter((value): value is number => value !== null && value >= 0);
  if (known.length === 0) {
    return null;
  }
  return Math.round(Math.max(...known));
}

/**
 * Reduce the catalog query's rows to tables, each with its columns in table order and its primary key in key order,
 * and its row estimate from {@link estimatedRowsOf}.
 *
 * @param rows what {@link CATALOG_SQL} returned, still unknown
 * @returns the tables in name order, or the first row that is not a catalog row
 */
export function catalogFromRows({
  rows,
}: {
  rows: readonly unknown[];
}): Result<readonly CatalogTable[], StoreBrowseError> {
  const byTable = new Map<string, { reltuples: number; liveTuples: number | null; rows: CatalogRow[] }>();
  for (const [index, raw] of rows.entries()) {
    const row = catalogRowOf({ index, raw });
    if (row.isErr()) {
      return err(row.error);
    }
    const seen = byTable.get(row.value.tableName);
    if (seen === undefined) {
      byTable.set(row.value.tableName, {
        liveTuples: row.value.liveTuples,
        reltuples: row.value.reltuples,
        rows: [row.value],
      });
    } else {
      seen.rows.push(row.value);
    }
  }
  const tables: CatalogTable[] = [];
  for (const [name, table] of [...byTable].toSorted(([a], [b]) => (a < b ? -1 : 1))) {
    const ordered = table.rows.toSorted((a, b) => a.ordinal - b.ordinal);
    const columns: StoreColumnDefinition[] = ordered.map((row) => ({
      displayKind: displayKindOf({ typeCategory: row.typeCategory, typeName: row.typeName }),
      formattedType: row.formattedType,
      generated: row.generated,
      identity: row.identity,
      name: row.columnName,
      nullable: row.nullable,
      ordinal: row.ordinal,
      primaryKeyPosition: row.pkPosition,
      token: tokenOfName({ name: row.columnName }),
    }));
    const primaryKey = ordered
      .filter((row) => row.pkPosition !== null)
      .toSorted((a, b) => Number(a.pkPosition) - Number(b.pkPosition))
      .map((row) => row.columnName);
    tables.push({
      definition: {
        columns,
        estimatedRows: estimatedRowsOf({ liveTuples: table.liveTuples, reltuples: table.reltuples }),
        name,
        primaryKey,
        token: tokenOfName({ name }),
      },
      typeNames: new Map(ordered.map((row) => [row.columnName, row.typeName])),
    });
  }
  return ok(tables);
}

/**
 * The catalog's own table for a name a request carried.
 *
 * @param table the name, decoded from its token and not yet trusted
 * @returns the catalog's table, or `TABLE_UNKNOWN`
 */
export function tableFromCatalog({
  catalog,
  table,
}: {
  catalog: readonly CatalogTable[];
  table: string;
}): Result<CatalogTable, StoreBrowseError> {
  const found = catalog.find((one) => one.definition.name === table);
  if (found === undefined) {
    return err(StoreBrowseErrors.tableUnknown({ table }));
  }
  return ok(found);
}

/**
 * The catalog's own column for a name a request carried.
 *
 * @param column the name, decoded from its token and not yet trusted
 * @returns the catalog's column, or `COLUMN_UNKNOWN`
 */
export function columnFromTable({
  table,
  column,
}: {
  table: CatalogTable;
  column: string;
}): Result<StoreColumnDefinition, StoreBrowseError> {
  const found = table.definition.columns.find((one) => one.name === column);
  if (found === undefined) {
    return err(StoreBrowseErrors.columnUnknown({ column, table: table.definition.name }));
  }
  return ok(found);
}
