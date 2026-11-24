/**
 * The documents the three read-only store browsing verbs print — `store tables`, `store rows` and `store row` —
 * and the requests they take. The console's Store page decodes exactly these shapes
 * (`site/lib/storeDocuments.ts`), so a change here is a change to that page's wire.
 *
 * Every identifier travels as a TOKEN as well as a name: the UTF-8 bytes of the catalog name in lowercase hex.
 * A token is opaque to the page and safe in an argv whatever the name holds (a space, a quote, a leading dash),
 * and a token is never trusted: the verb decodes it and looks the name up in the live catalog before a single
 * identifier is quoted into SQL.
 */

/** How a column's values are drawn: picked from the catalog type, never guessed from a value. */
export type StoreDisplayKind = "binary" | "boolean" | "json" | "number" | "temporal" | "text";

/** One column of one table, as the catalog describes it. */
export interface StoreColumnDefinition {
  readonly name: string;
  readonly token: string;
  /** The column's position in the table, 1-based, as the catalog numbers it. */
  readonly ordinal: number;
  /** `pg_catalog.format_type`'s spelling, e.g. `timestamp with time zone`. */
  readonly formattedType: string;
  readonly nullable: boolean;
  readonly generated: boolean;
  readonly identity: boolean;
  /** Where the column sits in the primary key, 1-based, or `null` when it is not part of it. */
  readonly primaryKeyPosition: number | null;
  readonly displayKind: StoreDisplayKind;
}

/** One table in the public schema, with its columns and the planner's row estimate. */
export interface StoreTableDefinition {
  readonly name: string;
  readonly token: string;
  /** An ESTIMATE from the planner and the statistics collector (`estimatedRowsOf`); `null` when neither has one. */
  readonly estimatedRows: number | null;
  readonly columns: readonly StoreColumnDefinition[];
  /** The primary key's column names in key order; empty when the table has none. */
  readonly primaryKey: readonly string[];
}

/** What `store tables --json` prints. */
export interface StoreTablesDocument {
  readonly observedAtIso: string;
  readonly schema: "public";
  readonly tables: readonly StoreTableDefinition[];
  /**
   * How many tables were left out because a name, key or column type in their definition would be masked. A count
   * only, never which: a table listed here is one `store rows` and `store row` refuse as `TABLE_UNKNOWN`.
   */
  readonly withheldTables: number;
}

/** One cell: SQL NULL, a value withheld by the credential mask, or the value as text. */
export type StoreCell =
  | { readonly kind: "null" }
  | { readonly kind: "withheld"; readonly why: string }
  | {
      readonly kind: "value";
      /** The value as Postgres renders it as text (bytea as base64), credentials masked, cut when `truncated`. */
      readonly text: string;
      readonly truncated: boolean;
      /** The stored value's full length in characters, before the cut. */
      readonly characters: number;
    };

/**
 * How a row is found again for the row panel: by its physical position (`tableoid`, `ctid`) and the transaction that
 * wrote it (`xmin`), never by a value it holds, so a locator carries nothing the credential mask would have hidden.
 * A row updated since its page was read is refused as gone rather than shown in its new form.
 */
type StoreRowLocatorStability = "ctid-xmin";

/** One row of a page: its cells by column name, and the opaque locator `store row` reopens it by. */
export interface StoreRowPreview {
  /** Lowercase hex of the row's versioned locator JSON. */
  readonly locator: string;
  readonly cells: Readonly<Record<string, StoreCell>>;
}

/** The filter operators a page may ask for; `contains` is a case-insensitive substring over the value as text. */
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
    /** The value filtered on; absent for `is-null` and `not-null`. */
    readonly value: string | null;
  };
  readonly locatorStability: StoreRowLocatorStability;
  readonly columns: readonly StoreColumnDefinition[];
  readonly rows: readonly StoreRowPreview[];
}

/** What `store row --json` prints: every column of one row, each cut only past a large bound. */
export interface StoreRowDocument {
  readonly observedAtIso: string;
  readonly table: string;
  readonly locator: string;
  readonly locatorStability: StoreRowLocatorStability;
  readonly columns: readonly StoreColumnDefinition[];
  readonly cells: Readonly<Record<string, StoreCell>>;
}

/** One filter a `store rows` request carries, its column still a NAME the catalog has not yet confirmed. */
export type StoreRowsFilterRequest =
  | { readonly column: string; readonly operator: "eq" | "contains"; readonly value: string }
  | { readonly column: string; readonly operator: "is-null" | "not-null" };

/** What `store rows` was asked for, every identifier still a name the catalog has not yet confirmed. */
export interface StoreRowsRequest {
  readonly table: string;
  readonly sort: { readonly column: string; readonly direction: StoreSortDirection } | null;
  readonly filter: StoreRowsFilterRequest | null;
  readonly page: number;
  readonly pageSize: number;
}

/** A decoded row locator, its table name not yet confirmed against the catalog. */
export interface StoreRowLocator {
  readonly kind: "ctid-xmin";
  readonly table: string;
  /** The partition or table the row physically lives in, as Postgres prints `tableoid`. */
  readonly tableoid: string;
  readonly ctid: string;
  readonly xmin: string;
}
