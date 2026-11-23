/**
 * Selecting records from the store — the one place a question becomes rows becomes records.
 *
 * ## Why this is a module and not a line inside a CLI shell
 *
 * Every reader of the corpus now reaches the store: `store read`, `store cite`, the console's lookup pane,
 * and `slice verify`'s handoff sentinels. There is no ranked bronze path: no pg vector, no embeddings, no re-ranking, no semantic search and no
 * lexical splitting — so they need the same selection the CLI shell already performed. Two of them are
 * not CLI verbs, and a pane that shells out to a logging command to read its own database would be
 * printing a verb's stderr into an HTTP handler.
 *
 * So the composition of {@link ../store/client.listContentWithNames} and `recordsFrom` lives here as a
 * value-returning function, and the shells keep what is genuinely theirs: opening and closing the
 * connection, printing, argv, files and the clock.
 *
 * ## Unplaced rows are counted, never coalesced
 *
 * A citation is computed from a row's container, so a row whose container did not resolve cannot be
 * cited. Every ingested row HAS one — the projection refuses an empty container and always writes the
 * container row — so a null is a broken foreign key rather than an ordinary shape. It is carried out as
 * a number for the caller to report, because a row quietly dropped is the failure this layer exists to
 * refuse.
 */
import type { CorpusRecord } from "../corpus/types.js";
import { type Result } from "../lib/result.js";
import { type ContentWithNames, listContentWithNames, type StoreClient } from "./client.js";
import type { StoreError } from "./errors.js";
import type { StoreQuery } from "./query.js";
import { recordFromStoreRow } from "./record.js";

/** What one selection returned: the query it ran, the records it produced, and what it held back. */
export interface StoreSelection {
  /** The validated query the rows were selected with, carried so a caller can report what it ran. */
  readonly query: StoreQuery;
  /** The selected rows as corpus records, in the order the store returned them. */
  readonly records: readonly CorpusRecord[];
  /** How many rows were held back for having no resolvable container. */
  readonly unplaced: number;
}

/**
 * Turn the rows a query returned into corpus records, holding back any whose container did not resolve.
 *
 * @param rows the rows the query returned, with their author and container names already resolved
 * @returns the records, and how many rows were held back
 */
function recordsFrom({ rows }: { rows: readonly ContentWithNames[] }): {
  records: readonly CorpusRecord[];
  unplaced: number;
} {
  const records: CorpusRecord[] = [];
  let unplaced = 0;
  for (const entry of rows) {
    const container = entry.container;
    if (container === null) {
      unplaced += 1;
      continue;
    }
    records.push(recordFromStoreRow({ author: entry.author, container, row: entry.row }));
  }
  return { records, unplaced };
}

/**
 * Select the records one validated query addresses.
 *
 * The connection is the caller's: this function neither opens nor closes it, so a caller holding one
 * open across several selections is not forced to reconnect, and a shell that opened one stays the
 * thing responsible for closing it.
 *
 * @param client an open store client the caller owns the lifetime of
 * @param query the validated query, already checked against the store's own vocabulary
 * @param listRows what runs the query against the database; the real store read unless a test supplies a fake
 * @returns the selection, or the store's own typed failure
 */
export async function selectStoreRecords({
  client,
  query,
  listRows = listContentWithNames,
}: {
  client: StoreClient;
  query: StoreQuery;
  listRows?: typeof listContentWithNames;
}): Promise<Result<StoreSelection, StoreError>> {
  const listed = await listRows({ client, query });
  return listed.map((rows) => {
    const read = recordsFrom({ rows });
    return { query, records: read.records, unplaced: read.unplaced };
  });
}
