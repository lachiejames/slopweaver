/**
 * The shared read, normalize, reconcile and gap steps every "parent inventory + embedded child collection"
 * kind's own `syncXKind` function builds on: one concurrency ceiling, each parent's scope string, the
 * fan-out-and-reconcile read, and the simple per-parent gap inputs.
 *
 * `kindFold.ts` holds the folds every kind shares, flat or not; this module holds only what the parent-fanout
 * kinds add on top of them, so it imports nothing from there.
 */
import type { Result } from "../../lib/result.js";
import type { CloudflareClientError } from "./errors.js";
import { type ParentCollectionAttempt, readParentCollections } from "./fanout.js";
import {
  type CloudflareGapRecheck,
  classifyCloudflareClientErrorGap,
  openCloudflareGap,
  recheckEveryCondition,
} from "./gaps.js";
import type { CloudflareEntity, CloudflareGap, CloudflareKind } from "./model.js";
import { reconcileParentFanout } from "./parentFanoutReconcile.js";

/** Every non-flat kind's fan-out concurrency ceiling — one global cap, per `src/lib/resilience.ts`'s doctrine. */
export const PARENT_FANOUT_CONCURRENCY = 4;

/**
 * The scope one parent-fanout kind's single parent is recorded under — shared by every kind using
 * `reconcileParentFanout`, since each parent's own scope needs no kind-specific shape.
 *
 * @param accountId the selected account id
 * @param kind the kind this scope is for
 * @param parentId the parent's own provider id
 * @returns the scope string
 */
export function parentFanoutScope({
  accountId,
  kind,
  parentId,
}: {
  accountId: string;
  kind: CloudflareKind;
  parentId: string;
}): string {
  return `account/${accountId}/${kind}/${parentId}`;
}

/** One reconciled parent-fanout attempt: the per-parent attempts (for building gap inputs) and the
 * reconciliation itself (for the entities and completeness). */
export interface FanOutAndReconcileResult<TChild> {
  readonly attempts: readonly ParentCollectionAttempt<TChild>[];
  readonly reconciliation: ReturnType<typeof reconcileParentFanout>;
}

/**
 * Fan out one child-collection read per parent, normalize every raw child, and reconcile the result against
 * what is already stored — the three steps every "parent inventory + embedded child collection" kind's own
 * `syncXKind` function otherwise repeats verbatim.
 *
 * @param accountId the selected account id
 * @param at this run's ISO timestamp
 * @param parents this run's fresh parent inventory
 * @param stored every entity this kind's file already holds
 * @param readChild reads one parent's raw child collection, given its id
 * @param normalizeChild normalizes one raw child into its stored shape
 * @param extractStoredChildren read a stored entity's children back out, or `null` if it does not validate
 * @param buildEntity project one parent's fresh metadata plus its resolved children into an entity
 * @returns this run's per-parent attempts and the reconciled result
 */
export async function fanOutAndReconcile<TParent extends { id: string }, TRawChild, TChild>({
  accountId,
  at,
  parents,
  stored,
  readChild,
  normalizeChild,
  extractStoredChildren,
  buildEntity,
}: {
  accountId: string;
  at: string;
  parents: readonly TParent[];
  stored: readonly CloudflareEntity[];
  readChild: (args: { parentId: string }) => Promise<Result<readonly TRawChild[], CloudflareClientError>>;
  normalizeChild: (args: { raw: TRawChild }) => TChild;
  extractStoredChildren: (entity: CloudflareEntity) => readonly TChild[] | null;
  buildEntity: (args: {
    accountId: string;
    at: string;
    parentId: string;
    parent: TParent;
    children: readonly TChild[];
  }) => CloudflareEntity;
}): Promise<FanOutAndReconcileResult<TChild>> {
  const rawAttempts = await readParentCollections<TRawChild>({
    concurrency: PARENT_FANOUT_CONCURRENCY,
    parentIds: parents.map((parent) => parent.id),
    read: readChild,
  });
  const attempts: readonly ParentCollectionAttempt<TChild>[] = rawAttempts.map((attempt) => ({
    parentId: attempt.parentId,
    result: attempt.result.map((items) => items.map((raw) => normalizeChild({ raw }))),
  }));
  const reconciliation = reconcileParentFanout<TParent, TChild>({
    accountId,
    at,
    attempts,
    buildEntity,
    extractStoredChildren,
    parentId: (parent) => parent.id,
    parents,
    stored,
  });
  return { attempts, reconciliation };
}

/**
 * Build the observed gaps and rechecks for a simple parent-fanout kind — one gap per failed parent, a
 * recheck for every condition on every succeeded parent. A kind whose own completeness depends on more than
 * "did the read succeed" (`gateway-list`, `pages-project`) needs its own variant instead of this one, since
 * a succeeded-but-incomplete parent must not recheck its own completeness condition as resolved.
 *
 * @param accountId the selected account id
 * @param kind the kind these attempts belong to
 * @param attempts this run's per-parent fan-out attempts
 * @param at this run's ISO timestamp
 * @returns the gaps this run observed, and the rechecks it earned
 */
export function basicParentFanoutGapInputs<TChild>({
  accountId,
  kind,
  attempts,
  at,
}: {
  accountId: string;
  kind: CloudflareKind;
  attempts: readonly ParentCollectionAttempt<TChild>[];
  at: string;
}): { observed: readonly CloudflareGap[]; rechecks: readonly CloudflareGapRecheck[] } {
  const observed: CloudflareGap[] = [];
  const rechecks: CloudflareGapRecheck[] = [];
  for (const attempt of attempts) {
    const scope = parentFanoutScope({ accountId, kind, parentId: attempt.parentId });
    if (attempt.result.isErr()) {
      observed.push(
        openCloudflareGap({
          at,
          condition: classifyCloudflareClientErrorGap({ error: attempt.result.error }),
          kind,
          reason: attempt.result.error.message,
          scope,
        }),
      );
    } else {
      rechecks.push(...recheckEveryCondition({ scope }));
    }
  }
  return { observed, rechecks };
}
