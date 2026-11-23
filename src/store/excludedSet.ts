/**
 * The `excluded.<column>` set clause a side-table upsert refreshes on conflict, derived from the row itself.
 *
 * Pure, and its own module so it is asserted without a database: the loader (`./ingestSourceRows.ts`) is batching
 * and a connection, and this is the one part of its upsert that is a function of a row's shape alone.
 */
import { sql } from "drizzle-orm";

/**
 * The `excluded.<column>` assignment list an upsert needs, built from the row being written.
 *
 * Derived from the row rather than written per table, because four hand-maintained column lists is four
 * chances for a column added to a table to stop being refreshed on re-ingest — silently, since a stale
 * value and a correct one look identical.
 *
 * @param row one row about to be inserted, used only for its key set
 * @returns the set clause, every column but the key refreshed from the incoming row
 */
export function excludedFor({ row }: { row: object }): Record<string, ReturnType<typeof sql>> {
  const set: Record<string, ReturnType<typeof sql>> = {};
  for (const key of Object.keys(row)) {
    if (key !== "contentId") {
      set[key] = sql.raw(`excluded.${camelToSnake({ key })}`);
    }
  }
  return set;
}

/**
 * The Postgres column name for a Drizzle field name.
 *
 * @param key the camelCase field name
 * @returns the snake_case column name the generated DDL uses
 */
function camelToSnake({ key }: { key: string }): string {
  return key.replaceAll(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}
