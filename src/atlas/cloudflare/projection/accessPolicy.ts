/**
 * The `access-policy` entity shape and its one-policy projection.
 *
 * One `access-policy` entity is keyed by account + policy id (never per-application) — a reusable policy
 * attached to several applications is ONE entity carrying every referring application id, never one row
 * per application. See
 * `readers/accessPolicy.ts`'s header for the live-measured reasoning behind treating `precedence` as an
 * app-local binding rather than part of the policy's own canonical body.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import { isRecord } from "../../../lib/parsers.js";
import { cloudflareEntityId } from "../identity.js";
import type { CloudflareEntity } from "../model.js";

/** The raw shape either policy-list endpoint returns. `precedence` only ever appears on a per-app read;
 * `app_count`/`reusable` only ever appear on the account-level reusable-list read. */
export interface CloudflareRawAccessPolicy {
  readonly id: string;
  readonly name?: string;
  readonly decision?: string;
  readonly precedence?: number;
  readonly app_count?: number;
  readonly reusable?: true;
  readonly [key: string]: unknown;
}

/** One application's binding to a policy — just the part of the relationship that is genuinely per-app. */
export interface CloudflareAccessPolicyBinding {
  readonly applicationId: string;
  readonly precedence: number | null;
}

/** The light-inventory detail this atlas stores for the `access-policy` kind. */
export interface CloudflareAccessPolicyDetail {
  readonly kind: "access-policy";
  readonly name: string | null;
  readonly decision: string | null;
  /** Whether this policy has ever appeared in the account-level reusable-policy list. */
  readonly reusable: boolean;
  /** Sorted, unique — derived from `bindings`, kept alongside it because it is the field most callers want. */
  readonly referringApplicationIds: readonly string[];
  /** Sorted by `applicationId`. */
  readonly bindings: readonly CloudflareAccessPolicyBinding[];
  readonly config: Readonly<Record<string, unknown>>;
}

/** The policy's own fields, with every app-binding-specific or list-context field removed. */
export interface CloudflareAccessPolicyBody {
  readonly name: string | null;
  readonly decision: string | null;
  readonly config: Readonly<Record<string, unknown>>;
}

/**
 * Narrow a stored entity's `detail` — deliberately `unknown` on disk, per `model.ts`'s own header — into
 * this domain's shape. The only consumer is `accessPolicyReconcile.ts` seeding from what this projection
 * itself wrote, so a value failing this guard means the kind file was corrupted or hand-edited outside the
 * atlas, not a case this domain otherwise expects to hit.
 *
 * @param value the entity's `detail` field, read back from disk
 * @returns true when `value` is a genuine `CloudflareAccessPolicyDetail`
 */
export function isCloudflareAccessPolicyDetail(value: unknown): value is CloudflareAccessPolicyDetail {
  return (
    isRecord(value) &&
    value["kind"] === "access-policy" &&
    (value["name"] === null || typeof value["name"] === "string") &&
    (value["decision"] === null || typeof value["decision"] === "string") &&
    typeof value["reusable"] === "boolean" &&
    Array.isArray(value["referringApplicationIds"]) &&
    Array.isArray(value["bindings"]) &&
    isRecord(value["config"])
  );
}

/**
 * Extract one policy's canonical body from a raw sighting — whichever endpoint it came from.
 *
 * @param raw the raw policy row
 * @returns the canonical body, with `id`/`precedence`/`app_count`/`reusable` stripped
 */
export function extractCloudflareAccessPolicyBody({
  raw,
}: {
  raw: CloudflareRawAccessPolicy;
}): CloudflareAccessPolicyBody {
  const {
    id: _id,
    name: _name,
    decision: _decision,
    precedence: _precedence,
    app_count: _appCount,
    reusable: _reusable,
    ...config
  } = raw;
  return {
    config,
    decision: unsetFieldAsNull({ key: "decision", record: raw }),
    name: unsetFieldAsNull({ key: "name", record: raw }),
  };
}

/**
 * Project one reconciled policy into an `access-policy` entity.
 *
 * @param policyId the policy's provider id
 * @param body the policy's canonical body
 * @param reusable whether this policy has ever appeared in the account-level reusable-policy list
 * @param bindings this policy's current application bindings
 * @param accountId the account this policy was read under
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareAccessPolicy({
  policyId,
  body,
  reusable,
  bindings,
  accountId,
  at,
}: {
  policyId: string;
  body: CloudflareAccessPolicyBody;
  reusable: boolean;
  bindings: readonly CloudflareAccessPolicyBinding[];
  accountId: string;
  at: string;
}): CloudflareEntity {
  const sortedBindings = [...bindings].toSorted((left, right) => left.applicationId.localeCompare(right.applicationId));
  const detail: CloudflareAccessPolicyDetail = {
    bindings: sortedBindings,
    config: body.config,
    decision: body.decision,
    kind: "access-policy",
    name: body.name,
    referringApplicationIds: sortedBindings.map((binding) => binding.applicationId),
    reusable,
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareEntityId({ components: { accountId, providerId: policyId }, kind: "access-policy" }),
    kind: "access-policy",
    lastSeenAt: at,
    providerId: policyId,
    scope: { accountId, parentId: null, zoneId: null },
    source: { channel: "rest-api", observedAt: at, operation: "access-policies-reconcile" },
    state: "observed",
  };
}
