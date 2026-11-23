/**
 * Remove named identities from the store, when the bronze rows they were ingested from have been superseded.
 *
 * The store is a projection of bronze and re-ingest is an upsert on `(source, source_id)`: a row whose
 * bronze line has been REMOVED, rather than rewritten under the same identity, is never touched by a replay
 * again and would sit in the store forever. `fathom share` is the one writer that retires an identity — the
 * hand-written `share:<token>` rows it replaces with recording-id rows — so it deletes those identities here,
 * by exact `(source, source_id)`, and nothing wider. Every per-source row and vector cascades from `content`.
 */
import { sql } from "drizzle-orm";

import type { CorpusSource } from "../corpus/types.js";
import { err, ok, type Result } from "../lib/result.js";

import type { StoreClient } from "./client.js";
import { type StoreError, StoreErrors } from "./errors.js";

/**
 * Delete the `content` rows of exactly these identities in one source.
 *
 * @param client the open store
 * @param source the source the identities belong to
 * @param sourceIds the retired identities; an empty list deletes nothing and runs no statement
 * @returns how many rows went
 */
export async function deleteContentIdentities({
  client,
  source,
  sourceIds,
}: {
  client: StoreClient;
  source: CorpusSource;
  sourceIds: readonly string[];
}): Promise<Result<number, StoreError>> {
  if (sourceIds.length === 0) {
    return ok(0);
  }
  try {
    const rows = await client.db.execute(sql`
      delete from content
      where source = ${source}
        and source_id in (${sql.join(
          sourceIds.map((id) => sql`${id}`),
          sql`, `,
        )})
      returning id
    `);
    return ok(rows.length);
  } catch (error: unknown) {
    return err(
      StoreErrors.queryFailed({ cause: error, what: `retiring ${String(sourceIds.length)} ${source} row(s)` }),
    );
  }
}
