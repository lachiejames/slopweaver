/**
 * The `notification-silence` reader: a flat, account-filtered collection of alerting silences, exhausted with
 * `for await` like every other flat kind — never a parent fan-out.
 */
import type Cloudflare from "cloudflare";

import { err, ok, type Result } from "../../../lib/result.js";
import { mapCloudflareError } from "../client.js";
import type { CloudflareClientError } from "../errors.js";
import type { CloudflareEntity } from "../model.js";
import { projectCloudflareNotificationSilence } from "../projection/notificationSilence.js";

/**
 * Read every notification silence under the selected account, exhausting pagination.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param at this run's ISO timestamp
 * @returns every silence's entity, or the reason the read failed
 */
export async function readCloudflareNotificationSilences({
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
    for await (const silence of client.alerting.silences.list({ account_id: accountId })) {
      if (typeof silence.id !== "string" || silence.id.length === 0) {
        continue;
      }
      entities.push(projectCloudflareNotificationSilence({ accountId, at, silence: { ...silence, id: silence.id } }));
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "notification-silences-list" }));
  }
  return ok(entities);
}
