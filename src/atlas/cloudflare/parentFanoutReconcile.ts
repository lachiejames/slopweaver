/**
 * Generic reconciliation for a "parent inventory + one embedded child collection per parent" kind —
 * `gateway-list` and `account-filter-list` today, the shape the plan names for Pages/Workers/certificates
 * later. Different from `accessPolicyReconcile.ts`'s bipartite graph: here a child collection belongs to
 * exactly one parent, so a failed parent's read never touches any OTHER parent's entity, and a parent no
 * longer present in a successful inventory read is simply dropped rather than conditionally kept.
 */
import { absentAsEmpty } from "#lib/absent.js";
import type { ParentCollectionAttempt } from "./fanout.js";
import type { CloudflareEntity } from "./model.js";

/** What one reconciliation pass produced. */
export interface ParentFanoutReconciliation {
  readonly entities: readonly CloudflareEntity[];
  readonly complete: boolean;
  readonly failedParentIds: readonly string[];
  readonly reasons: readonly string[];
}

/**
 * Reconcile this run's per-parent child-collection fan-out against what is already stored.
 *
 * @param accountId the selected account id
 * @param at this run's ISO timestamp
 * @param parents this run's fresh parent inventory — authoritative for which parents currently exist
 * @param parentId the parent's own provider id
 * @param attempts this run's per-parent child-collection read attempts
 * @param stored every entity this kind's file already holds, keyed by `providerId`
 * @param extractStoredChildren read a stored entity's children back out, or `null` if its `detail` does not
 *   validate against this kind's own shape — the guard every kind reading a typed `detail` off disk needs
 * @param buildEntity project one parent's fresh metadata plus its resolved children into an entity — called
 *   with this run's own children on success, or the previously stored children (if any) on failure
 * @returns the reconciled entities and this run's completeness
 */
export function reconcileParentFanout<TParent, TChild>({
  accountId,
  at,
  parents,
  parentId,
  attempts,
  stored,
  extractStoredChildren,
  buildEntity,
}: {
  accountId: string;
  at: string;
  parents: readonly TParent[];
  parentId: (parent: TParent) => string;
  attempts: readonly ParentCollectionAttempt<TChild>[];
  stored: readonly CloudflareEntity[];
  extractStoredChildren: (entity: CloudflareEntity) => readonly TChild[] | null;
  buildEntity: (args: {
    accountId: string;
    at: string;
    parentId: string;
    parent: TParent;
    children: readonly TChild[];
  }) => CloudflareEntity;
}): ParentFanoutReconciliation {
  const attemptById = new Map(attempts.map((attempt) => [attempt.parentId, attempt]));
  const storedById = new Map(stored.map((entity) => [entity.providerId, entity]));
  const entities: CloudflareEntity[] = [];
  const failedParentIds: string[] = [];
  const reasons: string[] = [];

  for (const parent of parents) {
    const id = parentId(parent);
    const attempt = attemptById.get(id);
    if (attempt === undefined) {
      continue;
    }
    if (attempt.result.isOk()) {
      entities.push(buildEntity({ accountId, at, children: attempt.result.value, parent, parentId: id }));
      continue;
    }
    failedParentIds.push(id);
    reasons.push(`${id}: ${attempt.result.error.message}`);
    const priorEntity = storedById.get(id);
    const priorChildren = priorEntity !== undefined ? extractStoredChildren(priorEntity) : null;
    entities.push(
      buildEntity({ accountId, at, children: absentAsEmpty({ value: priorChildren }), parent, parentId: id }),
    );
  }

  return {
    complete: failedParentIds.length === 0,
    entities: entities.toSorted((left, right) => left.id.localeCompare(right.id)),
    failedParentIds,
    reasons,
  };
}
