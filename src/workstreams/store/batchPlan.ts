/**
 * What a batch's transaction decides from the revisions it read under lock, before it writes anything — and the
 * outcomes it can answer. Pure, so the in-memory store the tests drive decides a batch exactly as the store does.
 */
import type { WorkstreamRegisterMetaRow } from "../../store/schema.js";

import { byCodeUnit } from "./canonical.js";
import type { WorkstreamBatchRequest } from "./judge.js";
import type { StoredWorkstream } from "./types.js";

/** What one batch did inside its transaction. Every arm but `applied` rolled it back. */
export type WorkstreamBatchOutcome =
  | {
      readonly kind: "applied";
      /**
       * Every written workstream as the transaction read it back and decoded it, in id order — decoded BEFORE the
       * commit, its links judged against the ids the batch leaves, so a read-back that fails rolls the batch back.
       */
      readonly written: readonly StoredWorkstream[];
      /** The register document as written, or `null` when the batch wrote none. */
      readonly meta: WorkstreamRegisterMetaRow | null;
    }
  | WorkstreamBatchRefusal;

/** Every way a batch's transaction refuses, each one rolling it back. */
export type WorkstreamBatchRefusal =
  | { readonly kind: "stored-invalid"; readonly problems: readonly string[] }
  | { readonly kind: "workstream-conflict"; readonly workstreamId: string; readonly expectedRevision: number | null }
  | { readonly kind: "missing-targets"; readonly workstreamId: string; readonly missing: readonly string[] }
  | { readonly kind: "referenced"; readonly workstreamId: string; readonly referencedBy: readonly string[] }
  | { readonly kind: "meta-conflict"; readonly expectedRevision: number | null }
  | {
      readonly kind: "whole-register-conflict";
      readonly expected: Readonly<Record<string, number>>;
      readonly actual: Readonly<Record<string, number>>;
    };

/**
 * Everything a batch refuses on before it writes: the whole-register baseline, then each stated revision in id order,
 * then each link against the ids the batch leaves.
 *
 * @param held every stored id and its revision, as the locked read returned them
 * @param request the batch, judged
 * @returns the first refusal, or the ids the batch leaves, sorted
 */
export function planWorkstreamBatch({
  held,
  request,
}: {
  held: Readonly<Record<string, number>>;
  request: WorkstreamBatchRequest;
}): { readonly refusal: WorkstreamBatchRefusal } | { readonly finalIds: readonly string[] } {
  const baseline = request.wholeRegister;
  if (baseline !== undefined && !sameRevisions({ actual: held, expected: baseline })) {
    return { refusal: { actual: held, expected: baseline, kind: "whole-register-conflict" } };
  }
  const conflict = revisionConflict({ held, request });
  if (conflict !== undefined) {
    return { refusal: conflict };
  }
  const gone = new Set(request.deletes.map((one) => one.workstreamId));
  const finalIds = new Set([
    ...Object.keys(held).filter((id) => !gone.has(id)),
    ...request.writes.map((one) => one.aggregate.id),
  ]);
  const missing = missingTarget({ finalIds, request });
  if (missing !== undefined) {
    return { refusal: missing };
  }
  return { finalIds: [...finalIds].toSorted((a, b) => byCodeUnit({ a, b })) };
}

/**
 * The first deleted workstream a surviving one still links to, from every `workstream` link the batch leaves.
 *
 * @param links each surviving link's owner and target
 * @param deleted the ids the batch deletes
 * @returns the refusal, or `undefined` when nothing the batch leaves links to a deleted one
 */
export function survivingReferenceOf({
  deleted,
  links,
}: {
  deleted: readonly string[];
  links: readonly { readonly workstreamId: string; readonly target: string }[];
}): Extract<WorkstreamBatchRefusal, { readonly kind: "referenced" }> | undefined {
  const gone = new Set(deleted);
  const linking = links
    .filter((link) => gone.has(link.target) && !gone.has(link.workstreamId))
    .toSorted(
      (a, b) => byCodeUnit({ a: a.target, b: b.target }) || byCodeUnit({ a: a.workstreamId, b: b.workstreamId }),
    );
  const [first] = linking;
  if (first === undefined) {
    return undefined;
  }
  const referencedBy = [
    ...new Set(linking.filter((link) => link.target === first.target).map((link) => link.workstreamId)),
  ];
  return { kind: "referenced", referencedBy, workstreamId: first.target };
}

/**
 * Whether two id-to-revision maps hold exactly the same pairs.
 *
 * @returns true when every key and value agree
 */
export function sameRevisions({
  actual,
  expected,
}: {
  actual: Readonly<Record<string, number>>;
  expected: Readonly<Record<string, number>>;
}): boolean {
  const keys = Object.keys(expected);
  return keys.length === Object.keys(actual).length && keys.every((id) => actual[id] === expected[id]);
}

/**
 * The first write or delete whose revision the register no longer carries, in id order.
 *
 * @returns the conflict, or `undefined` when every revision holds
 */
function revisionConflict({
  held,
  request,
}: {
  held: Readonly<Record<string, number>>;
  request: WorkstreamBatchRequest;
}): Extract<WorkstreamBatchRefusal, { readonly kind: "workstream-conflict" }> | undefined {
  const stated = [
    ...request.writes.map((one) => ({ expectedRevision: one.expectedRevision, workstreamId: one.aggregate.id })),
    ...request.deletes.map((one) => ({ expectedRevision: one.expectedRevision, workstreamId: one.workstreamId })),
  ].toSorted((a, b) => byCodeUnit({ a: a.workstreamId, b: b.workstreamId }));
  const conflict = stated.find(({ expectedRevision, workstreamId }) => {
    const current = Object.hasOwn(held, workstreamId) ? held[workstreamId] : undefined;
    if (expectedRevision === null) {
      return current !== undefined;
    }
    return current !== expectedRevision;
  });
  if (conflict === undefined) {
    return undefined;
  }
  return { kind: "workstream-conflict", ...conflict };
}

/**
 * The first write, in id order, linking a workstream the batch does not leave.
 *
 * @param finalIds every id the batch leaves
 * @returns the refusal, or `undefined` when every target survives
 */
function missingTarget({
  finalIds,
  request,
}: {
  finalIds: ReadonlySet<string>;
  request: WorkstreamBatchRequest;
}): Extract<WorkstreamBatchRefusal, { readonly kind: "missing-targets" }> | undefined {
  const writes = request.writes.toSorted((a, b) => byCodeUnit({ a: a.aggregate.id, b: b.aggregate.id }));
  for (const { aggregate } of writes) {
    const missing = [
      ...new Set(
        aggregate.links
          .filter((link) => link.kind === "workstream" && !finalIds.has(link.target))
          .map((link) => link.target),
      ),
    ].toSorted((a, b) => byCodeUnit({ a, b }));
    if (missing.length > 0) {
      return { kind: "missing-targets", missing, workstreamId: aggregate.id };
    }
  }
  return undefined;
}
