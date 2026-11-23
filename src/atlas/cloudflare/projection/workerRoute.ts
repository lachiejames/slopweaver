/**
 * Pure projection for the `worker-route` kind — Worker routes attached to the configured deep zone
 * (`client.workers.routes.list`). Trivially flat — `{id, pattern, script}`, no open bucket needed, no secret
 * material.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import { cloudflareZoneEntityId } from "../identity.js";
import type { CloudflareEntity } from "../model.js";

/** The detail this atlas stores for the `worker-route` kind. */
interface CloudflareWorkerRouteDetail {
  readonly kind: "worker-route";
  readonly pattern: string | null;
  readonly script: string | null;
}

/** The raw shape `client.workers.routes.list()` returns for one route. */
export interface CloudflareRawWorkerRoute {
  readonly id: string;
  readonly pattern?: string;
  readonly script?: string;
}

/**
 * Project one raw Worker route into a `worker-route` entity.
 *
 * @param raw the raw route, already validated to carry a non-empty `id`
 * @param accountId the account the deep zone belongs to
 * @param zoneId the configured deep zone's id
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareWorkerRoute({
  raw,
  accountId,
  zoneId,
  at,
}: {
  raw: CloudflareRawWorkerRoute;
  accountId: string;
  zoneId: string;
  at: string;
}): CloudflareEntity {
  const detail: CloudflareWorkerRouteDetail = {
    kind: "worker-route",
    pattern: unsetFieldAsNull({ key: "pattern", record: raw }),
    script: unsetFieldAsNull({ key: "script", record: raw }),
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareZoneEntityId({ components: { accountId, providerId: raw.id }, kind: "worker-route", zoneId }),
    kind: "worker-route",
    lastSeenAt: at,
    providerId: raw.id,
    scope: { accountId, parentId: null, zoneId },
    source: { channel: "rest-api", observedAt: at, operation: "workers-routes-list" },
    state: "observed",
  };
}
