/**
 * The base-zone routers of the `syncCloudflareAtlas` all-kinds `fetch` stub: the five deep-zone-only
 * endpoints and the classic firewall / WAF family.
 */

import type { FetchRouter, ResolvedAllKindsFixture } from "./harnessTypes.js";
import { jsonResponse, listPage } from "./httpResponses.js";

/**
 * Route the five deep-zone-only endpoints (`dns_records`, `dnssec`, `settings`, `pagerules`,
 * `workers/routes`). Each is checked with `.endsWith` on its own distinct trailing segment.
 *
 * @returns the matching fixture response, or `null` if this pathname is not a deep-zone endpoint
 */
export const deepZoneFetchResponse: FetchRouter = (options) => {
  const {
    fixture: { dnsRecords, dnssec, zoneSettings, pageRules, workerRoutes },
    request: { pathname, page },
  } = options;
  if (pathname.endsWith("/dns_records")) {
    return jsonResponse({ body: listPage({ items: dnsRecords, page }), status: 200 });
  }
  if (pathname.endsWith("/dnssec")) {
    return jsonResponse({ body: { result: dnssec, success: true }, status: 200 });
  }
  if (pathname.endsWith("/settings")) {
    return jsonResponse({ body: { result: zoneSettings, success: true }, status: 200 });
  }
  if (pathname.endsWith("/pagerules")) {
    return jsonResponse({ body: { result: pageRules, success: true }, status: 200 });
  }
  if (pathname.endsWith("/workers/routes")) {
    return jsonResponse({ body: { result: workerRoutes, success: true }, status: 200 });
  }
  return null;
};

/** The package id path segment of a per-package WAF groups request, or `null` if this is not one. */
function wafPackageGroupsPackageId({ pathname }: { pathname: string }): string | null {
  const match = /\/firewall\/waf\/packages\/([^/]+)\/groups$/.exec(pathname);
  return match === null ? null : match[1]!;
}

/** The package id path segment of a per-package WAF rules request, or `null` if this is not one. */
function wafPackageRulesPackageId({ pathname }: { pathname: string }): string | null {
  const match = /\/firewall\/waf\/packages\/([^/]+)\/rules$/.exec(pathname);
  return match === null ? null : match[1]!;
}

/** One WAF package's groups. A package the case seeded no groups for has none. */
function wafPackageGroups({
  groupsPackageId,
  wafGroupsByPackage,
}: {
  groupsPackageId: string;
  wafGroupsByPackage: ResolvedAllKindsFixture["wafGroupsByPackage"];
}): readonly { id: string }[] {
  const groups = wafGroupsByPackage[groupsPackageId];
  if (groups === undefined) {
    return [];
  }
  return groups;
}

/** One WAF package's rules. A package the case seeded no rules for has none. */
function wafPackageRules({
  rulesPackageId,
  wafRulesByPackage,
}: {
  rulesPackageId: string;
  wafRulesByPackage: ResolvedAllKindsFixture["wafRulesByPackage"];
}): readonly { id: string }[] {
  const rules = wafRulesByPackage[rulesPackageId];
  if (rules === undefined) {
    return [];
  }
  return rules;
}

/** The per-package WAF groups and rules endpoints. */
const wafPackageChildResponse: FetchRouter = ({
  fixture: { wafGroupsByPackage, wafRulesByPackage },
  request: { pathname, page },
}) => {
  const groupsPackageId = wafPackageGroupsPackageId({ pathname });
  if (groupsPackageId !== null) {
    return jsonResponse({
      body: listPage({ items: wafPackageGroups({ groupsPackageId, wafGroupsByPackage }), page }),
      status: 200,
    });
  }
  const rulesPackageId = wafPackageRulesPackageId({ pathname });
  if (rulesPackageId !== null) {
    return jsonResponse({
      body: listPage({ items: wafPackageRules({ rulesPackageId, wafRulesByPackage }), page }),
      status: 200,
    });
  }
  return null;
};

/** The five classic firewall endpoints. */
const classicFirewallResponse: FetchRouter = ({
  fixture: { firewallRules, ipAccessRules, uaRules, lockdowns, rateLimits },
  request: { pathname, page },
}) => {
  if (pathname.endsWith("/access_rules/rules")) {
    return jsonResponse({ body: listPage({ items: ipAccessRules, page }), status: 200 });
  }
  if (pathname.endsWith("/firewall/rules")) {
    return jsonResponse({ body: listPage({ items: firewallRules, page }), status: 200 });
  }
  if (pathname.endsWith("/ua_rules")) {
    return jsonResponse({ body: listPage({ items: uaRules, page }), status: 200 });
  }
  if (pathname.endsWith("/lockdowns")) {
    return jsonResponse({ body: listPage({ items: lockdowns, page }), status: 200 });
  }
  if (pathname.endsWith("/rate_limits")) {
    return jsonResponse({ body: listPage({ items: rateLimits, page }), status: 200 });
  }
  return null;
};

/** The WAF package inventory, the WAF overrides and the classic filters. */
const wafInventoryResponse: FetchRouter = ({
  fixture: { wafPackages, wafOverrides, filters },
  request: { pathname, page },
}) => {
  if (pathname.endsWith("/waf/packages")) {
    return jsonResponse({ body: listPage({ items: wafPackages, page }), status: 200 });
  }
  if (pathname.endsWith("/waf/overrides")) {
    return jsonResponse({ body: listPage({ items: wafOverrides, page }), status: 200 });
  }
  if (pathname.endsWith("/filters")) {
    return jsonResponse({ body: listPage({ items: filters, page }), status: 200 });
  }
  return null;
};

/**
 * Route the ten classic firewall/WAF endpoints `firewall-service`/`legacy-waf` read. The per-package
 * groups/rules checks MUST run before the generic WAF-packages inventory check, same rule as every other
 * per-parent items check in this directory.
 *
 * @returns the matching fixture response, or `null` if this pathname is not one of these ten endpoints
 */
export const firewallWafFetchResponse: FetchRouter = (options) => {
  const child = wafPackageChildResponse(options);
  if (child !== null) {
    return child;
  }
  const classic = classicFirewallResponse(options);
  if (classic !== null) {
    return classic;
  }
  return wafInventoryResponse(options);
};
