/**
 * Pure projections from the SDK's Access application/group/service-token/identity-provider DTOs to this
 * atlas's flat-inventory entities.
 *
 * Access applications and identity providers are each a discriminated union across a dozen-plus provider
 * types (SelfHosted, SaaS, Bookmark, … / OIDC, SAML, Okta, …), every variant sharing only `id`/`name` (and,
 * for applications, usually `type`) as stable fields. Rather than hand-model each variant, the rest of the
 * object is kept as an open `config` bucket — exactly the "inherently open configuration" treatment the
 * atlas's own design calls for (see `client.ts`'s header for the same posture applied to the envelope).
 *
 * Identity-provider configs are the one place that bucket can carry a real secret: several provider types
 * declare `config.client_secret` in the SDK's own types. `redactSensitiveConfig` strips it (and same-named
 * keys at any depth) before anything is written — never trusting that a list endpoint already redacts it.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import { isRecord } from "../../../lib/parsers.js";
import { cloudflareEntityId } from "../identity.js";
import type { CloudflareEntity } from "../model.js";

/** Config keys never persisted, at any depth — Access identity-provider configs are the only place this
 * atlas has seen a real secret field declared in the SDK's own types. */
const SENSITIVE_CONFIG_KEYS = new Set(["client_secret"]);

/**
 * Strip sensitive keys from a raw config value, recursively, without assuming its shape.
 *
 * @param value the raw value to sanitise
 * @returns the same shape with every sensitive key removed
 */
function redactSensitiveConfig({ value }: { value: unknown }): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveConfig({ value: item }));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !SENSITIVE_CONFIG_KEYS.has(key))
        .map(([key, entryValue]) => [key, redactSensitiveConfig({ value: entryValue })]),
    );
  }
  return value;
}

/** The stable fields every Access-application variant declares, plus whatever else it carries. */
export interface CloudflareAccessApplicationDto {
  readonly id: string;
  readonly name?: string;
  readonly type?: string;
  readonly [key: string]: unknown;
}

/** The light-inventory detail this atlas stores for the `access-application` kind. */
interface CloudflareAccessApplicationDetail {
  readonly kind: "access-application";
  readonly name: string | null;
  readonly type: string | null;
  readonly config: Readonly<Record<string, unknown>>;
}

/**
 * Project one Access application into an `access-application` entity.
 *
 * @param application the raw application, already validated to carry a non-empty `id`
 * @param accountId the account this application was read under
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareAccessApplication({
  application,
  accountId,
  at,
}: {
  application: CloudflareAccessApplicationDto;
  accountId: string;
  at: string;
}): CloudflareEntity {
  const { id, name: _name, type: _type, ...config } = application;
  const detail: CloudflareAccessApplicationDetail = {
    config,
    kind: "access-application",
    name: unsetFieldAsNull({ key: "name", record: application }),
    type: unsetFieldAsNull({ key: "type", record: application }),
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareEntityId({ components: { accountId, providerId: id }, kind: "access-application" }),
    kind: "access-application",
    lastSeenAt: at,
    providerId: id,
    scope: { accountId, parentId: null, zoneId: null },
    source: { channel: "rest-api", observedAt: at, operation: "access-applications-list" },
    state: "observed",
  };
}

/** The stable fields the Access-group DTO declares. */
export interface CloudflareAccessGroupDto {
  readonly id: string;
  readonly name?: string;
  readonly include?: unknown;
  readonly exclude?: unknown;
  readonly require?: unknown;
  readonly is_default?: unknown;
}

/** The light-inventory detail this atlas stores for the `access-group` kind. */
interface CloudflareAccessGroupDetail {
  readonly kind: "access-group";
  readonly name: string | null;
  readonly include: unknown;
  readonly exclude: unknown;
  readonly require: unknown;
  readonly isDefault: unknown;
}

/**
 * Project one Access group into an `access-group` entity. The rule arrays are inherently open
 * configuration (see this file's header) and are kept as-is, unredacted — they carry conditions, not secrets.
 *
 * @param group the raw group, already validated to carry a non-empty `id`
 * @param accountId the account this group was read under
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareAccessGroup({
  group,
  accountId,
  at,
}: {
  group: CloudflareAccessGroupDto;
  accountId: string;
  at: string;
}): CloudflareEntity {
  const detail: CloudflareAccessGroupDetail = {
    exclude: unsetFieldAsNull({ key: "exclude", record: group }),
    include: unsetFieldAsNull({ key: "include", record: group }),
    isDefault: unsetFieldAsNull({ key: "is_default", record: group }),
    kind: "access-group",
    name: unsetFieldAsNull({ key: "name", record: group }),
    require: unsetFieldAsNull({ key: "require", record: group }),
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareEntityId({ components: { accountId, providerId: group.id }, kind: "access-group" }),
    kind: "access-group",
    lastSeenAt: at,
    providerId: group.id,
    scope: { accountId, parentId: null, zoneId: null },
    source: { channel: "rest-api", observedAt: at, operation: "access-groups-list" },
    state: "observed",
  };
}

/** The stable fields the service-token DTO declares. Never a secret — the list endpoint has no `value` field. */
export interface CloudflareAccessServiceTokenDto {
  readonly id: string;
  readonly name?: string;
  readonly client_id?: string;
  readonly duration?: string;
  readonly expires_at?: string;
}

/** The light-inventory detail this atlas stores for the `access-service-token` kind. */
interface CloudflareAccessServiceTokenDetail {
  readonly kind: "access-service-token";
  readonly name: string | null;
  readonly clientId: string | null;
  readonly duration: string | null;
  readonly expiresAt: string | null;
}

/**
 * Project one Access service token into an `access-service-token` entity.
 *
 * @param serviceToken the raw service token, already validated to carry a non-empty `id`
 * @param accountId the account this service token was read under
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareAccessServiceToken({
  serviceToken,
  accountId,
  at,
}: {
  serviceToken: CloudflareAccessServiceTokenDto;
  accountId: string;
  at: string;
}): CloudflareEntity {
  const detail: CloudflareAccessServiceTokenDetail = {
    clientId: unsetFieldAsNull({ key: "client_id", record: serviceToken }),
    duration: unsetFieldAsNull({ key: "duration", record: serviceToken }),
    expiresAt: unsetFieldAsNull({ key: "expires_at", record: serviceToken }),
    kind: "access-service-token",
    name: unsetFieldAsNull({ key: "name", record: serviceToken }),
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareEntityId({ components: { accountId, providerId: serviceToken.id }, kind: "access-service-token" }),
    kind: "access-service-token",
    lastSeenAt: at,
    providerId: serviceToken.id,
    scope: { accountId, parentId: null, zoneId: null },
    source: { channel: "rest-api", observedAt: at, operation: "access-service-tokens-list" },
    state: "observed",
  };
}

/** The stable fields every identity-provider variant declares, plus whatever else it carries. */
export interface CloudflareIdentityProviderDto {
  readonly id: string;
  readonly name?: string;
  readonly type?: string;
  readonly [key: string]: unknown;
}

/** The light-inventory detail this atlas stores for the `identity-provider` kind. */
interface CloudflareIdentityProviderDetail {
  readonly kind: "identity-provider";
  readonly name: string | null;
  readonly type: string | null;
  readonly config: unknown;
}

/**
 * Project one identity provider into an `identity-provider` entity. `config` is redacted — see this file's
 * header — before it is ever written.
 *
 * @param provider the raw identity provider, already validated to carry a non-empty `id`
 * @param accountId the account this identity provider was read under
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareIdentityProvider({
  provider,
  accountId,
  at,
}: {
  provider: CloudflareIdentityProviderDto;
  accountId: string;
  at: string;
}): CloudflareEntity {
  const { id, name: _name, type: _type, ...config } = provider;
  const detail: CloudflareIdentityProviderDetail = {
    config: redactSensitiveConfig({ value: config }),
    kind: "identity-provider",
    name: unsetFieldAsNull({ key: "name", record: provider }),
    type: unsetFieldAsNull({ key: "type", record: provider }),
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareEntityId({ components: { accountId, providerId: id }, kind: "identity-provider" }),
    kind: "identity-provider",
    lastSeenAt: at,
    providerId: id,
    scope: { accountId, parentId: null, zoneId: null },
    source: { channel: "rest-api", observedAt: at, operation: "identity-providers-list" },
    state: "observed",
  };
}
