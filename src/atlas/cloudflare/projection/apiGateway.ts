/**
 * Pure projection for the `api-gateway` kind — EIGHT independent, deep-zone-scoped API Gateway surfaces
 * folded into one kind, each entity tagged by which surface produced it (`subtype`), the same "N independent
 * collections, per-subtype partial credit" shape `projection/firewallService.ts`/`projection/zoneCertificate.ts`
 * established. Although the token's permission for these surfaces is granted at account level, every SDK
 * method is itself zone-addressed (`zone_id`, never `account_id`) — confirmed by reading the compiled SDK
 * source rather than assumed from the plan's own wording.
 *
 * Two of the eight surfaces (`discovery.get`'s `schemas`, `schemas.list`'s `schemas`) type their items as
 * bare `unknown` in the SDK, the same class of gap PR14's WAF packages hit — each raw item is validated at
 * runtime and stored as an open bucket rather than guessed at.
 *
 * `settings.schemaValidation` and the whole `userSchemas` resource are marked `@deprecated` by the SDK in
 * favor of a separate top-level `client.schemaValidation` resource entirely outside `apiGateway` — that
 * modern replacement is a genuinely different product surface and deliberately out of scope for THIS kind;
 * both deprecated surfaces are still read here since they remain real, currently-working data an account
 * may still rely on.
 *
 * The four per-item subtypes and the `discovery-schema` collection live here; the other three one-per-zone
 * subtypes (the `schema` collection, `settings` and `configuration`) live in
 * `projection/apiGatewayZoneSingletons.ts`, re-exported below.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import { isRecord } from "../../../lib/parsers.js";
import { cloudflareZoneEntityId } from "../identity.js";
import type { CloudflareEntity } from "../model.js";

export {
  projectCloudflareApiGatewayConfiguration,
  projectCloudflareApiGatewaySettings,
  projectCloudflareSchemaCollection,
} from "./apiGatewayZoneSingletons.js";

/** Every source surface `api-gateway` folds together. */
export const CLOUDFLARE_API_GATEWAY_SUBTYPES = [
  "configuration",
  "discovery-operation",
  "discovery-schema",
  "label",
  "operation",
  "schema",
  "settings",
  "user-schema",
] as const;

export type CloudflareApiGatewaySubtype = (typeof CLOUDFLARE_API_GATEWAY_SUBTYPES)[number];

/**
 * Narrow a stored entity's `detail` into this domain's shape and confirm its subtype.
 *
 * @param value the entity's `detail` field, read back from disk
 * @param subtype the subtype to require
 * @returns true when `value` is a genuine `CloudflareApiGatewayDetail` of the given subtype
 */
export function isCloudflareApiGatewayDetailOf({
  value,
  subtype,
}: {
  value: unknown;
  subtype: CloudflareApiGatewaySubtype;
}): boolean {
  return isRecord(value) && value["kind"] === "api-gateway" && value["subtype"] === subtype;
}

/** The raw shape `client.apiGateway.operations.list()` returns for one operation. */
export interface CloudflareRawApiGatewayOperation {
  readonly operation_id: string;
  readonly endpoint?: string;
  readonly host?: string;
  readonly method?: string;
  readonly last_updated?: string;
  readonly [key: string]: unknown;
}

/** The raw shape `client.apiGateway.discovery.operations.list()` returns for one discovered operation. */
export interface CloudflareRawDiscoveryOperation {
  readonly id: string;
  readonly endpoint?: string;
  readonly host?: string;
  readonly method?: string;
  readonly state?: string;
  readonly last_updated?: string;
  readonly [key: string]: unknown;
}

/** The raw shape `client.apiGateway.labels.list()` returns for one label. */
export interface CloudflareRawApiGatewayLabel {
  readonly name: string;
  readonly description?: string;
  readonly source?: string;
  readonly created_at?: string;
  readonly last_updated?: string;
  readonly [key: string]: unknown;
}

/** The raw shape `client.apiGateway.userSchemas.list()` returns for one uploaded schema file. */
export interface CloudflareRawUserSchema {
  readonly schema_id: string;
  readonly name?: string;
  readonly kind?: string;
  readonly validation_enabled?: boolean;
  readonly created_at?: string;
  readonly [key: string]: unknown;
}

/** The detail this atlas stores for each per-item `api-gateway` subtype and the `discovery-schema` collection. */
type CloudflareApiGatewayDetail =
  | {
      readonly kind: "api-gateway";
      readonly subtype: "discovery-schema";
      readonly timestamp: string | null;
      readonly schema: Readonly<Record<string, unknown>>;
    }
  | {
      readonly kind: "api-gateway";
      readonly subtype: "operation";
      readonly endpoint: string | null;
      readonly host: string | null;
      readonly method: string | null;
      readonly lastUpdated: string | null;
      readonly config: Readonly<Record<string, unknown>>;
    }
  | {
      readonly kind: "api-gateway";
      readonly subtype: "discovery-operation";
      readonly endpoint: string | null;
      readonly host: string | null;
      readonly method: string | null;
      readonly state: string | null;
      readonly lastUpdated: string | null;
      readonly config: Readonly<Record<string, unknown>>;
    }
  | {
      readonly kind: "api-gateway";
      readonly subtype: "label";
      readonly description: string | null;
      readonly source: string | null;
      readonly createdAt: string | null;
      readonly lastUpdated: string | null;
      readonly config: Readonly<Record<string, unknown>>;
    }
  | {
      readonly kind: "api-gateway";
      readonly subtype: "user-schema";
      readonly name: string | null;
      readonly schemaKind: string | null;
      readonly validationEnabled: boolean | null;
      readonly createdAt: string | null;
      readonly config: Readonly<Record<string, unknown>>;
    };

/**
 * Project one raw registered operation into an `api-gateway` entity.
 *
 * @param raw the raw operation, already validated to carry a non-empty `operation_id`
 * @param accountId the selected account id
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareApiGatewayOperation({
  raw,
  accountId,
  zoneId,
  at,
}: {
  raw: CloudflareRawApiGatewayOperation;
  accountId: string;
  zoneId: string;
  at: string;
}): CloudflareEntity {
  const { operation_id, endpoint, host, method, last_updated, ...rest } = raw;
  const providerId = `operation:${operation_id}`;
  const detail: CloudflareApiGatewayDetail = {
    config: rest,
    endpoint: endpoint ?? null,
    host: host ?? null,
    kind: "api-gateway",
    lastUpdated: last_updated ?? null,
    method: method ?? null,
    subtype: "operation",
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareZoneEntityId({ components: { accountId, providerId }, kind: "api-gateway", zoneId }),
    kind: "api-gateway",
    lastSeenAt: at,
    providerId,
    scope: { accountId, parentId: null, zoneId },
    source: { channel: "rest-api", observedAt: at, operation: "api-gateway-operations-list" },
    state: "observed",
  };
}

/**
 * Project one raw discovered operation into an `api-gateway` entity.
 *
 * @param raw the raw discovered operation, already validated to carry a non-empty `id`
 * @param accountId the selected account id
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareDiscoveryOperation({
  raw,
  accountId,
  zoneId,
  at,
}: {
  raw: CloudflareRawDiscoveryOperation;
  accountId: string;
  zoneId: string;
  at: string;
}): CloudflareEntity {
  const { id, endpoint, host, method, state, last_updated, ...rest } = raw;
  const providerId = `discovery-operation:${id}`;
  const detail: CloudflareApiGatewayDetail = {
    config: rest,
    endpoint: endpoint ?? null,
    host: host ?? null,
    kind: "api-gateway",
    lastUpdated: last_updated ?? null,
    method: method ?? null,
    state: state ?? null,
    subtype: "discovery-operation",
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareZoneEntityId({ components: { accountId, providerId }, kind: "api-gateway", zoneId }),
    kind: "api-gateway",
    lastSeenAt: at,
    providerId,
    scope: { accountId, parentId: null, zoneId },
    source: { channel: "rest-api", observedAt: at, operation: "api-gateway-discovery-operations-list" },
    state: "observed",
  };
}

/**
 * Project the zone's discovered-schema collection into a SINGLE `api-gateway` entity — the SDK types this
 * endpoint's `schemas` field as bare `unknown[]`, so the whole array is stored as one open bucket rather
 * than split into per-item entities with no real per-item identity to key on.
 *
 * @param timestamp the response's own timestamp, if present
 * @param schemas every raw schema fragment the response returned
 * @param accountId the selected account id
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareDiscoverySchemaCollection({
  timestamp,
  schemas,
  accountId,
  zoneId,
  at,
}: {
  timestamp: string | undefined;
  schemas: readonly unknown[];
  accountId: string;
  zoneId: string;
  at: string;
}): CloudflareEntity {
  const providerId = "discovery-schema";
  const detail: CloudflareApiGatewayDetail = {
    kind: "api-gateway",
    schema: { schemas },
    subtype: "discovery-schema",
    timestamp: timestamp ?? null,
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareZoneEntityId({ components: { accountId, providerId }, kind: "api-gateway", zoneId }),
    kind: "api-gateway",
    lastSeenAt: at,
    providerId,
    scope: { accountId, parentId: null, zoneId },
    source: { channel: "rest-api", observedAt: at, operation: "api-gateway-discovery-get" },
    state: "observed",
  };
}

/**
 * Project one raw label into an `api-gateway` entity.
 *
 * @param raw the raw label, already validated to carry a non-empty `name`
 * @param accountId the selected account id
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareApiGatewayLabel({
  raw,
  accountId,
  zoneId,
  at,
}: {
  raw: CloudflareRawApiGatewayLabel;
  accountId: string;
  zoneId: string;
  at: string;
}): CloudflareEntity {
  const { name, description, source, created_at, last_updated, ...rest } = raw;
  const providerId = `label:${name}`;
  const detail: CloudflareApiGatewayDetail = {
    config: rest,
    createdAt: created_at ?? null,
    description: description ?? null,
    kind: "api-gateway",
    lastUpdated: last_updated ?? null,
    source: source ?? null,
    subtype: "label",
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareZoneEntityId({ components: { accountId, providerId }, kind: "api-gateway", zoneId }),
    kind: "api-gateway",
    lastSeenAt: at,
    providerId,
    scope: { accountId, parentId: null, zoneId },
    source: { channel: "rest-api", observedAt: at, operation: "api-gateway-labels-list" },
    state: "observed",
  };
}

/**
 * Project one raw uploaded/deprecated user schema into an `api-gateway` entity.
 *
 * @param raw the raw schema, already validated to carry a non-empty `schema_id`
 * @param accountId the selected account id
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareUserSchema({
  raw,
  accountId,
  zoneId,
  at,
}: {
  raw: CloudflareRawUserSchema;
  accountId: string;
  zoneId: string;
  at: string;
}): CloudflareEntity {
  // `validation_enabled` is read from `raw` itself below; destructuring only leaves it out of the open config.
  const { schema_id, name, kind, validation_enabled: _validationEnabled, created_at, ...rest } = raw;
  const providerId = `user-schema:${schema_id}`;
  const detail: CloudflareApiGatewayDetail = {
    config: rest,
    createdAt: created_at ?? null,
    kind: "api-gateway",
    name: name ?? null,
    schemaKind: kind ?? null,
    subtype: "user-schema",
    validationEnabled: unsetFieldAsNull({ key: "validation_enabled", record: raw }),
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareZoneEntityId({ components: { accountId, providerId }, kind: "api-gateway", zoneId }),
    kind: "api-gateway",
    lastSeenAt: at,
    providerId,
    scope: { accountId, parentId: null, zoneId },
    source: { channel: "rest-api", observedAt: at, operation: "api-gateway-user-schemas-list" },
    state: "observed",
  };
}
