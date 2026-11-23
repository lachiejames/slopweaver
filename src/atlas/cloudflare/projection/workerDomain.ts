/**
 * Pure projection for the `worker-domain` kind — account-level custom domains routed to a Worker. A flat,
 * account-filtered collection (`client.workers.domains.list`), never a parent fan-out — each domain already
 * names the zone and Worker it routes to as ordinary fields.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import { cloudflareEntityId } from "../identity.js";
import type { CloudflareEntity } from "../model.js";

/** The detail this atlas stores for the `worker-domain` kind. */
interface CloudflareWorkerDomainDetail {
  readonly kind: "worker-domain";
  readonly hostname: string;
  readonly service: string | null;
  readonly certificateId: string | null;
  readonly zoneId: string | null;
  readonly zoneName: string | null;
}

/** The subset of the SDK's Workers-domain shape this projection reads. */
export interface CloudflareRawWorkerDomain {
  readonly id: string;
  readonly hostname: string;
  readonly service?: string;
  readonly cert_id?: string;
  readonly zone_id?: string;
  readonly zone_name?: string;
}

/**
 * Project one raw Workers domain into a `worker-domain` entity.
 *
 * @param domain the raw domain, already validated to carry a non-empty `id`
 * @param accountId the account this domain was read under
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareWorkerDomain({
  domain,
  accountId,
  at,
}: {
  domain: CloudflareRawWorkerDomain;
  accountId: string;
  at: string;
}): CloudflareEntity {
  const zoneId = unsetFieldAsNull({ key: "zone_id", record: domain });
  const detail: CloudflareWorkerDomainDetail = {
    certificateId: unsetFieldAsNull({ key: "cert_id", record: domain }),
    hostname: domain.hostname,
    kind: "worker-domain",
    service: unsetFieldAsNull({ key: "service", record: domain }),
    zoneId,
    zoneName: unsetFieldAsNull({ key: "zone_name", record: domain }),
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareEntityId({ components: { accountId, providerId: domain.id }, kind: "worker-domain" }),
    kind: "worker-domain",
    lastSeenAt: at,
    providerId: domain.id,
    scope: { accountId, parentId: null, zoneId },
    source: { channel: "rest-api", observedAt: at, operation: "workers-domains-list" },
    state: "observed",
  };
}
