/**
 * Three of the `api-gateway` subtypes that are ONE entity per zone rather than one per provider item: the
 * uploaded/learned `schema` collection the SDK types as bare `unknown[]`, the schema-validation `settings` and
 * the auth-ID `configuration`. Each carries a fixed `providerId` naming its subtype, since the zone itself is
 * the only identity it has. Extracted from `projection/apiGateway.ts`, which re-exports every projection here
 * so no caller's import changed; the per-item subtypes and the `discovery-schema` collection stay there.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import { cloudflareZoneEntityId } from "../identity.js";
import type { CloudflareEntity } from "../model.js";

/** The part of a `schemas.list` response its projection reads beyond its schema list. */
export interface CloudflareRawApiGatewaySchemaResponse {
  readonly timestamp?: string;
}

/** The raw shape `client.apiGateway.settings.schemaValidation.get()` returns. */
export interface CloudflareRawApiGatewaySettings {
  readonly validation_default_mitigation_action?: string;
  readonly validation_override_mitigation_action?: string | null;
}

/** The detail this atlas stores for each zone-singleton `api-gateway` subtype. */
type CloudflareApiGatewaySingletonDetail =
  | {
      readonly kind: "api-gateway";
      readonly subtype: "schema";
      readonly timestamp: string | null;
      readonly schema: Readonly<Record<string, unknown>>;
    }
  | {
      readonly kind: "api-gateway";
      readonly subtype: "settings";
      readonly validationDefaultMitigationAction: string | null;
      readonly validationOverrideMitigationAction: string | null;
    }
  | {
      readonly kind: "api-gateway";
      readonly subtype: "configuration";
      readonly authIdCharacteristics: readonly Readonly<Record<string, unknown>>[];
    };

/** Wrap one zone-singleton detail into its entity, keyed on the subtype as its fixed provider id. */
function singletonEntity({
  detail,
  operation,
  accountId,
  zoneId,
  at,
}: {
  detail: CloudflareApiGatewaySingletonDetail;
  operation: string;
  accountId: string;
  zoneId: string;
  at: string;
}): CloudflareEntity {
  const providerId = detail.subtype;
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareZoneEntityId({ components: { accountId, providerId }, kind: "api-gateway", zoneId }),
    kind: "api-gateway",
    lastSeenAt: at,
    providerId,
    scope: { accountId, parentId: null, zoneId },
    source: { channel: "rest-api", observedAt: at, operation },
    state: "observed",
  };
}

/**
 * Project the zone's uploaded/learned schema collection into a SINGLE `api-gateway` entity — the same
 * bare-`unknown[]` shape `projectCloudflareDiscoverySchemaCollection` (in `projection/apiGateway.ts`) handles.
 *
 * @param raw the response, read for its own timestamp
 * @param schemas every raw schema fragment the response returned
 * @param accountId the selected account id
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareSchemaCollection({
  raw,
  schemas,
  accountId,
  zoneId,
  at,
}: {
  raw: CloudflareRawApiGatewaySchemaResponse;
  schemas: readonly unknown[];
  accountId: string;
  zoneId: string;
  at: string;
}): CloudflareEntity {
  const detail: CloudflareApiGatewaySingletonDetail = {
    kind: "api-gateway",
    schema: { schemas },
    subtype: "schema",
    timestamp: unsetFieldAsNull({ key: "timestamp", record: raw }),
  };
  return singletonEntity({ accountId, at, detail, operation: "api-gateway-schemas-list", zoneId });
}

/**
 * Project the zone's schema-validation setting into a SINGLETON `api-gateway` entity.
 *
 * @param raw the setting as the SDK returned it
 * @param accountId the selected account id
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareApiGatewaySettings({
  raw,
  accountId,
  zoneId,
  at,
}: {
  raw: CloudflareRawApiGatewaySettings;
  accountId: string;
  zoneId: string;
  at: string;
}): CloudflareEntity {
  const detail: CloudflareApiGatewaySingletonDetail = {
    kind: "api-gateway",
    subtype: "settings",
    validationDefaultMitigationAction: unsetFieldAsNull({ key: "validation_default_mitigation_action", record: raw }),
    validationOverrideMitigationAction: unsetFieldAsNull({ key: "validation_override_mitigation_action", record: raw }),
  };
  return singletonEntity({
    accountId,
    at,
    detail,
    operation: "api-gateway-settings-schema-validation-get",
    zoneId,
  });
}

/**
 * Project the zone's API Shield auth-ID configuration into a SINGLETON `api-gateway` entity.
 *
 * @param authIdCharacteristics every configured auth-ID characteristic rule
 * @param accountId the selected account id
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareApiGatewayConfiguration({
  authIdCharacteristics,
  accountId,
  zoneId,
  at,
}: {
  authIdCharacteristics: readonly Readonly<Record<string, unknown>>[];
  accountId: string;
  zoneId: string;
  at: string;
}): CloudflareEntity {
  const detail: CloudflareApiGatewaySingletonDetail = {
    authIdCharacteristics,
    kind: "api-gateway",
    subtype: "configuration",
  };
  return singletonEntity({ accountId, at, detail, operation: "api-gateway-configurations-get", zoneId });
}
