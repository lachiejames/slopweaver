/**
 * The `worker-domain` reader: a flat, account-filtered collection of custom domains routed to a Worker,
 * exhausted with `for await` like every other flat kind — never a parent fan-out.
 */
import type Cloudflare from "cloudflare";

import { err, ok, type Result } from "../../../lib/result.js";
import { mapCloudflareError } from "../client.js";
import type { CloudflareClientError } from "../errors.js";
import type { CloudflareEntity } from "../model.js";
import { projectCloudflareWorkerDomain } from "../projection/workerDomain.js";

/**
 * Read every Workers custom domain under the selected account, exhausting pagination.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param at this run's ISO timestamp
 * @returns every domain's light-inventory entity, or the reason the read failed
 */
export async function readCloudflareWorkerDomains({
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
    for await (const domain of client.workers.domains.list({ account_id: accountId })) {
      if (typeof domain.id !== "string" || domain.id.length === 0) {
        continue;
      }
      entities.push(projectCloudflareWorkerDomain({ accountId, at, domain: { ...domain, id: domain.id } }));
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "workers-domains-list" }));
  }
  return ok(entities);
}
