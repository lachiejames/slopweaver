/**
 * Why a read-only store browsing read did not answer — one union for `store tables`, `store rows` and `store row`.
 *
 * Each variant carries a `code` the console branches on and a `message` it prints. None carries a row value: a
 * message is shown on the page and may land in a log, so it names a table, a column or a limit and nothing more.
 */

/** No store is selected, or the selection was refused (`src/store/config.ts`). */
export interface StoreBrowseUnselectedError {
  readonly code: "STORE_UNSELECTED";
  readonly message: string;
}

/** The store could not be reached, or a statement failed for a reason other than its timeout. */
export interface StoreBrowseQueryFailedError {
  readonly code: "QUERY_FAILED";
  readonly message: string;
}

/** A statement ran past the store's statement timeout. */
export interface StoreBrowseTimedOutError {
  readonly code: "QUERY_TIMED_OUT";
  readonly message: string;
}

/** The catalog came back in a shape this reader does not know. */
export interface StoreBrowseCatalogMalformedError {
  readonly code: "CATALOG_MALFORMED";
  readonly message: string;
}

/** A table the request named is not an ordinary or partitioned table in the public schema. */
export interface StoreBrowseTableUnknownError {
  readonly code: "TABLE_UNKNOWN";
  readonly message: string;
  readonly table: string;
}

/** A column the request named is not a column of the table. */
export interface StoreBrowseColumnUnknownError {
  readonly code: "COLUMN_UNKNOWN";
  readonly message: string;
  readonly column: string;
}

/** A filter the column's type cannot take. */
export interface StoreBrowseFilterUnsupportedError {
  readonly code: "FILTER_UNSUPPORTED";
  readonly message: string;
}

/** A row locator that does not decode, or names a key the table does not have. */
export interface StoreBrowseLocatorInvalidError {
  readonly code: "LOCATOR_INVALID";
  readonly message: string;
}

/** No row matches the locator any more: deleted, or for a keyless table, moved or rewritten. */
export interface StoreBrowseRowGoneError {
  readonly code: "ROW_GONE";
  readonly message: string;
}

/** The owner's private denylist exists and could not be read, so no value can be masked against it. */
export interface StoreBrowseDenylistUnreadableError {
  readonly code: "DENYLIST_UNREADABLE";
  readonly message: string;
}

/** Every way a store browsing read can fail. */
export type StoreBrowseError =
  | StoreBrowseUnselectedError
  | StoreBrowseQueryFailedError
  | StoreBrowseTimedOutError
  | StoreBrowseCatalogMalformedError
  | StoreBrowseTableUnknownError
  | StoreBrowseColumnUnknownError
  | StoreBrowseFilterUnsupportedError
  | StoreBrowseLocatorInvalidError
  | StoreBrowseRowGoneError
  | StoreBrowseDenylistUnreadableError;

/** The one place each {@link StoreBrowseError} is built, so every message reads the same way. */
export const StoreBrowseErrors = {
  catalogMalformed: ({ why }: { why: string }): StoreBrowseCatalogMalformedError => ({
    code: "CATALOG_MALFORMED",
    message: `the store's catalog came back in a shape this reader does not know: ${why}`,
  }),
  columnUnknown: ({ table, column }: { table: string; column: string }): StoreBrowseColumnUnknownError => ({
    code: "COLUMN_UNKNOWN",
    column,
    message: `${table} has no column named ${column}`,
  }),
  denylistUnreadable: ({ path, reason }: { path: string; reason: string }): StoreBrowseDenylistUnreadableError => ({
    code: "DENYLIST_UNREADABLE",
    message: `the private denylist at ${path} could not be read (${reason}), so no value could be masked against it`,
  }),
  filterUnsupported: ({ column, why }: { column: string; why: string }): StoreBrowseFilterUnsupportedError => ({
    code: "FILTER_UNSUPPORTED",
    message: `${column} cannot be filtered that way: ${why}`,
  }),
  locatorInvalid: ({ why }: { why: string }): StoreBrowseLocatorInvalidError => ({
    code: "LOCATOR_INVALID",
    message: `that row locator is not one this reader issued: ${why}`,
  }),
  queryFailed: ({ cause }: { cause: unknown }): StoreBrowseQueryFailedError => ({
    code: "QUERY_FAILED",
    message: `the store read failed: ${cause instanceof Error ? cause.message : String(cause)}`,
  }),
  rowGone: ({ table }: { table: string }): StoreBrowseRowGoneError => ({
    code: "ROW_GONE",
    message: `that row of ${table} is no longer there; it was deleted or, in a table with no primary key, rewritten`,
  }),
  tableUnknown: ({ table }: { table: string }): StoreBrowseTableUnknownError => ({
    code: "TABLE_UNKNOWN",
    message: `${table} is not a table in the store's public schema`,
    table,
  }),
  timedOut: ({ budgetMs }: { budgetMs: number }): StoreBrowseTimedOutError => ({
    code: "QUERY_TIMED_OUT",
    message: `the store read ran past its ${String(budgetMs / 1000)}s statement timeout; narrow the filter or pick a smaller page`,
  }),
  unselected: ({ why }: { why: string }): StoreBrowseUnselectedError => ({
    code: "STORE_UNSELECTED",
    message: why,
  }),
} as const;
