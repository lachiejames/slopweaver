/** The two whole-surface Zero Trust fixtures the `syncCloudflareAtlas` cases start from. */

import type { ZeroTrustFixture } from "./harnessTypes.js";

/**
 * Exactly one row in every Zero Trust collection, for the one test that asserts every kind published
 * something. The singletons need no fixture value: an empty object is a present record and projects to one
 * entity, which is what the live surfaces do for an account that has configured nothing.
 */
export const ONE_OF_EACH_ZERO_TRUST: ZeroTrustFixture = {
  accessAuthenticationEvents: [{ created_at: "2026-01-01T00:00:00Z", ray_id: "ray-1" }],
  accessBookmarks: [{ id: "bookmark-1", name: "one" }],
  accessCustomPages: [{ name: "one", uid: "page-1" }],
  accessGatewayCas: [{ id: "ca-1", public_key: "ssh-ca" }],
  accessInfrastructureTargets: [{ hostname: "host.example.test", id: "target-1" }],
  accessKeyConfiguration: { key_rotation_interval_days: 90 },
  accessMtlsCertificates: [{ id: "mtls-1", name: "one" }],
  // Empty on purpose: `access-certificate` folds mTLS and SAML into ONE kind, and the sweep below asserts
  // exactly one entity per kind. The SAML mapping has its own test.
  accessSamlCertificates: [],
  // Empty for the same reason — `access-authentication-log` folds authentication events and SCIM updates.
  accessScimUpdates: [],
  accessTags: [{ app_count: 1, name: "tag-one" }],
  accessUsers: [{ email: "person@example.test", id: "user-1" }],
  casbFindings: [{ active_count: 2, id: "finding-1" }],
  dexFleetStatus: [{ deviceId: "device-1", timestamp: "2026-01-01T00:00:00Z" }],
  dexTests: [{ id: "dex-1", name: "one" }],
  dlpDatasets: [{ id: "dataset-1", name: "one" }],
  riskScoreBehaviours: { behaviors: { malware: { enabled: false } } },
  riskScoreIntegrations: [],
  riskScoreSummary: { users: [] },
  casbIntegrations: [{ id: "casb-1", name: "one" }],
  connectivitySetting: { icmp_proxy_enabled: true },
  customDevicePolicies: [{ name: "custom", policy_id: "warp-custom-1" }],
  defaultDevicePolicy: { default: true, policy_id: "warp-default" },
  deviceManagedNetworks: [{ name: "office", network_id: "net-1" }],
  deviceRegistrations: [{ id: "reg-1" }],
  deviceSetting: { gateway_proxy_enabled: true },
  dlpProfiles: [{ id: "dlp-1", name: "one" }],
  gatewayAuditSsh: { public_key: "ssh-public" },
  gatewayCertificates: [{ id: "cert-1" }],
  gatewayConfiguration: { settings: { antivirus: null } },
  gatewayLocations: [{ id: "loc-1", name: "one" }],
  gatewayLogging: { redact_pii: true },
  gatewayPolicies: [{ id: "rule-1", name: "one" }],
  gatewayProxyEndpoints: [{ id: "proxy-1", name: "one" }],
  organization: { auth_domain: "team.example.test", name: "one" },
  subnets: [{ id: "subnet-1", name: "one" }],
  tunnelRoutes: [{ id: "route-1", network: "10.0.0.0/24" }],
  tunnels: [{ id: "tunnel-1", name: "one" }],
  virtualNetworks: [{ id: "vnet-1", name: "one" }],
};

/** Every Zero Trust surface empty — what a test that says nothing about Zero Trust gets. */
export const EMPTY_ZERO_TRUST: ZeroTrustFixture = {
  accessAuthenticationEvents: [],
  accessBookmarks: [],
  accessCustomPages: [],
  accessGatewayCas: [],
  accessInfrastructureTargets: [],
  accessKeyConfiguration: {},
  accessMtlsCertificates: [],
  accessSamlCertificates: [],
  accessScimUpdates: [],
  accessTags: [],
  accessUsers: [],
  casbFindings: [],
  dexFleetStatus: [],
  dexTests: [],
  dlpDatasets: [],
  riskScoreBehaviours: {},
  riskScoreIntegrations: [],
  riskScoreSummary: {},
  casbIntegrations: [],
  connectivitySetting: {},
  customDevicePolicies: [],
  defaultDevicePolicy: {},
  deviceManagedNetworks: [],
  deviceRegistrations: [],
  deviceSetting: {},
  dlpProfiles: [],
  gatewayAuditSsh: {},
  gatewayCertificates: [],
  gatewayConfiguration: {},
  gatewayLocations: [],
  gatewayLogging: {},
  gatewayPolicies: [],
  gatewayProxyEndpoints: [],
  organization: {},
  subnets: [],
  tunnelRoutes: [],
  tunnels: [],
  virtualNetworks: [],
};
