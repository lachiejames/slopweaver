/*
 * The fixtures more than one `syncAccessPolicyKind` test file reads: the account and instants a run is stamped
 * at, the paths and scopes its reads address, the stored kind file a run folds into, and the entity and gap
 * shapes a run is expected to publish. The fake client lives beside it in `policyClient.ts`. A plain module, not
 * a `*.test.ts`, so no test registers twice. It was split out when the Access policy sync suite became one file
 * per behaviour.
 */
import { openCloudflareGap } from "../../../../../atlas/cloudflare/gaps.js";
import { cloudflareGapId } from "../../../../../atlas/cloudflare/identity.js";
import {
  type CloudflareEntity,
  type CloudflareGap,
  type CloudflareKindFile,
  emptyCloudflareKindFile,
} from "../../../../../atlas/cloudflare/model.js";
import {
  type CloudflareAccessPolicyBinding,
  type CloudflareAccessPolicyDetail,
  type CloudflareRawAccessPolicy,
  projectCloudflareAccessPolicy,
} from "../../../../../atlas/cloudflare/projection/accessPolicy.js";

export const AT = "2026-01-01T00:00:00.000Z";
export const STORED_AT = "2025-12-01T00:00:00.000Z";
export const ACCOUNT_ID: string = "a".repeat(32);
export const FLAT_SCOPE: string = `account/${ACCOUNT_ID}/access-policy`;
export const APPS_PATH: string = `/client/v4/accounts/${ACCOUNT_ID}/access/apps`;
export const REUSABLE_PATH: string = `/client/v4/accounts/${ACCOUNT_ID}/access/policies`;
export const REUSABLE_SCOPE: string = `${FLAT_SCOPE}/reusable-list`;
const INCLUDE = { include: [{ everyone: {} }] };

const DENIED_TAIL = '403 {"errors":[{"message":"denied"}],"success":false}';

/**
 * The typed permission message a 403 maps to for one reader operation.
 *
 * @returns the message the reader's typed error words for that operation
 */
export function deniedMessage({ operation }: { operation: string }): string {
  return `cloudflare ${operation}: permission denied (403) — the configured token cannot see this surface: ${DENIED_TAIL}`;
}

/**
 * The policy list path for one application.
 *
 * @returns the request path, without a page
 */
export function appPoliciesPath({ applicationId }: { applicationId: string }): string {
  return `${APPS_PATH}/${applicationId}/policies`;
}

/**
 * The gap scope for one application's policy list.
 *
 * @returns the kind scope with the application id appended
 */
export function appScope({ applicationId }: { applicationId: string }): string {
  return `${FLAT_SCOPE}/app/${applicationId}`;
}

/**
 * A stored policy entity, projected by the module's own projection at the earlier timestamp.
 *
 * @returns the projected entity, stamped `STORED_AT`
 */
export function storedPolicy({
  policyId,
  reusable,
  bindings,
}: {
  policyId: string;
  reusable: boolean;
  bindings: readonly CloudflareAccessPolicyBinding[];
}): CloudflareEntity {
  return projectCloudflareAccessPolicy({
    accountId: ACCOUNT_ID,
    at: STORED_AT,
    bindings,
    body: { config: INCLUDE, decision: "allow", name: policyId },
    policyId,
    reusable,
  });
}

/**
 * A stored `access-policy` kind file holding the given entities, gaps and coverage.
 *
 * @returns the kind file a run folds into
 */
export function storedFile({
  entities,
  gaps = [],
  coverage = [],
}: {
  entities: readonly CloudflareEntity[];
  gaps?: readonly CloudflareGap[];
  coverage?: CloudflareKindFile["coverage"];
}): CloudflareKindFile {
  return {
    ...emptyCloudflareKindFile({ kind: "access-policy", updatedAt: STORED_AT }),
    coverage: [...coverage],
    entities: [...entities],
    gaps: [...gaps],
  };
}

/**
 * A permission-refused gap a previous run opened, stamped at the earlier timestamp.
 *
 * @returns the open gap
 */
export function storedPermissionGap({ scope }: { scope: string }): CloudflareGap {
  return openCloudflareGap({
    at: STORED_AT,
    condition: "permission-refused",
    kind: "access-policy",
    reason: "stored",
    scope,
  });
}

/**
 * One raw policy row as either endpoint returns it, with a shared include rule so every sighting agrees.
 *
 * @returns the raw row, carrying `precedence` and `reusable` only when given
 */
export function rawPolicy({
  id,
  precedence,
  reusable,
}: {
  id: string;
  precedence?: number;
  reusable?: true;
}): CloudflareRawAccessPolicy {
  return {
    ...INCLUDE,
    decision: "allow",
    id,
    name: id,
    ...(precedence === undefined ? {} : { precedence }),
    ...(reusable === undefined ? {} : { reusable }),
  };
}

/**
 * The identity-bearing view of a set of policy entities, ordered by provider id.
 *
 * @returns each entity's detail, last sighting, provider id and source
 */
export function entityView({
  entities,
}: {
  entities: readonly CloudflareEntity[];
}): readonly Pick<CloudflareEntity, "detail" | "lastSeenAt" | "providerId" | "source">[] {
  return entities
    .toSorted((left, right) => left.providerId.localeCompare(right.providerId))
    .map((entity) => ({
      detail: entity.detail,
      lastSeenAt: entity.lastSeenAt,
      providerId: entity.providerId,
      source: entity.source,
    }));
}

/**
 * The detail a reconciled policy is expected to carry, with the sorted referring ids derived from the bindings.
 *
 * @returns the expected `access-policy` detail
 */
export function policyDetail({
  policyId,
  reusable,
  bindings,
}: {
  policyId: string;
  reusable: boolean;
  bindings: readonly CloudflareAccessPolicyBinding[];
}): CloudflareAccessPolicyDetail {
  return {
    bindings,
    config: INCLUDE,
    decision: "allow",
    kind: "access-policy",
    name: policyId,
    referringApplicationIds: bindings.map((binding) => binding.applicationId),
    reusable,
  };
}

export const RECONCILE_SOURCE: CloudflareEntity["source"] = {
  channel: "rest-api",
  observedAt: AT,
  operation: "access-policies-reconcile",
};

/**
 * The gaps of a kind file still open.
 *
 * @returns only the gaps whose status is `open`
 */
export function openGapsOf({ file }: { file: CloudflareKindFile }): readonly CloudflareGap[] {
  return file.gaps.filter((gap) => gap.status === "open");
}

/**
 * Every gap as `{ condition, scope, status, lastCheckedAt }`, ordered by scope, for lifecycle assertions.
 *
 * @returns each gap's lifecycle fields, sorted by scope
 */
export function gapLifecycle({
  file,
}: {
  file: CloudflareKindFile;
}): readonly Pick<CloudflareGap, "condition" | "lastCheckedAt" | "scope" | "status">[] {
  return file.gaps
    .map((gap) => ({
      condition: gap.condition,
      lastCheckedAt: gap.lastCheckedAt,
      scope: gap.scope,
      status: gap.status,
    }))
    .toSorted((left, right) => left.scope.localeCompare(right.scope));
}

/**
 * The permission-refused gap this run is expected to open, first and last detected at `AT`.
 *
 * @returns the open gap, written out field by field
 */
export function expectedOpenGap({ scope, reason }: { scope: string; reason: string }): CloudflareGap {
  return {
    condition: "permission-refused",
    firstDetectedAt: AT,
    id: cloudflareGapId({ condition: "permission-refused", scope }),
    kind: "access-policy",
    lastCheckedAt: AT,
    lastDetectedAt: AT,
    reason,
    scope,
    status: "open",
  };
}
