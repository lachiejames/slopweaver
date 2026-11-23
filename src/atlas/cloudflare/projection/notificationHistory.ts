/**
 * Pure projection for the `notification-history` kind — every dispatched-notification record the account's
 * plan retains (`client.alerting.history.list`, cursor-exhausted `V4PagePaginationArray`; retention is
 * plan-bound — 30 days on free/pro/business, 90 on enterprise — and this atlas never narrows it further with
 * `since`/`before`, matching the plan's own "every page the plan makes available" framing). A flat,
 * account-filtered collection, never a parent fan-out. `alertBody` is the actual message Cloudflare sent, not
 * credential material, so it is stored as ordinary entity detail with no redaction.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import { cloudflareEntityId } from "../identity.js";
import type { CloudflareEntity } from "../model.js";

/** The detail this atlas stores for the `notification-history` kind. */
interface CloudflareNotificationHistoryDetail {
  readonly kind: "notification-history";
  readonly alertType: string | null;
  readonly alertBody: string | null;
  readonly description: string | null;
  readonly mechanism: string | null;
  readonly mechanismType: string | null;
  readonly name: string | null;
  readonly policyId: string | null;
  readonly sent: string | null;
}

/** The subset of the SDK's `History` shape this projection reads. */
export interface CloudflareRawNotificationHistory {
  readonly id: string;
  readonly alert_type?: string;
  readonly alert_body?: string;
  readonly description?: string;
  readonly mechanism?: string;
  readonly mechanism_type?: string;
  readonly name?: string;
  readonly policy_id?: string;
  readonly sent?: string;
}

/**
 * Project one raw history record into a `notification-history` entity.
 *
 * @param record the raw history record, already validated to carry a non-empty `id`
 * @param accountId the account this record was read under
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareNotificationHistory({
  record,
  accountId,
  at,
}: {
  record: CloudflareRawNotificationHistory;
  accountId: string;
  at: string;
}): CloudflareEntity {
  const detail: CloudflareNotificationHistoryDetail = {
    alertBody: unsetFieldAsNull({ key: "alert_body", record }),
    alertType: unsetFieldAsNull({ key: "alert_type", record }),
    description: unsetFieldAsNull({ key: "description", record }),
    kind: "notification-history",
    mechanism: unsetFieldAsNull({ key: "mechanism", record }),
    mechanismType: unsetFieldAsNull({ key: "mechanism_type", record }),
    name: unsetFieldAsNull({ key: "name", record }),
    policyId: unsetFieldAsNull({ key: "policy_id", record }),
    sent: unsetFieldAsNull({ key: "sent", record }),
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareEntityId({ components: { accountId, providerId: record.id }, kind: "notification-history" }),
    kind: "notification-history",
    lastSeenAt: at,
    providerId: record.id,
    scope: { accountId, parentId: null, zoneId: null },
    source: { channel: "rest-api", observedAt: at, operation: "notification-history-list" },
    state: "observed",
  };
}
