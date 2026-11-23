/**
 * The closed inventory of Cloudflare surfaces this atlas covers, and the surfaces it deliberately does not.
 *
 * A surface not named in either list cannot silently vanish from a coverage report the way an unmapped one
 * would — it is either one of the required surfaces below, or a named exclusion. That is what makes "what
 * does this atlas NOT cover" a printable list rather than a guess, the same doctrine `atlas/vanta/inventory.ts`
 * established.
 *
 * There are TWO lists. {@link CLOUDFLARE_REQUIRED_SURFACES} is what a reader
 * reads and {@link CLOUDFLARE_EXCLUDED_SURFACES} is what this atlas will never hold. There is no list of
 * DEFERRED surfaces between them: only highly voluminous data may be excluded, and every candidate was
 * measured against that bar and none met it. A mechanism with no members is one the next session quietly fills back up, which
 * is also why the deferred list's NAME is not written here, so the handover row's own `absent:` probe over
 * this file stays falsifiable.
 * {@link CLOUDFLARE_REQUIRED_SURFACES}' own doc carries the measurements and the grounds that were rejected.
 *
 * Every required surface below now has a real reader wired into `flatKindSpecs.ts` or `nonFlatKinds.ts` — see
 * `src/__tests__/unit/atlas/cloudflare/inventory.test.ts` for the exhaustiveness check that keeps this list
 * and the atlas's actual coverage from drifting apart. A row present here with no reader would be a
 * `not-configured` coverage gap, not a silent omission — that is the property this file makes checkable.
 */
import type { AtlasExclusion } from "../kit/contract.js";

import type { CloudflareKind } from "./model.js";

/** One surface this atlas is required to cover, for one kind. */
export interface CloudflareRequiredSurface {
  readonly kind: CloudflareKind;
  readonly surface: string;
  readonly deepZoneOnly: boolean;
  readonly description: string;
}

/**
 * Every surface this atlas is required to cover. Not exhaustive of every Cloudflare API surface — see
 * {@link CLOUDFLARE_EXCLUDED_SURFACES} for what's named as out of scope instead.
 *
 * ## Sixteen rows an earlier draft deferred or excluded, and what each one actually costs
 *
 * Thirteen would have been `deferred` and three `excluded`. The owner's ruling that retires both groups is in
 * `model.ts`; what follows is the evidence it asked for: what each kind costs, by class, GET only. An
 * installation's own rows and bytes are state, never this file's: reproduce a row count with
 * `slopweaver atlas cloudflare read --kind <kind> --json | jq '.page.matched'` once synced, and its bytes
 * with `wc -c "$SLOPWEAVER_HOME"/atlas/cloudflare/kinds/<kind>.jsonl`.
 *
 * | kind | cost class |
 * | --- | --- |
 * | `access-tag` | small configuration list |
 * | `access-bookmark` | small configuration list |
 * | `access-custom-page` | optional small configuration list |
 * | `access-certificate` | small certificate-metadata list |
 * | `access-gateway-ca` | optional singleton; an account with none answers 404 `gateway_ca_not_found` |
 * | `access-infrastructure-target` | small configuration list |
 * | `access-key-configuration` | singleton configuration |
 * | `access-authentication-log` | retention-window-sized event log (authentication events and SCIM updates) |
 * | `dlp-dataset` | configuration list |
 * | `casb-finding` | current-posture finding list |
 * | `risk-score` | singleton snapshot: behaviours + integrations |
 * | `risk-score-summary` | singleton; a 403 is a permission boundary, held as a kind that says so |
 * | `dex-test` | configured-test list |
 * | `dex-fleet-status` | retention-window-sized observation family, the slowest read here |
 * | `ruleset` | bounded configuration list with nested rules |
 * | `zone-ruleset` | per-zone bounded configuration list with nested rules (deep zone only) |
 *
 * Even the largest class is read in MiB against a terabyte as the owner's own example of a qualifying volume. Three
 * GROUNDS were used to keep these out and all three are REJECTED rather than merely overturned, recorded
 * here so the same argument cannot be made again from scratch: that a surface is _secondary
 * administration no enforcement question reaches through_ (the seven Access rows); that it is _a churning
 * point-in-time judgement rather than state_ (`casb-finding`, `risk-score` — and `merge.ts` stales a
 * vanished entity rather than deleting it, so churn is an argument FOR holding it); and that it is _a time
 * series rather than configuration_ (`access-authentication-log`, `dex-test`, `dex-fleet-status`). The
 * three Rulesets exclusions carried no recorded reason at all, which is what the owner objected to.
 */
export const CLOUDFLARE_REQUIRED_SURFACES: readonly CloudflareRequiredSurface[] = [
  {
    deepZoneOnly: false,
    description: "the selected account's own settings",
    kind: "account-setting",
    surface: "account-get",
  },
  {
    deepZoneOnly: false,
    description: "every Access application",
    kind: "access-application",
    surface: "access-apps-list",
  },
  {
    deepZoneOnly: false,
    description: "account reusable policies plus every application's exclusive/reusable policies",
    kind: "access-policy",
    surface: "access-policies-list",
  },
  { deepZoneOnly: false, description: "every Access group", kind: "access-group", surface: "access-groups-list" },
  {
    deepZoneOnly: false,
    description: "service-token metadata (no secret value)",
    kind: "access-service-token",
    surface: "access-service-tokens-list",
  },
  {
    deepZoneOnly: false,
    description: "device posture rules",
    kind: "device-posture-rule",
    surface: "device-posture-rules-list",
  },
  {
    deepZoneOnly: false,
    description: "Access identity providers",
    kind: "identity-provider",
    surface: "access-identity-providers-list",
  },
  {
    deepZoneOnly: false,
    description: "Zero Trust Gateway Lists, including their complete items array",
    kind: "gateway-list",
    surface: "gateway-lists-list",
  },
  {
    deepZoneOnly: false,
    description: "Cloudflare Pages projects, deployments and custom domains",
    kind: "pages-project",
    surface: "pages-projects-list",
  },
  {
    deepZoneOnly: false,
    description: "Workers account/subdomain settings",
    kind: "worker-account-setting",
    surface: "workers-account-settings-get",
  },
  {
    deepZoneOnly: false,
    description: "Worker scripts, settings, deployments, versions, schedules and secret descriptors",
    kind: "worker-script",
    surface: "workers-scripts-list",
  },
  {
    deepZoneOnly: false,
    description: "account-level Workers custom domains",
    kind: "worker-domain",
    surface: "workers-domains-list",
  },
  {
    deepZoneOnly: false,
    description: "account Rules Lists and their complete item collections",
    kind: "account-filter-list",
    surface: "account-filter-lists-list",
  },
  {
    deepZoneOnly: false,
    description: "notification alerting policies",
    kind: "notification-policy",
    surface: "notification-policies-list",
  },
  {
    deepZoneOnly: false,
    description: "notification webhook/PagerDuty destinations",
    kind: "notification-destination",
    surface: "notification-destinations-list",
  },
  {
    deepZoneOnly: false,
    description: "notification silences",
    kind: "notification-silence",
    surface: "notification-silences-list",
  },
  {
    deepZoneOnly: false,
    description: "every notification-history page the plan makes available",
    kind: "notification-history",
    surface: "notification-history-list",
  },
  {
    deepZoneOnly: false,
    description: "Audit Logs v2 over the full documented retention, plus deduplicated resource history",
    kind: "audit-log",
    surface: "audit-logs-list",
  },
  {
    deepZoneOnly: false,
    description: "account mTLS certificate metadata and hostname associations",
    kind: "account-certificate",
    surface: "account-certificates-list",
  },
  {
    deepZoneOnly: false,
    description: "light inventory (id/name/status/plan) for every zone under the selected account",
    kind: "zone",
    surface: "zones-list",
  },
  {
    deepZoneOnly: false,
    description: "every Access user, with the Access and Gateway seats each one holds",
    kind: "access-user",
    surface: "access-users-list",
  },
  {
    deepZoneOnly: false,
    description: "the Zero Trust organisation: login page, WARP session duration and unmatched-request policy",
    kind: "zero-trust-organization",
    surface: "zero-trust-organization-get",
  },
  {
    deepZoneOnly: false,
    description: "every WARP device registration, with its enrolled user and public key",
    kind: "device-registration",
    surface: "device-registrations-list",
  },
  {
    deepZoneOnly: false,
    description: "the default WARP profile plus every custom one, in one kind",
    kind: "device-policy",
    surface: "device-policies-list",
  },
  {
    deepZoneOnly: false,
    description: "account-wide Zero Trust device settings",
    kind: "device-setting",
    surface: "device-settings-get",
  },
  {
    deepZoneOnly: false,
    description: "managed networks WARP recognises a location by",
    kind: "device-managed-network",
    surface: "device-managed-networks-list",
  },
  {
    deepZoneOnly: false,
    description: "every Gateway DNS, HTTP and Network policy — the rules, not the lists they reference",
    kind: "gateway-policy",
    surface: "gateway-policies-list",
  },
  {
    deepZoneOnly: false,
    description: "the account's Gateway proxy, TLS-decryption and block-page configuration",
    kind: "gateway-configuration",
    surface: "gateway-configuration-get",
  },
  {
    deepZoneOnly: false,
    description: "Gateway per-rule-type log settings and the PII redaction switch",
    kind: "gateway-logging",
    surface: "gateway-logging-get",
  },
  {
    deepZoneOnly: false,
    description: "Gateway locations and the DNS endpoints each exposes",
    kind: "gateway-location",
    surface: "gateway-locations-list",
  },
  {
    deepZoneOnly: false,
    description: "Gateway TLS-inspection certificate metadata (no PEM body)",
    kind: "gateway-certificate",
    surface: "gateway-certificates-list",
  },
  {
    deepZoneOnly: false,
    description: "Gateway proxy endpoints and the source CIDRs allowed to reach them",
    kind: "gateway-proxy-endpoint",
    surface: "gateway-proxy-endpoints-list",
  },
  {
    deepZoneOnly: false,
    description: "SSH session-recording settings, public key only",
    kind: "gateway-audit-ssh-setting",
    surface: "gateway-audit-ssh-settings-get",
  },
  {
    deepZoneOnly: false,
    description: "account-wide ICMP-proxy and WARP-offramp connectivity settings",
    kind: "connectivity-setting",
    surface: "connectivity-settings-get",
  },
  {
    deepZoneOnly: false,
    description: "every cloudflared tunnel and its live connector connections",
    kind: "tunnel",
    surface: "tunnels-list",
  },
  {
    deepZoneOnly: false,
    description: "every private CIDR a tunnel makes reachable",
    kind: "tunnel-route",
    surface: "tunnel-routes-list",
  },
  {
    deepZoneOnly: false,
    description: "the virtual networks tunnel routes are namespaced by",
    kind: "virtual-network",
    surface: "virtual-networks-list",
  },
  {
    deepZoneOnly: false,
    description: "the address space WARP allocates client addresses from",
    kind: "zero-trust-subnet",
    surface: "zero-trust-subnets-list",
  },
  {
    deepZoneOnly: false,
    description: "every DLP profile, with the detector entries it matches on",
    kind: "dlp-profile",
    surface: "dlp-profiles-list",
  },
  {
    deepZoneOnly: false,
    description: "every CASB integration and the SaaS tenant it scans",
    kind: "casb-integration",
    surface: "casb-integrations-list",
  },
  {
    deepZoneOnly: true,
    description: "every DNS record for the configured deep zone",
    kind: "dns-record",
    surface: "dns-records-list",
  },
  { deepZoneOnly: true, description: "DNSSEC status/configuration", kind: "dnssec", surface: "dnssec-get" },
  {
    deepZoneOnly: true,
    description: "the complete zone-settings collection (legacy cache/performance settings included)",
    kind: "zone-setting",
    surface: "zone-settings-list",
  },
  {
    deepZoneOnly: true,
    description: "classic filters, firewall rules, IP access rules, UA rules, lockdowns, legacy rate limits",
    kind: "firewall-service",
    surface: "firewall-services-list",
  },
  {
    deepZoneOnly: true,
    description: "classic WAF packages/groups/rules/overrides",
    kind: "legacy-waf",
    surface: "legacy-waf-list",
  },
  {
    deepZoneOnly: true,
    description: "zone certificate packs, universal SSL, custom/client/keyless/origin-CA certs",
    kind: "zone-certificate",
    surface: "zone-certificates-list",
  },
  { deepZoneOnly: true, description: "Page Rules", kind: "page-rule", surface: "page-rules-list" },
  {
    deepZoneOnly: true,
    description: "general + DNS zone analytics, bounded by the plan's own GraphQL settings",
    kind: "zone-analytics",
    surface: "zone-analytics-settings-and-query",
  },
  {
    deepZoneOnly: true,
    description: "API Gateway operations/discovery/schemas/labels/settings for the deep zone",
    kind: "api-gateway",
    surface: "api-gateway-list",
  },
  {
    deepZoneOnly: true,
    description: "Workers routes attached to the deep zone",
    kind: "worker-route",
    surface: "workers-routes-list",
  },
  { deepZoneOnly: false, description: "Access tags", kind: "access-tag", surface: "access-tags-list" },
  {
    deepZoneOnly: false,
    description: "Access App Launcher bookmarks",
    kind: "access-bookmark",
    surface: "access-bookmarks-list",
  },
  {
    deepZoneOnly: false,
    description: "Access custom block and identity-denied pages",
    kind: "access-custom-page",
    surface: "access-custom-pages-list",
  },
  {
    deepZoneOnly: false,
    description: "Access mTLS certificates and SAML signing certificate sets",
    kind: "access-certificate",
    surface: "access-certificates-list",
  },
  {
    deepZoneOnly: false,
    description: "Access SSH certificate authorities",
    kind: "access-gateway-ca",
    surface: "access-gateway-ca-list",
  },
  {
    deepZoneOnly: false,
    description: "Access infrastructure targets",
    kind: "access-infrastructure-target",
    surface: "access-infrastructure-targets-list",
  },
  {
    deepZoneOnly: false,
    description: "the Access JWT key-rotation configuration",
    kind: "access-key-configuration",
    surface: "access-keys-get",
  },
  {
    deepZoneOnly: false,
    description: "Access authentication events and SCIM provisioning updates",
    kind: "access-authentication-log",
    surface: "access-logs-list",
  },
  { deepZoneOnly: false, description: "DLP datasets", kind: "dlp-dataset", surface: "dlp-datasets-list" },
  {
    deepZoneOnly: false,
    description: "CASB posture findings",
    kind: "casb-finding",
    surface: "casb-posture-findings-list",
  },
  {
    deepZoneOnly: false,
    description: "risk-scoring behaviour definitions and the integrations that feed them",
    kind: "risk-score",
    surface: "risk-scoring-get",
  },
  {
    deepZoneOnly: false,
    description: "the risk-scoring summary — a permission boundary on the configured token",
    kind: "risk-score-summary",
    surface: "risk-scoring-summary-get",
  },
  { deepZoneOnly: false, description: "DEX synthetic tests", kind: "dex-test", surface: "dex-tests-list" },
  {
    deepZoneOnly: false,
    description: "DEX fleet-status samples over the provider's 7-day retention",
    kind: "dex-fleet-status",
    surface: "dex-fleet-status-list",
  },
  {
    deepZoneOnly: false,
    description: "account Rulesets, each with the rules it contains",
    kind: "ruleset",
    surface: "account-rulesets-list",
  },
  {
    deepZoneOnly: true,
    description: "the deep zone's Rulesets, each with the rules it contains",
    kind: "zone-ruleset",
    surface: "zone-rulesets-list",
  },
] as const;

/**
 * A closed list of the required surfaces for one kind.
 *
 * @param kind the kind to look up
 * @returns every surface this atlas requires for that kind
 */
export function cloudflareRequiredSurfacesForKind({
  kind,
}: {
  kind: CloudflareKind;
}): readonly CloudflareRequiredSurface[] {
  return CLOUDFLARE_REQUIRED_SURFACES.filter((entry) => entry.kind === kind);
}

/**
 * Cloudflare surfaces this atlas deliberately does not cover, each carrying the GROUND it stands on.
 *
 * This list is where the owner's rule applies (`kit/contract.ts` {@link ATLAS_EXCLUSION_GROUNDS}):
 * the three Rulesets rows are not here because they measured far short of a qualifying volume and have a reader. What is left is graded rather than narrated. Three rows are `not-fetched`, which the
 * coverage gate REFUSES: every zone past the configured deep zone is the open
 * `the-cloudflare-atlas-cannot-read-all-twelve-zones` row rather than a decision, no dashboard walk is built
 * yet, and a capability catalog is reachable configuration nobody has read. A mutation is outside what an
 * atlas IS, the log streams are unbounded by construction, and a secret value is one no read API returns.
 */
export const CLOUDFLARE_EXCLUDED_SURFACES: readonly AtlasExclusion[] = [
  {
    because:
      "deep DNS/firewall/settings/certificate/analytics reads for every zone other than the configured deep zone",
    ground: "not-fetched",
    wouldBeClosedBy:
      "widening the deep read past the one configured zone, which is the open " +
      "`the-cloudflare-atlas-cannot-read-all-twelve-zones` row rather than a decision",
  },
  {
    because: "browser/dashboard capture",
    ground: "not-fetched",
    wouldBeClosedBy: "a driven-browser walk of the Cloudflare dashboard, which no channel here performs",
  },
  { because: "any Cloudflare mutation — this atlas is read-only", ground: "never-acted" },
  {
    because: "Workers request/tail logs and Pages transient build-log streams",
    ground: "shape-index",
    volume: {
      basis: "unmeasured",
      unboundedBecause:
        "Workers request and tail logs and Pages build-log streams are per-instant emissions, unbounded and " +
        "identified by the moment they occurred",
      wouldBeMeasuredBy: "the Workers Logs GraphQL dataset queried over a fixed window, counting rows returned",
    },
  },
  {
    because: "provider capability catalogs that are not account state (e.g. the available-alert-types catalog)",
    ground: "not-fetched",
    wouldBeClosedBy:
      "reading the provider capability catalogs, which are configuration Cloudflare authored and listable " +
      "exhaustively",
  },
  { because: "secret values, which read APIs do not return", ground: "secret-material" },
];
