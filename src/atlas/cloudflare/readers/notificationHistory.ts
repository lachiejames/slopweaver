/**
 * The `notification-history` reader: a flat, account-filtered collection of every dispatched-notification
 * record the plan retains, exhausted with `for await` — the SDK's `V4PagePaginationArray` handles the
 * cursor, same mechanism every other cursor-paginated reader in this atlas already relies on. No `since`/
 * `before` narrowing is applied, matching the plan's own "every page the plan makes available" framing.
 */
import type Cloudflare from "cloudflare";

import { err, ok, type Result } from "../../../lib/result.js";
import { mapCloudflareError } from "../client.js";
import type { CloudflareClientError } from "../errors.js";
import type { CloudflareEntity } from "../model.js";
import { projectCloudflareNotificationHistory } from "../projection/notificationHistory.js";

/**
 * Read every notification-history record the account's plan retains, exhausting pagination.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param at this run's ISO timestamp
 * @returns every history record's entity, or the reason the read failed
 */
export async function readCloudflareNotificationHistory({
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
    for await (const record of client.alerting.history.list({ account_id: accountId })) {
      if (typeof record.id !== "string" || record.id.length === 0) {
        continue;
      }
      entities.push(projectCloudflareNotificationHistory({ accountId, at, record: { ...record, id: record.id } }));
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "notification-history-list" }));
  }
  return ok(entities);
}
