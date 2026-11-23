/**
 * The `device-posture-rule` reader: one account-filtered collection. The SDK exposes this endpoint as a
 * single, non-paginated page (`SinglePage`, not `V4PagePaginationArray`) — `for await` still exhausts it
 * correctly either way, so the read is written the same as every other flat reader.
 */
import type Cloudflare from "cloudflare";

import { err, ok, type Result } from "../../../lib/result.js";
import { mapCloudflareError } from "../client.js";
import { type CloudflareClientError, CloudflareClientErrors } from "../errors.js";
import type { CloudflareEntity } from "../model.js";
import { projectCloudflareDevicePostureRule } from "../projection/devicePosture.js";

/**
 * Read every device posture rule under the selected account.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param at this run's ISO timestamp
 * @returns every rule's entity, or the reason the read failed
 */
export async function readCloudflareDevicePostureRules({
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
    for await (const rule of client.zeroTrust.devices.posture.list({ account_id: accountId })) {
      if (typeof rule.id !== "string" || rule.id.length === 0) {
        return err(
          CloudflareClientErrors.schema({
            cause: "a device posture rule had no id in the response",
            operation: "device-posture-rules-list",
          }),
        );
      }
      entities.push(projectCloudflareDevicePostureRule({ accountId, at, rule: { ...rule, id: rule.id } }));
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "device-posture-rules-list" }));
  }
  return ok(entities);
}
