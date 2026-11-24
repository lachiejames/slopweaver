/**
 * The SQL the browsing verbs run, planned as a value so every statement can be read and tested without a database.
 *
 * Two rules make this safe, and both are structural rather than a matter of care at each call site:
 *
 * - **An identifier reaches SQL only from a catalog object.** The planners take a {@link CatalogTable} and the
 *   catalog's own column definitions, which `./catalog.ts` looked up by name inside the same read-only
 *   transaction. A request string is never passed to {@link quoteIdentifier}.
 * - **A value reaches SQL only as a bound parameter.** A filter value, the page's limit and offset, and a locator's
 *   position travel in `params`; the statement text holds `$1`, `$2`, … and never a value. The one request field
 *   spelled into the text, the sort direction, is mapped to a keyword this file owns rather than copied.
 *
 * Every value is rendered as text by Postgres itself (`bytea` as base64), so no driver-native `bigint`, `Date` or
 * buffer ever reaches JSON serialisation, and a long value is cut by Postgres before it crosses the wire.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { type CatalogTable, columnFromTable } from "./catalog.js";
import { type StoreBrowseError, StoreBrowseErrors } from "./errors.js";
import type { StoreColumnDefinition, StoreRowLocator, StoreRowsRequest, StoreSortDirection } from "./types.js";

/** How many characters of each value a page fetches, so a credential straddling the preview cut is still masked whole. */
const PREVIEW_WINDOW_CHARACTERS = 4096;

/** How many characters of each value a page shows. */
export const PREVIEW_CHARACTERS = 512;

/** How many characters of each value the row panel fetches and shows; past it the cell says it was cut. */
export const ROW_CHARACTERS = 1_048_576;

/** The largest page a request may ask for. */
export const MAX_PAGE_SIZE = 100;

/** A planned statement: its text, its bound parameters, and where each column's value and length come back. */
export interface StoreSqlPlan {
  readonly text: string;
  readonly params: readonly string[];
  /** For each column in table order: its name, and the result aliases its value text and full length come back as. */
  readonly columns: readonly { readonly name: string; readonly value: string; readonly length: string }[];
}

/**
 * The result aliases every row's locator is read from. Position and writing transaction only, never a column's
 * value: a primary key holds data, and a locator carrying it would print that data past the credential mask.
 */
export const LOCATOR_ALIASES = { ctid: "k_ctid", tableoid: "k_tableoid", xmin: "k_xmin" } as const;

/** The select list a page's locators are read from. */
const LOCATOR_SELECT: readonly string[] = [
  `tableoid::text as ${LOCATOR_ALIASES.tableoid}`,
  `ctid::text as ${LOCATOR_ALIASES.ctid}`,
  `xmin::text as ${LOCATOR_ALIASES.xmin}`,
];

/**
 * Quote an identifier the catalog issued, doubling any double quote inside it.
 *
 * @param name a table or column name taken from a catalog object, never from a request
 * @returns the quoted identifier
 */
export function quoteIdentifier({ name }: { name: string }): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/** A column's value as text: base64 for `bytea`, Postgres's own text rendering for everything else. */
function textExpression({ column }: { column: StoreColumnDefinition }): string {
  const quoted = quoteIdentifier({ name: column.name });
  if (column.displayKind === "binary") {
    return `encode(${quoted}, 'base64')`;
  }
  return `${quoted}::text`;
}

/** The select list shared by both planners: each column's text cut at `characters`, and its full length. */
function valueSelect({ table, characters }: { table: CatalogTable; characters: number }): {
  readonly list: readonly string[];
  readonly columns: StoreSqlPlan["columns"];
} {
  const list: string[] = [];
  const columns: { name: string; value: string; length: string }[] = [];
  for (const [index, column] of table.definition.columns.entries()) {
    const expression = textExpression({ column });
    const value = `v${String(index)}`;
    const length = `n${String(index)}`;
    list.push(`left(${expression}, ${String(characters)}) as ${value}`, `length(${expression}) as ${length}`);
    columns.push({ length, name: column.name, value });
  }
  return { columns, list };
}

/** The SQL keyword for a sort direction, chosen here so no request text is ever spelled into a statement. */
function directionKeyword({ direction }: { direction: StoreSortDirection }): "asc" | "desc" {
  if (direction === "desc") {
    return "desc";
  }
  return "asc";
}

/** Escape `%`, `_` and the escape character itself, so a `contains` value matches its own characters literally. */
function likeLiteral({ value }: { value: string }): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/** The WHERE clause and its parameters for a request's filter, its column confirmed against the catalog first. */
function filterClause({
  table,
  filter,
}: {
  table: CatalogTable;
  filter: NonNullable<StoreRowsRequest["filter"]>;
}): Result<{ readonly clause: string; readonly params: readonly string[] }, StoreBrowseError> {
  const column = columnFromTable({ column: filter.column, table });
  if (column.isErr()) {
    return err(column.error);
  }
  const quoted = quoteIdentifier({ name: column.value.name });
  // Narrowed on the field, not the operator: a member whose operator is one of two literals never narrows away.
  if (!("value" in filter)) {
    if (filter.operator === "is-null") {
      return ok({ clause: `${quoted} is null`, params: [] });
    }
    return ok({ clause: `${quoted} is not null`, params: [] });
  }
  if (column.value.displayKind === "binary") {
    return err(
      StoreBrowseErrors.filterUnsupported({
        column: column.value.name,
        why: "binary values can only be filtered as empty or not empty",
      }),
    );
  }
  const expression = textExpression({ column: column.value });
  if (filter.operator === "eq") {
    return ok({ clause: `${expression} = $1`, params: [filter.value] });
  }
  return ok({ clause: `${expression} ilike $1`, params: [`%${likeLiteral({ value: filter.value })}%`] });
}

/**
 * Plan one page of a table: the requested sort first, then the whole primary key (or `tableoid` and `ctid` for a
 * keyless table) so equal sort values keep one order, and one row more than the page so the page knows whether another
 * follows.
 *
 * @param table the catalog's own table, already looked up from the request's name
 * @param request the page asked for; its sort and filter columns are confirmed against `table` here
 * @returns the plan, or the column that is not the table's or the filter its type cannot take
 */
export function rowsSqlPlan({
  table,
  request,
}: {
  table: CatalogTable;
  request: StoreRowsRequest;
}): Result<StoreSqlPlan, StoreBrowseError> {
  const values = valueSelect({ characters: PREVIEW_WINDOW_CHARACTERS, table });
  const order: string[] = [];
  let sorted: string | null = null;
  if (request.sort !== null) {
    const column = columnFromTable({ column: request.sort.column, table });
    if (column.isErr()) {
      return err(column.error);
    }
    sorted = column.value.name;
    order.push(`${quoteIdentifier({ name: sorted })} ${directionKeyword({ direction: request.sort.direction })}`);
  }
  const { primaryKey } = table.definition;
  if (primaryKey.length === 0) {
    order.push("tableoid asc", "ctid asc");
  } else {
    for (const column of primaryKey.filter((name) => name !== sorted)) {
      order.push(`${quoteIdentifier({ name: column })} asc`);
    }
  }
  let where = "";
  let params: readonly string[] = [];
  if (request.filter !== null) {
    const filtered = filterClause({ filter: request.filter, table });
    if (filtered.isErr()) {
      return err(filtered.error);
    }
    where = ` where ${filtered.value.clause}`;
    params = filtered.value.params;
  }
  const limit = `$${String(params.length + 1)}::int8`;
  const offset = `$${String(params.length + 2)}::int8`;
  const text =
    `select ${[...LOCATOR_SELECT, ...values.list].join(", ")} from public.${quoteIdentifier({ name: table.definition.name })}` +
    `${where} order by ${order.join(", ")} limit ${limit} offset ${offset}`;
  return ok({
    columns: values.columns,
    params: [...params, String(request.pageSize + 1), String((request.page - 1) * request.pageSize)],
    text,
  });
}

/**
 * Plan the read of one whole row by its locator: `tableoid`, `ctid` and `xmin` together, so a partition's slot, or a
 * slot reused by another row, never opens the wrong one, and a row updated since its page was read is gone rather than
 * shown in its new form. Two rows are asked for, so a locator matching more than one is caught rather than shown.
 *
 * @param table the catalog's own table, already looked up from the locator's name
 * @param locator the decoded locator, its position already checked to be one Postgres prints
 * @returns the plan
 */
export function rowSqlPlan({ table, locator }: { table: CatalogTable; locator: StoreRowLocator }): StoreSqlPlan {
  const values = valueSelect({ characters: ROW_CHARACTERS, table });
  const from = `from public.${quoteIdentifier({ name: table.definition.name })}`;
  return {
    columns: values.columns,
    params: [locator.tableoid, locator.ctid, locator.xmin],
    text: `select ${values.list.join(", ")} ${from} where tableoid = $1::oid and ctid = $2::tid and xmin::text = $3 limit 2`,
  };
}
