/**
 * Pure projection for the `zone-setting` kind — the configured deep zone's complete settings collection
 * (`GET /zones/{zone_id}/settings`). Not wrapped by the pinned SDK version at all — it exposes only a
 * per-setting `get(settingID)`/`edit`, never the list endpoint the real REST API documents — so
 * `readers/zoneSetting.ts` reaches it via the base client's own `client.get()` escape hatch, the same
 * mechanism PR10 used for Audit Logs' Resource History endpoint. Confirmed live against a deep zone
 * before writing this: every setting is `{id, value, modified_on, editable}`, `value` varying from a
 * plain on/off string to a number to a nested object depending on which of the ~65 documented setting types
 * `id` names — kept as an open `unknown` field rather than modelled per type, since these are configuration
 * toggles, not secrets, and there is no shared shape to extract beyond the envelope itself.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import { cloudflareZoneEntityId } from "../identity.js";
import type { CloudflareEntity } from "../model.js";

/** The detail this atlas stores for the `zone-setting` kind. */
interface CloudflareZoneSettingDetail {
  readonly kind: "zone-setting";
  readonly value: unknown;
  readonly editable: boolean | null;
  readonly modifiedOn: string | null;
}

/** The raw shape one entry of `GET /zones/{zone_id}/settings`'s `result` array has. */
export interface CloudflareRawZoneSetting {
  readonly id: string;
  readonly value?: unknown;
  readonly editable?: boolean;
  readonly modified_on?: string | null;
}

/**
 * Project one raw zone setting into a `zone-setting` entity.
 *
 * @param raw the raw setting, already validated to carry a non-empty `id`
 * @param accountId the account the deep zone belongs to
 * @param zoneId the configured deep zone's id
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareZoneSetting({
  raw,
  accountId,
  zoneId,
  at,
}: {
  raw: CloudflareRawZoneSetting;
  accountId: string;
  zoneId: string;
  at: string;
}): CloudflareEntity {
  const detail: CloudflareZoneSettingDetail = {
    editable: unsetFieldAsNull({ key: "editable", record: raw }),
    kind: "zone-setting",
    modifiedOn: unsetFieldAsNull({ key: "modified_on", record: raw }),
    value: raw.value,
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareZoneEntityId({ components: { accountId, providerId: raw.id }, kind: "zone-setting", zoneId }),
    kind: "zone-setting",
    lastSeenAt: at,
    providerId: raw.id,
    scope: { accountId, parentId: null, zoneId },
    source: { channel: "rest-api", observedAt: at, operation: "zone-settings-list" },
    state: "observed",
  };
}
