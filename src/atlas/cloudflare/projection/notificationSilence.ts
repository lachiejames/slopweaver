/**
 * Pure projection for the `notification-silence` kind — account-level alerting silences
 * (`client.alerting.silences.list`). A flat, account-filtered collection, never a parent fan-out.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import { cloudflareEntityId } from "../identity.js";
import type { CloudflareEntity } from "../model.js";

/** The detail this atlas stores for the `notification-silence` kind. */
interface CloudflareNotificationSilenceDetail {
  readonly kind: "notification-silence";
  readonly policyId: string | null;
  readonly startTime: string | null;
  readonly endTime: string | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
}

/** The subset of the SDK's `SilenceListResponse` shape this projection reads. */
export interface CloudflareRawNotificationSilence {
  readonly id: string;
  readonly policy_id?: string;
  readonly start_time?: string;
  readonly end_time?: string;
  readonly created_at?: string;
  readonly updated_at?: string;
}

/**
 * Project one raw silence into a `notification-silence` entity.
 *
 * @param silence the raw silence, already validated to carry a non-empty `id`
 * @param accountId the account this silence was read under
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareNotificationSilence({
  silence,
  accountId,
  at,
}: {
  silence: CloudflareRawNotificationSilence;
  accountId: string;
  at: string;
}): CloudflareEntity {
  const detail: CloudflareNotificationSilenceDetail = {
    createdAt: unsetFieldAsNull({ key: "created_at", record: silence }),
    endTime: unsetFieldAsNull({ key: "end_time", record: silence }),
    kind: "notification-silence",
    policyId: unsetFieldAsNull({ key: "policy_id", record: silence }),
    startTime: unsetFieldAsNull({ key: "start_time", record: silence }),
    updatedAt: unsetFieldAsNull({ key: "updated_at", record: silence }),
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareEntityId({ components: { accountId, providerId: silence.id }, kind: "notification-silence" }),
    kind: "notification-silence",
    lastSeenAt: at,
    providerId: silence.id,
    scope: { accountId, parentId: null, zoneId: null },
    source: { channel: "rest-api", observedAt: at, operation: "notification-silences-list" },
    state: "observed",
  };
}
