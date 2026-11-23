import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createCloudflareClient } from "../../../../../atlas/cloudflare/client.js";
import { CLOUDFLARE_KINDS } from "../../../../../atlas/cloudflare/model.js";
import { cloudflareAtlasPaths, readCloudflareKindFile } from "../../../../../atlas/cloudflare/store.js";
import { syncCloudflareAtlas } from "../../../../../atlas/cloudflare/sync.js";
import { unwrap } from "../../../../../lib/result.js";
import {
  ACCOUNT_ID,
  ALL_SYNCED_KINDS,
  AT,
  FLAT_KINDS,
  noopProgress,
  outcomeFor,
  SELECTION,
  WIRE_DEPLOYMENT,
} from "./fixtures.js";
import { allKindsFetch, freshHome, removeFixtureHomes } from "./harness.js";
import { ONE_OF_EACH_ZERO_TRUST } from "./zeroTrustFixtures.js";

describe("syncCloudflareAtlas", () => {
  it("has at least one entry in CLOUDFLARE_KINDS, so the guards below are not vacuously green", () => {
    expect(CLOUDFLARE_KINDS.length).toBeGreaterThan(0);
  });

  let home: string;
  beforeEach(() => {
    home = freshHome();
  });
  afterEach(removeFixtureHomes);

  it("syncs every flat kind plus every non-flat kind's fan-out in one run and publishes every kind's file", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: allKindsFetch({
        accountCertificateAssociationsByCert: { "cert-1": [{ service: "access", status: "active" }] },
        accountCertificates: [{ id: "cert-1", name: "My Cert" }],
        accountSetting: { id: ACCOUNT_ID, name: "Acme", type: "enterprise" },
        applications: [{ id: "app-1", name: "App" }],
        auditLogs: [{ id: "log-1" }],
        dnsRecords: [{ id: "record-1", type: "A" }],
        aopHostnameCertificates: [{ id: "aophc-1" }],
        aopSetting: { enabled: true },
        aopZoneCertificates: [{ id: "aopzc-1" }],
        certificatePacks: [{ id: "pack-1" }],
        clientCertificates: [{ id: "cc-1" }],
        customCertificates: [{ id: "cert-1" }],
        apiGatewaySchemas: { schemas: [{ path: "/orders" }], timestamp: "2026-01-01T00:00:00Z" },
        apiGatewaySettings: { validation_default_mitigation_action: "log" },
        configuration: { auth_id_characteristics: [{ name: "authorization", type: "header" }] },
        customHostnames: [{ id: "ch-1" }],
        discoveryOperations: [{ id: "disc-1" }],
        discoverySchemas: { schemas: [{ path: "/users" }], timestamp: "2026-01-01T00:00:00Z" },
        dnsQueryGroups: [{ count: 250, dimensions: { responseCode: "NOERROR" } }],
        dnssec: { status: "active" },
        filterLists: [{ id: "filter-1", kind: "ip", name: "blocklist", num_items: 1, num_referencing_filters: 0 }],
        filterListItemsByList: { "filter-1": [{ id: "item-1", ip: "10.0.0.1" }] },
        filters: [{ id: "cf-1" }],
        firewallRules: [{ id: "fr-1" }],
        gatewayLists: [{ count: 1, id: "gw-1", name: "IPs" }],
        gatewayListItemsByList: { "gw-1": [{ value: "10.0.0.1" }] },
        groups: [{ id: "grp-1", name: "Group" }],
        httpRequestGroups: [{ count: 5, dimensions: { datetimeHour: "2026-01-01T00:00:00Z" } }],
        identityProviders: [{ id: "idp-1", name: "Okta" }],
        ipAccessRules: [{ id: "ip-1" }],
        keylessCertificates: [{ id: "kl-1" }],
        labels: [{ name: "public" }],
        lockdowns: [{ id: "lock-1" }],
        notificationHistory: [{ id: "hist-1", sent: "2026-01-01T00:00:00Z" }],
        notificationPolicies: [{ id: "policy-1", name: "SSL alerts" }],
        notificationSilences: [{ id: "silence-1", policy_id: "policy-1" }],
        notificationWebhooks: [{ id: "hook-1", name: "Slack" }],
        operations: [{ operation_id: "op-1" }],
        originCaCertificates: [{ id: "ca-1" }],
        pageRules: [{ id: "rule-1", priority: 1 }],
        pagesDeploymentsByProject: { "my-site": [{ environment: "production", id: "dep-1" }] },
        pagesDomainsByProject: { "my-site": [{ name: "my-site.example.test", status: "active" }] },
        pagesProjects: [
          { domains: ["my-site.example.test"], id: "proj-1", name: "my-site", production_branch: "main" },
        ],
        policiesByApplication: { "app-1": [{ id: "pol-1", decision: "allow", precedence: 1 }] },
        postureRules: [{ id: "rule-1", name: "WARP" }],
        rateLimits: [{ id: "rl-1" }],
        serviceTokens: [{ id: "tok-1", name: "Token" }],
        uaRules: [{ id: "ua-1" }],
        universalSslSetting: { enabled: true },
        universalSslVerification: [{ cert_pack_uuid: "verify-uuid-1", certificate_status: "active" }],
        userSchemas: [{ schema_id: "sch-1" }],
        wafGroupsByPackage: { "pkg-1": [{ id: "g-1" }] },
        wafOverrides: [{ id: "o-1" }],
        wafPackages: [{ id: "pkg-1" }],
        wafRulesByPackage: { "pkg-1": [{ id: "r-1" }] },
        workerAccountSetting: { default_usage_model: "standard" },
        workerDomains: [{ hostname: "app.example.test", id: "dom-1" }],
        workerRoutes: [{ id: "route-1", pattern: "example.test/*" }],
        workerScripts: [{ id: "my-worker" }],
        workerScriptsByName: { "my-worker": { deployments: [WIRE_DEPLOYMENT] } },
        rulesetRulesById: { "ruleset-1": [{ action: "block", id: "rule-a" }] },
        rulesets: [{ id: "ruleset-1", name: "one", phase: "http_request_firewall_custom" }],
        zeroTrust: ONE_OF_EACH_ZERO_TRUST,
        zoneSettings: [{ id: "always_online", value: "off" }],
        zones: [{ id: "z1", name: "one.test" }],
      }),
      maxRetries: 0,
    });
    const result = await syncCloudflareAtlas({ at: AT, client, home, progress: noopProgress, selection: SELECTION });
    const report = unwrap(result);
    expect(report.kinds).toHaveLength(66);
    expect(report.kinds.map((outcome) => outcome.kind).toSorted()).toEqual([...CLOUDFLARE_KINDS].toSorted());
    // `device-policy` is the one flat kind that reads TWO endpoints — the default WARP profile and the
    // custom list — so one row in the custom fixture plus the default profile is two entities, not one.
    // Asserted as ONE list rather than one expectation per kind, so a failure names WHICH kind read nothing
    // instead of reporting `expected 0 to be 1` with no kind attached.
    expect(
      FLAT_KINDS.filter((entry) => entry !== "device-policy").map((kind) => {
        const outcome = outcomeFor({ kind, kinds: report.kinds });
        return `${kind}: ${String(outcome?.complete)}/${String(outcome?.entityCount)}`;
      }),
    ).toEqual(FLAT_KINDS.filter((entry) => entry !== "device-policy").map((kind) => `${kind}: true/1`));
    expect(outcomeFor({ kind: "device-policy", kinds: report.kinds })).toEqual({
      complete: true,
      entityCount: 2,
      kind: "device-policy",
      reasons: [],
    });
    const policyOutcome = outcomeFor({ kind: "access-policy", kinds: report.kinds });
    expect(policyOutcome).toEqual({ complete: true, entityCount: 1, kind: "access-policy", reasons: [] });
    const gatewayListOutcome = outcomeFor({ kind: "gateway-list", kinds: report.kinds });
    expect(gatewayListOutcome).toEqual({ complete: true, entityCount: 1, kind: "gateway-list", reasons: [] });
    const filterListOutcome = outcomeFor({ kind: "account-filter-list", kinds: report.kinds });
    expect(filterListOutcome).toEqual({ complete: true, entityCount: 1, kind: "account-filter-list", reasons: [] });
    const pagesOutcome = outcomeFor({ kind: "pages-project", kinds: report.kinds });
    expect(pagesOutcome).toEqual({ complete: true, entityCount: 1, kind: "pages-project", reasons: [] });
    const workerScriptOutcome = outcomeFor({ kind: "worker-script", kinds: report.kinds });
    expect(workerScriptOutcome).toEqual({ complete: true, entityCount: 1, kind: "worker-script", reasons: [] });
    const accountCertificateOutcome = outcomeFor({ kind: "account-certificate", kinds: report.kinds });
    expect(accountCertificateOutcome).toEqual({
      complete: true,
      entityCount: 1,
      kind: "account-certificate",
      reasons: [],
    });
    const firewallServiceOutcome = outcomeFor({ kind: "firewall-service", kinds: report.kinds });
    expect(firewallServiceOutcome).toEqual({
      complete: true,
      entityCount: 6,
      kind: "firewall-service",
      reasons: [],
    });
    const legacyWafOutcome = outcomeFor({ kind: "legacy-waf", kinds: report.kinds });
    expect(legacyWafOutcome).toEqual({ complete: true, entityCount: 2, kind: "legacy-waf", reasons: [] });
    const zoneCertificateOutcome = outcomeFor({ kind: "zone-certificate", kinds: report.kinds });
    expect(zoneCertificateOutcome).toEqual({ complete: true, entityCount: 11, kind: "zone-certificate", reasons: [] });
    const apiGatewayOutcome = outcomeFor({ kind: "api-gateway", kinds: report.kinds });
    expect(apiGatewayOutcome).toEqual({ complete: true, entityCount: 8, kind: "api-gateway", reasons: [] });
    const zoneAnalyticsOutcome = outcomeFor({ kind: "zone-analytics", kinds: report.kinds });
    expect(zoneAnalyticsOutcome).toEqual({ complete: true, entityCount: 2, kind: "zone-analytics", reasons: [] });

    const paths = cloudflareAtlasPaths({ home });
    for (const kind of ALL_SYNCED_KINDS.filter((entry) => entry !== "device-policy")) {
      const file = unwrap(readCloudflareKindFile({ kind, paths }));
      expect(file?.entities).toHaveLength(1);
    }
    // The two-endpoint fold on disk: the default profile and the one custom profile, distinguished by the
    // stored `isDefault` flag rather than by which endpoint they came from.
    const devicePolicyFile = unwrap(readCloudflareKindFile({ kind: "device-policy", paths }));
    expect(devicePolicyFile?.entities.map((entity) => entity.providerId).toSorted()).toEqual([
      "warp-custom-1",
      "warp-default",
    ]);
    // No kind may publish a `deferred` cell any more — that is the ruling, asserted over every file rather
    // than over the list that used to name them, because the list itself is what was deleted.
    for (const kind of CLOUDFLARE_KINDS) {
      const file = unwrap(readCloudflareKindFile({ kind, paths }));
      expect(file?.coverage.filter((cell) => cell.state === "deferred")).toEqual([]);
    }
    // Rulesets at both scopes, each carrying the rules its own `get` returned — the fan-out, not the list.
    const rulesetFile = unwrap(readCloudflareKindFile({ kind: "ruleset", paths }));
    expect(rulesetFile?.entities.map((entity) => entity.providerId)).toEqual(["ruleset-1"]);
    const zoneRulesetFile = unwrap(readCloudflareKindFile({ kind: "zone-ruleset", paths }));
    expect(zoneRulesetFile?.entities.map((entity) => entity.scope.zoneId)).toEqual(["zone-1"]);
    const firewallServiceFile = unwrap(readCloudflareKindFile({ kind: "firewall-service", paths }));
    expect(firewallServiceFile?.entities).toHaveLength(6);
    const legacyWafFile = unwrap(readCloudflareKindFile({ kind: "legacy-waf", paths }));
    expect(legacyWafFile?.entities).toHaveLength(2);
    const zoneCertificateFile = unwrap(readCloudflareKindFile({ kind: "zone-certificate", paths }));
    expect(zoneCertificateFile?.entities).toHaveLength(11);
    const apiGatewayFile = unwrap(readCloudflareKindFile({ kind: "api-gateway", paths }));
    expect(apiGatewayFile?.entities).toHaveLength(8);
    const zoneAnalyticsFile = unwrap(readCloudflareKindFile({ kind: "zone-analytics", paths }));
    expect(zoneAnalyticsFile?.entities).toHaveLength(2);
  });
});
