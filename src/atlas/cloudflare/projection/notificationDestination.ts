/**
 * Pure projection for the `notification-destination` kind — one flat, account-filtered collection combining
 * TWO independent SDK reads the plan treats as a single kind: `client.alerting.destinations.webhooks.list`
 * and `client.alerting.destinations.pagerduty.get` (itself a list despite the method name). Neither response
 * type exposes secret material: a webhook's `secret` is write-only (accepted on create/update, never
 * returned), and a PagerDuty destination carries only `id`/`name`. `providerId` is prefixed with the
 * mechanism type because webhook ids and PagerDuty ids are drawn from different ID spaces and could
 * otherwise collide inside this one kind.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import { cloudflareEntityId } from "../identity.js";
import type { CloudflareEntity } from "../model.js";

/** The detail this atlas stores for the `notification-destination` kind. */
type CloudflareNotificationDestinationDetail =
  | {
      readonly kind: "notification-destination";
      readonly mechanismType: "webhook";
      readonly name: string | null;
      readonly type: string | null;
      readonly url: string | null;
      readonly createdAt: string | null;
      readonly lastFailure: string | null;
      readonly lastSuccess: string | null;
    }
  | {
      readonly kind: "notification-destination";
      readonly mechanismType: "pagerduty";
      readonly name: string | null;
    };

/** The subset of the SDK's `Webhooks` shape this projection reads. */
export interface CloudflareRawNotificationWebhook {
  readonly id: string;
  readonly name?: string | undefined;
  readonly type?: string | undefined;
  readonly url?: string | undefined;
  readonly created_at?: string | undefined;
  readonly last_failure?: string | undefined;
  readonly last_success?: string | undefined;
}

/** The subset of the SDK's `Pagerduty` shape this projection reads. */
export interface CloudflareRawNotificationPagerduty {
  readonly id: string;
  readonly name?: string;
}

/**
 * Project one raw webhook destination into a `notification-destination` entity.
 *
 * @param webhook the raw webhook, already validated to carry a non-empty `id`
 * @param accountId the account this webhook was read under
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareNotificationWebhook({
  webhook,
  accountId,
  at,
}: {
  webhook: CloudflareRawNotificationWebhook;
  accountId: string;
  at: string;
}): CloudflareEntity {
  const providerId = `webhook:${webhook.id}`;
  const detail: CloudflareNotificationDestinationDetail = {
    createdAt: unsetFieldAsNull({ key: "created_at", record: webhook }),
    kind: "notification-destination",
    lastFailure: unsetFieldAsNull({ key: "last_failure", record: webhook }),
    lastSuccess: unsetFieldAsNull({ key: "last_success", record: webhook }),
    mechanismType: "webhook",
    name: unsetFieldAsNull({ key: "name", record: webhook }),
    type: unsetFieldAsNull({ key: "type", record: webhook }),
    url: unsetFieldAsNull({ key: "url", record: webhook }),
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareEntityId({ components: { accountId, providerId }, kind: "notification-destination" }),
    kind: "notification-destination",
    lastSeenAt: at,
    providerId,
    scope: { accountId, parentId: null, zoneId: null },
    source: { channel: "rest-api", observedAt: at, operation: "notification-destinations-webhooks-list" },
    state: "observed",
  };
}

/**
 * Project one raw PagerDuty destination into a `notification-destination` entity.
 *
 * @param pagerduty the raw PagerDuty service, already validated to carry a non-empty `id`
 * @param accountId the account this destination was read under
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareNotificationPagerduty({
  pagerduty,
  accountId,
  at,
}: {
  pagerduty: CloudflareRawNotificationPagerduty;
  accountId: string;
  at: string;
}): CloudflareEntity {
  const providerId = `pagerduty:${pagerduty.id}`;
  const detail: CloudflareNotificationDestinationDetail = {
    kind: "notification-destination",
    mechanismType: "pagerduty",
    name: unsetFieldAsNull({ key: "name", record: pagerduty }),
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareEntityId({ components: { accountId, providerId }, kind: "notification-destination" }),
    kind: "notification-destination",
    lastSeenAt: at,
    providerId,
    scope: { accountId, parentId: null, zoneId: null },
    source: { channel: "rest-api", observedAt: at, operation: "notification-destinations-pagerduty-list" },
    state: "observed",
  };
}
