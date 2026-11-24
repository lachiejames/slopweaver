/**
 * The `store` noun's BROWSING metadata — the three read-only verbs the console's Store page reads through, each a
 * table-editor read over the whole public schema rather than the typed content model `store query` answers from.
 */
import { STORE_ROW_USAGE, STORE_ROWS_USAGE, STORE_TABLES_USAGE } from "../commands/store/browseUsage.js";
import { readMeta } from "./storeQueryMeta.js";

/** `store tables` — every table, its columns and its estimated row count. */
export const tablesMeta = {
  ...readMeta,
  example: "slopweaver store tables --json",
  summary: "List every table in the store with its columns, primary key and estimated row count, read-only",
  usage: STORE_TABLES_USAGE,
} as const;

/** `store rows` — one page of one table, sorted and filtered. */
export const rowsMeta = {
  ...readMeta,
  example: "slopweaver store rows --table-hex 6d656d6f72696573 --page-size 10 --json",
  summary: "Print one page of one table's rows, sorted and filtered, credentials masked, read-only",
  usage: STORE_ROWS_USAGE,
} as const;

/** `store row` — one whole row by the locator a page printed. */
export const rowMeta = {
  ...readMeta,
  example: "slopweaver store row --locator-hex <hex from store rows> --json",
  summary: "Print one whole row of a table by the locator `store rows` printed, credentials masked, read-only",
  usage: STORE_ROW_USAGE,
} as const;
