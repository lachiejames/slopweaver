/**
 * Every FLAT kind this atlas wires, as one table. The one loop that runs them all is {@link ./flatKinds.js}.
 *
 * A flat kind is one account-filtered (or deep-zone-filtered) collection or singleton with no parent
 * fan-out: read it, project it, fold it. {@link flatKindSpecs} is the ONE place a new flat surface gets
 * registered — {@link ./flatKinds.syncOneFlatKind} needs no change for it — and that is what keeps
 * fifty-three kinds down to a table plus a loop: nineteen that predate the Zero Trust work plus the
 * thirty-four {@link zeroTrustFlatKindSpecs} adds.
 *
 * Five entries are DEEP-ZONE-ONLY (`dns-record`, `dnssec`, `zone-setting`, `page-rule`, `worker-route`):
 * each closes over `deepZoneId` inside its own `read`, ignoring the `accountId` the shared
 * {@link FlatKindReader} signature offers but such a reader has no use for beyond stamping it onto the
 * entity's own `scope`. Each also declares that zone and a `zone/...` coverage scope in place of the default
 * `account/...` one — those facts belong to one zone, not to the account, and {@link FlatKindSpec} is a
 * union precisely so a deep-zone row cannot be added without saying which zone it read.
 *
 * Three of the flat entries hide more than their row suggests, and the detail is in their own readers:
 * `worker-account-setting` is a SINGLETON combining two GET calls into one entity, `notification-destination`
 * combines two independent SDK reads (webhooks and PagerDuty) into one kind, and `audit-log` is deliberately
 * narrowed to the last 30 days rather than Cloudflare's documented 18-month retention. `zone-setting`
 * reaches its data through the base client's own untyped `client.get()`, because the pinned SDK version
 * never wraps the real list endpoint with a typed method.
 */
import type Cloudflare from "cloudflare";

import type { Result } from "../../lib/result.js";

import type { CloudflareClientError } from "./errors.js";
import { deepZoneKindScope } from "./kindFold.js";
import type { CloudflareAccountScopedKind, CloudflareEntity, CloudflareZoneScopedKind } from "./model.js";
import {
  readCloudflareAccessApplications,
  readCloudflareAccessGroups,
  readCloudflareAccessServiceTokens,
  readCloudflareIdentityProviders,
} from "./readers/access.js";
import { readCloudflareAccountSetting } from "./readers/accountSetting.js";
import { readCloudflareAuditLogs } from "./readers/auditLog.js";
import { readCloudflareDevicePostureRules } from "./readers/devicePosture.js";
import { readCloudflareDnsRecords } from "./readers/dnsRecord.js";
import { readCloudflareDnssec } from "./readers/dnssec.js";
import { readCloudflareNotificationDestinations } from "./readers/notificationDestination.js";
import { readCloudflareNotificationHistory } from "./readers/notificationHistory.js";
import { readCloudflareNotificationPolicies } from "./readers/notificationPolicy.js";
import { readCloudflareNotificationSilences } from "./readers/notificationSilence.js";
import { readCloudflarePageRules } from "./readers/pageRule.js";
import { readCloudflareWorkerAccountSetting } from "./readers/workerAccountSetting.js";
import { readCloudflareWorkerDomains } from "./readers/workerDomain.js";
import { readCloudflareWorkerRoutes } from "./readers/workerRoute.js";
import {
  readCloudflareAccessAuthenticationLog,
  readCloudflareAccessBookmarks,
  readCloudflareAccessCertificates,
  readCloudflareAccessCustomPages,
  readCloudflareAccessGatewayCas,
  readCloudflareAccessInfrastructureTargets,
  readCloudflareAccessKeyConfiguration,
  readCloudflareAccessTags,
} from "./readers/zeroTrustAccessAdmin.js";
import { readCloudflareAccessUsers, readCloudflareZeroTrustOrganization } from "./readers/zeroTrustActor.js";
import { readCloudflareCasbIntegrations, readCloudflareDlpProfiles } from "./readers/zeroTrustData.js";
import {
  readCloudflareDeviceManagedNetworks,
  readCloudflareDevicePolicies,
  readCloudflareDeviceRegistrations,
  readCloudflareDeviceSetting,
} from "./readers/zeroTrustDevice.js";
import {
  readCloudflareGatewayAuditSsh,
  readCloudflareGatewayCertificates,
  readCloudflareGatewayConfiguration,
  readCloudflareGatewayLocations,
  readCloudflareGatewayLogging,
  readCloudflareGatewayPolicies,
  readCloudflareGatewayProxyEndpoints,
} from "./readers/zeroTrustGateway.js";
import {
  readCloudflareConnectivitySetting,
  readCloudflareTunnelRoutes,
  readCloudflareTunnels,
  readCloudflareVirtualNetworks,
  readCloudflareZeroTrustSubnets,
} from "./readers/zeroTrustNetwork.js";
import {
  readCloudflareCasbFindings,
  readCloudflareDexFleetStatus,
  readCloudflareDexTests,
  readCloudflareDlpDatasets,
  readCloudflareRiskScore,
  readCloudflareRiskScoreSummary,
} from "./readers/zeroTrustPosture.js";
import { readCloudflareZones } from "./readers/zone.js";
import { readCloudflareZoneSettings } from "./readers/zoneSetting.js";

/** What a flat kind's reader looks like — one account-filtered collection, no parent fan-out. */
type FlatKindReader = (args: {
  client: Cloudflare;
  accountId: string;
  at: string;
}) => Promise<Result<readonly CloudflareEntity[], CloudflareClientError>>;

/** What every flat kind's row carries, whatever its scope. */
interface FlatKindSpecBase {
  /** What a successful read's coverage reason names, e.g. "zone(s)", "Access application(s)". */
  readonly label: string;
  readonly read: FlatKindReader;
}

/**
 * One flat kind this sync run covers — a union rather than one shape with two optional fields, so that a
 * zone-scoped row cannot be written without the zone it was read from.
 *
 * That is the fold's half of the same protection `identity.ts` gives identity: a zone-scoped read is
 * complete only for its own zone, so `syncOneFlatKind` must be able to tell the merge which zone that was
 * (see `merge.ts`). Making it a discriminated union means a new deep-zone entry that omits `zoneId` fails to
 * compile, rather than quietly staling every other zone on every run.
 */
export type FlatKindSpec =
  | (FlatKindSpecBase & { readonly kind: CloudflareAccountScopedKind })
  | (FlatKindSpecBase & {
      readonly kind: CloudflareZoneScopedKind;
      /** The zone this row's `read` closure is pinned to. */
      readonly zoneId: string;
      /** The `zone/...` coverage scope these facts belong to, rather than the default `account/...`. */
      readonly scope: string;
    });

/**
 * The deep-zone-only flat kinds — every row read from INSIDE one zone rather than across the account.
 *
 * Their own function rather than five more entries in {@link flatKindSpecs}: each carries three fields the
 * account-scoped rows do not (the zone, its `zone/...` coverage scope, and a `read` closure pinned to that
 * zone), and they are the rows that become a loop the day this atlas reads every zone in the account.
 *
 * @param deepZoneId the selected, live-verified deep zone's id
 * @returns every deep-zone flat kind spec this run covers
 */
function deepZoneFlatKindSpecs({ deepZoneId }: { deepZoneId: string }): readonly FlatKindSpec[] {
  return [
    {
      kind: "dns-record",
      label: "DNS record(s) for the deep zone",
      read: ({ accountId, client, at }) => readCloudflareDnsRecords({ accountId, at, client, zoneId: deepZoneId }),
      scope: deepZoneKindScope({ kind: "dns-record", zoneId: deepZoneId }),
      zoneId: deepZoneId,
    },
    {
      kind: "dnssec",
      label: "DNSSEC status record(s) for the deep zone",
      read: ({ accountId, client, at }) => readCloudflareDnssec({ accountId, at, client, zoneId: deepZoneId }),
      scope: deepZoneKindScope({ kind: "dnssec", zoneId: deepZoneId }),
      zoneId: deepZoneId,
    },
    {
      kind: "zone-setting",
      label: "zone setting(s) for the deep zone",
      read: ({ accountId, client, at }) => readCloudflareZoneSettings({ accountId, at, client, zoneId: deepZoneId }),
      scope: deepZoneKindScope({ kind: "zone-setting", zoneId: deepZoneId }),
      zoneId: deepZoneId,
    },
    {
      kind: "page-rule",
      label: "Page Rule(s) for the deep zone",
      read: ({ accountId, client, at }) => readCloudflarePageRules({ accountId, at, client, zoneId: deepZoneId }),
      scope: deepZoneKindScope({ kind: "page-rule", zoneId: deepZoneId }),
      zoneId: deepZoneId,
    },
    {
      kind: "worker-route",
      label: "Workers route(s) for the deep zone",
      read: ({ accountId, client, at }) => readCloudflareWorkerRoutes({ accountId, at, client, zoneId: deepZoneId }),
      scope: deepZoneKindScope({ kind: "worker-route", zoneId: deepZoneId }),
      zoneId: deepZoneId,
    },
  ];
}

/**
 * Every Zero Trust FLAT kind, in the order `CLOUDFLARE_ZERO_TRUST_HELD_KINDS` declares it save one swapped pair
 * (`access-key-configuration` before `access-authentication-log`): the enforcement path first — actor, device,
 * policy, egress, private topology, data controls — then the Access administration and posture surfaces the
 * owner's ruling moved out of `deferred` and into here.
 *
 * Their own function rather than twenty more entries in {@link flatKindSpecs} for the same reason
 * {@link deepZoneFlatKindSpecs} has one: they are a coherent set with a single ranked justification, and a
 * reader asking "what did the Zero Trust cut actually ship" gets one list rather than a diff of a long one.
 * Every row here is account-scoped, so none carries a zone — that is why this returns the account arm of
 * {@link FlatKindSpec} and needs no `deepZoneId` at all.
 *
 * Several read a SINGLETON and may legitimately come back with zero entities on an account that has never
 * configured that surface; `readers/zeroTrustGateway.ts` explains why an empty array is the honest answer
 * there rather than an invented all-null record. `risk-score-summary` is the one row here that is EXPECTED
 * to fail — it is a permission boundary held as a kind, and `readers/zeroTrustPosture.ts` says why that is
 * the point rather than a defect.
 *
 * @returns every Zero Trust flat kind spec this run covers
 */
function zeroTrustFlatKindSpecs(): readonly FlatKindSpec[] {
  return [
    { kind: "access-user", label: "Access user(s)", read: readCloudflareAccessUsers },
    {
      kind: "zero-trust-organization",
      label: "Zero Trust organisation record(s)",
      read: readCloudflareZeroTrustOrganization,
    },
    { kind: "device-registration", label: "WARP device registration(s)", read: readCloudflareDeviceRegistrations },
    { kind: "device-policy", label: "WARP profile(s), default and custom", read: readCloudflareDevicePolicies },
    { kind: "device-setting", label: "Zero Trust device setting record(s)", read: readCloudflareDeviceSetting },
    { kind: "device-managed-network", label: "managed network(s)", read: readCloudflareDeviceManagedNetworks },
    { kind: "gateway-policy", label: "Gateway DNS/HTTP/Network policy(s)", read: readCloudflareGatewayPolicies },
    {
      kind: "gateway-configuration",
      label: "Gateway configuration record(s)",
      read: readCloudflareGatewayConfiguration,
    },
    { kind: "gateway-logging", label: "Gateway logging setting record(s)", read: readCloudflareGatewayLogging },
    { kind: "gateway-location", label: "Gateway location(s)", read: readCloudflareGatewayLocations },
    {
      kind: "gateway-certificate",
      label: "Gateway inspection certificate(s)",
      read: readCloudflareGatewayCertificates,
    },
    { kind: "gateway-proxy-endpoint", label: "Gateway proxy endpoint(s)", read: readCloudflareGatewayProxyEndpoints },
    {
      kind: "gateway-audit-ssh-setting",
      label: "SSH session-recording setting record(s)",
      read: readCloudflareGatewayAuditSsh,
    },
    {
      kind: "connectivity-setting",
      label: "Zero Trust connectivity setting record(s)",
      read: readCloudflareConnectivitySetting,
    },
    { kind: "tunnel", label: "cloudflared tunnel(s)", read: readCloudflareTunnels },
    { kind: "tunnel-route", label: "tunnel route(s)", read: readCloudflareTunnelRoutes },
    { kind: "virtual-network", label: "virtual network(s)", read: readCloudflareVirtualNetworks },
    { kind: "zero-trust-subnet", label: "Zero Trust subnet(s)", read: readCloudflareZeroTrustSubnets },
    { kind: "dlp-profile", label: "DLP profile(s)", read: readCloudflareDlpProfiles },
    { kind: "casb-integration", label: "CASB integration(s)", read: readCloudflareCasbIntegrations },
    ...formerlyDeferredFlatKindSpecs(),
  ];
}

/**
 * The fourteen rows the owner's ruling moved out of `deferred` and into a real reader — the
 * Access administration surfaces and the posture ones. `model.ts` carries the ruling and `inventory.ts` the
 * per-kind measurement that answered it.
 *
 * Their own function rather than fourteen more rows in {@link zeroTrustFlatKindSpecs} for two reasons: that
 * function hit this repo's function-size cap at 78 lines, and a reader asking what the ruling actually
 * changed gets one list rather than a diff of a long one. `risk-score-summary` is the row here that is
 * EXPECTED to fail — see `readers/zeroTrustPosture.ts`.
 *
 * @returns every formerly-deferred Zero Trust flat kind spec this run covers
 */
function formerlyDeferredFlatKindSpecs(): readonly FlatKindSpec[] {
  return [
    { kind: "access-tag", label: "Access tag(s)", read: readCloudflareAccessTags },
    { kind: "access-bookmark", label: "App Launcher bookmark(s)", read: readCloudflareAccessBookmarks },
    { kind: "access-custom-page", label: "Access custom page(s)", read: readCloudflareAccessCustomPages },
    {
      kind: "access-certificate",
      label: "Access certificate(s), mTLS and SAML",
      read: readCloudflareAccessCertificates,
    },
    { kind: "access-gateway-ca", label: "Access SSH certificate authority(s)", read: readCloudflareAccessGatewayCas },
    {
      kind: "access-infrastructure-target",
      label: "Access infrastructure target(s)",
      read: readCloudflareAccessInfrastructureTargets,
    },
    {
      kind: "access-key-configuration",
      label: "Access key-rotation configuration record(s)",
      read: readCloudflareAccessKeyConfiguration,
    },
    {
      kind: "access-authentication-log",
      label: "Access authentication event(s) and SCIM update(s)",
      read: readCloudflareAccessAuthenticationLog,
    },
    { kind: "dlp-dataset", label: "DLP dataset(s)", read: readCloudflareDlpDatasets },
    { kind: "casb-finding", label: "CASB posture finding(s)", read: readCloudflareCasbFindings },
    { kind: "risk-score", label: "risk-scoring configuration record(s)", read: readCloudflareRiskScore },
    { kind: "risk-score-summary", label: "risk-scoring summary record(s)", read: readCloudflareRiskScoreSummary },
    { kind: "dex-test", label: "DEX synthetic test(s)", read: readCloudflareDexTests },
    {
      kind: "dex-fleet-status",
      label: "DEX fleet-status sample(s) over the 7-day retention",
      read: readCloudflareDexFleetStatus,
    },
  ];
}

/**
 * Every flat kind this atlas wires. Add a new flat, account-scoped surface directly here — `syncOneFlatKind`
 * needs no change. A deep-zone-only flat surface additionally declares its `zoneId` and a `zone/...` `scope`
 * (both required by {@link FlatKindSpec}'s zone arm) and a `read` closure substituting that zone for the
 * `accountId` the shared call signature offers but such a reader has no use for — see the
 * `dns-record`/`dnssec`/`zone-setting`/`page-rule`/`worker-route` entries below.
 *
 * @param deepZoneId the selected, live-verified deep zone's id
 * @returns every flat kind spec this run covers
 */
export function flatKindSpecs({ deepZoneId }: { deepZoneId: string }): readonly FlatKindSpec[] {
  return [
    { kind: "zone", label: "zone(s) under the selected account", read: readCloudflareZones },
    { kind: "account-setting", label: "account setting record(s)", read: readCloudflareAccountSetting },
    { kind: "access-application", label: "Access application(s)", read: readCloudflareAccessApplications },
    { kind: "access-group", label: "Access group(s)", read: readCloudflareAccessGroups },
    { kind: "access-service-token", label: "Access service token(s)", read: readCloudflareAccessServiceTokens },
    { kind: "device-posture-rule", label: "device posture rule(s)", read: readCloudflareDevicePostureRules },
    { kind: "identity-provider", label: "identity provider(s)", read: readCloudflareIdentityProviders },
    {
      kind: "worker-account-setting",
      label: "Workers account setting(s)",
      read: readCloudflareWorkerAccountSetting,
    },
    { kind: "worker-domain", label: "Workers custom domain(s)", read: readCloudflareWorkerDomains },
    {
      kind: "notification-policy",
      label: "notification-policy record(s)",
      read: readCloudflareNotificationPolicies,
    },
    {
      kind: "notification-destination",
      label: "notification destination(s)",
      read: readCloudflareNotificationDestinations,
    },
    { kind: "notification-silence", label: "notification silence(s)", read: readCloudflareNotificationSilences },
    { kind: "notification-history", label: "notification-history record(s)", read: readCloudflareNotificationHistory },
    { kind: "audit-log", label: "audit-log record(s) from the last 30 days", read: readCloudflareAuditLogs },
    ...zeroTrustFlatKindSpecs(),
    ...deepZoneFlatKindSpecs({ deepZoneId }),
  ];
}
