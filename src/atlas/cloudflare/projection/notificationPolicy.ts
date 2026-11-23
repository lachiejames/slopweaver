/**
 * Pure projection for the `notification-policy` kind — account-level alerting policies
 * (`client.alerting.policies.list`). A flat, account-filtered collection, never a parent fan-out. `mechanisms`
 * and `filters` are kept as open buckets rather than hand-modelled: `mechanisms` only ever carries IDs (email
 * addresses, or UUIDs referring to a `notification-destination` entity), and `filters`' shape depends entirely
 * on `alertType` (over 70 variants in the SDK's own union) — neither carries secret material.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import { isRecord } from "../../../lib/parsers.js";
import { cloudflareEntityId } from "../identity.js";
import type { CloudflareEntity } from "../model.js";

/** The detail this atlas stores for the `notification-policy` kind. */
interface CloudflareNotificationPolicyDetail {
  readonly kind: "notification-policy";
  readonly name: string;
  readonly alertType: string | null;
  readonly enabled: boolean | null;
  readonly description: string | null;
  readonly alertInterval: string | null;
  readonly mechanisms: Record<string, unknown> | null;
  readonly filters: Record<string, unknown> | null;
  readonly created: string | null;
  readonly modified: string | null;
}

/** The subset of the SDK's `Policy` shape this projection reads. */
export interface CloudflareRawNotificationPolicy {
  readonly id: string;
  readonly name?: string;
  readonly alert_type?: string;
  readonly enabled?: boolean;
  readonly description?: string;
  readonly alert_interval?: string;
  readonly mechanisms?: unknown;
  readonly filters?: unknown;
  readonly created?: string;
  readonly modified?: string;
}

/**
 * Project one raw notification policy into a `notification-policy` entity.
 *
 * @param policy the raw policy, already validated to carry a non-empty `id`
 * @param accountId the account this policy was read under
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareNotificationPolicy({
  policy,
  accountId,
  at,
}: {
  policy: CloudflareRawNotificationPolicy;
  accountId: string;
  at: string;
}): CloudflareEntity {
  const detail: CloudflareNotificationPolicyDetail = {
    alertInterval: unsetFieldAsNull({ key: "alert_interval", record: policy }),
    alertType: unsetFieldAsNull({ key: "alert_type", record: policy }),
    created: unsetFieldAsNull({ key: "created", record: policy }),
    description: unsetFieldAsNull({ key: "description", record: policy }),
    enabled: unsetFieldAsNull({ key: "enabled", record: policy }),
    filters: isRecord(policy.filters) ? { ...policy.filters } : null,
    kind: "notification-policy",
    mechanisms: isRecord(policy.mechanisms) ? { ...policy.mechanisms } : null,
    modified: unsetFieldAsNull({ key: "modified", record: policy }),
    // oxlint-disable-next-line prefer-nullish-coalescing -- house-rules bans `?? ""`; this ternary is the honest form
    name: policy.name === undefined ? "" : policy.name,
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareEntityId({ components: { accountId, providerId: policy.id }, kind: "notification-policy" }),
    kind: "notification-policy",
    lastSeenAt: at,
    providerId: policy.id,
    scope: { accountId, parentId: null, zoneId: null },
    source: { channel: "rest-api", observedAt: at, operation: "notification-policies-list" },
    state: "observed",
  };
}
