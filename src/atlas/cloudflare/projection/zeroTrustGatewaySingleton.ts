/**
 * The three Zero Trust Gateway SINGLETONS, whose provider id is the kind's own name because Cloudflare
 * allocates none: `gateway-configuration` (the account's proxy/TLS-decryption settings), `gateway-logging`
 * (per-rule-type log retention and the PII redaction switch) and `gateway-audit-ssh-setting` (the SSH
 * session-recording key pair's PUBLIC half). Their shape follows `projection/workerAccountSetting.ts`, which
 * had the same problem first. `projection/zeroTrustGateway.ts` re-exports all of it, so its importers never
 * name this module.
 *
 * Every field each of these reads is declared OPTIONAL by the SDK's own response type
 * (`ConfigurationGetResponse`, `LoggingSetting`, `GatewaySettings`) — `is_public_key_valid` is not declared
 * there at all — so an omitted one is stored as `null`.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import { cloudflareEntityId } from "../identity.js";
import type { CloudflareEntity } from "../model.js";

/** The fixed provider id each Gateway singleton is stored under — Cloudflare allocates none. */
export const GATEWAY_CONFIGURATION_ID = "gateway-configuration";

/** The fixed provider id the Gateway logging singleton is stored under. */
export const GATEWAY_LOGGING_ID = "gateway-logging";

/** The fixed provider id the Gateway SSH-audit singleton is stored under. */
export const GATEWAY_AUDIT_SSH_ID = "gateway-audit-ssh-setting";

/** The detail this atlas stores for the `gateway-configuration` singleton. */
export interface CloudflareGatewayConfigurationDetail {
  readonly kind: "gateway-configuration";
  /** The whole settings object — TLS decrypt, activity log, block page, certificate binding and the rest. */
  readonly settings: unknown;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
}

/**
 * Project the account's Gateway configuration into its singleton entity.
 *
 * @param configuration the raw configuration response
 * @param accountId the account this configuration was read under
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareGatewayConfiguration({
  configuration,
  accountId,
  at,
}: {
  configuration: { readonly settings?: unknown; readonly created_at?: string | null; readonly updated_at?: string };
  accountId: string;
  at: string;
}): CloudflareEntity {
  const detail: CloudflareGatewayConfigurationDetail = {
    createdAt: unsetFieldAsNull({ key: "created_at", record: configuration }),
    kind: "gateway-configuration",
    settings: unsetFieldAsNull({ key: "settings", record: configuration }),
    updatedAt: unsetFieldAsNull({ key: "updated_at", record: configuration }),
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareEntityId({
      components: { accountId, providerId: GATEWAY_CONFIGURATION_ID },
      kind: "gateway-configuration",
    }),
    kind: "gateway-configuration",
    lastSeenAt: at,
    providerId: GATEWAY_CONFIGURATION_ID,
    scope: { accountId, parentId: null, zoneId: null },
    source: { channel: "rest-api", observedAt: at, operation: "gateway-configuration-get" },
    state: "observed",
  };
}

/** The detail this atlas stores for the `gateway-logging` singleton. */
export interface CloudflareGatewayLoggingDetail {
  readonly kind: "gateway-logging";
  /** Per-rule-type (dns/http/l4) log settings — what is logged for allows, blocks and everything else. */
  readonly settingsByRuleType: unknown;
  /** Whether identities are stripped from Gateway logs before they are written. */
  readonly redactPii: boolean | null;
}

/**
 * Project the account's Gateway logging settings into their singleton entity.
 *
 * @param logging the raw logging response
 * @param accountId the account this was read under
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareGatewayLogging({
  logging,
  accountId,
  at,
}: {
  logging: { readonly settings_by_rule_type?: unknown; readonly redact_pii?: boolean };
  accountId: string;
  at: string;
}): CloudflareEntity {
  const detail: CloudflareGatewayLoggingDetail = {
    kind: "gateway-logging",
    redactPii: unsetFieldAsNull({ key: "redact_pii", record: logging }),
    settingsByRuleType: unsetFieldAsNull({ key: "settings_by_rule_type", record: logging }),
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareEntityId({ components: { accountId, providerId: GATEWAY_LOGGING_ID }, kind: "gateway-logging" }),
    kind: "gateway-logging",
    lastSeenAt: at,
    providerId: GATEWAY_LOGGING_ID,
    scope: { accountId, parentId: null, zoneId: null },
    source: { channel: "rest-api", observedAt: at, operation: "gateway-logging-get" },
    state: "observed",
  };
}

/** The detail this atlas stores for the `gateway-audit-ssh-setting` singleton. */
export interface CloudflareGatewayAuditSshDetail {
  readonly kind: "gateway-audit-ssh-setting";
  /** The PUBLIC half of the SSH session-recording key pair. Cloudflare never returns the private half. */
  readonly publicKey: string | null;
  readonly seedId: string | null;
  readonly publicKeyValid: boolean | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
}

/**
 * Project the account's SSH session-recording settings into their singleton entity.
 *
 * @param setting the raw audit-SSH response
 * @param accountId the account this was read under
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareGatewayAuditSsh({
  setting,
  accountId,
  at,
}: {
  setting: {
    readonly public_key?: string | null;
    readonly seed_id?: string | null;
    readonly is_public_key_valid?: boolean | null;
    readonly created_at?: string | null;
    readonly updated_at?: string | null;
  };
  accountId: string;
  at: string;
}): CloudflareEntity {
  const detail: CloudflareGatewayAuditSshDetail = {
    createdAt: unsetFieldAsNull({ key: "created_at", record: setting }),
    kind: "gateway-audit-ssh-setting",
    publicKey: unsetFieldAsNull({ key: "public_key", record: setting }),
    publicKeyValid: unsetFieldAsNull({ key: "is_public_key_valid", record: setting }),
    seedId: unsetFieldAsNull({ key: "seed_id", record: setting }),
    updatedAt: unsetFieldAsNull({ key: "updated_at", record: setting }),
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareEntityId({
      components: { accountId, providerId: GATEWAY_AUDIT_SSH_ID },
      kind: "gateway-audit-ssh-setting",
    }),
    kind: "gateway-audit-ssh-setting",
    lastSeenAt: at,
    providerId: GATEWAY_AUDIT_SSH_ID,
    scope: { accountId, parentId: null, zoneId: null },
    source: { channel: "rest-api", observedAt: at, operation: "gateway-audit-ssh-settings-get" },
    state: "observed",
  };
}
