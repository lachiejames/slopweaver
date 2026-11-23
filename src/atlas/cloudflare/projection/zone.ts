/**
 * Pure projection from the SDK's `Zone` DTO to this atlas's light zone-inventory entity.
 *
 * Only the fields `inventory.ts` actually names for `zone` — id/name/status/plan — survive; everything else
 * the SDK returns for a zone (name servers, owner, tenant, DNSSEC status, …) belongs to a future, deeper pass
 * over the configured deep zone specifically, or is out of scope entirely. No SDK response type is exported
 * from `model.ts` or treated as the disk contract — see that file's header — so this is the one place a raw
 * `Zone` shape is ever named.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import { cloudflareEntityId } from "../identity.js";
import type { CloudflareEntity } from "../model.js";

/** The light-inventory detail this atlas stores for the `zone` kind. */
interface CloudflareZoneDetail {
  readonly kind: "zone";
  readonly name: string;
  readonly status: string | null;
  readonly paused: boolean | null;
  readonly type: string | null;
  readonly planName: string | null;
}

/** The subset of the SDK's `Zone` shape this projection reads — narrowed so a plain fake is easy to build. */
export interface CloudflareZoneDto {
  readonly id: string;
  readonly name: string;
  readonly status?: string;
  readonly paused?: boolean;
  readonly type?: string;
  readonly plan?: { readonly name?: string };
}

/**
 * Project one SDK zone into a light-inventory `zone` entity.
 *
 * @param zone the raw zone, already validated to carry a non-empty `id`
 * @param accountId the account this zone was read under — the query's own scope, not the response's
 * @param at this run's ISO timestamp, stamped as both `firstSeenAt` and `lastSeenAt` (merge overwrites
 *   `firstSeenAt` from any prior generation)
 * @returns the projected entity
 */
export function projectCloudflareZone({
  zone,
  accountId,
  at,
}: {
  zone: CloudflareZoneDto;
  accountId: string;
  at: string;
}): CloudflareEntity {
  const detail: CloudflareZoneDetail = {
    kind: "zone",
    name: zone.name,
    paused: unsetFieldAsNull({ key: "paused", record: zone }),
    planName: unsetFieldAsNull({ key: "name", record: zone.plan }),
    status: unsetFieldAsNull({ key: "status", record: zone }),
    type: unsetFieldAsNull({ key: "type", record: zone }),
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareEntityId({ components: { accountId, providerId: zone.id }, kind: "zone" }),
    kind: "zone",
    lastSeenAt: at,
    providerId: zone.id,
    scope: { accountId, parentId: null, zoneId: zone.id },
    source: { channel: "rest-api", observedAt: at, operation: "zones-list" },
    state: "observed",
  };
}
