/**
 * The two transactions that change a workstream: write one aggregate whole, and delete one. `./port.ts` decides
 * everything; this module only speaks SQL, through Drizzle's parameterised builders.
 *
 * ## Writing an aggregate, in one transaction
 *
 * 1. Lock every `workstream` link target `FOR KEY SHARE`, in id order, and stop unless every
 *    target came back. A target deleted just before the lock returns no row and locks nothing, which is why the
 *    count is compared. Two writers linking the same targets never wait on each other, since key share does not
 *    conflict with key share; the order only makes the statement deterministic.
 * 2. Compare-and-set the workstream row: insert `ON CONFLICT DO NOTHING` when creating, else update `WHERE revision =
 *    expected`. No row back is a conflict, and nothing has been written.
 * 3. Replace its children — links and entries first, since they reference milestones; then edges; then milestones —
 *    and insert the new set. Every multi-row statement goes in runs (`./storable.ts`'s `statementRuns`), so no count
 *    of children outgrows one statement's bind parameters.
 * 4. Read the aggregate back inside the same transaction, so the answer is exactly what committed.
 *
 * `FOR KEY SHARE` does not conflict with the `FOR NO KEY UPDATE` an ordinary update takes, so two workstreams linking
 * each other never wait on one another; it does conflict with the `FOR UPDATE` a delete takes, which is the point.
 *
 * ## Deleting, in one transaction
 *
 * Lock the row `FOR UPDATE` and check its revision, then refuse if any other workstream links to it. A writer that
 * locked it first commits its link before the check reads; a writer arriving after waits, then finds it gone. Only
 * then delete it; its children cascade.
 */
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";

import type { StoreReader } from "../../store/client.js";
import {
  workstreamEntryTable,
  workstreamLinkTable,
  workstreamMilestoneAfterTable,
  workstreamMilestoneTable,
  workstreamTable,
} from "../../store/schema.js";

import type { WorkstreamAggregateRows } from "./assembly.js";
import { byCodeUnit } from "./canonical.js";
import type { AggregateWriteOutcome, WorkstreamDeleteOutcome } from "./port.js";
import { statementRuns } from "./storable.js";
import type { WorkstreamAggregate } from "./types.js";

/** Whatever a statement runs on: the transaction the operation opened, or — in the proof — the pool itself. */
type StoreHandle = StoreReader["db"];

/**
 * Lock every distinct `workstream` link target the aggregates name `FOR KEY SHARE`, in id order, and name any the
 * register no longer holds — the lock a single write and a batch both take, so a delete that has locked a target
 * `FOR UPDATE` finishes first and the target reads as gone.
 *
 * @param aggregates the workstreams about to be written
 * @param writer the open transaction
 * @returns the locked targets, sorted, and the missing ones
 */
export async function lockLinkTargetsIn({
  aggregates,
  writer,
}: {
  aggregates: readonly WorkstreamAggregate[];
  writer: StoreHandle;
}): Promise<{ readonly locked: readonly string[]; readonly missing: readonly string[] }> {
  // Code-unit order, and `collate "C"` inside each run, which is the same order for these ASCII ids: so the runs
  // together lock in one order every writer shares, however many statements the targets take.
  const wanted = [
    ...new Set(
      aggregates.flatMap((aggregate) =>
        aggregate.links.filter((link) => link.kind === "workstream").map((link) => link.target),
      ),
    ),
  ].toSorted((a, b) => byCodeUnit({ a, b }));
  const locked: string[] = [];
  for (const run of statementRuns({ items: wanted })) {
    const found = await writer
      .select({ id: workstreamTable.id })
      .from(workstreamTable)
      .where(inArray(workstreamTable.id, [...run]))
      .orderBy(sql`${workstreamTable.id} collate "C"`)
      .for("key share");
    locked.push(...found.map((row) => row.id));
  }
  const held = new Set(locked);
  return { locked, missing: wanted.filter((target) => !held.has(target)).toSorted() };
}

/**
 * Compare-and-set the workstream row itself — the one implementation a single write and a batch share.
 *
 * @param writer the open transaction
 * @returns whether this writer won
 */
export async function writeWorkstreamRowIn({
  aggregate,
  expectedRevision,
  writer,
}: {
  aggregate: WorkstreamAggregate;
  expectedRevision: number | null;
  writer: StoreHandle;
}): Promise<boolean> {
  const { detail, id, kind, name, outcome, status, workspace } = aggregate;
  const columns = { detail, kind, name, outcome, status, workspace };
  if (expectedRevision === null) {
    const inserted = await writer
      .insert(workstreamTable)
      .values({ ...columns, id, revision: 1 })
      .onConflictDoNothing({ target: workstreamTable.id })
      .returning({ id: workstreamTable.id });
    return inserted.length === 1;
  }
  const updated = await writer
    .update(workstreamTable)
    .set({ ...columns, revision: sql`${workstreamTable.revision} + 1`, updatedAt: sql`now()` })
    .where(and(eq(workstreamTable.id, id), eq(workstreamTable.revision, expectedRevision)))
    .returning({ id: workstreamTable.id });
  return updated.length === 1;
}

/**
 * Replace every child row of one workstream with the aggregate's — the one implementation a single write and a batch
 * share.
 *
 * @param writer the open transaction
 */
export async function replaceWorkstreamChildrenIn({
  aggregate,
  writer,
}: {
  aggregate: WorkstreamAggregate;
  writer: StoreHandle;
}): Promise<void> {
  const workstreamId = aggregate.id;
  await writer.delete(workstreamLinkTable).where(eq(workstreamLinkTable.workstreamId, workstreamId));
  await writer.delete(workstreamEntryTable).where(eq(workstreamEntryTable.workstreamId, workstreamId));
  await writer
    .delete(workstreamMilestoneAfterTable)
    .where(eq(workstreamMilestoneAfterTable.workstreamId, workstreamId));
  await writer.delete(workstreamMilestoneTable).where(eq(workstreamMilestoneTable.workstreamId, workstreamId));
  const { entries, links, milestones } = aggregate;
  // In runs, each one statement's worth of bind parameters (`./storable.ts`), parents before children.
  const milestoneRows = milestones.map(({ anchor, id, name, position }) => ({
    anchor,
    id,
    name,
    position,
    workstreamId,
  }));
  for (const run of statementRuns({ items: milestoneRows })) {
    await writer.insert(workstreamMilestoneTable).values([...run]);
  }
  const edges = milestones.flatMap((one) =>
    one.after.map((afterId) => ({ afterId, milestoneId: one.id, workstreamId })),
  );
  for (const run of statementRuns({ items: edges })) {
    await writer.insert(workstreamMilestoneAfterTable).values([...run]);
  }
  for (const run of statementRuns({ items: entries.map((entry) => ({ ...entry, workstreamId })) })) {
    await writer.insert(workstreamEntryTable).values([...run]);
  }
  for (const run of statementRuns({ items: links.map((link) => ({ ...link, workstreamId })) })) {
    await writer.insert(workstreamLinkTable).values([...run]);
  }
}

/**
 * Every row one workstream owns, read through whichever handle is given.
 *
 * @returns the row and its children, or `undefined` when the workstream is not there
 */
export async function aggregateRowsOf({
  reader,
  workstreamId,
}: {
  reader: StoreHandle;
  workstreamId: string;
}): Promise<WorkstreamAggregateRows | undefined> {
  const [row] = await reader.select().from(workstreamTable).where(eq(workstreamTable.id, workstreamId));
  if (row === undefined) {
    return undefined;
  }
  return {
    edges: await reader
      .select()
      .from(workstreamMilestoneAfterTable)
      .where(eq(workstreamMilestoneAfterTable.workstreamId, workstreamId)),
    entries: await reader
      .select()
      .from(workstreamEntryTable)
      .where(eq(workstreamEntryTable.workstreamId, workstreamId)),
    links: await reader.select().from(workstreamLinkTable).where(eq(workstreamLinkTable.workstreamId, workstreamId)),
    milestones: await reader
      .select()
      .from(workstreamMilestoneTable)
      .where(eq(workstreamMilestoneTable.workstreamId, workstreamId)),
    row,
  };
}

/**
 * Write one judged aggregate whole, inside the transaction it is handed.
 *
 * @param writer the open transaction; a throw rolls it back
 * @returns what the write did
 */
export async function writeAggregateIn({
  aggregate,
  expectedRevision,
  writer,
}: {
  aggregate: WorkstreamAggregate;
  expectedRevision: number | null;
  writer: StoreHandle;
}): Promise<AggregateWriteOutcome> {
  const targets = await lockLinkTargetsIn({ aggregates: [aggregate], writer });
  if (targets.missing.length > 0) {
    return { kind: "missing-targets", missing: targets.missing };
  }
  if (!(await writeWorkstreamRowIn({ aggregate, expectedRevision, writer }))) {
    return { kind: "conflict" };
  }
  await replaceWorkstreamChildrenIn({ aggregate, writer });
  const rows = await aggregateRowsOf({ reader: writer, workstreamId: aggregate.id });
  if (rows === undefined) {
    throw new Error(`workstream ${aggregate.id} was written and then could not be read back in the same transaction`);
  }
  return { kind: "written", lockedTargets: targets.locked, rows };
}

/**
 * Delete one workstream iff it is at the revision and nothing links to it, inside the transaction it is handed.
 *
 * @param writer the open transaction
 * @returns what the delete did
 */
export async function deleteWorkstreamIn({
  expectedRevision,
  workstreamId,
  writer,
}: {
  expectedRevision: number;
  workstreamId: string;
  writer: StoreHandle;
}): Promise<WorkstreamDeleteOutcome> {
  const [held] = await writer
    .select({ revision: workstreamTable.revision })
    .from(workstreamTable)
    .where(eq(workstreamTable.id, workstreamId))
    .for("update");
  if (held === undefined || held.revision !== expectedRevision) {
    return { kind: "conflict" };
  }
  const linking = await writer
    .selectDistinct({ workstreamId: workstreamLinkTable.workstreamId })
    .from(workstreamLinkTable)
    .where(
      and(
        eq(workstreamLinkTable.kind, "workstream"),
        eq(workstreamLinkTable.target, workstreamId),
        ne(workstreamLinkTable.workstreamId, workstreamId),
      ),
    )
    .orderBy(asc(workstreamLinkTable.workstreamId));
  if (linking.length > 0) {
    return { kind: "referenced", referencedBy: linking.map((row) => row.workstreamId) };
  }
  await writer.delete(workstreamTable).where(eq(workstreamTable.id, workstreamId));
  return { kind: "deleted" };
}
