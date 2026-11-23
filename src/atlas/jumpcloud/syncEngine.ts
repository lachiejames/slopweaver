/**
 * The walk itself: every admitted operation, in an order that keeps the read epochs comparable.
 *
 * ## Root collections first, then fan-outs, and both INTERLEAVED across kinds
 *
 * The obvious order — finish `systems` entirely, then `policies`, then the rest — produces read epochs that
 * cannot overlap. The malware-detection question this atlas exists to answer compares a device against the
 * policy result recorded for it, and a comparison whose two operands come from intervals that do not
 * overlap is not a disagreement; it is temporally incomparable. Run that way, every live comparison would
 * be a permanent non-result while every test passed.
 *
 * So each phase runs round-robin: slot 0 of every kind, then slot 1 of every kind, and so on. Every kind's
 * epoch then spans very nearly the whole sync, so every pair of epochs overlaps and the comparison is
 * answerable. It costs nothing — the same calls in a different order.
 *
 * ## A fan-out is bound from its OWN kind's root ids
 *
 * `plan.ts` explains the rule. What matters here is that phase two cannot start until phase one has
 * finished, because a fan-out with no ids is a fan-out that never runs, and running it against last
 * generation's ids would be reporting on devices that may no longer exist.
 *
 * ## Calls run eight at a time, and every completed one is journalled
 *
 * A restart resumes from the journal rather than from the beginning. See `resume.ts` for the numbers that
 * make that a requirement rather than a nicety.
 */
import { err, ok, type Result } from "../../lib/result.js";
import type { AtlasDroppedField, AtlasProjection } from "../kit/projection.js";
import { bindPath, type JumpcloudClientDeps } from "./client.js";
import type { JumpcloudEntity } from "./entities.js";
import { JUMPCLOUD_SETTLED_FAILURE_CODES, type JumpcloudReadError, settledJumpcloudError } from "./errors.js";
import type { JumpcloudKind } from "./model.js";
import { bindingRootFor, type JumpcloudKindPlan, type JumpcloudOperation } from "./plan.js";
import { projectJumpcloudValue } from "./projection.js";
import type { JumpcloudAdmit } from "./responseRegistry.js";
import { appendJumpcloudResume, type JumpcloudResumeEntry, readJumpcloudResume, resumeKey } from "./resume.js";
import { admitJumpcloudGeneration } from "./sensitivity.js";
import { absorbJumpcloudCall, emptyJumpcloudAccumulator, type JumpcloudAccumulator } from "./syncAccumulator.js";
import { observeJumpcloudRecords } from "./syncEntities.js";
import { idsForFanout, interleave } from "./syncOrder.js";
import { readJumpcloudOperation } from "./syncRead.js";

/** What one kind's walk accumulated. */
export interface JumpcloudKindWalk {
  readonly kind: JumpcloudKind;
  readonly entities: readonly JumpcloudEntity[];
  readonly projections: readonly AtlasProjection[];
  /** Removals journalled by an earlier projection, which re-projecting the same records can no longer find. */
  readonly journalledDrops: readonly AtlasDroppedField[];
  /** Provider ids the root collections yielded, pooled — the fallback binding for a fan-out with no parent. */
  readonly providerIds: readonly string[];
  /**
   * The same ids kept per ROOT OPERATION, which is what a fan-out is actually bound from.
   *
   * A kind with several root collections used to pool them, so every `/application-catalog` id reached
   * `/applications/{application_id}` — `plan.ts`'s {@link bindingRootFor} has the measurement.
   */
  readonly providerIdsBySurface: Readonly<Record<string, readonly string[]>>;
  /** The first and last instants any call for this kind was made at. */
  readonly firstAt: string | null;
  readonly lastAt: string | null;
  /** Every operation that did not complete, with the typed reason. */
  readonly failures: readonly { readonly surface: string; readonly error: JumpcloudReadError }[];
  /** Operations that answered successfully and carried no records at all. */
  readonly emptyOperations: readonly string[];
  /** Operations that answered but could not be shown to have been read to the end. */
  readonly incompleteOperations: readonly string[];
  /** Of those, the ones whose shortfall a later run could clear — these refuse a publication. */
  readonly clearableIncomplete: readonly string[];
  /** The provider's own total for the kind's first root collection, when it declared one. */
  readonly declaredTotal: number | null;
  /** Whether every walk for this kind ended because the provider ran out of pages. */
  readonly pagesExhausted: boolean;
  /** How many calls this run skipped because a previous run had already made them. */
  readonly resumed: number;
}

/**

 * Everything the walk needs beyond the plan.
 * @internal
 */
export interface JumpcloudWalkDeps {
  readonly client: JumpcloudClientDeps;
  /** How each answered page is admitted — `admitJumpcloudPage` in production. */
  readonly admit: JumpcloudAdmit;
  readonly now: () => string;
  readonly progress: (line: string) => void;
  /** The atlas directory, where the resume journal lives. */
  readonly directory: string;
}

/**
 * Make one call, or reuse the journalled result of a previous run's identical call.
 *
 * @param operation the planned operation
 * @param bindings one value per path parameter
 * @param isRoot whether this is a root collection, which changes how ids are stored
 * @param accumulator the kind's accumulator, mutated in place
 * @param journalled what previous runs already completed, keyed by call
 * @param deps the client, clock, progress sink and atlas directory
 * @returns nothing on success, or why the journal could not be written — the one fatal local failure
 */
async function runCall({
  operation,
  bindings,
  isRoot,
  accumulator,
  journalled,
  deps,
}: {
  operation: JumpcloudOperation;
  bindings: Readonly<Record<string, string>>;
  isRoot: boolean;
  accumulator: JumpcloudAccumulator;
  journalled: ReadonlyMap<string, JumpcloudResumeEntry>;
  deps: JumpcloudWalkDeps;
}): Promise<Result<null>> {
  const bound = bindPath({ bindings, path: operation.row.path });
  const cached = bound.isOk()
    ? (journalled.get(resumeKey({ endpoint: bound.value, surface: operation.row.name })) ?? null)
    : null;
  const entry = await journalledOrFresh({ accumulator, bindings, cached, deps, isRoot, operation });
  if (entry === null) {
    return ok(null);
  }
  const settled = entry.settledFailure;
  if (settled !== undefined) {
    accumulator.failures.push({
      error: settledJumpcloudError({ code: settled.code, message: settled.message, surface: entry.surface }),
      surface: entry.surface,
    });
    return cached === null ? appendJumpcloudResume({ directory: deps.directory, entry }) : ok(null);
  }
  // Identities are derived HERE rather than read out of the journal, so a corrected identity rule applies
  // to work a previous run already did instead of costing the whole walk again.
  const observed = observeJumpcloudRecords({
    at: entry.at,
    endpoint: entry.endpoint,
    isRoot: entry.isRoot,
    operation,
    records: entry.records,
  });
  // The key this walk authenticates WITH is matched verbatim, never left to the forgiving shape table.
  const admitted = admitJumpcloudGeneration({ document: observed.entities, knownSecrets: [deps.client.apiKey] });
  if (admitted.isErr()) {
    accumulator.failures.push({
      error: {
        code: "UNEXPECTED_SHAPE",
        detail: admitted.error.join("; "),
        message: `${operation.row.name} carried material the pre-publish gate refuses`,
        surface: operation.row.name,
      },
      surface: operation.row.name,
    });
    return ok(null);
  }
  absorbJumpcloudCall({ accumulator, entry, observed });
  return cached === null ? appendJumpcloudResume({ directory: deps.directory, entry }) : ok(null);
}

/**
 * This call's entry: the one a previous run journalled, counted as resumed, or — when no run has completed it
 * yet — a fresh call's.
 *
 * @param cached the journalled entry for this exact call, or `null` when no previous run completed it
 * @returns the entry, or `null` when a fresh read failed and the failure was recorded
 */
async function journalledOrFresh({
  cached,
  ...call
}: Parameters<typeof freshEntry>[0] & { cached: JumpcloudResumeEntry | null }): Promise<JumpcloudResumeEntry | null> {
  if (cached !== null) {
    call.accumulator.resumed += 1;
    return cached;
  }
  return freshEntry(call);
}

/**
 * Make one call and turn what it returned into a journal entry.
 *
 * @param operation the planned operation
 * @param bindings one value per path parameter
 * @param isRoot whether this is a root collection
 * @param accumulator the kind's accumulator, which records a failure in place
 * @param deps the client, clock, progress sink and atlas directory
 * @returns the entry, or `null` when the read failed and the failure was recorded
 */
async function freshEntry({
  operation,
  bindings,
  isRoot,
  accumulator,
  deps,
}: {
  operation: JumpcloudOperation;
  bindings: Readonly<Record<string, string>>;
  isRoot: boolean;
  accumulator: JumpcloudAccumulator;
  deps: JumpcloudWalkDeps;
}): Promise<JumpcloudResumeEntry | null> {
  const at = deps.now();
  const answered = await readJumpcloudOperation({ admit: deps.admit, bindings, deps: deps.client, now: at, operation });
  if (answered.isErr()) {
    accumulator.firstAt = accumulator.firstAt === null || at < accumulator.firstAt ? at : accumulator.firstAt;
    accumulator.lastAt = accumulator.lastAt === null || at > accumulator.lastAt ? at : accumulator.lastAt;
    if (!JUMPCLOUD_SETTLED_FAILURE_CODES.has(answered.error.code)) {
      accumulator.failures.push({ error: answered.error, surface: operation.row.name });
      return null;
    }
    const bound = bindPath({ bindings, path: operation.row.path });
    const endpoint = bound.isOk() ? bound.value : operation.row.path;
    return {
      at,
      complete: false,
      declaredTotal: null,
      empty: true,
      incompleteIsClearable: false,
      endpoint,
      isRoot,
      key: resumeKey({ endpoint, surface: operation.row.name }),
      kind: operation.kind,
      pagesExhausted: true,
      reason: answered.error.message,
      records: [],
      settledFailure: { code: answered.error.code, message: answered.error.message },
      surface: operation.row.name,
    };
  }
  const read = answered.value;
  return {
    at,
    complete: read.complete,
    declaredTotal: read.declaredTotal,
    empty: read.empty,
    incompleteIsClearable: read.incompleteIsClearable,
    endpoint: read.endpoint,
    isRoot,
    key: resumeKey({ endpoint: read.endpoint, surface: operation.row.name }),
    kind: operation.kind,
    pagesExhausted: read.pagesExhausted,
    reason: read.reason,
    ...projectedRecords({ endpoint: read.endpoint, records: read.records }),
    surface: operation.row.name,
  };
}

/**
 * Project a call's records once, keeping both halves of what the projection produced.
 *
 * The records are projected before they are journalled, so nothing a kind file would be refused for
 * holding can reach the journal either. That is why the REMOVALS have to travel with them — re-projecting
 * an already-projected record finds nothing, so a drop discarded here is a withholding coverage can never
 * report again.
 *
 * @param endpoint the bound path these records came through, which scopes the denial
 * @param records the provider's own documents, exactly as the read returned them
 * @returns the projected records and every removal across them, deduplicated by pointer and reason
 */
function projectedRecords({ endpoint, records }: { endpoint: string; records: readonly unknown[] }): {
  readonly records: readonly unknown[];
  readonly dropped: readonly AtlasDroppedField[];
} {
  const projected: unknown[] = [];
  const seen = new Set<string>();
  const dropped: AtlasDroppedField[] = [];
  for (const record of records) {
    const projection = projectJumpcloudValue({ endpoint, value: record });
    projected.push(projection.value);
    for (const drop of projection.dropped) {
      const key = `${drop.pointer}\u0000${drop.reason}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      dropped.push(drop);
    }
  }
  return { dropped, records: projected };
}

/**
 * The journalled calls a previous run completed, indexed by key.
 *
 * @param directory the atlas directory
 * @returns the index, empty when no journal exists
 */
function journalIndex({ directory }: { directory: string }): ReadonlyMap<string, JumpcloudResumeEntry> {
  const index = new Map<string, JumpcloudResumeEntry>();
  for (const entry of readJumpcloudResume({ directory })) {
    index.set(entry.key, entry);
  }
  return index;
}

/** One scheduled call: what to run, with what bindings, into which accumulator. */
interface ScheduledCall {
  readonly operation: JumpcloudOperation;
  readonly bindings: Readonly<Record<string, string>>;
  readonly isRoot: boolean;
  readonly accumulator: JumpcloudAccumulator;
}

/**
 * How many calls are in flight at once.
 *
 * MEASURED against the live tenancy: a full walk is every root call plus one fan-out call per parent id, and
 * in series its duration is one call's latency multiplied by that whole call count, which is not a sync
 * anybody runs. Eight workers is the number, and it is deliberately modest: JumpCloud publishes no
 * numeric allowance and directs callers to back off rather than to a documented rate, so the ceiling here
 * is self-imposed. Nothing about it defeats the pacing — every call still goes through `safeProviderCall`,
 * so a 429 records on the shared block and every one of the eight then waits on it.
 *
 * Reproduce the shape with `slopweaver atlas jumpcloud sync` and read the progress lines it writes.
 * @internal
 */
export const JUMPCLOUD_CONCURRENCY = 8;

/**
 * Run every scheduled call, eight at a time, reporting progress as it goes.
 *
 * Concurrency changes the ORDER results are folded in, never the result: `mergeKind` sorts entities by id,
 * the store serialises with sorted keys, and each call's outcome depends on nothing another call did. The
 * accumulators are mutated after each `await` on one thread, so there is no interleaving inside a fold.
 *
 * @param calls the ordered calls
 * @param journalled the previous run's completed calls
 * @param label the phase name, for the progress line
 * @param deps the client, clock, progress sink and atlas directory
 * @returns nothing, or the first journal write failure — which stops the run rather than losing resumability
 */
async function runCalls({
  calls,
  journalled,
  label,
  deps,
}: {
  calls: readonly ScheduledCall[];
  journalled: ReadonlyMap<string, JumpcloudResumeEntry>;
  label: string;
  deps: JumpcloudWalkDeps;
}): Promise<Result<null>> {
  let next = 0;
  let done = 0;
  // An array rather than a nullable binding: TypeScript cannot narrow a `let` a closure assigns, so a
  // nullable one read as always-null to the compiler and to oxlint alike.
  const failures: Result<null>[] = [];
  const worker = async (): Promise<void> => {
    while (failures.length === 0) {
      const index = next;
      next += 1;
      const call = calls[index];
      if (call === undefined) {
        return;
      }
      const ran = await runCall({ ...call, deps, journalled });
      done += 1;
      if (ran.isErr()) {
        failures.push(ran);
        return;
      }
      if (done % 250 === 0 || done === calls.length) {
        deps.progress(`${label}: ${String(done)}/${String(calls.length)} calls`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(JUMPCLOUD_CONCURRENCY, Math.max(calls.length, 1)) }, () => worker()));
  const failed = failures[0];
  if (failed !== undefined) {
    return failed;
  }
  // No worker recorded a failure, so every call ran.
  return ok(null);
}

/**
 * Walk every planned kind: root collections, then fan-outs bound from their own kind's ids.
 *
 * @param plans one plan per kind to walk
 * @param deps the client, clock, progress sink and atlas directory
 * @returns one walk result per kind, or the reason the run could not continue
 */
export async function walkJumpcloud({
  plans,
  deps,
}: {
  plans: readonly JumpcloudKindPlan[];
  deps: JumpcloudWalkDeps;
}): Promise<Result<readonly JumpcloudKindWalk[]>> {
  const journalled = journalIndex({ directory: deps.directory });
  // Every `accumulators.get(plan.kind)!` below is present: this map is built from these same plans.
  const accumulators = new Map<JumpcloudKind, JumpcloudAccumulator>(
    plans.map((plan) => [plan.kind, emptyJumpcloudAccumulator()]),
  );
  const roots = plans.map((plan) =>
    plan.roots.map((operation): ScheduledCall => ({
      accumulator: accumulators.get(plan.kind)!,
      bindings: {},
      isRoot: true,
      operation,
    })),
  );
  const rootRun = await runCalls({ calls: interleave({ perKind: roots }), deps, journalled, label: "roots" });
  if (rootRun.isErr()) {
    return err(rootRun.error);
  }

  const fanouts = plans.map((plan) => {
    const accumulator = accumulators.get(plan.kind)!;
    const pooled = [...new Set(accumulator.providerIds)].toSorted();
    return plan.fanouts.flatMap((operation) => {
      const root = bindingRootFor({ fanout: operation, roots: plan.roots });
      const ids = idsForFanout({ accumulator, pooled, root });
      // `parameters[0]` is present by construction: `plan.ts` files an operation as a fan-out only when it
      // declares exactly one path parameter.
      return ids.map((id): ScheduledCall => ({
        accumulator,
        bindings: { [operation.parameters[0]!]: id },
        isRoot: false,
        operation,
      }));
    });
  });
  const fanoutRun = await runCalls({ calls: interleave({ perKind: fanouts }), deps, journalled, label: "fan-outs" });
  if (fanoutRun.isErr()) {
    return err(fanoutRun.error);
  }

  return ok(plans.map((plan): JumpcloudKindWalk => ({ ...accumulators.get(plan.kind)!, kind: plan.kind })));
}
