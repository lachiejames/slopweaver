/** The Zero Trust router of the `syncCloudflareAtlas` all-kinds `fetch` stub. */

import type { FetchRouter } from "./harnessTypes.js";
import { jsonResponse, listPage } from "./httpResponses.js";

/** Every paginated Zero Trust collection, as a path suffix and the fixture rows it answers with. */
const zeroTrustCollectionResponse: FetchRouter = ({ fixture: { zeroTrust }, request: { pathname, page } }) => {
  const collections: readonly [string, readonly unknown[]][] = [
    ["/gateway/rules", zeroTrust.gatewayPolicies],
    ["/gateway/locations", zeroTrust.gatewayLocations],
    ["/gateway/certificates", zeroTrust.gatewayCertificates],
    ["/gateway/proxy_endpoints", zeroTrust.gatewayProxyEndpoints],
    ["/access/users", zeroTrust.accessUsers],
    ["/devices/registrations", zeroTrust.deviceRegistrations],
    ["/devices/policies", zeroTrust.customDevicePolicies],
    ["/devices/networks", zeroTrust.deviceManagedNetworks],
    ["/cfd_tunnel", zeroTrust.tunnels],
    ["/teamnet/routes", zeroTrust.tunnelRoutes],
    ["/teamnet/virtual_networks", zeroTrust.virtualNetworks],
    ["/zerotrust/subnets", zeroTrust.subnets],
    ["/dlp/profiles", zeroTrust.dlpProfiles],
    ["/one/integrations", zeroTrust.casbIntegrations],
    ["/access/tags", zeroTrust.accessTags],
    ["/access/bookmarks", zeroTrust.accessBookmarks],
    ["/access/custom_pages", zeroTrust.accessCustomPages],
    ["/access/certificates", zeroTrust.accessMtlsCertificates],
    ["/access/saml_certificates", zeroTrust.accessSamlCertificates],
    ["/access/gateway_ca", zeroTrust.accessGatewayCas],
    ["/infrastructure/targets", zeroTrust.accessInfrastructureTargets],
    ["/access/logs/scim/updates", zeroTrust.accessScimUpdates],
    ["/dlp/datasets", zeroTrust.dlpDatasets],
    ["/data-security/posture/findings", zeroTrust.casbFindings],
    ["/zt_risk_scoring/integrations", zeroTrust.riskScoreIntegrations],
    ["/dex/fleet-status/devices", zeroTrust.dexFleetStatus],
  ];
  const collection = collections.find(([suffix]) => pathname.endsWith(suffix));
  if (collection !== undefined) {
    return jsonResponse({ body: listPage({ items: collection[1], page }), status: 200 });
  }
  return null;
};

/** The two Zero Trust surfaces that are not a plain page: the DEX overview and the bare authentication log. */
const zeroTrustSpecialResponse: FetchRouter = ({ fixture: { zeroTrust }, request: { pathname, page } }) => {
  // `dex/tests/overview` is the ONE surface here paged by `V4PagePagination` rather than
  // `V4PagePaginationArray`: its items come from `result.items`, not from `result`, and each item is an
  // overview object carrying its own `tests` array — so a test sits TWO levels below the body. See
  // `readers/zeroTrustPosture.ts` for the reader's matching nested loop.
  if (pathname.endsWith("/dex/tests/overview")) {
    const items = page === 1 ? [{ overviewMetrics: {}, tests: zeroTrust.dexTests }] : [];
    return jsonResponse({
      body: { result: { items }, result_info: { count: items.length, page }, success: true },
      status: 200,
    });
  }
  // Not a page at all: the authentication-log surface answers a bare array.
  if (pathname.endsWith("/access/logs/access_requests")) {
    return jsonResponse({ body: { result: zeroTrust.accessAuthenticationEvents, success: true }, status: 200 });
  }
  return null;
};

/** Every Zero Trust singleton, as a path suffix and the one record it answers with. */
const zeroTrustSingletonResponse: FetchRouter = ({ fixture: { zeroTrust }, request: { pathname } }) => {
  const singletons: readonly [string, unknown][] = [
    ["/gateway/configuration", zeroTrust.gatewayConfiguration],
    ["/gateway/logging", zeroTrust.gatewayLogging],
    ["/gateway/audit_ssh_settings", zeroTrust.gatewayAuditSsh],
    ["/access/organizations", zeroTrust.organization],
    ["/devices/policy", zeroTrust.defaultDevicePolicy],
    ["/devices/settings", zeroTrust.deviceSetting],
    ["/zerotrust/connectivity_settings", zeroTrust.connectivitySetting],
    ["/access/keys", zeroTrust.accessKeyConfiguration],
    ["/zt_risk_scoring/behaviors", zeroTrust.riskScoreBehaviours],
    ["/zt_risk_scoring/summary", zeroTrust.riskScoreSummary],
  ];
  const singleton = singletons.find(([suffix]) => pathname.endsWith(suffix));
  return singleton === undefined ? null : jsonResponse({ body: { result: singleton[1], success: true }, status: 200 });
};

/**
 * Route every Zero Trust endpoint — checked FIRST, before every other router, because two of them
 * would otherwise be swallowed by a broader suffix downstream: the zone-certificate router matches a
 * bare `/certificates` for Origin CA, which `/gateway/certificates` also ends with, and every check here is
 * a full product-scoped suffix rather than a trailing noun. The same reason puts `/access/certificates`
 * here rather than beside it.
 *
 * Defaults are empty collections and empty singletons, so a test that says nothing about Zero Trust still
 * gets a complete, successful run rather than a wall of failed reads — the same posture every other router
 * in this directory takes.
 *
 * @returns the matching fixture response, or `null` if this pathname is not a Zero Trust endpoint
 */
export const zeroTrustFetchResponse: FetchRouter = (options) => {
  const collection = zeroTrustCollectionResponse(options);
  if (collection !== null) {
    return collection;
  }
  const special = zeroTrustSpecialResponse(options);
  if (special !== null) {
    return special;
  }
  return zeroTrustSingletonResponse(options);
};
