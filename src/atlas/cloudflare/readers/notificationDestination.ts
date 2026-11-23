/**
 * The `notification-destination` reader: combines TWO flat, account-filtered SDK reads
 * (`alerting.destinations.webhooks.list` and `alerting.destinations.pagerduty.get`) into one kind's entity
 * list. Both reads run concurrently; either failing fails the whole kind, same as any other flat read —
 * there is no partial-success concept here since neither collection depends on the other.
 */
import type Cloudflare from "cloudflare";

import { err, ok, type Result } from "../../../lib/result.js";
import { mapCloudflareError } from "../client.js";
import type { CloudflareClientError } from "../errors.js";
import type { CloudflareEntity } from "../model.js";
import {
  projectCloudflareNotificationPagerduty,
  projectCloudflareNotificationWebhook,
} from "../projection/notificationDestination.js";

/**
 * Read every notification destination (webhook and PagerDuty) under the selected account.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param at this run's ISO timestamp
 * @returns every destination's entity, or the reason the read failed
 */
export async function readCloudflareNotificationDestinations({
  client,
  accountId,
  at,
}: {
  client: Cloudflare;
  accountId: string;
  at: string;
}): Promise<Result<readonly CloudflareEntity[], CloudflareClientError>> {
  const entities: CloudflareEntity[] = [];
  try {
    for await (const webhook of client.alerting.destinations.webhooks.list({ account_id: accountId })) {
      if (typeof webhook.id !== "string" || webhook.id.length === 0) {
        continue;
      }
      entities.push(
        projectCloudflareNotificationWebhook({
          accountId,
          at,
          webhook: {
            created_at: webhook.created_at,
            id: webhook.id,
            last_failure: webhook.last_failure,
            last_success: webhook.last_success,
            name: webhook.name,
            type: webhook.type,
            url: webhook.url,
          },
        }),
      );
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "notification-destinations-webhooks-list" }));
  }
  try {
    for await (const pagerduty of client.alerting.destinations.pagerduty.get({ account_id: accountId })) {
      if (typeof pagerduty.id !== "string" || pagerduty.id.length === 0) {
        continue;
      }
      entities.push(
        projectCloudflareNotificationPagerduty({ accountId, at, pagerduty: { ...pagerduty, id: pagerduty.id } }),
      );
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "notification-destinations-pagerduty-list" }));
  }
  return ok(entities);
}
