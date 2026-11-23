/**
 * What `./workstreamStoreFake.ts` does on each write, as pure functions from what it holds to what it holds after: it
 * asks the same pure judges the port does (`src/workstreams/store/judge.ts`, `batchPlan.ts`) and answers through the
 * port's own refusal mapping, so it refuses exactly what the store refuses. A refusal leaves the state it was handed
 * untouched; the fake keeps the state and hands copies across its boundary.
 */
import { err, ok, type Result, unwrap } from "../lib/result.js";
import { storedWorkstreamOf } from "../workstreams/store/assembly.js";
import { planWorkstreamBatch, survivingReferenceOf } from "../workstreams/store/batchPlan.js";
import { byCodeUnit } from "../workstreams/store/canonical.js";
import { decodeWorkstreamDetail, decodeWorkstreamMeta } from "../workstreams/store/decode.js";
import { type WorkstreamStoreError, WorkstreamStoreErrors } from "../workstreams/store/errors.js";
import {
  judgeAggregateWrite,
  judgeBatch,
  judgeMetaWrite,
  judgeRemove,
  type WorkstreamBatchRequest,
} from "../workstreams/store/judge.js";
import { batchRefusalError, type WorkstreamBatchResult } from "../workstreams/store/port.js";
import type { StoredWorkstream, StoredWorkstreamMeta, WorkstreamAggregate } from "../workstreams/store/types.js";

import { rowsOf } from "./workstreamStoreFixtures.js";

/** What the fake holds: every workstream by id, and the register document. */
export interface FakeState {
  readonly workstreams: ReadonlyMap<string, StoredWorkstream>;
  readonly meta: StoredWorkstreamMeta | null;
}

/**
 * A document as a jsonb column hands it back, before the store's read decodes it: `-0` comes back `0`, as measured.
 * Bounded: one workstream's `detail` or the register document, never a whole register. Each
 * caller decodes the copy with the decoder the store's read runs (`assembly.ts`), so nothing is asserted.
 *
 * @returns a copy carrying only what JSON holds, undecoded
 */
function asJsonb({ value }: { value: unknown }): unknown {
  return JSON.parse(JSON.stringify(value));
}

/**
 * The register document as the store reads it back: through jsonb, then its decoder.
 *
 * @returns the decoded copy
 */
function metaAsStored({ document }: { document: StoredWorkstreamMeta["document"] }): StoredWorkstreamMeta["document"] {
  // Judged before it got here, so a decode failure is this fake disagreeing with the store's own reader.
  return unwrap(decodeWorkstreamMeta({ value: asJsonb({ value: document }) }));
}

/**
 * A workstream as the store would hand it back after a write at `revision`: its rows built, `detail` as jsonb returns
 * it, then decoded by the very `storedWorkstreamOf` the store's read-back runs — so a field no column holds is dropped
 * here exactly as there, rather than this fake keeping a list of what the store keeps.
 *
 * @param aggregate the judged aggregate, canonical
 * @param createdAtIso when it was first written
 * @returns the stored workstream, a copy the caller may keep
 */
function storedOf({
  aggregate,
  createdAtIso,
  nowIso,
  revision,
}: {
  aggregate: WorkstreamAggregate;
  createdAtIso: string;
  nowIso: string;
  revision: number;
}): StoredWorkstream {
  const rows = rowsOf({ aggregate, revision });
  const row = {
    ...rows.row,
    createdAt: new Date(createdAtIso),
    detail: unwrap(
      decodeWorkstreamDetail({
        kind: aggregate.kind,
        owner: aggregate.id,
        value: asJsonb({ value: aggregate.detail }),
      }),
    ),
    updatedAt: new Date(nowIso),
  };
  const targets = aggregate.links.filter((link) => link.kind === "workstream").map((link) => link.target);
  // The aggregate was judged before it got here, so a decode failure is this fake disagreeing with the store's own
  // reader — a defect to throw on, never an answer.
  return unwrap(
    storedWorkstreamOf({ knownWorkstreamIds: new Set([aggregate.id, ...targets]), rows: { ...rows, row } }),
  );
}

/**
 * Every stored id and its revision.
 *
 * @returns the map the batch plan reads
 */
function heldRevisions({ state }: { state: FakeState }): Readonly<Record<string, number>> {
  return Object.fromEntries([...state.workstreams.values()].map((one) => [one.id, one.revision]));
}

/**
 * Write one judged aggregate into a copy of the workstreams, by compare-and-set.
 *
 * @param into the copy to write into
 * @returns whether the revision held
 */
function writeInto({
  aggregate,
  expectedRevision,
  into,
  nowIso,
}: {
  aggregate: WorkstreamAggregate;
  expectedRevision: number | null;
  into: Map<string, StoredWorkstream>;
  nowIso: string;
}): boolean {
  const current = into.get(aggregate.id);
  if (expectedRevision === null) {
    if (current !== undefined) {
      return false;
    }
    into.set(aggregate.id, storedOf({ aggregate, createdAtIso: nowIso, nowIso, revision: 1 }));
    return true;
  }
  if (current?.revision !== expectedRevision) {
    return false;
  }
  const revision = expectedRevision + 1;
  into.set(aggregate.id, storedOf({ aggregate, createdAtIso: current.createdAtIso, nowIso, revision }));
  return true;
}

/**
 * The document as it stands after a settlement by compare-and-set — the four arms of `WorkstreamBatchMeta` — or
 * `undefined` when the revision did not hold.
 *
 * @param document the document to write, `null` to leave none
 * @returns the document as it now stands (`null` for none), or `undefined` on a conflict
 */
function metaAfter({
  document,
  expectedRevision,
  nowIso,
  state,
}: {
  document: StoredWorkstreamMeta["document"] | null;
  expectedRevision: number | null;
  nowIso: string;
  state: FakeState;
}): { readonly settled: StoredWorkstreamMeta | null } | undefined {
  const held = expectedRevision === null ? state.meta === null : state.meta?.revision === expectedRevision;
  if (!held) {
    return undefined;
  }
  if (document === null) {
    return { settled: null };
  }
  let revision = 1;
  if (expectedRevision !== null) {
    revision = expectedRevision + 1;
  }
  return { settled: { document: metaAsStored({ document }), revision, updatedAtIso: nowIso } };
}

/**
 * Every `workstream` link the given workstreams hold, as owner and target.
 *
 * @returns the links
 */
function workstreamLinks({
  workstreams,
}: {
  workstreams: Iterable<StoredWorkstream>;
}): readonly { readonly workstreamId: string; readonly target: string }[] {
  return [...workstreams].flatMap((one) =>
    one.links
      .filter((link) => link.kind === "workstream")
      .map((link) => ({ target: link.target, workstreamId: one.id })),
  );
}

/**
 * One judged batch against what the fake holds, exactly as the store's transaction decides it.
 *
 * @param request the batch, the caller's `home` already dropped
 * @param nowIso the instant every write stamps
 * @returns what the fake holds after it and what the store would answer, or the refusal the port would map
 */
export function batchAfter({
  nowIso,
  request,
  state,
}: {
  nowIso: string;
  request: WorkstreamBatchRequest;
  state: FakeState;
}): Result<{ readonly result: WorkstreamBatchResult; readonly state: FakeState }, WorkstreamStoreError> {
  const judged = judgeBatch({ request });
  if (judged.isErr()) {
    return err(WorkstreamStoreErrors.invalid({ problems: judged.error }));
  }
  const batch = judged.value;
  const plan = planWorkstreamBatch({ held: heldRevisions({ state }), request: batch });
  if ("refusal" in plan) {
    return err(batchRefusalError({ outcome: plan.refusal }));
  }
  const next = new Map(state.workstreams);
  for (const { aggregate, expectedRevision } of batch.writes) {
    if (!writeInto({ aggregate, expectedRevision, into: next, nowIso })) {
      return err(
        batchRefusalError({ outcome: { expectedRevision, kind: "workstream-conflict", workstreamId: aggregate.id } }),
      );
    }
  }
  const deleted = batch.deletes.map((one) => one.workstreamId);
  const referenced = survivingReferenceOf({ deleted, links: workstreamLinks({ workstreams: next.values() }) });
  if (referenced !== undefined) {
    return err(batchRefusalError({ outcome: referenced }));
  }
  for (const id of deleted) {
    next.delete(id);
  }
  let heldMeta = state.meta;
  if (batch.meta !== undefined) {
    const settled = metaAfter({ ...batch.meta, nowIso, state });
    if (settled === undefined) {
      return err(
        batchRefusalError({ outcome: { expectedRevision: batch.meta.expectedRevision, kind: "meta-conflict" } }),
      );
    }
    heldMeta = settled.settled;
  }
  const meta = batch.meta === undefined ? null : heldMeta;
  const written = batch.writes.map((one) => next.get(one.aggregate.id)!);
  return ok({ result: { meta, written }, state: { meta: heldMeta, workstreams: next } });
}

/**
 * The problems a single put's `workstream` links raise against what the fake holds, as the store's target lock reads.
 *
 * @param aggregate the judged aggregate
 * @returns one problem per target the register does not hold, sorted
 */
function missingTargetProblems({
  aggregate,
  state,
}: {
  aggregate: WorkstreamAggregate;
  state: FakeState;
}): readonly string[] {
  const targets = [...new Set(aggregate.links.filter((link) => link.kind === "workstream").map((link) => link.target))];
  return targets
    .filter((target) => !state.workstreams.has(target))
    .toSorted((a, b) => byCodeUnit({ a, b }))
    .map((target) => `${aggregate.id} links workstream ${target}, which the register does not hold`);
}

/**
 * Every other workstream linking the given one.
 *
 * @returns their ids, sorted
 */
function linkersOf({ state, workstreamId }: { state: FakeState; workstreamId: string }): readonly string[] {
  return [
    ...new Set(
      workstreamLinks({ workstreams: state.workstreams.values() })
        .filter((link) => link.target === workstreamId && link.workstreamId !== workstreamId)
        .map((link) => link.workstreamId),
    ),
  ].toSorted((a, b) => byCodeUnit({ a, b }));
}

/**
 * One single put against what the fake holds, as the store's write decides it.
 *
 * @param nowIso the instant the write stamps
 * @returns what the fake holds after it and the stored workstream, or the refusal the port would map
 */
export function putAfter({
  aggregate,
  expectedRevision,
  nowIso,
  state,
}: {
  aggregate: WorkstreamAggregate;
  expectedRevision: number | null;
  nowIso: string;
  state: FakeState;
}): Result<{ readonly result: StoredWorkstream; readonly state: FakeState }, WorkstreamStoreError> {
  const judged = judgeAggregateWrite({ aggregate, expectedRevision });
  if (judged.isErr()) {
    return err(WorkstreamStoreErrors.invalid({ problems: judged.error }));
  }
  const missing = missingTargetProblems({ aggregate: judged.value, state });
  if (missing.length > 0) {
    return err(WorkstreamStoreErrors.invalid({ problems: missing }));
  }
  const next = new Map(state.workstreams);
  if (!writeInto({ aggregate: judged.value, expectedRevision, into: next, nowIso })) {
    // A create's conflict names revision 0, as the port's own mapping does.
    if (expectedRevision === null) {
      return err(WorkstreamStoreErrors.conflict({ expectedRevision: 0, workstreamId: aggregate.id }));
    }
    return err(WorkstreamStoreErrors.conflict({ expectedRevision, workstreamId: aggregate.id }));
  }
  return ok({ result: next.get(aggregate.id)!, state: { ...state, workstreams: next } });
}

/**
 * One single remove against what the fake holds, as the store's delete decides it.
 *
 * @returns what the fake holds after it, or the refusal the port would map
 */
export function removeAfter({
  expectedRevision,
  state,
  workstreamId,
}: {
  expectedRevision: number;
  state: FakeState;
  workstreamId: string;
}): Result<FakeState, WorkstreamStoreError> {
  const judged = judgeRemove({ expectedRevision, workstreamId });
  if (judged.isErr()) {
    return err(WorkstreamStoreErrors.invalid({ problems: judged.error }));
  }
  const current = state.workstreams.get(workstreamId);
  if (current?.revision !== expectedRevision) {
    return err(WorkstreamStoreErrors.conflict({ expectedRevision, workstreamId }));
  }
  const referencedBy = linkersOf({ state, workstreamId });
  if (referencedBy.length > 0) {
    return err(WorkstreamStoreErrors.referenced({ referencedBy, workstreamId }));
  }
  const next = new Map(state.workstreams);
  next.delete(workstreamId);
  return ok({ ...state, workstreams: next });
}

/**
 * One register-document write against what the fake holds, as the store's compare-and-set decides it.
 *
 * @param nowIso the instant the write stamps
 * @returns what the fake holds after it, its document the stored one, or the refusal the port would map
 */
export function putMetaAfter({
  document,
  expectedRevision,
  nowIso,
  state,
}: {
  document: StoredWorkstreamMeta["document"];
  expectedRevision: number | null;
  nowIso: string;
  state: FakeState;
}): Result<FakeState & { readonly meta: StoredWorkstreamMeta }, WorkstreamStoreError> {
  const judged = judgeMetaWrite({ document, expectedRevision });
  if (judged.isErr()) {
    return err(WorkstreamStoreErrors.invalid({ problems: judged.error }));
  }
  const written = metaAfter({ document: judged.value, expectedRevision, nowIso, state })?.settled;
  if (written == null) {
    // A create's conflict names revision 0, as the port's own mapping does.
    if (expectedRevision === null) {
      return err(WorkstreamStoreErrors.metaConflict({ expectedRevision: 0 }));
    }
    return err(WorkstreamStoreErrors.metaConflict({ expectedRevision }));
  }
  return ok({ ...state, meta: written });
}
