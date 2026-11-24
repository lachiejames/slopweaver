/**
 * The effectful half of store browsing: open the store the way every verb does, and read inside one READ ONLY
 * transaction under a statement timeout.
 *
 * **The store's own sanctioned path, and nothing wider.** The connection string comes from `storeUrlSelection`
 * (`src/store/config.ts`) — the `secrets/store-url` credential every store verb uses, refusing a remote host — and
 * from nowhere else. No Studio, no new port, no new role, no API key.
 *
 * **Never `connectStore`.** That helper may run the additive migration catch-up on a store that is behind, which is
 * a write; a reader that can never write cannot call it. This opens one bare connection instead.
 *
 * **Read-only is enforced by Postgres, not by intent.** Every statement — the catalog lookup and the data read it
 * validates — runs inside `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`, so a planning bug that produced a write
 * would be refused by the database. `statement_timeout` is set with `SET LOCAL` as the transaction's first statement,
 * so a slow read is cancelled by the server rather than only abandoned by the console's process timeout. It is set
 * there rather than only as a connection option because a store URL's own `?statement_timeout=0` overrides the
 * option (postgres.js merges URL parameters after it); nothing in the URL reaches a statement inside the transaction.
 *
 * **The residue, stated.** READ ONLY forbids writing persistent data, not temporary tables, so a function already
 * in the schema that a SELECT runs (a row-level security policy, a cast) could still create and fill a temporary
 * table. It dies with this connection, which is closed in `finally`. Planting that function is
 * a schema write by someone who could already write the store, so no reader-side guard is attempted.
 */
import postgres from "postgres";

import { loadDenylistResult } from "../../hygiene/scan.js";
import { err, ok, type Result } from "../../lib/result.js";
import { redactCredentials } from "../../talk/fileRedaction.js";
import { storeUrlSelection } from "../config.js";
import { CATALOG_SQL, catalogFromRows, tableFromCatalog } from "./catalog.js";
import { type StoreBrowseError, StoreBrowseErrors } from "./errors.js";
import { decodeStoreRowLocator, encodeStoreRowLocator } from "./locator.js";
import {
  LOCATOR_ALIASES,
  PREVIEW_CHARACTERS,
  ROW_CHARACTERS,
  rowSqlPlan,
  rowsSqlPlan,
  type StoreSqlPlan,
} from "./sql.js";
import type {
  StoreCell,
  StoreRowDocument,
  StoreRowLocator,
  StoreRowPreview,
  StoreRowsDocument,
  StoreRowsRequest,
  StoreTablesDocument,
} from "./types.js";
import { maskedQueryFailure, storeCellOf } from "./values.js";

/** How long one statement may run before Postgres cancels it; below the console's 15-second process bound. */
const STORE_BROWSE_BUDGET_MS = 5000;

/** Postgres's SQLSTATE for a statement cancelled by `statement_timeout`. */
const QUERY_CANCELED = "57014";

/** The transaction mode every browsing read runs in. */
const READ_ONLY_MODE = "isolation level repeatable read read only";

/** One read's transaction handle, as the bodies below use it. */
type ReadTransaction = postgres.TransactionSql;

/** The owner's private denylist, or why no value can be masked against it. An absent list masks shapes only. */
function denylistFor({ home }: { home: string | undefined }): Result<readonly string[], StoreBrowseError> {
  const loaded = loadDenylistResult(home === undefined ? {} : { home });
  if (loaded.kind === "unreadable") {
    return err(StoreBrowseErrors.denylistUnreadable({ path: loaded.path, reason: loaded.reason }));
  }
  if (loaded.kind === "absent") {
    return ok([]);
  }
  return ok(loaded.lines);
}

/**
 * The statement that bounds every later statement in the transaction. `SET` takes no bound parameter, so the budget
 * is spelled in, and only ever as a whole number of milliseconds this module chose.
 *
 * @param budgetMs the timeout; a fraction is dropped, and anything below one millisecond becomes one, never `0`
 * @returns the `SET LOCAL statement_timeout` statement
 */
export function statementTimeoutSql({ budgetMs }: { budgetMs: number }): string {
  const whole = Math.max(1, Math.trunc(budgetMs));
  return `set local statement_timeout = ${String(whole)}`;
}

/** Whether a thrown value is Postgres cancelling a statement at its timeout. */
function isTimeout({ cause }: { cause: unknown }): boolean {
  return typeof cause === "object" && cause !== null && "code" in cause && cause.code === QUERY_CANCELED;
}

/**
 * Run `body` inside one read-only transaction on the selected store, with the denylist loaded, and always close.
 *
 * @returns what `body` returned, or why the store could not be read
 */
async function withReadOnlyStore<T>({
  home,
  budgetMs,
  body,
}: {
  home: string | undefined;
  budgetMs: number;
  body: (read: { tx: ReadTransaction; denylist: readonly string[] }) => Promise<Result<T, StoreBrowseError>>;
}): Promise<Result<T, StoreBrowseError>> {
  const denylist = denylistFor({ home });
  if (denylist.isErr()) {
    return err(denylist.error);
  }
  const selected = storeUrlSelection(home === undefined ? {} : { home });
  if (selected.isErr()) {
    return err(StoreBrowseErrors.unselected({ why: selected.error.message }));
  }
  const seconds = Math.max(1, Math.ceil(budgetMs / 1000));
  let sql: postgres.Sql | undefined;
  try {
    sql = postgres(selected.value.url, {
      connect_timeout: seconds,
      connection: { statement_timeout: budgetMs },
      max: 1,
      onnotice: () => {},
      prepare: false,
    });
    return await sql.begin(READ_ONLY_MODE, async (tx) => {
      await tx.unsafe(statementTimeoutSql({ budgetMs }));
      return body({ denylist: denylist.value, tx });
    });
  } catch (cause: unknown) {
    if (isTimeout({ cause })) {
      return err(StoreBrowseErrors.timedOut({ budgetMs }));
    }
    return err(maskedQueryFailure({ cause, denylist: denylist.value }));
  } finally {
    if (sql !== undefined) {
      await sql.end({ timeout: seconds });
    }
  }
}

/** Read the catalog inside the transaction. */
async function catalogIn({ tx }: { tx: ReadTransaction }): Promise<ReturnType<typeof catalogFromRows>> {
  const rows: readonly unknown[] = await tx.unsafe(CATALOG_SQL);
  return catalogFromRows({ rows });
}

/** Run a plan inside the transaction, its parameters bound. */
async function runPlan({
  tx,
  plan,
}: {
  tx: ReadTransaction;
  plan: StoreSqlPlan;
}): Promise<readonly Readonly<Record<string, unknown>>[]> {
  const rows: readonly Readonly<Record<string, unknown>>[] = await tx.unsafe(plan.text, [...plan.params]);
  return rows;
}

/**
 * Every column's cell for one result row, each through {@link storeCellOf}'s credential mask. The mask is by content,
 * never by column: every catalog column takes the same path, the primary key and a newly added column included.
 *
 * @internal
 * @param plan the plan whose columns name each value's and length's alias in `row`
 * @param showCharacters how many characters of each masked value a cell shows before it is cut
 * @returns the cells by column name, or `QUERY_FAILED` when a value came back that is not text with a length
 */
export function cellsOf({
  row,
  plan,
  denylist,
  showCharacters,
}: {
  row: Readonly<Record<string, unknown>>;
  plan: StoreSqlPlan;
  denylist: readonly string[];
  showCharacters: number;
}): Result<Readonly<Record<string, StoreCell>>, StoreBrowseError> {
  const cells: Record<string, StoreCell> = {};
  for (const column of plan.columns) {
    const cell = storeCellOf({ denylist, length: row[column.length], showCharacters, value: row[column.value] });
    if (cell.isErr()) {
      return err(cell.error);
    }
    cells[column.name] = cell.value;
  }
  return ok(cells);
}

/** The locator one result row is reopened by: its position and writing transaction, never a value it holds. */
function locatorOf({
  row,
  table,
}: {
  row: Readonly<Record<string, unknown>>;
  table: string;
}): Result<string, StoreBrowseError> {
  const tableoid = row[LOCATOR_ALIASES.tableoid];
  const ctid = row[LOCATOR_ALIASES.ctid];
  const xmin = row[LOCATOR_ALIASES.xmin];
  if (typeof tableoid !== "string" || typeof ctid !== "string" || typeof xmin !== "string") {
    return err(StoreBrowseErrors.queryFailed({ cause: new Error("a row came back without its locator") }));
  }
  return ok(encodeStoreRowLocator({ locator: { ctid, kind: "ctid-xmin", table, tableoid, xmin } }));
}

/** The filter a rows document says it applied, a typed value passed through the credential mask before it is echoed. */
function filterEchoOf({
  request,
  denylist,
}: {
  request: StoreRowsRequest;
  denylist: readonly string[];
}): StoreRowsDocument["filter"] {
  if (request.filter === null) {
    return null;
  }
  let value: string | null = null;
  if (request.filter.operator === "eq" || request.filter.operator === "contains") {
    value = redactCredentials({ denylist, source: false, text: request.filter.value }).text;
  }
  return { column: request.filter.column, operator: request.filter.operator, value };
}

/** The sort a rows document says it applied: the column asked for, or `null` for the primary key's own order. */
function sortEchoOf({ request }: { request: StoreRowsRequest }): StoreRowsDocument["sort"] {
  if (request.sort === null) {
    return { column: null, direction: "asc" };
  }
  return { column: request.sort.column, direction: request.sort.direction };
}

/**
 * Every table in the store's public schema, with its columns and estimated row count.
 *
 * @param home the Slopweaver home whose store selection and denylist are read
 * @param budgetMs the statement timeout
 * @returns the tables document, or why it could not be read
 */
export async function readStoreTables({
  home,
  budgetMs = STORE_BROWSE_BUDGET_MS,
}: {
  home?: string;
  budgetMs?: number;
}): Promise<Result<StoreTablesDocument, StoreBrowseError>> {
  return withReadOnlyStore({
    body: async ({ tx }) => {
      const catalog = await catalogIn({ tx });
      if (catalog.isErr()) {
        return err(catalog.error);
      }
      return ok({
        observedAtIso: new Date().toISOString(),
        schema: "public" as const,
        tables: catalog.value.map((table) => table.definition),
      });
    },
    budgetMs,
    home,
  });
}

/**
 * One page of one table's rows, sorted and filtered as asked, each value masked and cut for the grid.
 *
 * @param home the Slopweaver home whose store selection and denylist are read
 * @param request the page asked for; every name in it is confirmed against the live catalog before use
 * @param budgetMs the statement timeout
 * @returns the rows document, or why it could not be read
 */
export async function readStoreRows({
  home,
  request,
  budgetMs = STORE_BROWSE_BUDGET_MS,
}: {
  home?: string;
  request: StoreRowsRequest;
  budgetMs?: number;
}): Promise<Result<StoreRowsDocument, StoreBrowseError>> {
  return withReadOnlyStore({
    body: async ({ tx, denylist }) => {
      const catalog = await catalogIn({ tx });
      if (catalog.isErr()) {
        return err(catalog.error);
      }
      const table = tableFromCatalog({ catalog: catalog.value, table: request.table });
      if (table.isErr()) {
        return err(table.error);
      }
      const plan = rowsSqlPlan({ request, table: table.value });
      if (plan.isErr()) {
        return err(plan.error);
      }
      const fetched = await runPlan({ plan: plan.value, tx });
      const rows: StoreRowPreview[] = [];
      for (const row of fetched.slice(0, request.pageSize)) {
        const locator = locatorOf({ row, table: request.table });
        if (locator.isErr()) {
          return err(locator.error);
        }
        const cells = cellsOf({ denylist, plan: plan.value, row, showCharacters: PREVIEW_CHARACTERS });
        if (cells.isErr()) {
          return err(cells.error);
        }
        rows.push({ cells: cells.value, locator: locator.value });
      }
      return ok({
        columns: table.value.definition.columns,
        filter: filterEchoOf({ denylist, request }),
        hasNext: fetched.length > request.pageSize,
        hasPrevious: request.page > 1,
        locatorStability: "ctid-xmin",
        observedAtIso: new Date().toISOString(),
        page: request.page,
        pageSize: request.pageSize,
        rows,
        sort: sortEchoOf({ request }),
        table: request.table,
      });
    },
    budgetMs,
    home,
  });
}

/**
 * One whole row, found again by the locator a page issued, every column masked and cut only past a large bound.
 *
 * @param home the Slopweaver home whose store selection and denylist are read
 * @param locatorHex the locator token, decoded and confirmed against the live catalog here
 * @param budgetMs the statement timeout
 * @returns the row document, or why it could not be read
 */
export async function readStoreRow({
  home,
  locatorHex,
  budgetMs = STORE_BROWSE_BUDGET_MS,
}: {
  home?: string;
  locatorHex: string;
  budgetMs?: number;
}): Promise<Result<StoreRowDocument, StoreBrowseError>> {
  const decoded = decodeStoreRowLocator({ encoded: locatorHex });
  if (decoded.isErr()) {
    return err(decoded.error);
  }
  const locator: StoreRowLocator = decoded.value;
  return withReadOnlyStore({
    body: async ({ tx, denylist }) => {
      const catalog = await catalogIn({ tx });
      if (catalog.isErr()) {
        return err(catalog.error);
      }
      const table = tableFromCatalog({ catalog: catalog.value, table: locator.table });
      if (table.isErr()) {
        return err(table.error);
      }
      const plan = rowSqlPlan({ locator, table: table.value });
      const fetched = await runPlan({ plan, tx });
      const [row] = fetched;
      if (row === undefined) {
        return err(StoreBrowseErrors.rowGone({ table: locator.table }));
      }
      if (fetched.length > 1) {
        return err(StoreBrowseErrors.locatorInvalid({ why: "it matches more than one row" }));
      }
      const cells = cellsOf({ denylist, plan, row, showCharacters: ROW_CHARACTERS });
      if (cells.isErr()) {
        return err(cells.error);
      }
      return ok({
        cells: cells.value,
        columns: table.value.definition.columns,
        locator: locatorHex,
        locatorStability: locator.kind,
        observedAtIso: new Date().toISOString(),
        table: locator.table,
      });
    },
    budgetMs,
    home,
  });
}
