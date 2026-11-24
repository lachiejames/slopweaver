/**
 * The usage text and flag specs of the three read-only browsing verbs — `store tables`, `store rows`, `store row` —
 * kept in a leaf the manifest can import without loading a command module.
 */

/** The flags `store tables` takes. */
export const STORE_TABLES_FLAG_SPEC = { boolean: ["json"], string: ["home"] } as const;

/** The flags `store rows` takes. */
export const STORE_ROWS_FLAG_SPEC = {
  boolean: ["json"],
  string: [
    "home",
    "table-hex",
    "sort-hex",
    "direction",
    "filter-column-hex",
    "filter-op",
    "filter-value-hex",
    "page",
    "page-size",
  ],
} as const;

/** The flags `store row` takes. */
export const STORE_ROW_FLAG_SPEC = { boolean: ["json"], string: ["home", "locator-hex"] } as const;

/** What `store tables --help` prints. */
export const STORE_TABLES_USAGE =
  "usage: slopweaver store tables [--home <dir>] [--json]\n" +
  "  Every table in the store's public schema, with its columns, types, primary key and the planner's\n" +
  "  ESTIMATED row count (never an exact count, which would scan every table). Read-only: one READ ONLY\n" +
  "  transaction on the store the verbs' own credential selects. The console's Store page reads this.";

/** What `store rows --help` prints. */
export const STORE_ROWS_USAGE =
  "usage: slopweaver store rows --table-hex <hex> [--sort-hex <hex> [--direction asc|desc]]\n" +
  "  [--filter-column-hex <hex> --filter-op eq|contains|is-null|not-null [--filter-value-hex <hex>]]\n" +
  "  [--page <n>] [--page-size <n>] [--home <dir>] [--json]\n" +
  "  One page of one table's rows, sorted and filtered, each value masked for credentials and cut to 512\n" +
  "  characters. Table and column names travel as the lowercase hex of their UTF-8 (the `token` `store tables`\n" +
  "  prints) and are confirmed against the live catalog before use; a filter value travels as hex too and is\n" +
  "  only ever a bound parameter. `contains` is a case-insensitive substring of the value as text. Pages are\n" +
  "  1-based, 50 rows by default, at most 100. Read-only, under a 5-second statement timeout.";

/** What `store row --help` prints. */
export const STORE_ROW_USAGE =
  "usage: slopweaver store row --locator-hex <hex> [--home <dir>] [--json]\n" +
  "  One whole row, found again by the locator `store rows` printed beside it: its tableoid, ctid and xmin\n" +
  "  together, never a value it holds, so a row written since is refused rather than shown in its place.\n" +
  "  Every value is masked for credentials and cut only past a million characters. Read-only.";
