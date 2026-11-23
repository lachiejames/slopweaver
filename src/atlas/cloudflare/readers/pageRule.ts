/**
 * The `page-rule` reader: the configured deep zone's Page Rules. A single call returns the whole array —
 * `client.pageRules.list()` is a plain `APIPromise<PageRule[]>`, not a paginated response.
 */
import type Cloudflare from "cloudflare";

import { err, ok, type Result } from "../../../lib/result.js";
import { mapCloudflareError } from "../client.js";
import type { CloudflareClientError } from "../errors.js";
import type { CloudflareEntity } from "../model.js";
import { projectCloudflarePageRule } from "../projection/pageRule.js";

/**
 * Read the configured deep zone's Page Rules.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param zoneId the configured deep zone's id
 * @param at this run's ISO timestamp
 * @returns every Page Rule's entity, or the reason the read failed
 */
export async function readCloudflarePageRules({
  client,
  accountId,
  zoneId,
  at,
}: {
  client: Cloudflare;
  accountId: string;
  zoneId: string;
  at: string;
}): Promise<Result<readonly CloudflareEntity[], CloudflareClientError>> {
  try {
    const rules = await client.pageRules.list({ zone_id: zoneId });
    const entities: CloudflareEntity[] = [];
    for (const rule of rules) {
      if (typeof rule.id !== "string" || rule.id.length === 0) {
        continue;
      }
      entities.push(projectCloudflarePageRule({ accountId, at, raw: { ...rule, id: rule.id }, zoneId }));
    }
    return ok(entities);
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "page-rules-list" }));
  }
}
