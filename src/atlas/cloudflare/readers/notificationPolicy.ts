/**
 * The `notification-policy` reader: a flat, account-filtered collection of alerting policies, exhausted with
 * `for await` like every other flat kind — never a parent fan-out.
 */
import type Cloudflare from "cloudflare";

import { err, ok, type Result } from "../../../lib/result.js";
import { mapCloudflareError } from "../client.js";
import type { CloudflareClientError } from "../errors.js";
import type { CloudflareEntity } from "../model.js";
import { projectCloudflareNotificationPolicy } from "../projection/notificationPolicy.js";

/**
 * Read every notification policy under the selected account, exhausting pagination.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param at this run's ISO timestamp
 * @returns every policy's entity, or the reason the read failed
 */
export async function readCloudflareNotificationPolicies({
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
    for await (const policy of client.alerting.policies.list({ account_id: accountId })) {
      if (typeof policy.id !== "string" || policy.id.length === 0) {
        continue;
      }
      entities.push(projectCloudflareNotificationPolicy({ accountId, at, policy: { ...policy, id: policy.id } }));
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "notification-policies-list" }));
  }
  return ok(entities);
}
