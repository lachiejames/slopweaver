/**
 * Pure projection for the `legacy-waf` kind — classic WAF packages with their groups/rules embedded as
 * combined per-package children (the same "one combined per-parent fan-out" shape `projection/pages.ts`
 * established), plus WAF overrides as independent, zone-level sibling entities rather than forced under a
 * package — overrides reference groups/rules across potentially many packages by id-keyed map, never a
 * single package they belong to, so nesting them under one parent would misrepresent the real relationship.
 *
 * The SDK types `client.firewall.waf.packages.list()`'s item as bare `unknown` — Cloudflare's official
 * TypeScript SDK gives this one surface, alone among all ten classic firewall/WAF endpoints this atlas reads,
 * zero compile-time contract. A live probe of a deep zone could not recover real field names
 * either: the zone returned `403 WAF is deprecated for this zone, Managed Rulesets should be used instead`
 * before any package data was reachable. Rather than guess at field names from general Cloudflare
 * documentation this repo cannot verify against a live response, a package's own raw object (minus `id`) is
 * stored wholesale as an open `config` bucket — the same "inherently open configuration" treatment
 * `projection/access.ts` already uses, applied here because the type is unknown rather than merely wide.
 * Groups and package-rules ARE fully typed by the SDK and are modeled properly below.
 */
import { absentAsEmpty, unsetFieldAsNull } from "#lib/absent.js";
import { isRecord } from "../../../lib/parsers.js";
import { cloudflareZoneEntityId } from "../identity.js";
import type { CloudflareEntity } from "../model.js";

/** The raw shape `client.firewall.waf.packages.list()` returns for one package — genuinely `unknown` in the
 * SDK; only `id` is validated before use, everything else is stored as opaque config. */
export interface CloudflareRawWafPackage {
  readonly id: string;
  readonly [key: string]: unknown;
}

/** The raw shape `client.firewall.waf.packages.groups.list()` returns for one group. */
export interface CloudflareRawWafGroup {
  readonly id: string;
  readonly description?: string | null;
  readonly mode?: "on" | "off";
  readonly name?: string;
  readonly rules_count?: number;
  readonly allowed_modes?: readonly string[];
  readonly modified_rules_count?: number;
  readonly package_id?: string;
}

/** The raw shape `client.firewall.waf.packages.rules.list()` returns for one rule — the SDK's 3-variant
 * union shares identical field names across every variant (only `mode`'s value set and the presence of
 * `default_mode` differ), so this is modeled as one flat shape rather than three. */
export interface CloudflareRawWafRule {
  readonly id: string;
  readonly description?: string;
  readonly mode?: string;
  readonly default_mode?: string;
  readonly allowed_modes?: readonly string[];
  readonly group?: { readonly id?: string; readonly name?: string };
  readonly package_id?: string;
  readonly priority?: string;
}

/** The raw shape `client.firewall.waf.overrides.list()` returns for one override — zone-scoped, never nested
 * under a package. */
export interface CloudflareRawWafOverride {
  readonly id?: string;
  readonly description?: string | null;
  readonly groups?: unknown;
  readonly paused?: boolean;
  readonly priority?: number;
  readonly rewrite_action?: unknown;
  readonly rules?: unknown;
  readonly urls?: readonly string[];
}

/** One group, as stored. */
interface CloudflareWafGroupDetail {
  readonly id: string;
  readonly name: string | null;
  readonly description: string | null;
  readonly mode: string | null;
  readonly rulesCount: number | null;
  readonly allowedModes: readonly string[];
  readonly modifiedRulesCount: number | null;
}

/** One package-rule, as stored. */
interface CloudflareWafRuleDetail {
  readonly id: string;
  readonly description: string | null;
  readonly mode: string | null;
  readonly defaultMode: string | null;
  readonly allowedModes: readonly string[];
  readonly groupId: string | null;
  readonly groupName: string | null;
  readonly priority: string | null;
}

/** One raw child item, before normalization — a package's groups and rules reads are fanned out and folded
 * back into ONE combined attempt, so a package's own children are tagged by which read produced them, the
 * same shape `projection/pages.ts`'s `CloudflarePagesRawChildItem` established. */
export type CloudflareLegacyWafRawChildItem =
  | { readonly itemKind: "group"; readonly group: CloudflareRawWafGroup }
  | { readonly itemKind: "rule"; readonly rule: CloudflareRawWafRule };

/** One normalized child item — the stored counterpart of {@link CloudflareLegacyWafRawChildItem}. */
export type CloudflareLegacyWafChildItem =
  | { readonly itemKind: "group"; readonly group: CloudflareWafGroupDetail }
  | { readonly itemKind: "rule"; readonly rule: CloudflareWafRuleDetail };

/** The detail this atlas stores for a `legacy-waf` PACKAGE entity. */
export interface CloudflareWafPackageDetail {
  readonly kind: "legacy-waf";
  readonly itemKind: "package";
  readonly config: Readonly<Record<string, unknown>>;
  readonly groups: readonly CloudflareWafGroupDetail[];
  readonly rules: readonly CloudflareWafRuleDetail[];
}

/** The detail this atlas stores for a `legacy-waf` OVERRIDE entity. */
export interface CloudflareWafOverrideDetail {
  readonly kind: "legacy-waf";
  readonly itemKind: "override";
  readonly description: string | null;
  readonly paused: boolean | null;
  readonly priority: number | null;
  readonly urls: readonly string[];
  readonly groupActions: Readonly<Record<string, unknown>>;
  readonly ruleActions: Readonly<Record<string, unknown>>;
  readonly rewriteAction: Readonly<Record<string, unknown>> | null;
}

/**
 * Narrow a stored entity's `detail` into a `legacy-waf` PACKAGE detail, the same pattern
 * `projection/pages.ts`'s `isCloudflarePagesProjectDetail` established.
 *
 * @param value the entity's `detail` field, read back from disk
 * @returns true when `value` is a genuine `CloudflareWafPackageDetail`
 */
export function isCloudflareWafPackageDetail(value: unknown): value is CloudflareWafPackageDetail {
  return (
    isRecord(value) &&
    value["kind"] === "legacy-waf" &&
    value["itemKind"] === "package" &&
    Array.isArray(value["groups"]) &&
    Array.isArray(value["rules"])
  );
}

/**
 * Narrow a stored entity's `detail` into a `legacy-waf` OVERRIDE detail.
 *
 * @param value the entity's `detail` field, read back from disk
 * @returns true when `value` is a genuine `CloudflareWafOverrideDetail`
 */
export function isCloudflareWafOverrideDetail(value: unknown): value is CloudflareWafOverrideDetail {
  return isRecord(value) && value["kind"] === "legacy-waf" && value["itemKind"] === "override";
}

/**
 * Split a stored package's own groups/rules back into the combined, tagged child-item shape
 * `reconcileParentFanout`'s `extractStoredChildren` needs.
 *
 * @param detail the stored package detail
 * @returns every group and rule, tagged by which collection it came from
 */
export function extractCloudflareLegacyWafChildren({
  detail,
}: {
  detail: CloudflareWafPackageDetail;
}): readonly CloudflareLegacyWafChildItem[] {
  return [
    ...detail.groups.map((group): CloudflareLegacyWafChildItem => ({ group, itemKind: "group" })),
    ...detail.rules.map((rule): CloudflareLegacyWafChildItem => ({ itemKind: "rule", rule })),
  ];
}

/**
 * The modes a group may be set to: an omitted list means the provider published none, so none are stored.
 *
 * @param group the raw group
 * @returns the group's own list, or an empty one when it published none
 */
function wafGroupAllowedModes({ group }: { group: CloudflareRawWafGroup }): readonly string[] {
  const modes = unsetFieldAsNull({ key: "allowed_modes", record: group });
  if (modes === null) {
    return [];
  }
  return modes;
}

/**
 * The URLs an override applies to: an omitted list means the provider published none, so none are stored.
 *
 * @param override the raw override
 * @returns the override's own list, or an empty one when it published none
 */
function wafOverrideUrls({ override }: { override: CloudflareRawWafOverride }): readonly string[] {
  const urls = unsetFieldAsNull({ key: "urls", record: override });
  if (urls === null) {
    return [];
  }
  return urls;
}

/**
 * Normalize one raw child item into its stored shape.
 *
 * @param raw the raw child item, from a package's combined groups/rules read
 * @returns the item, as stored
 */
export function normalizeCloudflareLegacyWafChildItem({
  raw,
}: {
  raw: CloudflareLegacyWafRawChildItem;
}): CloudflareLegacyWafChildItem {
  if (raw.itemKind === "group") {
    const group = raw.group;
    return {
      group: {
        allowedModes: wafGroupAllowedModes({ group }),
        description: unsetFieldAsNull({ key: "description", record: group }),
        id: group.id,
        mode: unsetFieldAsNull({ key: "mode", record: group }),
        modifiedRulesCount: unsetFieldAsNull({ key: "modified_rules_count", record: group }),
        name: unsetFieldAsNull({ key: "name", record: group }),
        rulesCount: unsetFieldAsNull({ key: "rules_count", record: group }),
      },
      itemKind: "group",
    };
  }
  const rule = raw.rule;
  return {
    itemKind: "rule",
    rule: {
      allowedModes: absentAsEmpty({ value: rule.allowed_modes }),
      defaultMode: unsetFieldAsNull({ key: "default_mode", record: rule }),
      description: unsetFieldAsNull({ key: "description", record: rule }),
      groupId: unsetFieldAsNull({ key: "id", record: rule.group }),
      groupName: unsetFieldAsNull({ key: "name", record: rule.group }),
      id: rule.id,
      mode: unsetFieldAsNull({ key: "mode", record: rule }),
      priority: unsetFieldAsNull({ key: "priority", record: rule }),
    },
  };
}

/**
 * Split this run's combined child items back into their two collections.
 *
 * @param children this package's combined, tagged groups/rules
 * @returns the groups and rules, each already unwrapped from their tag
 */
function splitCloudflareLegacyWafChildren({ children }: { children: readonly CloudflareLegacyWafChildItem[] }): {
  groups: readonly CloudflareWafGroupDetail[];
  rules: readonly CloudflareWafRuleDetail[];
} {
  return {
    groups: children
      .filter((item): item is Extract<CloudflareLegacyWafChildItem, { itemKind: "group" }> => item.itemKind === "group")
      .map((item) => item.group),
    rules: children
      .filter((item): item is Extract<CloudflareLegacyWafChildItem, { itemKind: "rule" }> => item.itemKind === "rule")
      .map((item) => item.rule),
  };
}

/** What a PACKAGE entity's `providerId` puts before the package's own id, so a package and an override with
 * the same raw id never share one. */
export const WAF_PACKAGE_PROVIDER_ID_PREFIX = "package:";

/**
 * Project one WAF package's raw metadata and resolved children into a `legacy-waf` PACKAGE entity.
 *
 * @param raw the package's own raw object — genuinely untyped by the SDK, stored minus `id` as open config
 * @param children this package's groups and rules, already normalized
 * @param accountId the selected account id
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareWafPackage({
  raw,
  children,
  accountId,
  zoneId,
  at,
}: {
  raw: CloudflareRawWafPackage;
  children: readonly CloudflareLegacyWafChildItem[];
  accountId: string;
  zoneId: string;
  at: string;
}): CloudflareEntity {
  const { id, ...config } = raw;
  const { groups, rules } = splitCloudflareLegacyWafChildren({ children });
  const providerId = `${WAF_PACKAGE_PROVIDER_ID_PREFIX}${id}`;
  const detail: CloudflareWafPackageDetail = { config, groups, itemKind: "package", kind: "legacy-waf", rules };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareZoneEntityId({ components: { accountId, providerId }, kind: "legacy-waf", zoneId }),
    kind: "legacy-waf",
    lastSeenAt: at,
    providerId,
    scope: { accountId, parentId: null, zoneId },
    source: { channel: "rest-api", observedAt: at, operation: "legacy-waf-packages-fanout" },
    state: "observed",
  };
}

/**
 * Project one raw WAF override into a `legacy-waf` OVERRIDE entity.
 *
 * @param raw the raw override, already validated to carry a non-empty `id`
 * @param accountId the selected account id
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareWafOverride({
  raw,
  accountId,
  zoneId,
  at,
}: {
  raw: CloudflareRawWafOverride & { id: string };
  accountId: string;
  zoneId: string;
  at: string;
}): CloudflareEntity {
  const providerId = `override:${raw.id}`;
  const detail: CloudflareWafOverrideDetail = {
    description: unsetFieldAsNull({ key: "description", record: raw }),
    groupActions: isRecord(raw.groups) ? { ...raw.groups } : {},
    itemKind: "override",
    kind: "legacy-waf",
    paused: unsetFieldAsNull({ key: "paused", record: raw }),
    priority: unsetFieldAsNull({ key: "priority", record: raw }),
    rewriteAction: isRecord(raw.rewrite_action) ? { ...raw.rewrite_action } : null,
    ruleActions: isRecord(raw.rules) ? { ...raw.rules } : {},
    urls: wafOverrideUrls({ override: raw }),
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareZoneEntityId({ components: { accountId, providerId }, kind: "legacy-waf", zoneId }),
    kind: "legacy-waf",
    lastSeenAt: at,
    providerId,
    scope: { accountId, parentId: null, zoneId },
    source: { channel: "rest-api", observedAt: at, operation: "legacy-waf-overrides-list" },
    state: "observed",
  };
}
