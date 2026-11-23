import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createCloudflareClient } from "../../../../../atlas/cloudflare/client.js";
import { cloudflareAtlasPaths, readCloudflareKindFile } from "../../../../../atlas/cloudflare/store.js";
import { syncCloudflareAtlas } from "../../../../../atlas/cloudflare/sync.js";
import { unwrap } from "../../../../../lib/result.js";
import { AT, FLAT_KINDS, LATER, noopProgress, outcomeFor, SELECTION } from "./fixtures.js";
import { allKindsFetch, freshHome, removeFixtureHomes } from "./harness.js";
import { jsonResponse, requestUrl } from "./httpResponses.js";

describe("syncCloudflareAtlas", () => {
  let home: string;
  beforeEach(() => {
    home = freshHome();
  });
  afterEach(removeFixtureHomes);

  it("a failed classic-firewall subtype preserves only its own entities, without losing the other five", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async (input) => {
        const url = requestUrl({ input });
        if (url.pathname.endsWith("/rate_limits")) {
          return jsonResponse({ body: { errors: [{ message: "deprecated" }], success: false }, status: 410 });
        }
        return allKindsFetch({
          filters: [{ id: "cf-1" }],
          firewallRules: [{ id: "fr-1" }],
          ipAccessRules: [{ id: "ip-1" }],
          lockdowns: [{ id: "lock-1" }],
          uaRules: [{ id: "ua-1" }],
        })(input);
      },
      maxRetries: 0,
    });
    const result = await syncCloudflareAtlas({ at: AT, client, home, progress: noopProgress, selection: SELECTION });
    const report = unwrap(result);
    const firewallServiceOutcome = outcomeFor({ kind: "firewall-service", kinds: report.kinds });
    expect(firewallServiceOutcome?.complete).toBe(false);
    expect(firewallServiceOutcome?.entityCount).toBe(5);
    for (const kind of FLAT_KINDS) {
      expect(outcomeFor({ kind, kinds: report.kinds })?.complete).toBe(true);
    }

    const paths = cloudflareAtlasPaths({ home });
    const firewallServiceFile = unwrap(readCloudflareKindFile({ kind: "firewall-service", paths }));
    expect(firewallServiceFile?.entities).toHaveLength(5);
    expect(firewallServiceFile?.gaps.some((gap) => gap.status === "open")).toBe(true);
  });

  it("re-syncing after one classic-firewall subtype recovers replaces only that subtype's entities", async () => {
    const failingClient = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async (input) => {
        const url = requestUrl({ input });
        if (url.pathname.endsWith("/rate_limits")) {
          return jsonResponse({ body: { errors: [{ message: "deprecated" }], success: false }, status: 410 });
        }
        return allKindsFetch({ filters: [{ id: "cf-1" }] })(input);
      },
      maxRetries: 0,
    });
    await syncCloudflareAtlas({ at: AT, client: failingClient, home, progress: noopProgress, selection: SELECTION });

    const recoveredClient = createCloudflareClient({
      apiToken: "t",
      fetchImpl: allKindsFetch({ filters: [{ id: "cf-1" }], rateLimits: [{ id: "rl-1" }] }),
      maxRetries: 0,
    });
    const result = await syncCloudflareAtlas({
      at: LATER,
      client: recoveredClient,
      home,
      progress: noopProgress,
      selection: SELECTION,
    });
    const report = unwrap(result);
    const firewallServiceOutcome = outcomeFor({ kind: "firewall-service", kinds: report.kinds });
    expect(firewallServiceOutcome).toEqual({ complete: true, entityCount: 2, kind: "firewall-service", reasons: [] });

    const paths = cloudflareAtlasPaths({ home });
    const firewallServiceFile = unwrap(readCloudflareKindFile({ kind: "firewall-service", paths }));
    expect(firewallServiceFile?.entities.map((entity) => entity.providerId).toSorted()).toEqual([
      "filter:cf-1",
      "rate-limit:rl-1",
    ]);
    expect(firewallServiceFile?.gaps.every((gap) => gap.status === "closed")).toBe(true);
  });

  it("a failed WAF-package inventory read preserves stored overrides untouched, without failing any other kind", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async (input) => {
        const url = requestUrl({ input });
        if (url.pathname.endsWith("/waf/packages")) {
          return jsonResponse({
            body: { errors: [{ message: "WAF is deprecated for this zone" }], success: false },
            status: 403,
          });
        }
        return allKindsFetch({ wafOverrides: [{ id: "o-1" }] })(input);
      },
      maxRetries: 0,
    });
    const result = await syncCloudflareAtlas({ at: AT, client, home, progress: noopProgress, selection: SELECTION });
    const report = unwrap(result);
    const legacyWafOutcome = outcomeFor({ kind: "legacy-waf", kinds: report.kinds });
    expect(legacyWafOutcome?.complete).toBe(false);
    expect(legacyWafOutcome?.entityCount).toBe(1);
    for (const kind of FLAT_KINDS) {
      expect(outcomeFor({ kind, kinds: report.kinds })?.complete).toBe(true);
    }

    const paths = cloudflareAtlasPaths({ home });
    const legacyWafFile = unwrap(readCloudflareKindFile({ kind: "legacy-waf", paths }));
    expect(legacyWafFile?.entities.map((entity) => entity.providerId)).toEqual(["override:o-1"]);
    expect(legacyWafFile?.gaps.some((gap) => gap.status === "open")).toBe(true);
  });

  it("a failed zone-certificate subtype preserves only its own entities, without losing the other nine", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async (input) => {
        const url = requestUrl({ input });
        if (url.pathname.endsWith("/keyless_certificates")) {
          return jsonResponse({ body: { errors: [{ message: "denied" }], success: false }, status: 403 });
        }
        return allKindsFetch({
          aopHostnameCertificates: [{ id: "aophc-1" }],
          aopSetting: { enabled: true },
          aopZoneCertificates: [{ id: "aopzc-1" }],
          certificatePacks: [{ id: "pack-1" }],
          clientCertificates: [{ id: "cc-1" }],
          customCertificates: [{ id: "cert-1" }],
          customHostnames: [{ id: "ch-1" }],
          originCaCertificates: [{ id: "ca-1" }],
          universalSslSetting: { enabled: true },
          universalSslVerification: [{ cert_pack_uuid: "verify-uuid-1", certificate_status: "active" }],
        })(input);
      },
      maxRetries: 0,
    });
    const result = await syncCloudflareAtlas({ at: AT, client, home, progress: noopProgress, selection: SELECTION });
    const report = unwrap(result);
    const zoneCertificateOutcome = outcomeFor({ kind: "zone-certificate", kinds: report.kinds });
    expect(zoneCertificateOutcome?.complete).toBe(false);
    expect(zoneCertificateOutcome?.entityCount).toBe(10);
    for (const kind of FLAT_KINDS) {
      expect(outcomeFor({ kind, kinds: report.kinds })?.complete).toBe(true);
    }

    const paths = cloudflareAtlasPaths({ home });
    const zoneCertificateFile = unwrap(readCloudflareKindFile({ kind: "zone-certificate", paths }));
    expect(zoneCertificateFile?.entities).toHaveLength(10);
    expect(zoneCertificateFile?.entities.some((entity) => entity.providerId.startsWith("keyless-certificate:"))).toBe(
      false,
    );
    expect(zoneCertificateFile?.gaps.some((gap) => gap.status === "open")).toBe(true);
  });

  it("a failed api-gateway subtype preserves only its own entities, without losing the other seven", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async (input) => {
        const url = requestUrl({ input });
        if (url.pathname.endsWith("/api_gateway/labels")) {
          return jsonResponse({ body: { errors: [{ message: "denied" }], success: false }, status: 403 });
        }
        return allKindsFetch({
          apiGatewaySchemas: { schemas: [{ path: "/orders" }] },
          apiGatewaySettings: { validation_default_mitigation_action: "log" },
          configuration: { auth_id_characteristics: [{ name: "authorization", type: "header" }] },
          discoveryOperations: [{ id: "disc-1" }],
          discoverySchemas: { schemas: [{ path: "/users" }] },
          operations: [{ operation_id: "op-1" }],
          userSchemas: [{ schema_id: "sch-1" }],
        })(input);
      },
      maxRetries: 0,
    });
    const result = await syncCloudflareAtlas({ at: AT, client, home, progress: noopProgress, selection: SELECTION });
    const report = unwrap(result);
    const apiGatewayOutcome = outcomeFor({ kind: "api-gateway", kinds: report.kinds });
    expect(apiGatewayOutcome?.complete).toBe(false);
    expect(apiGatewayOutcome?.entityCount).toBe(7);
    for (const kind of FLAT_KINDS) {
      expect(outcomeFor({ kind, kinds: report.kinds })?.complete).toBe(true);
    }

    const paths = cloudflareAtlasPaths({ home });
    const apiGatewayFile = unwrap(readCloudflareKindFile({ kind: "api-gateway", paths }));
    expect(apiGatewayFile?.entities).toHaveLength(7);
    expect(apiGatewayFile?.entities.some((entity) => entity.providerId.startsWith("label:"))).toBe(false);
    expect(apiGatewayFile?.gaps.some((gap) => gap.status === "open")).toBe(true);
  });

  it("a failed zone-analytics subtype preserves only its own entity, without losing the other", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async (input, init) => {
        const url = requestUrl({ input });
        const body = typeof init?.body === "string" ? (JSON.parse(init.body) as { query?: string }) : {};
        // oxlint-disable-next-line prefer-nullish-coalescing -- house-rules bans `?? ""`; this ternary is the honest form
        const query = body.query === undefined ? "" : body.query;
        if (url.pathname.endsWith("/graphql") && query.includes("dnsAnalyticsAdaptiveGroups")) {
          return jsonResponse({
            body: { data: null, errors: [{ message: "dns analytics not enabled" }] },
            status: 200,
          });
        }
        return allKindsFetch({
          httpRequestGroups: [{ count: 5, dimensions: { datetimeHour: "2026-01-01T00:00:00Z" } }],
        })(input, init);
      },
      maxRetries: 0,
    });
    const result = await syncCloudflareAtlas({ at: AT, client, home, progress: noopProgress, selection: SELECTION });
    const report = unwrap(result);
    const zoneAnalyticsOutcome = outcomeFor({ kind: "zone-analytics", kinds: report.kinds });
    expect(zoneAnalyticsOutcome?.complete).toBe(false);
    expect(zoneAnalyticsOutcome?.entityCount).toBe(1);
    for (const kind of FLAT_KINDS) {
      expect(outcomeFor({ kind, kinds: report.kinds })?.complete).toBe(true);
    }

    const paths = cloudflareAtlasPaths({ home });
    const zoneAnalyticsFile = unwrap(readCloudflareKindFile({ kind: "zone-analytics", paths }));
    expect(zoneAnalyticsFile?.entities).toHaveLength(1);
    expect(zoneAnalyticsFile?.entities.some((entity) => entity.providerId === "dns-queries")).toBe(false);
    expect(zoneAnalyticsFile?.entities.some((entity) => entity.providerId === "http-requests")).toBe(true);
    expect(zoneAnalyticsFile?.gaps.some((gap) => gap.status === "open")).toBe(true);
  });
});
