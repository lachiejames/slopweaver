/**
 * Which of a set of native ids the store already HOLDS — a physical presence check, never a search.
 *
 * It exists for one caller (`./bronzeDrift.ts`) and the distinction matters: every other read of `content`
 * in this tree goes through `./client.ts`'s query layer, which applies visibility, paging and text
 * predicates. None of those belong to the question "is this row in the database", and one of them applied
 * by accident would report a row missing because it was private rather than because it was absent — a
 * drift report that cannot tell those apart is worse than no report.
 *
 * The query is an index probe rather than a scan: `content` carries `uq_content_source_native` on
 * `(source, source_id)` (`./schema/content.ts`), so `where source = $1 and source_id = any($2)` selecting
 * only `source_id` never reads a body. Batching is what keeps ONE statement's parameter list bounded on a
 * source whose window files carry a hundred thousand ids.
 */
import { and, eq, inArray } from "drizzle-orm";

import { err, ok, type Result } from "../lib/result.js";

import type { StoreClient } from "./client.js";
import { type StoreError, StoreErrors } from "./errors.js";
import { type ContentRow, contentTable } from "./schema/content.js";

/**
 * How many ids one `source_id = any(...)` carries.
 *
 * A CHOICE rather than a measurement, sized so a batch stays far below Postgres's 65,535-parameter ceiling
 * while keeping the number of round trips proportional to ids/2000 rather than to ids. Reproduce the cost
 * of a whole source with `time slopweaver store status --source slack`.
 *
 * @internal named by this module and its own test — the batch size is a parameter-ceiling fact, not a knob.
 */
export const PRESENCE_BATCH = 2_000;

/**
 * Split the ids to probe into the statements that will carry them.
 *
 * Pure, and separate from the probe on purpose: the parameter-ceiling property is the whole reason
 * batching exists here, and it is checkable with no database — whereas the probe around it is not
 * checkable without one. An empty input yields NO batches rather than one empty batch, which is what
 * keeps the caller from issuing an `in ()`.
 *
 * @param sourceIds the native ids to look for
 * @param size how many ids one statement carries
 * @returns the batches, in input order, none of them empty
 */
export function presenceBatches({
  sourceIds,
  size = PRESENCE_BATCH,
}: {
  sourceIds: readonly string[];
  size?: number;
}): readonly (readonly string[])[] {
  const batches: (readonly string[])[] = [];
  for (let at = 0; at < sourceIds.length; at += size) {
    batches.push(sourceIds.slice(at, at + size));
  }
  return batches;
}

/**
 * The subset of `sourceIds` the store already holds for `source`.
 *
 * Returns immediately over an empty input rather than issuing an `in ()`, which Postgres accepts and
 * every reader then has to reason about.
 *
 * @param client the open store
 * @param source which source rows to probe
 * @param sourceIds the native ids to look for, in any order
 * @returns the ids that are present, as a set, or the typed database failure
 */
export async function findPresentContentKeys({
  client,
  source,
  sourceIds,
}: {
  client: StoreClient;
  source: ContentRow["source"];
  sourceIds: readonly string[];
}): Promise<Result<ReadonlySet<string>, StoreError>> {
  const present = new Set<string>();
  if (sourceIds.length === 0) {
    return ok(present);
  }
  try {
    for (const batch of presenceBatches({ sourceIds })) {
      const rows = await client.db
        .select({ sourceId: contentTable.sourceId })
        .from(contentTable)
        .where(and(eq(contentTable.source, source), inArray(contentTable.sourceId, [...batch])));
      rows.forEach((row) => present.add(row.sourceId));
    }
  } catch (error: unknown) {
    return err(StoreErrors.queryFailed({ cause: error, what: "store drift presence probe" }));
  }
  return ok(present);
}
