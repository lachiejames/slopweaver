/**
 * The `worker-route` reader: Worker routes attached to the configured deep zone. `SinglePage` — one
 * response, no cursor.
 */
import type Cloudflare from "cloudflare";

import { err, ok, type Result } from "../../../lib/result.js";
import { mapCloudflareError } from "../client.js";
import type { CloudflareClientError } from "../errors.js";
import type { CloudflareEntity } from "../model.js";
import { projectCloudflareWorkerRoute } from "../projection/workerRoute.js";

/**
 * Read every Worker route attached to the configured deep zone.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param zoneId the configured deep zone's id
 * @param at this run's ISO timestamp
 * @returns every route's entity, or the reason the read failed
 */
export async function readCloudflareWorkerRoutes({
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
  const entities: CloudflareEntity[] = [];
  try {
    for await (const route of client.workers.routes.list({ zone_id: zoneId })) {
      if (typeof route.id !== "string" || route.id.length === 0) {
        continue;
      }
      entities.push(projectCloudflareWorkerRoute({ accountId, at, raw: { ...route, id: route.id }, zoneId }));
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "workers-routes-list" }));
  }
  return ok(entities);
}
