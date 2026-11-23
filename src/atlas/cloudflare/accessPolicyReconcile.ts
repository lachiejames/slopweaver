/**
 * Pure reconciliation of this run's Access-policy fan-out against what the store already holds.
 *
 * Different shape from `merge.ts` on purpose: a flat kind's entities are a plain list, replaced wholesale on
 * a complete read. `access-policy` is a bipartite graph (policy ⟷ application), and one failed application
 * read must only leave THAT application's edges untouched — every other application's successful update,
 * and the reusable-policy list itself, still lands. See `readers/accessPolicy.ts`'s header for what a live
 * probe measured about cross-app duplication before this was written.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import type { Result } from "../../lib/result.js";
import type { CloudflareClientError } from "./errors.js";
import type { CloudflareEntity } from "./model.js";
import {
  type CloudflareAccessPolicyBinding,
  type CloudflareAccessPolicyBody,
  type CloudflareRawAccessPolicy,
  extractCloudflareAccessPolicyBody,
  isCloudflareAccessPolicyDetail,
  projectCloudflareAccessPolicy,
} from "./projection/accessPolicy.js";

/** One application's per-app policy-read attempt this run. */
export interface AccessPolicyAppAttempt {
  readonly applicationId: string;
  readonly result: Result<readonly CloudflareRawAccessPolicy[], CloudflareClientError>;
}

/** The mutable working state one reconciliation pass builds up, seeded from what is already stored. */
interface ReconcileState {
  readonly bindings: Map<string, Map<string, number | null>>;
  readonly bodies: Map<string, CloudflareAccessPolicyBody>;
  readonly reusable: Map<string, boolean>;
}

/** Seed the working state from the previously stored `access-policy` entities. */
function seedFromStored({ stored }: { stored: readonly CloudflareEntity[] }): ReconcileState {
  const bindings = new Map<string, Map<string, number | null>>();
  const bodies = new Map<string, CloudflareAccessPolicyBody>();
  const reusable = new Map<string, boolean>();
  for (const entity of stored) {
    if (!isCloudflareAccessPolicyDetail(entity.detail)) {
      continue;
    }
    const detail = entity.detail;
    bindings.set(
      entity.providerId,
      new Map(detail.bindings.map((binding) => [binding.applicationId, binding.precedence])),
    );
    bodies.set(entity.providerId, { config: detail.config, decision: detail.decision, name: detail.name });
    reusable.set(entity.providerId, detail.reusable);
  }
  return { bindings, bodies, reusable };
}

/** Fold the account-level reusable-policy read into the working state. Authoritative for `reusable` — every
 * policy not named in a SUCCESSFUL read is marked not-reusable, since this list is a complete snapshot. */
function applyReusableRead({
  state,
  reusableRead,
}: {
  state: ReconcileState;
  reusableRead: Result<readonly CloudflareRawAccessPolicy[], CloudflareClientError>;
}): { ok: boolean; reason: string | null } {
  if (reusableRead.isErr()) {
    return { ok: false, reason: reusableRead.error.message };
  }
  for (const policyId of state.reusable.keys()) {
    state.reusable.set(policyId, false);
  }
  for (const raw of reusableRead.value) {
    state.reusable.set(raw.id, true);
    state.bodies.set(raw.id, extractCloudflareAccessPolicyBody({ raw }));
    if (!state.bindings.has(raw.id)) {
      state.bindings.set(raw.id, new Map());
    }
  }
  return { ok: true, reason: null };
}

/** Fold one application's policy-read attempt into the working state. A failure leaves this application's
 * edges exactly as stored — never blanked, never frozen for any OTHER application. */
function applyAppAttempt({
  state,
  attempt,
}: {
  state: ReconcileState;
  attempt: AccessPolicyAppAttempt;
}): string | null {
  if (attempt.result.isErr()) {
    return attempt.result.error.message;
  }
  for (const policyBindings of state.bindings.values()) {
    policyBindings.delete(attempt.applicationId);
  }
  for (const raw of attempt.result.value) {
    if (!state.bindings.has(raw.id)) {
      state.bindings.set(raw.id, new Map());
    }
    state.bindings.get(raw.id)!.set(attempt.applicationId, unsetFieldAsNull({ key: "precedence", record: raw }));
    state.bodies.set(raw.id, extractCloudflareAccessPolicyBody({ raw }));
  }
  return null;
}

/** Remove edges to applications proven deleted — only when the application inventory itself is trustworthy. */
function pruneDeletedApplications({
  state,
  currentApplicationIds,
}: {
  state: ReconcileState;
  currentApplicationIds: readonly string[] | null;
}): void {
  if (currentApplicationIds === null) {
    return;
  }
  const current = new Set(currentApplicationIds);
  for (const policyBindings of state.bindings.values()) {
    for (const applicationId of policyBindings.keys()) {
      if (!current.has(applicationId)) {
        policyBindings.delete(applicationId);
      }
    }
  }
}

/** Project every policy still worth keeping — dropped only when it has no bindings AND is not reusable. */
function buildEntities({
  state,
  accountId,
  at,
}: {
  state: ReconcileState;
  accountId: string;
  at: string;
}): readonly CloudflareEntity[] {
  const entities: CloudflareEntity[] = [];
  for (const [policyId, policyBindings] of state.bindings) {
    const isReusable = state.reusable.get(policyId) === true;
    if (policyBindings.size === 0 && !isReusable) {
      continue;
    }
    const body = state.bodies.get(policyId);
    if (body === undefined) {
      continue;
    }
    const bindings: CloudflareAccessPolicyBinding[] = [...policyBindings.entries()].map(
      ([applicationId, precedence]) => ({
        applicationId,
        precedence,
      }),
    );
    entities.push(projectCloudflareAccessPolicy({ accountId, at, body, bindings, policyId, reusable: isReusable }));
  }
  return entities.toSorted((left, right) => left.id.localeCompare(right.id));
}

/** What one reconciliation pass produced. */
export interface AccessPolicyReconciliation {
  readonly entities: readonly CloudflareEntity[];
  readonly complete: boolean;
  readonly failedApplicationIds: readonly string[];
  readonly reasons: readonly string[];
}

/**
 * Reconcile this run's Access-policy fan-out against the stored `access-policy` entities.
 *
 * @param stored every `access-policy` entity the kind file already holds
 * @param currentApplicationIds every currently-listed application id, or `null` if the application
 *   inventory itself failed this run (in which case no application is pruned)
 * @param reusableRead this run's account-level reusable-policy read
 * @param appAttempts this run's per-application policy-read attempts
 * @param accountId the selected account id
 * @param at this run's ISO timestamp
 * @returns the reconciled entities and this run's completeness
 */
export function reconcileAccessPolicies({
  stored,
  currentApplicationIds,
  reusableRead,
  appAttempts,
  accountId,
  at,
}: {
  stored: readonly CloudflareEntity[];
  currentApplicationIds: readonly string[] | null;
  reusableRead: Result<readonly CloudflareRawAccessPolicy[], CloudflareClientError>;
  appAttempts: readonly AccessPolicyAppAttempt[];
  accountId: string;
  at: string;
}): AccessPolicyReconciliation {
  const state = seedFromStored({ stored });
  const reasons: string[] = [];

  const reusableOutcome = applyReusableRead({ reusableRead, state });
  if (reusableOutcome.reason !== null) {
    reasons.push(reusableOutcome.reason);
  }

  const failedApplicationIds: string[] = [];
  for (const attempt of appAttempts) {
    const reason = applyAppAttempt({ attempt, state });
    if (reason !== null) {
      failedApplicationIds.push(attempt.applicationId);
      reasons.push(`application ${attempt.applicationId}: ${reason}`);
    }
  }

  pruneDeletedApplications({ currentApplicationIds, state });

  return {
    complete: reusableOutcome.ok && currentApplicationIds !== null && failedApplicationIds.length === 0,
    entities: buildEntities({ accountId, at, state }),
    failedApplicationIds,
    reasons,
  };
}
