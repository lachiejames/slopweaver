/**
 * The compound-zone routers of the `syncCloudflareAtlas` all-kinds `fetch` stub: the ten zone-certificate
 * endpoints, the eight API Gateway endpoints and the GraphQL zone-analytics endpoint.
 */

import type { FetchRouter } from "./harnessTypes.js";
import { jsonResponse, listPage } from "./httpResponses.js";

/** The Authenticated Origin Pull and certificate-pack endpoints, most specific first. */
const aopAndPackResponse: FetchRouter = ({
  fixture: { aopHostnameCertificates, aopSetting, aopZoneCertificates, certificatePacks },
  request: { pathname, page },
}) => {
  if (pathname.endsWith("/origin_tls_client_auth/hostnames/certificates")) {
    return jsonResponse({ body: listPage({ items: aopHostnameCertificates, page }), status: 200 });
  }
  if (pathname.endsWith("/origin_tls_client_auth/settings")) {
    return jsonResponse({ body: { result: aopSetting, success: true }, status: 200 });
  }
  if (pathname.endsWith("/origin_tls_client_auth")) {
    return jsonResponse({ body: listPage({ items: aopZoneCertificates, page }), status: 200 });
  }
  if (pathname.endsWith("/ssl/certificate_packs")) {
    return jsonResponse({ body: listPage({ items: certificatePacks, page }), status: 200 });
  }
  return null;
};

/** The Universal SSL, custom, client, keyless, custom-hostname and Origin CA endpoints. */
const sslAndCertificateResponse: FetchRouter = ({
  fixture: {
    universalSslSetting,
    universalSslVerification,
    customCertificates,
    clientCertificates,
    keylessCertificates,
    originCaCertificates,
    customHostnames,
  },
  request: { pathname, page },
}) => {
  if (pathname.endsWith("/ssl/universal/settings")) {
    return jsonResponse({ body: { result: universalSslSetting, success: true }, status: 200 });
  }
  if (pathname.endsWith("/ssl/verification")) {
    return jsonResponse({ body: { result: universalSslVerification, success: true }, status: 200 });
  }
  if (pathname.endsWith("/custom_certificates")) {
    return jsonResponse({ body: listPage({ items: customCertificates, page }), status: 200 });
  }
  if (pathname.endsWith("/client_certificates")) {
    return jsonResponse({ body: listPage({ items: clientCertificates, page }), status: 200 });
  }
  if (pathname.endsWith("/keyless_certificates")) {
    return jsonResponse({ body: listPage({ items: keylessCertificates, page }), status: 200 });
  }
  if (pathname.endsWith("/custom_hostnames")) {
    return jsonResponse({ body: listPage({ items: customHostnames, page }), status: 200 });
  }
  if (pathname.endsWith("/certificates")) {
    return jsonResponse({ body: listPage({ items: originCaCertificates, page }), status: 200 });
  }
  return null;
};

/**
 * Route the ten `zone-certificate` endpoints. Every check that could collide on a shared `/certificates`
 * trailing segment (AOP's hostname-certificates path, Origin CA's bare `/certificates`) runs
 * most-specific-first, same rule as every other per-parent items check in this directory.
 *
 * @returns the matching fixture response, or `null` if this pathname is not one of these ten endpoints
 */
export const zoneCertificateFetchResponse: FetchRouter = (options) => {
  const aopOrPack = aopAndPackResponse(options);
  if (aopOrPack !== null) {
    return aopOrPack;
  }
  return sslAndCertificateResponse(options);
};

/**
 * Route the eight `api-gateway` endpoints.
 *
 * @returns the matching fixture response, or `null` if this pathname is not one of these eight endpoints
 */
export const apiGatewayFetchResponse: FetchRouter = (options) => {
  const {
    fixture: {
      operations,
      discoveryOperations,
      discoverySchemas,
      apiGatewaySchemas,
      labels,
      apiGatewaySettings,
      configuration,
      userSchemas,
    },
    request: { pathname, page },
  } = options;
  if (pathname.endsWith("/api_gateway/discovery/operations")) {
    return jsonResponse({ body: listPage({ items: discoveryOperations, page }), status: 200 });
  }
  if (pathname.endsWith("/api_gateway/discovery")) {
    return jsonResponse({ body: { result: discoverySchemas, success: true }, status: 200 });
  }
  if (pathname.endsWith("/api_gateway/operations")) {
    return jsonResponse({ body: listPage({ items: operations, page }), status: 200 });
  }
  if (pathname.endsWith("/api_gateway/schemas")) {
    return jsonResponse({ body: { result: apiGatewaySchemas, success: true }, status: 200 });
  }
  if (pathname.endsWith("/api_gateway/user_schemas")) {
    return jsonResponse({ body: listPage({ items: userSchemas, page }), status: 200 });
  }
  if (pathname.endsWith("/api_gateway/configuration")) {
    return jsonResponse({ body: { result: configuration, success: true }, status: 200 });
  }
  if (pathname.endsWith("/api_gateway/settings/schema_validation")) {
    return jsonResponse({ body: { result: apiGatewaySettings, success: true }, status: 200 });
  }
  if (pathname.endsWith("/api_gateway/labels")) {
    return jsonResponse({ body: listPage({ items: labels, page }), status: 200 });
  }
  return null;
};

/**
 * The `query` a GraphQL request body carries — empty when the body is not a string or names none, and a throw
 * on a null body or a query that is neither a string nor an array, as the original's direct `.includes` did.
 */
function graphqlQuery({ init }: { init: RequestInit | undefined }): string | readonly unknown[] {
  if (typeof init?.body !== "string") {
    return "";
  }
  const parsed: unknown = JSON.parse(init.body);
  if (parsed === null) {
    throw new TypeError("a graphql request body parsed to null");
  }
  if (typeof parsed !== "object" || !("query" in parsed)) {
    return "";
  }
  const query: unknown = parsed.query;
  // A string or an array both answer `.includes`, as the original's direct call did; anything else threw there.
  if (typeof query === "string") {
    return query;
  }
  if (Array.isArray(query)) {
    const items: readonly unknown[] = query;
    return items;
  }
  throw new TypeError("a graphql request body carries a query that is neither a string nor an array");
}

/**
 * Route the GraphQL Analytics endpoint by the dataset a `/graphql` request body's query string asks for.
 * Routing on the request body rather than the path, since both `zone-analytics` subtypes share the one
 * `/graphql` endpoint.
 *
 * @returns the matching fixture response, or `null` if this is not a `/graphql` request at all
 */
export const zoneAnalyticsFetchResponse: FetchRouter = (options) => {
  const {
    fixture: { httpRequestGroups, dnsQueryGroups },
    request: { pathname, init },
  } = options;
  if (!pathname.endsWith("/graphql")) {
    return null;
  }
  const query = graphqlQuery({ init });
  if (query.includes("httpRequestsAdaptiveGroups")) {
    return jsonResponse({
      body: { data: { viewer: { zones: [{ httpRequestsAdaptiveGroups: httpRequestGroups }] } }, errors: null },
      status: 200,
    });
  }
  if (query.includes("dnsAnalyticsAdaptiveGroups")) {
    return jsonResponse({
      body: { data: { viewer: { zones: [{ dnsAnalyticsAdaptiveGroups: dnsQueryGroups }] } }, errors: null },
      status: 200,
    });
  }
  return jsonResponse({ body: { data: null, errors: [{ message: "unrecognised graphql query" }] }, status: 200 });
};
