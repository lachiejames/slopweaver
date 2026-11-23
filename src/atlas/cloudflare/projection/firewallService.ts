/**
 * Pure projection for the `firewall-service` kind — six independent, deep-zone-scoped classic firewall
 * surfaces folded into ONE kind, each entity tagged by which surface produced it (`subtype`), per the plan's
 * own grouping: classic filters, classic firewall rules, IP access rules, user-agent blocking rules, zone
 * lockdowns and legacy rate limiting rules. Modern Rulesets-based firewall/WAF is explicitly deferred — see
 * `nonFlatKinds.ts`'s header and `CLOUDFLARE_EXCLUDED_SURFACES`.
 *
 * A live probe of a deep zone (see `readers/firewallService.ts`'s own header) found five of the six surfaces
 * reachable — empty wherever a zone has no classic firewall configured — and the sixth (legacy rate limits)
 * returning `410 Gone` — Cloudflare has retired that API outright, not merely emptied it. Both are honest, expected outcomes the gap/coverage machinery already models; neither is
 * a reason to skip building the surface.
 *
 * `providerId` is prefixed with the subtype, mirroring `projection/notificationDestination.ts`'s
 * `webhook:`/`pagerduty:` convention — six independent SDK id spaces combine into one kind here, and a raw id
 * could otherwise collide across them.
 *
 * The three access-control subtypes (IP access rules, user-agent rules, zone lockdowns) live here; the three
 * expression-based subtypes (filters, firewall rules, rate limits) live in
 * `projection/firewallServiceExpressionRules.ts`, re-exported below.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import { isRecord } from "../../../lib/parsers.js";
import { cloudflareZoneEntityId } from "../identity.js";
import type { CloudflareEntity } from "../model.js";

export {
  projectCloudflareFirewallFilter,
  projectCloudflareFirewallRule,
  projectCloudflareRateLimit,
} from "./firewallServiceExpressionRules.js";

/** Every source surface `firewall-service` folds together. */
export const CLOUDFLARE_FIREWALL_SERVICE_SUBTYPES = [
  "filter",
  "firewall-rule",
  "ip-access-rule",
  "ua-rule",
  "lockdown",
  "rate-limit",
] as const;

export type CloudflareFirewallServiceSubtype = (typeof CLOUDFLARE_FIREWALL_SERVICE_SUBTYPES)[number];

/** The subset of the SDK's `AccessRuleListResponse` shape this projection reads. */
export interface CloudflareRawIpAccessRule {
  readonly id: string;
  readonly mode?: string;
  readonly allowed_modes?: readonly string[];
  readonly configuration?: unknown;
  readonly notes?: string;
  readonly created_on?: string;
  readonly modified_on?: string;
  readonly scope?: { readonly type?: string };
  readonly [key: string]: unknown;
}

/** The subset of the SDK's `UARuleListResponse` shape this projection reads. */
export interface CloudflareRawUaRule {
  readonly id: string;
  readonly description?: string;
  readonly mode?: string;
  readonly paused?: boolean;
  readonly configuration?: unknown;
  readonly [key: string]: unknown;
}

/** The subset of the SDK's `Lockdown` shape this projection reads. */
export interface CloudflareRawLockdown {
  readonly id: string;
  readonly description?: string;
  readonly paused?: boolean;
  readonly created_on?: string;
  readonly modified_on?: string;
  readonly urls?: readonly string[];
  readonly configurations?: readonly unknown[];
  readonly [key: string]: unknown;
}

/** The detail this atlas stores for each access-control `firewall-service` subtype. */
type CloudflareFirewallServiceDetail =
  | {
      readonly kind: "firewall-service";
      readonly subtype: "ip-access-rule";
      readonly mode: string | null;
      readonly allowedModes: readonly string[];
      readonly configuration: Readonly<Record<string, unknown>>;
      readonly notes: string | null;
      readonly createdOn: string | null;
      readonly modifiedOn: string | null;
      readonly scopeType: string | null;
    }
  | {
      readonly kind: "firewall-service";
      readonly subtype: "ua-rule";
      readonly description: string | null;
      readonly mode: string | null;
      readonly paused: boolean | null;
      readonly configuration: Readonly<Record<string, unknown>>;
    }
  | {
      readonly kind: "firewall-service";
      readonly subtype: "lockdown";
      readonly description: string | null;
      readonly paused: boolean | null;
      readonly createdOn: string | null;
      readonly modifiedOn: string | null;
      readonly urls: readonly string[];
      readonly configurations: readonly unknown[];
    };

/**
 * Narrow a stored entity's `detail` into this domain's shape and confirm its subtype, the same pattern
 * `projection/pages.ts`'s `isCloudflarePagesProjectDetail` established.
 *
 * @param value the entity's `detail` field, read back from disk
 * @param subtype the subtype to require
 * @returns true when `value` is a genuine `CloudflareFirewallServiceDetail` of the given subtype
 */
export function isCloudflareFirewallServiceDetailOf({
  value,
  subtype,
}: {
  value: unknown;
  subtype: CloudflareFirewallServiceSubtype;
}): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "firewall-service" &&
    (value as { subtype?: unknown }).subtype === subtype
  );
}

/**
 * Project one raw IP access rule into a `firewall-service` entity.
 *
 * @param raw the raw rule, already validated to carry a non-empty `id`
 * @param accountId the selected account id
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareIpAccessRule({
  raw,
  accountId,
  zoneId,
  at,
}: {
  raw: CloudflareRawIpAccessRule;
  accountId: string;
  zoneId: string;
  at: string;
}): CloudflareEntity {
  const providerId = `ip-access-rule:${raw.id}`;
  const detail: CloudflareFirewallServiceDetail = {
    allowedModes: raw.allowed_modes ?? [],
    configuration: isRecord(raw.configuration) ? { ...raw.configuration } : {},
    createdOn: unsetFieldAsNull({ key: "created_on", record: raw }),
    kind: "firewall-service",
    mode: raw.mode ?? null,
    modifiedOn: unsetFieldAsNull({ key: "modified_on", record: raw }),
    notes: unsetFieldAsNull({ key: "notes", record: raw }),
    scopeType: unsetFieldAsNull({ key: "type", record: raw.scope }),
    subtype: "ip-access-rule",
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareZoneEntityId({ components: { accountId, providerId }, kind: "firewall-service", zoneId }),
    kind: "firewall-service",
    lastSeenAt: at,
    providerId,
    scope: { accountId, parentId: null, zoneId },
    source: { channel: "rest-api", observedAt: at, operation: "firewall-service-access-rules-list" },
    state: "observed",
  };
}

/**
 * Project one raw user-agent blocking rule into a `firewall-service` entity.
 *
 * @param raw the raw rule, already validated to carry a non-empty `id`
 * @param accountId the selected account id
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareUaRule({
  raw,
  accountId,
  zoneId,
  at,
}: {
  raw: CloudflareRawUaRule;
  accountId: string;
  zoneId: string;
  at: string;
}): CloudflareEntity {
  const providerId = `ua-rule:${raw.id}`;
  const detail: CloudflareFirewallServiceDetail = {
    configuration: isRecord(raw.configuration) ? { ...raw.configuration } : {},
    description: unsetFieldAsNull({ key: "description", record: raw }),
    kind: "firewall-service",
    mode: unsetFieldAsNull({ key: "mode", record: raw }),
    paused: unsetFieldAsNull({ key: "paused", record: raw }),
    subtype: "ua-rule",
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareZoneEntityId({ components: { accountId, providerId }, kind: "firewall-service", zoneId }),
    kind: "firewall-service",
    lastSeenAt: at,
    providerId,
    scope: { accountId, parentId: null, zoneId },
    source: { channel: "rest-api", observedAt: at, operation: "firewall-service-ua-rules-list" },
    state: "observed",
  };
}

/**
 * Project one raw zone lockdown into a `firewall-service` entity.
 *
 * @param raw the raw lockdown, already validated to carry a non-empty `id`
 * @param accountId the selected account id
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareLockdown({
  raw,
  accountId,
  zoneId,
  at,
}: {
  raw: CloudflareRawLockdown;
  accountId: string;
  zoneId: string;
  at: string;
}): CloudflareEntity {
  const providerId = `lockdown:${raw.id}`;
  const detail: CloudflareFirewallServiceDetail = {
    configurations: raw.configurations ?? [],
    createdOn: raw.created_on ?? null,
    description: raw.description ?? null,
    kind: "firewall-service",
    modifiedOn: raw.modified_on ?? null,
    paused: raw.paused ?? null,
    subtype: "lockdown",
    urls: raw.urls ?? [],
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareZoneEntityId({ components: { accountId, providerId }, kind: "firewall-service", zoneId }),
    kind: "firewall-service",
    lastSeenAt: at,
    providerId,
    scope: { accountId, parentId: null, zoneId },
    source: { channel: "rest-api", observedAt: at, operation: "firewall-service-lockdowns-list" },
    state: "observed",
  };
}
