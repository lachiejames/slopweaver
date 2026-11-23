/**
 * The register document's compare-and-set, over whichever handle it is given: its own statement for `putMeta`, or the
 * batch's open transaction (`./batchWrite.ts`), so both write it one way.
 */
import { and, eq, sql } from "drizzle-orm";

import type { StoreReader } from "../../store/client.js";
import {
  WORKSTREAM_REGISTER_META_ID,
  type WorkstreamRegisterMetaRow,
  workstreamRegisterMetaTable,
} from "../../store/schema.js";

import type { WorkstreamRegisterMeta } from "./types.js";

/**
 * Insert the register document (revision `null`) or update it iff it is at the revision.
 *
 * @param writer the pool or the open transaction
 * @returns the row as written, or `undefined` when the race was lost
 */
export async function writeMetaIn({
  document,
  expectedRevision,
  writer,
}: {
  document: WorkstreamRegisterMeta;
  expectedRevision: number | null;
  writer: StoreReader["db"];
}): Promise<WorkstreamRegisterMetaRow | undefined> {
  if (expectedRevision === null) {
    const [inserted] = await writer
      .insert(workstreamRegisterMetaTable)
      .values({ document, id: WORKSTREAM_REGISTER_META_ID, revision: 1 })
      .onConflictDoNothing({ target: workstreamRegisterMetaTable.id })
      .returning();
    return inserted;
  }
  const [updated] = await writer
    .update(workstreamRegisterMetaTable)
    .set({ document, revision: sql`${workstreamRegisterMetaTable.revision} + 1`, updatedAt: sql`now()` })
    .where(
      and(
        eq(workstreamRegisterMetaTable.id, WORKSTREAM_REGISTER_META_ID),
        eq(workstreamRegisterMetaTable.revision, expectedRevision),
      ),
    )
    .returning();
  return updated;
}

/**
 * Settle the register document as a batch states it (`./judge.ts` `WorkstreamBatchMeta`): assert none, create,
 * update or delete, each by compare-and-set. Run only inside the batch's transaction, after its table lock, so an
 * asserted absence cannot be filled before the commit.
 *
 * @param writer the open transaction
 * @returns the document as it now stands — the row, or `null` for none — or `conflict` when the revision moved
 */
export async function settleMetaIn({
  document,
  expectedRevision,
  writer,
}: {
  document: WorkstreamRegisterMeta | null;
  expectedRevision: number | null;
  writer: StoreReader["db"];
}): Promise<
  { readonly kind: "conflict" } | { readonly kind: "settled"; readonly row: WorkstreamRegisterMetaRow | null }
> {
  if (document !== null) {
    const written = await writeMetaIn({ document, expectedRevision, writer });
    if (written === undefined) {
      return { kind: "conflict" };
    }
    return { kind: "settled", row: written };
  }
  if (expectedRevision === null) {
    const [present] = await writer
      .select({ id: workstreamRegisterMetaTable.id })
      .from(workstreamRegisterMetaTable)
      .where(eq(workstreamRegisterMetaTable.id, WORKSTREAM_REGISTER_META_ID));
    if (present !== undefined) {
      return { kind: "conflict" };
    }
    return { kind: "settled", row: null };
  }
  const [deleted] = await writer
    .delete(workstreamRegisterMetaTable)
    .where(
      and(
        eq(workstreamRegisterMetaTable.id, WORKSTREAM_REGISTER_META_ID),
        eq(workstreamRegisterMetaTable.revision, expectedRevision),
      ),
    )
    .returning({ id: workstreamRegisterMetaTable.id });
  if (deleted === undefined) {
    return { kind: "conflict" };
  }
  return { kind: "settled", row: null };
}
