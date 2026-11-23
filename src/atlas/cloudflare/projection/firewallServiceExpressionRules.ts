/**
 * The three expression-based subtypes of the `firewall-service` kind: classic filters, classic firewall rules
 * and legacy rate limits. Each matches a request through a filter expression or a match block rather than the
 * fixed-attribute `configuration` object the access-control subtypes (IP access rules, user-agent rules, zone
 * lockdowns) carry, which stay in `projection/firewallService.ts`. That module re-exports every projection
 * here, so no caller's import changed.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import { isRecord } from "../../../lib/parsers.js";
import { cloudflareZoneEntityId } from "../identity.js";
import type { CloudflareEntity } from "../model.js";

/** The subset of the SDK's `FirewallFilter` shape this projection reads. */
export interface CloudflareRawFirewallFilter {
  readonly id: string;
  readonly description?: string;
  readonly expression?: string;
  readonly paused?: boolean;
  readonly ref?: string;
  readonly [key: string]: unknown;
}

/** The subset of the SDK's `FirewallRule` shape this projection reads — `filter` may be a full filter object
 * or a `{id, deleted}` stub when the filter it pointed to was removed; either way only the id is stable. */
export interface CloudflareRawFirewallRule {
  readonly id: string;
  readonly description?: string;
  readonly action?: string;
  readonly paused?: boolean;
  readonly priority?: number;
  readonly products?: readonly string[];
  readonly ref?: string;
  readonly filter?: { readonly id?: string } | null;
  readonly [key: string]: unknown;
}

/** The subset of the SDK's `RateLimit` shape this projection reads. */
export interface CloudflareRawRateLimit {
  readonly id: string;
  readonly description?: string;
  readonly disabled?: boolean;
  readonly period?: number;
  readonly threshold?: number;
  readonly action?: unknown;
  readonly match?: unknown;
  readonly bypass?: unknown;
  readonly [key: string]: unknown;
}

/** The detail this atlas stores for each expression-based `firewall-service` subtype. */
type CloudflareFirewallExpressionDetail =
  | {
      readonly kind: "firewall-service";
      readonly subtype: "filter";
      readonly description: string | null;
      readonly expression: string | null;
      readonly paused: boolean | null;
      readonly ref: string | null;
    }
  | {
      readonly kind: "firewall-service";
      readonly subtype: "firewall-rule";
      readonly description: string | null;
      readonly action: string | null;
      readonly paused: boolean | null;
      readonly priority: number | null;
      readonly products: readonly string[];
      readonly ref: string | null;
      readonly filterId: string | null;
    }
  | {
      readonly kind: "firewall-service";
      readonly subtype: "rate-limit";
      readonly description: string | null;
      readonly disabled: boolean | null;
      readonly period: number | null;
      readonly threshold: number | null;
      readonly action: Readonly<Record<string, unknown>>;
      readonly match: Readonly<Record<string, unknown>>;
      readonly bypass: readonly unknown[];
    };

/**
 * The products a classic firewall rule bypasses: an omitted list means it bypasses none.
 *
 * @param raw the raw firewall rule
 * @returns the rule's own list, or an empty one when it bypasses none
 */
function firewallRuleProducts({ raw }: { raw: CloudflareRawFirewallRule }): readonly string[] {
  const products = unsetFieldAsNull({ key: "products", record: raw });
  if (products === null) {
    return [];
  }
  return products;
}

/**
 * Project one raw classic filter into a `firewall-service` entity.
 *
 * @param raw the raw filter, already validated to carry a non-empty `id`
 * @param accountId the selected account id
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareFirewallFilter({
  raw,
  accountId,
  zoneId,
  at,
}: {
  raw: CloudflareRawFirewallFilter;
  accountId: string;
  zoneId: string;
  at: string;
}): CloudflareEntity {
  const providerId = `filter:${raw.id}`;
  const detail: CloudflareFirewallExpressionDetail = {
    description: unsetFieldAsNull({ key: "description", record: raw }),
    expression: unsetFieldAsNull({ key: "expression", record: raw }),
    kind: "firewall-service",
    paused: unsetFieldAsNull({ key: "paused", record: raw }),
    ref: unsetFieldAsNull({ key: "ref", record: raw }),
    subtype: "filter",
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareZoneEntityId({ components: { accountId, providerId }, kind: "firewall-service", zoneId }),
    kind: "firewall-service",
    lastSeenAt: at,
    providerId,
    scope: { accountId, parentId: null, zoneId },
    source: { channel: "rest-api", observedAt: at, operation: "firewall-service-filters-list" },
    state: "observed",
  };
}

/**
 * Project one raw classic firewall rule into a `firewall-service` entity.
 *
 * @param raw the raw rule, already validated to carry a non-empty `id`
 * @param accountId the selected account id
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareFirewallRule({
  raw,
  accountId,
  zoneId,
  at,
}: {
  raw: CloudflareRawFirewallRule;
  accountId: string;
  zoneId: string;
  at: string;
}): CloudflareEntity {
  const providerId = `firewall-rule:${raw.id}`;
  const detail: CloudflareFirewallExpressionDetail = {
    action: unsetFieldAsNull({ key: "action", record: raw }),
    description: unsetFieldAsNull({ key: "description", record: raw }),
    filterId: unsetFieldAsNull({ key: "id", record: raw.filter }),
    kind: "firewall-service",
    paused: unsetFieldAsNull({ key: "paused", record: raw }),
    priority: unsetFieldAsNull({ key: "priority", record: raw }),
    products: firewallRuleProducts({ raw }),
    ref: unsetFieldAsNull({ key: "ref", record: raw }),
    subtype: "firewall-rule",
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareZoneEntityId({ components: { accountId, providerId }, kind: "firewall-service", zoneId }),
    kind: "firewall-service",
    lastSeenAt: at,
    providerId,
    scope: { accountId, parentId: null, zoneId },
    source: { channel: "rest-api", observedAt: at, operation: "firewall-service-rules-list" },
    state: "observed",
  };
}

/**
 * Project one raw legacy rate limit into a `firewall-service` entity.
 *
 * @param raw the raw rate limit, already validated to carry a non-empty `id`
 * @param accountId the selected account id
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareRateLimit({
  raw,
  accountId,
  zoneId,
  at,
}: {
  raw: CloudflareRawRateLimit;
  accountId: string;
  zoneId: string;
  at: string;
}): CloudflareEntity {
  const providerId = `rate-limit:${raw.id}`;
  const detail: CloudflareFirewallExpressionDetail = {
    action: isRecord(raw.action) ? { ...raw.action } : {},
    bypass: Array.isArray(raw.bypass) ? raw.bypass : [],
    description: unsetFieldAsNull({ key: "description", record: raw }),
    disabled: unsetFieldAsNull({ key: "disabled", record: raw }),
    kind: "firewall-service",
    match: isRecord(raw.match) ? { ...raw.match } : {},
    period: unsetFieldAsNull({ key: "period", record: raw }),
    subtype: "rate-limit",
    threshold: unsetFieldAsNull({ key: "threshold", record: raw }),
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareZoneEntityId({ components: { accountId, providerId }, kind: "firewall-service", zoneId }),
    kind: "firewall-service",
    lastSeenAt: at,
    providerId,
    scope: { accountId, parentId: null, zoneId },
    source: { channel: "rest-api", observedAt: at, operation: "firewall-service-rate-limits-list" },
    state: "observed",
  };
}
