/**
 * Pure projection from the SDK's `DevicePostureRule` DTO to this atlas's `device-posture-rule` entity.
 *
 * `input`/`match` vary per rule type (file/tanium/warp/…) and are kept as an open bucket — the same
 * "inherently open configuration" treatment `projection/access.ts` gives Access rule arrays. Neither field
 * carries a credential; a posture rule only ever describes what to check for, not a secret to check with.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import { cloudflareEntityId } from "../identity.js";
import type { CloudflareEntity } from "../model.js";

/** The stable fields the device-posture-rule DTO declares. */
export interface CloudflareDevicePostureRuleDto {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
  readonly type?: string;
  readonly expiration?: string;
  readonly schedule?: string;
  readonly input?: unknown;
  readonly match?: unknown;
}

/** The light-inventory detail this atlas stores for the `device-posture-rule` kind. */
interface CloudflareDevicePostureRuleDetail {
  readonly kind: "device-posture-rule";
  readonly name: string | null;
  readonly description: string | null;
  readonly type: string | null;
  readonly expiration: string | null;
  readonly schedule: string | null;
  readonly input: unknown;
  readonly match: unknown;
}

/**
 * Project one device posture rule into a `device-posture-rule` entity.
 *
 * @param rule the raw rule, already validated to carry a non-empty `id`
 * @param accountId the account this rule was read under
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareDevicePostureRule({
  rule,
  accountId,
  at,
}: {
  rule: CloudflareDevicePostureRuleDto;
  accountId: string;
  at: string;
}): CloudflareEntity {
  const detail: CloudflareDevicePostureRuleDetail = {
    description: unsetFieldAsNull({ key: "description", record: rule }),
    expiration: unsetFieldAsNull({ key: "expiration", record: rule }),
    input: unsetFieldAsNull({ key: "input", record: rule }),
    kind: "device-posture-rule",
    match: unsetFieldAsNull({ key: "match", record: rule }),
    name: unsetFieldAsNull({ key: "name", record: rule }),
    schedule: unsetFieldAsNull({ key: "schedule", record: rule }),
    type: unsetFieldAsNull({ key: "type", record: rule }),
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareEntityId({ components: { accountId, providerId: rule.id }, kind: "device-posture-rule" }),
    kind: "device-posture-rule",
    lastSeenAt: at,
    providerId: rule.id,
    scope: { accountId, parentId: null, zoneId: null },
    source: { channel: "rest-api", observedAt: at, operation: "device-posture-rules-list" },
    state: "observed",
  };
}
