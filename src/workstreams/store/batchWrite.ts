/**
 * The batch transaction: several workstreams created, updated and deleted, and the register document written, in ONE
 * transaction that commits whole or not at all. `./port.ts` judges the batch first and `./batchPlan.ts` decides what
 * the locked read refuses; this module only speaks SQL.
 *
 * It is not a loop over `writeAggregateIn`/`deleteWorkstreamIn`, and cannot be: a single write locks its link targets
 * before its own row exists, so two NEW workstreams linking each other would each find the other missing, and a single
 * delete counts a link from a workstream the same batch is deleting. So the batch judges every link against the
 * register it LEAVES.
 *
 * ## In one transaction, in this order
 *
 * 0. Lock every `workstream` link target the writes name `FOR KEY SHARE`, as a single write does, BEFORE the table
 *    lock. A single `remove` locks its row `FOR UPDATE`, checks for linkers, then deletes; the table lock alone
 *    does not conflict with that row lock, so a batch could otherwise judge the target present, commit a link to it,
 *    and the delete land after. Taken first, the batch waits for that delete to commit and step 2 reads the target
 *    gone; taken after the table lock, the delete would wait on the table and the batch on the row — a deadlock.
 * 1. Lock the `workstream` and `workstream_register_meta` tables `SHARE ROW EXCLUSIVE`, in that order, in one
 *    statement: it excludes every concurrent insert, update and delete — a row lock would not stop an insert, and a
 *    new row would break the whole-register compare. Two batches serialise; a single `put`, `remove` or `putMeta`
 *    waits for the batch, or the batch for it, so the document's compare-and-set at step 7 sees the state the lock
 *    froze. `putMeta` touches only its own table, so the second lock adds no lock-order cycle. Child rows need no lock of their own: every
 *    writer of them goes through the port, and each writes its parent `workstream` row before any child, so the
 *    parent-table lock already excludes it. A statement that inserts a `workstream` link without the port checks no
 *    target at all and can dangle a link with or without a batch; the port is the contract.
 * 2. Read every `(id, revision)`. Refuse unless `wholeRegister`, when given, equals it exactly; unless every write's
 *    and delete's revision holds (a create needs no row); unless every `workstream` link names an id the batch leaves.
 * 3. Compare-and-set every parent row, in id order, so every parent exists before any child is written.
 * 4. Replace every written workstream's children, in id order.
 * 5. Refuse a delete any surviving workstream still links to — read AFTER the replacement, so a link the batch adds
 *    counts and one it removes does not.
 * 6. Delete; children cascade.
 * 7. Settle the register document by compare-and-set: assert none, create, update or delete it (`./metaWrite.ts`).
 * 8. Read every written aggregate back and decode it as a reader would, its links judged against the ids the batch
 *    leaves, so the answer is exactly what commits — and a read-back that does not decode is a refusal that rolls
 *    the batch back, never a `WORKSTREAM_STORED_INVALID` reported over a batch that already committed.
 *
 * A refusal found after anything was written must roll the whole transaction back, and returning from a Drizzle
 * transaction commits it. So {@link applyWorkstreamBatch} throws a private refusal out of the transaction and turns it
 * back into the outcome outside it.
 *
 * The table lock has one cost, stated rather than discovered: a single `put` or a batch that has already locked a link
 * target `FOR KEY SHARE` and a batch deleting that target can deadlock. PostgreSQL detects it and aborts one, which that
 * caller reads as `WORKSTREAM_STORE_UNAVAILABLE` with nothing written.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";

import type { StoreReader } from "../../store/client.js";
import {
  type WorkstreamRegisterMetaRow,
  workstreamLinkTable,
  workstreamRegisterMetaTable,
  workstreamTable,
} from "../../store/schema.js";

import {
  aggregateRowsOf,
  lockLinkTargetsIn,
  replaceWorkstreamChildrenIn,
  writeWorkstreamRowIn,
} from "./aggregateWrite.js";
import { storedWorkstreamOf } from "./assembly.js";
import {
  planWorkstreamBatch,
  survivingReferenceOf,
  type WorkstreamBatchOutcome,
  type WorkstreamBatchRefusal,
} from "./batchPlan.js";
import type { WorkstreamBatchRequest } from "./judge.js";
import { settleMetaIn } from "./metaWrite.js";
import { statementRuns } from "./storable.js";
import type { StoredWorkstream } from "./types.js";

/** Whatever a statement runs on: the transaction the batch opened. */
type StoreHandle = StoreReader["db"];

/** A refusal the batch found, carried out of the transaction so it rolls back rather than commits. */
class BatchRefused extends Error {
  readonly refusal: WorkstreamBatchRefusal;

  constructor({ refusal }: { refusal: WorkstreamBatchRefusal }) {
    super(`workstream batch refused: ${refusal.kind}`);
    this.refusal = refusal;
  }
}

/**
 * Run one judged batch inside the transaction it is handed, answering a refusal rather than throwing one. Only
 * {@link applyWorkstreamBatch} may call it for real: a refusal answered after a write must still be rolled back.
 *
 * @param request the batch, judged by the port: writes and deletes in id order, no id named twice
 * @param writer the open transaction
 * @returns what the batch did
 */
export async function applyWorkstreamBatchIn({
  request,
  writer,
}: {
  request: WorkstreamBatchRequest;
  writer: StoreHandle;
}): Promise<WorkstreamBatchOutcome> {
  await lockLinkTargetsIn({ aggregates: request.writes.map((one) => one.aggregate), writer });
  await writer.execute(sql`lock table ${workstreamTable}, ${workstreamRegisterMetaTable} in share row exclusive mode`);
  const read = await writer
    .select({ id: workstreamTable.id, revision: workstreamTable.revision })
    .from(workstreamTable)
    .orderBy(asc(workstreamTable.id));
  const plan = planWorkstreamBatch({
    held: Object.fromEntries(read.map((row) => [row.id, row.revision])),
    request,
  });
  if ("refusal" in plan) {
    return plan.refusal;
  }
  const conflict = await writeAggregatesIn({ request, writer });
  if (conflict !== undefined) {
    return conflict;
  }
  const referenced = await deleteUnlinkedIn({ request, writer });
  if (referenced !== undefined) {
    return referenced;
  }
  let meta: WorkstreamRegisterMetaRow | null = null;
  if (request.meta !== undefined) {
    const settled = await settleMetaIn({ ...request.meta, writer });
    if (settled.kind === "conflict") {
      return { expectedRevision: request.meta.expectedRevision, kind: "meta-conflict" };
    }
    meta = settled.row;
  }
  const back = await readBackIn({ finalIds: plan.finalIds, request, writer });
  return "written" in back ? { kind: "applied", meta, written: back.written } : back;
}

/**
 * Steps 3 and 4: compare-and-set every parent row, then replace every written workstream's children, each in id order.
 *
 * @returns the first parent whose revision moved, or nothing when every write landed
 */
async function writeAggregatesIn({
  request,
  writer,
}: {
  request: WorkstreamBatchRequest;
  writer: StoreHandle;
}): Promise<WorkstreamBatchRefusal | undefined> {
  for (const { aggregate, expectedRevision } of request.writes) {
    if (!(await writeWorkstreamRowIn({ aggregate, expectedRevision, writer }))) {
      return { expectedRevision, kind: "workstream-conflict", workstreamId: aggregate.id };
    }
  }
  for (const { aggregate } of request.writes) {
    await replaceWorkstreamChildrenIn({ aggregate, writer });
  }
  return undefined;
}

/**
 * Steps 5 and 6: refuse a delete a surviving workstream still links to, read after the replacement, then delete. In
 * runs (`./storable.ts`), so no count of deletes outgrows one statement; `survivingReferenceOf` orders what the runs
 * read, so their order is no decision.
 *
 * @returns the first delete still linked to, or nothing when every delete landed
 */
async function deleteUnlinkedIn({
  request,
  writer,
}: {
  request: WorkstreamBatchRequest;
  writer: StoreHandle;
}): Promise<WorkstreamBatchRefusal | undefined> {
  const deleted = request.deletes.map((one) => one.workstreamId);
  const links: { readonly target: string; readonly workstreamId: string }[] = [];
  for (const run of statementRuns({ items: deleted })) {
    links.push(
      ...(await writer
        .selectDistinct({ target: workstreamLinkTable.target, workstreamId: workstreamLinkTable.workstreamId })
        .from(workstreamLinkTable)
        .where(and(eq(workstreamLinkTable.kind, "workstream"), inArray(workstreamLinkTable.target, [...run])))),
    );
  }
  const referenced = survivingReferenceOf({ deleted, links });
  if (referenced !== undefined) {
    return referenced;
  }
  for (const run of statementRuns({ items: deleted })) {
    await writer.delete(workstreamTable).where(inArray(workstreamTable.id, [...run]));
  }
  return undefined;
}

/**
 * Step 8: read every written aggregate back and decode it as a reader would, its links judged against the ids the
 * batch leaves.
 *
 * @param finalIds every workstream id the batch leaves in the register
 * @returns what commits, or every problem a read-back that does not decode carries
 */
async function readBackIn({
  finalIds,
  request,
  writer,
}: {
  finalIds: readonly string[];
  request: WorkstreamBatchRequest;
  writer: StoreHandle;
}): Promise<
  { readonly written: readonly StoredWorkstream[] } | Extract<WorkstreamBatchRefusal, { kind: "stored-invalid" }>
> {
  const known = new Set(finalIds);
  const written: StoredWorkstream[] = [];
  const problems: string[] = [];
  for (const { aggregate } of request.writes) {
    const back = await aggregateRowsOf({ reader: writer, workstreamId: aggregate.id });
    if (back === undefined) {
      throw new Error(`workstream ${aggregate.id} was written and then could not be read back in the same transaction`);
    }
    const stored = storedWorkstreamOf({ knownWorkstreamIds: known, rows: back });
    if (stored.isErr()) {
      problems.push(...stored.error);
    } else {
      written.push(stored.value);
    }
  }
  return problems.length > 0 ? { kind: "stored-invalid", problems } : { written };
}

/**
 * Run one judged batch in its own transaction, rolling it back on every refusal.
 *
 * @param db the open store connection
 * @param request the batch, judged by the port
 * @returns what the batch did; a database failure throws, for the caller's boundary to type
 */
export async function applyWorkstreamBatch({
  db,
  request,
}: {
  db: StoreHandle;
  request: WorkstreamBatchRequest;
}): Promise<WorkstreamBatchOutcome> {
  try {
    return await db.transaction(async (writer) => {
      const outcome = await applyWorkstreamBatchIn({ request, writer });
      if (outcome.kind !== "applied") {
        throw new BatchRefused({ refusal: outcome });
      }
      return outcome;
    });
  } catch (cause) {
    if (cause instanceof BatchRefused) {
      return cause.refusal;
    }
    throw cause;
  }
}
