/**
 * The three documents the Store page reads — what `store tables`, `store rows` and `store row` print with `--json` —
 * decoded strictly from `unknown`, and the Store route's own answer around them. The fields, columns, tables and cells
 * they are built from decode in `./storeDocumentParts.ts`.
 *
 * The shapes restate `src/store/browse/types.ts`, the CLI's side of the wire, because `site/` builds apart from `src/`
 * and imports none of it at runtime; `site/__tests__/unit/storeDocuments.test.ts` holds the two to one shape, so a
 * field changed on one side and missed on the other fails there.
 *
 * **Strict means no stand-in, ever.** A field that is absent or of the wrong type fails the WHOLE document with a
 * sentence naming the field, and the page draws that sentence rather than a table: a row count read as zero, a cell
 * read as empty, or a page with its failing rows dropped would each be a confident lie about the store. An unknown
 * extra field is tolerated, so the verb can grow a field before the page draws it. A row's cells must be exactly its
 * columns: one missing would draw blank, one extra would never be drawn.
 */
import { err, ok, type Result } from "neverthrow";

import { type Bag, isBag } from "./bag";
import {
  decodeCells,
  decodeColumn,
  decodeTable,
  flag,
  list,
  locator,
  object,
  observedAt,
  oneOf,
  STABILITIES,
  text,
  whole,
  wrong,
} from "./storeDocumentParts";
import type { StoreReadResponse } from "./storeReadVerbs";

/** How a column's values are drawn: picked from the catalog type, never guessed from a value. */
export type StoreDisplayKind = "binary" | "boolean" | "json" | "number" | "temporal" | "text";

/** One column of one table, as the catalog describes it. */
export interface StoreColumnDefinition {
  readonly name: string;
  readonly token: string;
  readonly ordinal: number;
  readonly formattedType: string;
  readonly nullable: boolean;
  readonly generated: boolean;
  readonly identity: boolean;
  readonly primaryKeyPosition: number | null;
  readonly displayKind: StoreDisplayKind;
}

/** One table in the public schema, with its columns and the planner's row estimate. */
export interface StoreTableDefinition {
  readonly name: string;
  readonly token: string;
  /** `null` when the table has never been analysed — never a zero. */
  readonly estimatedRows: number | null;
  readonly columns: readonly StoreColumnDefinition[];
  readonly primaryKey: readonly string[];
}

/** What `store tables --json` prints. */
export interface StoreTablesDocument {
  readonly observedAtIso: string;
  readonly schema: "public";
  readonly tables: readonly StoreTableDefinition[];
  /** How many tables the verb left out because their definition would print a masked name; never which. */
  readonly withheldTables: number;
}

/** One cell: SQL NULL, a value withheld by the credential mask, or the value as text. */
export type StoreCell =
  | { readonly kind: "null" }
  | { readonly kind: "withheld"; readonly why: string }
  | { readonly kind: "value"; readonly text: string; readonly truncated: boolean; readonly characters: number };

/** How a row is found again: by its physical position and writing transaction, never by a value it holds. */
export type StoreRowLocatorStability = "ctid-xmin";

/** One row of a page: its cells by column name, and the opaque locator `store row` reopens it by. */
export interface StoreRowPreview {
  readonly locator: string;
  readonly cells: Readonly<Record<string, StoreCell>>;
}

/** The filter operators `store rows` may report it applied; the page itself asks only for the two without a value. */
type StoreFilterOperator = "eq" | "contains" | "is-null" | "not-null";

/** The direction a page is sorted in. */
export type StoreSortDirection = "asc" | "desc";

/** What `store rows --json` prints. */
export interface StoreRowsDocument {
  readonly observedAtIso: string;
  readonly table: string;
  readonly page: number;
  readonly pageSize: number;
  readonly hasPrevious: boolean;
  readonly hasNext: boolean;
  readonly sort: { readonly column: string | null; readonly direction: StoreSortDirection };
  readonly filter: null | {
    readonly column: string;
    readonly operator: StoreFilterOperator;
    readonly value: string | null;
  };
  readonly locatorStability: StoreRowLocatorStability;
  readonly columns: readonly StoreColumnDefinition[];
  readonly rows: readonly StoreRowPreview[];
}

/** What `store row --json` prints: every column of one row. */
export interface StoreRowDocument {
  readonly observedAtIso: string;
  readonly table: string;
  readonly locator: string;
  readonly locatorStability: StoreRowLocatorStability;
  readonly columns: readonly StoreColumnDefinition[];
  readonly cells: Readonly<Record<string, StoreCell>>;
}

/** Every filter operator. */
const OPERATORS: readonly StoreFilterOperator[] = ["eq", "contains", "is-null", "not-null"];

/** Every sort direction. */
const DIRECTIONS: readonly StoreSortDirection[] = ["asc", "desc"];

/**
 * Decode what `store tables --json` printed.
 *
 * @param value the parsed document
 * @returns the document, or the sentence naming its first wrong field
 */
export function decodeStoreTables({ value }: { value: unknown }): Result<StoreTablesDocument, string> {
  const at = "the tables document";
  return object({ at, value }).andThen((bag) => {
    if (bag["schema"] !== "public") {
      return err(wrong({ at: `${at}.schema`, what: "public" }));
    }
    return observedAt({ at, bag }).andThen((observedAtIso) =>
      list({ at, bag, key: "tables", read: decodeTable }).andThen((tables) =>
        whole({ at, bag, key: "withheldTables", min: 0 }).map((withheldTables): StoreTablesDocument => ({
          observedAtIso,
          schema: "public",
          tables,
          withheldTables,
        })),
      ),
    );
  });
}

/**
 * The sort a rows document says it applied.
 *
 * @returns the sort, or the refusal naming its first wrong field
 */
function decodeSort({ bag, at }: { bag: Bag; at: string }): Result<StoreRowsDocument["sort"], string> {
  const sort = bag["sort"];
  if (!isBag(sort)) {
    return err(wrong({ at: `${at}.sort`, what: "an object" }));
  }
  const column = sort["column"];
  if (column !== null && typeof column !== "string") {
    return err(wrong({ at: `${at}.sort.column`, what: "null or a column name" }));
  }
  return oneOf({ at: `${at}.sort`, bag: sort, key: "direction", words: DIRECTIONS }).map((direction) => ({
    column,
    direction,
  }));
}

/**
 * The filter a rows document says it applied: none, or a column, an operator and, for `eq` and `contains`, a value.
 *
 * @returns the filter, or the refusal naming its first wrong field
 */
function decodeFilter({ bag, at }: { bag: Bag; at: string }): Result<StoreRowsDocument["filter"], string> {
  const filter = bag["filter"];
  if (filter === null) {
    return ok(null);
  }
  if (!isBag(filter)) {
    return err(wrong({ at: `${at}.filter`, what: "null or an object" }));
  }
  const where = `${at}.filter`;
  return text({ at: where, bag: filter, key: "column" }).andThen((column) =>
    oneOf({ at: where, bag: filter, key: "operator", words: OPERATORS }).andThen(
      (operator): Result<StoreRowsDocument["filter"], string> => {
        const filterValue = filter["value"];
        const takesValue = operator === "eq" || operator === "contains";
        if (takesValue && typeof filterValue !== "string") {
          return err(wrong({ at: `${where}.value`, what: `a string, as ${operator} carries one` }));
        }
        if (!takesValue && filterValue !== null) {
          return err(wrong({ at: `${where}.value`, what: `null, as ${operator} carries none` }));
        }
        let shown: string | null = null;
        if (typeof filterValue === "string") {
          shown = filterValue;
        }
        return ok({ column, operator, value: shown });
      },
    ),
  );
}

/**
 * One row of a rows document.
 *
 * @returns the row, or the refusal naming its first wrong field
 */
function decodeRowPreview({
  value,
  at,
  columns,
}: {
  value: unknown;
  at: string;
  columns: readonly StoreColumnDefinition[];
}): Result<StoreRowPreview, string> {
  return object({ at, value }).andThen((bag) =>
    locator({ at, bag, key: "locator" }).andThen((rowLocator) =>
      decodeCells({ at, bag, columns }).map((cells): StoreRowPreview => ({ cells, locator: rowLocator })),
    ),
  );
}

/**
 * Decode what `store rows --json` printed.
 *
 * @param value the parsed document
 * @returns the document, or the sentence naming its first wrong field
 */
export function decodeStoreRows({ value }: { value: unknown }): Result<StoreRowsDocument, string> {
  const at = "the rows document";
  return object({ at, value }).andThen((bag) =>
    observedAt({ at, bag }).andThen((observedAtIso) =>
      text({ at, bag, key: "table" }).andThen((table) =>
        whole({ at, bag, key: "page", min: 1 }).andThen((page) =>
          whole({ at, bag, key: "pageSize", min: 1 }).andThen((pageSize) =>
            flag({ at, bag, key: "hasPrevious" }).andThen((hasPrevious) =>
              flag({ at, bag, key: "hasNext" }).andThen((hasNext) =>
                decodeSort({ at, bag }).andThen((sort) =>
                  decodeFilter({ at, bag }).andThen((filter) =>
                    oneOf({ at, bag, key: "locatorStability", words: STABILITIES }).andThen((locatorStability) =>
                      list({ at, bag, key: "columns", read: decodeColumn }).andThen((columns) =>
                        list({
                          at,
                          bag,
                          key: "rows",
                          read: ({ value: row, at: rowAt }) => decodeRowPreview({ at: rowAt, columns, value: row }),
                        }).map((rows): StoreRowsDocument => ({
                          columns,
                          filter,
                          hasNext,
                          hasPrevious,
                          locatorStability,
                          observedAtIso,
                          page,
                          pageSize,
                          rows,
                          sort,
                          table,
                        })),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

/**
 * Decode what `store row --json` printed.
 *
 * @param value the parsed document
 * @returns the document, or the sentence naming its first wrong field
 */
export function decodeStoreRow({ value }: { value: unknown }): Result<StoreRowDocument, string> {
  const at = "the row document";
  return object({ at, value }).andThen((bag) =>
    observedAt({ at, bag }).andThen((observedAtIso) =>
      text({ at, bag, key: "table" }).andThen((table) =>
        locator({ at, bag, key: "locator" }).andThen((rowLocator) =>
          oneOf({ at, bag, key: "locatorStability", words: STABILITIES }).andThen((locatorStability) =>
            list({ at, bag, key: "columns", read: decodeColumn }).andThen((columns) =>
              decodeCells({ at, bag, columns }).map((cells): StoreRowDocument => ({
                cells,
                columns,
                locator: rowLocator,
                locatorStability,
                observedAtIso,
                table,
              })),
            ),
          ),
        ),
      ),
    ),
  );
}

/**
 * Decode the Store route's answer as the page fetched it: a document still to be decoded, or the reason there is
 * none. A body of any other shape — a 404's `{ error }`, an HTML error page parsed by mistake — is a refusal naming
 * that, never an empty table.
 *
 * @param body what the route answered, parsed
 * @param status the response's HTTP status, named when the body is not the route's answer
 * @returns the answer
 */
export function decodeStoreReadResponse({ body, status }: { body: unknown; status: number }): StoreReadResponse {
  if (isBag(body)) {
    const tookMs = body["tookMs"];
    if (body["outcome"] === "read" && "document" in body && typeof tookMs === "number") {
      return { document: body["document"], outcome: "read", tookMs };
    }
    const why = body["why"];
    const code = body["code"];
    if (body["outcome"] === "refused" && typeof why === "string" && (code === null || typeof code === "string")) {
      return { code, outcome: "refused", why };
    }
    const error = body["error"];
    if (typeof error === "string") {
      return { code: null, outcome: "refused", why: error };
    }
  }
  return { code: null, outcome: "refused", why: `the store route answered ${String(status)} with no reading in it` };
}
