/**
 * The Store page's table-name box, as a pure projection: which of the already-read tables a typed name matches, and
 * where in each name the match sits so the rail can mark it. Nothing here asks the store anything; the list it narrows
 * is the one `store tables` already printed, so typing sends nothing anywhere.
 */
import type { StoreTableDefinition } from "./storeDocuments";

/** One table the box keeps, with the part of its name that matched split out for drawing. */
export interface StoreTableNameMatch {
  readonly table: StoreTableDefinition;
  /** `null` while the box is empty, so nothing is marked. */
  readonly name: null | { readonly before: string; readonly match: string; readonly after: string };
}

/**
 * A text with its case folded one character at a time, and for every folded position the span of the original
 * character it came from. A character folds by uppercasing then lowercasing it, so every case form of a letter meets
 * in one spelling: final `ς`, `σ` and `Σ` all fold to `σ`, and `ß` folds to `ss`. Folding per character, never the
 * whole string, keeps a name and a query folding alike whatever surrounds a letter, and the spans keep a match
 * reportable in the text's own casing when folding changes a character's length (`İ` folds to two code units).
 *
 * @returns the folded text and, per folded position, where its character starts and ends in the original
 */
function foldedOf({ text }: { text: string }): {
  folded: string;
  starts: readonly number[];
  ends: readonly number[];
} {
  let folded = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let at = 0;
  for (const character of text) {
    const lower = character.toUpperCase().toLowerCase();
    for (let unit = 0; unit < lower.length; unit += 1) {
      starts.push(at);
      ends.push(at + character.length);
    }
    folded += lower;
    at += character.length;
  }
  return { ends, folded, starts };
}

/**
 * Where a query first matches inside a name, ignoring case, as a span of the name as written, or `null`. A match
 * that covers part of a character that folded to several units widens to that whole character.
 *
 * @returns the span's start and end in the name, or `null`
 */
function firstMatchOf({ name, query }: { name: string; query: string }): { from: number; to: number } | null {
  const wanted = foldedOf({ text: query }).folded;
  const folded = foldedOf({ text: name });
  const found = folded.folded.indexOf(wanted);
  if (found === -1) {
    return null;
  }
  return { from: folded.starts[found], to: folded.ends[found + wanted.length - 1] };
}

/**
 * The rail's count line before "counts estimated": how many tables the document named, and once the box holds
 * anything, how many of them it keeps. Withheld tables are counted on their own line, never here.
 *
 * @param query the box's text, exactly as typed
 * @param kept how many tables the box keeps
 * @param total how many tables the tables document named
 * @returns the words, `M tables` or `N of M tables`
 */
export function storeTableCountWords({ query, kept, total }: { query: string; kept: number; total: number }): string {
  if (query.length === 0) {
    return `${String(total)} tables`;
  }
  return `${String(kept)} of ${String(total)} tables`;
}

/**
 * The tables whose name contains the query, ignoring case, in the order the document listed them. The query is taken
 * literally (no pattern characters) and is not trimmed, since a space is a legal character in a table name. An empty
 * query keeps every table, unmarked.
 *
 * @param tables the tables the tables document already holds
 * @param query the box's text, exactly as typed
 * @returns the tables kept, each with its matching span
 */
export function matchingStoreTables({
  tables,
  query,
}: {
  tables: readonly StoreTableDefinition[];
  query: string;
}): readonly StoreTableNameMatch[] {
  if (query.length === 0) {
    return tables.map((table) => ({ name: null, table }));
  }
  const kept: StoreTableNameMatch[] = [];
  for (const table of tables) {
    const span = firstMatchOf({ name: table.name, query });
    if (span !== null) {
      kept.push({
        name: {
          after: table.name.slice(span.to),
          before: table.name.slice(0, span.from),
          match: table.name.slice(span.from, span.to),
        },
        table,
      });
    }
  }
  return kept;
}
