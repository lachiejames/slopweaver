/**
 * The constants and the empty-by-default fixture the `syncCloudflareAtlas` cases share: instants, the account
 * selection, the kind lists a sweep asserts over, and the defaults an unmentioned collection falls back to.
 */

import { CLOUDFLARE_ZERO_TRUST_HELD_KINDS, type CloudflareKind } from "../../../../../atlas/cloudflare/model.js";
import type { CloudflareSyncKindOutcome } from "../../../../../atlas/cloudflare/sync.js";
import type { RichProgressEmitter } from "../../../../../lib/progressRichEmitter.js";
import type { AllKindsFixture, ResolvedAllKindsFixture } from "./harnessTypes.js";
import { EMPTY_ZERO_TRUST } from "./zeroTrustFixtures.js";

export const AT = "2026-01-01T00:00:00.000Z";
export const LATER = "2026-01-02T00:00:00.000Z";
export const ACCOUNT_ID = "a".repeat(32);
export const SELECTION = { accountId: ACCOUNT_ID, deepZone: { id: "zone-1", name: "example.test" } };
/** One Worker deployment carrying every field the SDK declares required, as the live wire sends it. */
export const WIRE_DEPLOYMENT = {
  created_on: "2026-06-30T06:22:13.249692Z",
  id: "dep-1",
  source: "terraform",
  strategy: "percentage",
  versions: [{ percentage: 100, version_id: "ver-1" }],
};

/** A no-op progress emitter — these tests assert on the sync report and disk state, not on progress lines. */
export const noopProgress: RichProgressEmitter = {
  close: () => undefined,
  emit: () => undefined,
  finish: () => undefined,
  noteStall: () => undefined,
};

/** Every FLAT kind, in `flatKindSpecs.ts`'s order bar one swapped pair: the pre-Zero-Trust rows, then all 34
 * `CLOUDFLARE_ZERO_TRUST_HELD_KINDS` in declared order, then the five deep-zone-only ones. */
export const FLAT_KINDS: readonly CloudflareKind[] = [
  "zone",
  "account-setting",
  "access-application",
  "access-group",
  "access-service-token",
  "device-posture-rule",
  "identity-provider",
  "worker-account-setting",
  "worker-domain",
  "notification-policy",
  "notification-destination",
  "notification-silence",
  "notification-history",
  "audit-log",
  ...CLOUDFLARE_ZERO_TRUST_HELD_KINDS,
  "dns-record",
  "dnssec",
  "zone-setting",
  "page-rule",
  "worker-route",
];

export const ALL_SYNCED_KINDS: readonly CloudflareKind[] = [
  ...FLAT_KINDS,
  "access-policy",
  "gateway-list",
  "account-filter-list",
  "pages-project",
  "worker-script",
  "account-certificate",
  "ruleset",
  "zone-ruleset",
];

/**
 * The outcome one kind reported in a sync run.
 *
 * @returns that kind's outcome, or `undefined` when the run reported none for it
 */
export function outcomeFor({
  kinds,
  kind,
}: {
  kinds: readonly CloudflareSyncKindOutcome[];
  kind: CloudflareKind;
}): CloudflareSyncKindOutcome | undefined {
  return kinds.find((outcome) => outcome.kind === kind);
}

/*
 * The fixture is resolved by parameter destructuring with a default per field, exactly as the original
 * stub read it: every field is read once, in this order, and an absent or `undefined` field takes its empty
 * default. The fields are split over four readers only to keep each under the function-length cap.
 */

function readFirstFields({
  zones = [],
  applications = [],
  groups = [],
  serviceTokens = [],
  postureRules = [],
  identityProviders = [],
  reusablePolicies = [],
  policiesByApplication = {},
  gatewayLists = [],
  gatewayListItemsByList = {},
  filterLists = [],
  filterListItemsByList = {},
  pagesProjects = [],
  pagesDeploymentsByProject = {},
  pagesDomainsByProject = {},
  workerAccountSetting = {},
  workerDomains = [],
  workerScripts = [],
}: AllKindsFixture) {
  return {
    zones,
    applications,
    groups,
    serviceTokens,
    postureRules,
    identityProviders,
    reusablePolicies,
    policiesByApplication,
    gatewayLists,
    gatewayListItemsByList,
    filterLists,
    filterListItemsByList,
    pagesProjects,
    pagesDeploymentsByProject,
    pagesDomainsByProject,
    workerAccountSetting,
    workerDomains,
    workerScripts,
  };
}

function readSecondFields({
  workerScriptsByName = {},
  notificationPolicies = [],
  notificationWebhooks = [],
  notificationPagerduty = [],
  notificationSilences = [],
  notificationHistory = [],
  auditLogs = [],
  accountSetting = {},
  accountCertificates = [],
  accountCertificateAssociationsByCert = {},
  dnsRecords = [],
  dnssec = {},
  zoneSettings = [],
  pageRules = [],
  workerRoutes = [],
  filters = [],
  firewallRules = [],
  ipAccessRules = [],
}: AllKindsFixture) {
  return {
    workerScriptsByName,
    notificationPolicies,
    notificationWebhooks,
    notificationPagerduty,
    notificationSilences,
    notificationHistory,
    auditLogs,
    accountSetting,
    accountCertificates,
    accountCertificateAssociationsByCert,
    dnsRecords,
    dnssec,
    zoneSettings,
    pageRules,
    workerRoutes,
    filters,
    firewallRules,
    ipAccessRules,
  };
}

function readThirdFields({
  uaRules = [],
  lockdowns = [],
  rateLimits = [],
  wafPackages = [],
  wafGroupsByPackage = {},
  wafRulesByPackage = {},
  wafOverrides = [],
  certificatePacks = [],
  universalSslSetting = {},
  universalSslVerification = [],
  customCertificates = [],
  clientCertificates = [],
  keylessCertificates = [],
  originCaCertificates = [],
  aopSetting = {},
  aopZoneCertificates = [],
  aopHostnameCertificates = [],
  customHostnames = [],
}: AllKindsFixture) {
  return {
    uaRules,
    lockdowns,
    rateLimits,
    wafPackages,
    wafGroupsByPackage,
    wafRulesByPackage,
    wafOverrides,
    certificatePacks,
    universalSslSetting,
    universalSslVerification,
    customCertificates,
    clientCertificates,
    keylessCertificates,
    originCaCertificates,
    aopSetting,
    aopZoneCertificates,
    aopHostnameCertificates,
    customHostnames,
  };
}

function readFinalFields({
  operations = [],
  discoveryOperations = [],
  discoverySchemas = {},
  apiGatewaySchemas = {},
  labels = [],
  apiGatewaySettings = {},
  configuration = {},
  userSchemas = [],
  httpRequestGroups = [],
  dnsQueryGroups = [],
  rulesets = [],
  rulesetRulesById = {},
  zeroTrust = EMPTY_ZERO_TRUST,
}: AllKindsFixture) {
  return {
    operations,
    discoveryOperations,
    discoverySchemas,
    apiGatewaySchemas,
    labels,
    apiGatewaySettings,
    configuration,
    userSchemas,
    httpRequestGroups,
    dnsQueryGroups,
    rulesets,
    rulesetRulesById,
    zeroTrust,
  };
}

/**
 * A case's fixture with every collection the case did not name replaced by its empty default, so every
 * router reads every collection.
 *
 * @returns the complete fixture, with each collection the case named kept and every other one empty
 */
export function resolveAllKindsFixture({ fixture }: { fixture: AllKindsFixture }): ResolvedAllKindsFixture {
  return {
    ...readFirstFields(fixture),
    ...readSecondFields(fixture),
    ...readThirdFields(fixture),
    ...readFinalFields(fixture),
  };
}
