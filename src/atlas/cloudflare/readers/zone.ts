/**
 * The `zone` kind's reader: light inventory for every zone under the selected account.
 *
 * Not a parent fan-out — one account-filtered, SDK-paginated collection, exhausted with `for await`. Every
 * zone is inventoried lightly here, including the configured deep zone; its own deep reads (DNS, settings,
 * firewall, …) are a later PR's reader entirely, per `inventory.ts`.
 */
import type Cloudflare from "cloudflare";

import { err, ok, type Result } from "../../../lib/result.js";
import { mapCloudflareError } from "../client.js";
import type { CloudflareClientError } from "../errors.js";
import { CloudflareClientErrors } from "../errors.js";
import type { CloudflareEntity } from "../model.js";
import { projectCloudflareZone } from "../projection/zone.js";

/**
 * Read every zone under the selected account, exhausting pagination.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param at this run's ISO timestamp
 * @returns every zone's light-inventory entity, or the reason the read failed
 */
export async function readCloudflareZones({
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
    for await (const zone of client.zones.list({ account: { id: accountId } })) {
      if (typeof zone.id !== "string" || zone.id.length === 0) {
        return err(
          CloudflareClientErrors.schema({
            cause: `a zone named "${zone.name}" had no id in the response`,
            operation: "zones-list",
          }),
        );
      }
      entities.push(projectCloudflareZone({ accountId, at, zone }));
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "zones-list" }));
  }
  return ok(entities);
}
