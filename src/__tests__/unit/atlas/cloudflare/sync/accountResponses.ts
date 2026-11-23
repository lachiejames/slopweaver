/**
 * The account-level routers of the `syncCloudflareAtlas` all-kinds `fetch` stub: Rulesets, the six flat
 * kinds, the Access-policy / Gateway List / filter-list fan-out, Notifications, the audit log, and the
 * account's own metadata and mTLS certificates.
 */

import { ACCOUNT_ID } from "./fixtures.js";
import type { FetchRouter } from "./harnessTypes.js";
import {
  filterListItemsListId,
  gatewayListItemsListId,
  jsonResponse,
  listPage,
  perAppPolicyApplicationId,
} from "./httpResponses.js";

/**
 * Route the Rulesets endpoints at BOTH scopes — `/accounts/{id}/rulesets` and `/zones/{id}/rulesets` are the
 * same path suffix, which is exactly why `ruleset` and `zone-ruleset` are two kinds with two id spaces.
 *
 * The per-ruleset `get` is checked FIRST, for the same reason every other per-parent check in this directory
 * is: `/rulesets/{id}` also contains the inventory path.
 *
 * @returns the matching fixture response, or `null` if this pathname is not a Rulesets endpoint
 */
export const rulesetFetchResponse: FetchRouter = (options) => {
  const {
    fixture: { rulesets, rulesetRulesById },
    request: { pathname, page },
  } = options;
  const detail = rulesets.find((ruleset) => pathname.endsWith(`/rulesets/${ruleset.id}`));
  if (detail !== undefined) {
    // The ruleset is copied BEFORE its rules are looked up, the order the original read them in.
    const ruleset = { ...detail };
    const rules = rulesetRulesById[detail.id];
    // A ruleset the case declared no rules for answers an empty rule list.
    if (rules == null) {
      return jsonResponse({ body: { result: { ...ruleset, rules: [] }, success: true }, status: 200 });
    }
    return jsonResponse({ body: { result: { ...ruleset, rules }, success: true }, status: 200 });
  }
  if (pathname.endsWith("/rulesets")) {
    return jsonResponse({ body: listPage({ items: rulesets, page }), status: 200 });
  }
  return null;
};

/**
 * Route one of the six flat kinds' endpoints.
 *
 * @returns the matching fixture response, or `null` if this pathname is not a flat-kind endpoint
 */
export const flatKindFetchResponse: FetchRouter = (options) => {
  const {
    fixture: { zones, applications, groups, serviceTokens, identityProviders, postureRules },
    request: { pathname, page },
  } = options;
  if (pathname.endsWith("/zones")) {
    const items = zones.map((zone) => ({ account: { id: ACCOUNT_ID }, id: zone.id, name: zone.name }));
    return jsonResponse({ body: listPage({ items, page }), status: 200 });
  }
  if (pathname.includes("/access/apps")) {
    return jsonResponse({ body: listPage({ items: applications, page }), status: 200 });
  }
  if (pathname.includes("/access/groups")) {
    return jsonResponse({ body: listPage({ items: groups, page }), status: 200 });
  }
  if (pathname.includes("/access/service_tokens")) {
    return jsonResponse({ body: listPage({ items: serviceTokens, page }), status: 200 });
  }
  if (pathname.includes("/access/identity_providers")) {
    return jsonResponse({ body: listPage({ items: identityProviders, page }), status: 200 });
  }
  if (pathname.includes("/devices/posture")) {
    return jsonResponse({ body: { result: postureRules, success: true }, status: 200 });
  }
  return null;
};

/** The Access-policy endpoints: per-application policies, then the account's reusable policy list. */
const accessPolicyResponse: FetchRouter = ({
  fixture: { policiesByApplication, reusablePolicies },
  request: { pathname, page },
}) => {
  const perAppApplicationId = perAppPolicyApplicationId({ pathname });
  if (perAppApplicationId !== null) {
    const items = policiesByApplication[perAppApplicationId];
    // An application the case declared no policies for answers an empty page.
    if (items == null) {
      return jsonResponse({ body: listPage({ items: [], page }), status: 200 });
    }
    return jsonResponse({ body: listPage({ items, page }), status: 200 });
  }
  if (pathname.includes("/access/policies")) {
    return jsonResponse({ body: listPage({ items: reusablePolicies, page }), status: 200 });
  }
  return null;
};

/** The Gateway List endpoints: per-list items, then the list inventory. */
const gatewayListResponse: FetchRouter = ({
  fixture: { gatewayLists, gatewayListItemsByList },
  request: { pathname, page },
}) => {
  const gatewayListId = gatewayListItemsListId({ pathname });
  if (gatewayListId !== null) {
    const items = gatewayListItemsByList[gatewayListId];
    // A list the case declared no items for answers an empty page.
    if (items == null) {
      return jsonResponse({ body: listPage({ items: [], page }), status: 200 });
    }
    return jsonResponse({ body: listPage({ items, page }), status: 200 });
  }
  if (pathname.includes("/gateway/lists")) {
    return jsonResponse({ body: { result: gatewayLists, success: true }, status: 200 });
  }
  return null;
};

/** The account filter-list endpoints: per-list items, then the list inventory. */
const filterListResponse: FetchRouter = ({
  fixture: { filterLists, filterListItemsByList },
  request: { pathname },
}) => {
  const filterListId = filterListItemsListId({ pathname });
  if (filterListId !== null) {
    const result = filterListItemsByList[filterListId];
    // A filter list the case declared no items for answers an empty result.
    if (result == null) {
      return jsonResponse({ body: { result: [], result_info: {}, success: true }, status: 200 });
    }
    return jsonResponse({ body: { result, result_info: {}, success: true }, status: 200 });
  }
  if (pathname.includes("/rules/lists")) {
    return jsonResponse({ body: { result: filterLists, success: true }, status: 200 });
  }
  return null;
};

/**
 * Route the Access-policy, Gateway List and account filter-list endpoints (per-app policies, the reusable
 * policy list, per-list items, and the two list inventories). Every per-parent items check MUST run before
 * its own kind's generic inventory-list check below it, since a per-parent items path also contains that
 * substring.
 *
 * @returns the matching fixture response, or `null` if this pathname is not one of these endpoints
 */
export const nonFlatFetchResponse: FetchRouter = (options) => {
  const policy = accessPolicyResponse(options);
  if (policy !== null) {
    return policy;
  }
  const gatewayList = gatewayListResponse(options);
  if (gatewayList !== null) {
    return gatewayList;
  }
  return filterListResponse(options);
};

/**
 * Route one of the four Notifications endpoints. `/destinations/pagerduty` and `/policies` are each checked
 * with `.endsWith` on the full `/alerting/v3/...` suffix, since `/access/policies` (a different kind's
 * endpoint, routed earlier in the chain) also ends with the bare word "policies".
 *
 * @returns the matching fixture response, or `null` if this pathname is not a Notifications endpoint
 */
export const notificationsFetchResponse: FetchRouter = (options) => {
  const {
    fixture: {
      notificationPolicies,
      notificationWebhooks,
      notificationPagerduty,
      notificationSilences,
      notificationHistory,
    },
    request: { pathname, page },
  } = options;
  if (pathname.endsWith("/alerting/v3/policies")) {
    return jsonResponse({ body: { result: notificationPolicies, success: true }, status: 200 });
  }
  if (pathname.endsWith("/destinations/webhooks")) {
    return jsonResponse({ body: { result: notificationWebhooks, success: true }, status: 200 });
  }
  if (pathname.endsWith("/destinations/pagerduty")) {
    return jsonResponse({ body: { result: notificationPagerduty, success: true }, status: 200 });
  }
  if (pathname.endsWith("/alerting/v3/silences")) {
    return jsonResponse({ body: { result: notificationSilences, success: true }, status: 200 });
  }
  if (pathname.endsWith("/alerting/v3/history")) {
    return jsonResponse({ body: listPage({ items: notificationHistory, page }), status: 200 });
  }
  return null;
};

/**
 * Route the `audit_logs` endpoint. The reader issues one call for its 30-day window, so this ignores
 * `since`/`before` entirely and just returns the fixture's items on the first page.
 *
 * @returns the matching fixture response, or `null` if this pathname is not the audit-logs endpoint
 */
export const auditLogFetchResponse: FetchRouter = (options) => {
  const {
    fixture: { auditLogs },
    request: { pathname, page },
  } = options;
  if (!pathname.endsWith("/audit_logs")) {
    return null;
  }
  const items = page === 1 ? auditLogs : [];
  return jsonResponse({
    body: { result: items, result_info: { count: items.length, page }, success: true },
    status: 200,
  });
};

/** The certificate id path segment of a per-certificate mTLS associations request, or `null` if this is not
 * one. */
function accountCertificateAssociationsCertId({ pathname }: { pathname: string }): string | null {
  const match = /\/mtls_certificates\/([^/]+)\/associations$/.exec(pathname);
  return match === null ? null : match[1]!;
}

/**
 * Route the account-level `accounts/{id}` and `mtls_certificates` endpoints.
 *
 * @returns the matching fixture response, or `null` if this pathname is not an account-state endpoint
 */
export const accountStateFetchResponse: FetchRouter = (options) => {
  const {
    fixture: { accountSetting, accountCertificates, accountCertificateAssociationsByCert },
    request: { pathname },
  } = options;
  const associationsCertId = accountCertificateAssociationsCertId({ pathname });
  if (associationsCertId !== null) {
    const result = accountCertificateAssociationsByCert[associationsCertId];
    // A certificate the case declared no associations for answers an empty list.
    if (result == null) {
      return jsonResponse({ body: { result: [], success: true }, status: 200 });
    }
    return jsonResponse({ body: { result, success: true }, status: 200 });
  }
  if (pathname.endsWith("/mtls_certificates")) {
    return jsonResponse({ body: { result: accountCertificates, success: true }, status: 200 });
  }
  if (/\/accounts\/[^/]+$/.test(pathname)) {
    return jsonResponse({ body: { result: accountSetting, success: true }, status: 200 });
  }
  return null;
};
