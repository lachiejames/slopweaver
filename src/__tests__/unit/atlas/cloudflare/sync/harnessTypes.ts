/**
 * The shapes the `syncCloudflareAtlas` test harness is handed and passes between its response routers: the
 * Zero Trust and Worker-script fixtures, the whole-account fixture a case describes, and the request every
 * router is asked about.
 */

/** Every Zero Trust collection and singleton the Zero Trust router can be handed. */
export interface ZeroTrustFixture {
  readonly gatewayPolicies: readonly { id: string; name?: string }[];
  readonly gatewayLocations: readonly { id: string; name?: string }[];
  readonly gatewayCertificates: readonly { id: string }[];
  readonly gatewayProxyEndpoints: readonly { id: string; name?: string }[];
  readonly gatewayConfiguration: { settings?: unknown };
  readonly gatewayLogging: { redact_pii?: boolean };
  readonly gatewayAuditSsh: { public_key?: string };
  readonly accessUsers: readonly { id: string; email?: string }[];
  readonly organization: { name?: string; auth_domain?: string };
  readonly deviceRegistrations: readonly { id: string }[];
  readonly defaultDevicePolicy: { policy_id?: string; default?: boolean };
  readonly customDevicePolicies: readonly { policy_id: string; name?: string }[];
  readonly deviceSetting: { gateway_proxy_enabled?: boolean };
  readonly deviceManagedNetworks: readonly { network_id: string; name?: string }[];
  readonly connectivitySetting: { icmp_proxy_enabled?: boolean };
  readonly tunnels: readonly { id: string; name?: string }[];
  readonly tunnelRoutes: readonly { id: string; network?: string }[];
  readonly virtualNetworks: readonly { id: string; name?: string }[];
  readonly subnets: readonly { id: string; name?: string }[];
  readonly dlpProfiles: readonly { id: string; name?: string }[];
  readonly casbIntegrations: readonly { id: string; name?: string }[];
  readonly accessTags: readonly { name: string; app_count?: number }[];
  readonly accessBookmarks: readonly { id: string; name?: string }[];
  readonly accessCustomPages: readonly { uid: string; name?: string }[];
  readonly accessMtlsCertificates: readonly { id: string; name?: string }[];
  readonly accessSamlCertificates: readonly { uid: string; created_at: string; updated_at: string }[];
  readonly accessGatewayCas: readonly { id: string; public_key?: string }[];
  readonly accessInfrastructureTargets: readonly { id: string; hostname?: string }[];
  readonly accessKeyConfiguration: { key_rotation_interval_days?: number };
  readonly accessAuthenticationEvents: readonly { created_at?: string; ray_id?: string }[];
  readonly accessScimUpdates: readonly { logged_at?: string; idp_id?: string; cf_resource_id?: string }[];
  readonly dlpDatasets: readonly { id: string; name?: string }[];
  readonly casbFindings: readonly { id: string; active_count?: number }[];
  readonly riskScoreBehaviours: { behaviors?: unknown };
  readonly riskScoreIntegrations: readonly { id: string }[];
  readonly riskScoreSummary: { users?: unknown };
  readonly dexTests: readonly { id: string; name?: string }[];
  readonly dexFleetStatus: readonly { deviceId: string; timestamp: string }[];
}

/** One script's fixture bundle — every field defaults to empty. */
export interface WorkerScriptBundleFixture {
  readonly bindings?: readonly unknown[];
  readonly content?: string;
  readonly deployments?: readonly unknown[];
  readonly schedules?: readonly unknown[];
  readonly secrets?: readonly unknown[];
  readonly versions?: readonly unknown[];
}

/**
 * Every collection a case may describe to the all-kinds `fetch` stub. Each is optional: a collection a case
 * says nothing about answers an empty, successful read.
 */
export interface AllKindsFixture {
  zones?: readonly { id: string; name: string }[];
  applications?: readonly { id: string; name: string }[];
  groups?: readonly { id: string; name: string }[];
  serviceTokens?: readonly { id: string; name: string }[];
  postureRules?: readonly { id: string; name: string }[];
  identityProviders?: readonly { id: string; name: string }[];
  reusablePolicies?: readonly { id: string; decision?: string; reusable?: true }[];
  policiesByApplication?: Record<string, readonly { id: string; decision?: string; precedence?: number }[]>;
  gatewayLists?: readonly { id: string; name: string; count?: number }[];
  gatewayListItemsByList?: Record<string, readonly { value?: string; description?: string }[]>;
  filterLists?: readonly {
    id: string;
    kind: string;
    name: string;
    num_items: number;
    num_referencing_filters: number;
  }[];
  filterListItemsByList?: Record<string, readonly { id: string; [key: string]: unknown }[]>;
  pagesProjects?: readonly { id: string; name: string; production_branch: string; domains?: readonly string[] }[];
  pagesDeploymentsByProject?: Record<string, readonly { id: string; environment?: string }[]>;
  pagesDomainsByProject?: Record<string, readonly { name: string; status?: string }[]>;
  workerAccountSetting?: { default_usage_model?: string; green_compute?: boolean };
  workerDomains?: readonly { id: string; hostname: string }[];
  workerScripts?: readonly { id: string }[];
  workerScriptsByName?: Record<string, WorkerScriptBundleFixture>;
  notificationPolicies?: readonly { id: string; name?: string }[];
  notificationWebhooks?: readonly { id: string; name?: string }[];
  notificationPagerduty?: readonly { id: string; name?: string }[];
  notificationSilences?: readonly { id: string; policy_id?: string }[];
  notificationHistory?: readonly { id: string; sent?: string }[];
  auditLogs?: readonly { id: string }[];
  accountSetting?: { id?: string; name?: string; type?: string };
  accountCertificates?: readonly { id: string; name?: string }[];
  accountCertificateAssociationsByCert?: Record<string, readonly { service?: string; status?: string }[]>;
  dnsRecords?: readonly { id: string; type?: string }[];
  dnssec?: { status?: string };
  zoneSettings?: readonly { id: string; value?: unknown }[];
  pageRules?: readonly { id: string; priority?: number }[];
  workerRoutes?: readonly { id: string; pattern?: string }[];
  filters?: readonly { id: string }[];
  firewallRules?: readonly { id: string }[];
  ipAccessRules?: readonly { id: string }[];
  uaRules?: readonly { id: string }[];
  lockdowns?: readonly { id: string }[];
  rateLimits?: readonly { id: string }[];
  wafPackages?: readonly { id: string }[];
  wafGroupsByPackage?: Record<string, readonly { id: string }[]>;
  wafRulesByPackage?: Record<string, readonly { id: string }[]>;
  wafOverrides?: readonly { id: string }[];
  certificatePacks?: readonly { id: string }[];
  universalSslSetting?: { enabled?: boolean };
  universalSslVerification?: readonly { cert_pack_uuid?: string; certificate_status: string }[];
  customCertificates?: readonly { id: string }[];
  clientCertificates?: readonly { id: string }[];
  keylessCertificates?: readonly { id: string }[];
  originCaCertificates?: readonly { id: string }[];
  aopSetting?: { enabled?: boolean };
  aopZoneCertificates?: readonly { id: string }[];
  aopHostnameCertificates?: readonly { id: string }[];
  customHostnames?: readonly { id: string }[];
  operations?: readonly { operation_id: string }[];
  discoveryOperations?: readonly { id: string }[];
  discoverySchemas?: { schemas?: readonly unknown[]; timestamp?: string };
  apiGatewaySchemas?: { schemas?: readonly unknown[]; timestamp?: string };
  labels?: readonly { name: string }[];
  apiGatewaySettings?: { validation_default_mitigation_action?: string };
  configuration?: { auth_id_characteristics?: readonly unknown[] };
  userSchemas?: readonly { schema_id: string }[];
  httpRequestGroups?: readonly { count: number; dimensions?: { datetimeHour?: string } }[];
  dnsQueryGroups?: readonly { count: number; dimensions?: { responseCode?: string } }[];
  rulesets?: readonly { id: string; name?: string; phase?: string }[];
  rulesetRulesById?: Record<string, readonly { id: string; action?: string }[]>;
  zeroTrust?: ZeroTrustFixture;
}

/** An {@link AllKindsFixture} with every collection present, defaults filled in. */
export type ResolvedAllKindsFixture = Required<AllKindsFixture>;

/** The parts of one `fetch` call a router decides on. */
interface FetchRequest {
  readonly pathname: string;
  readonly page: number;
  readonly init: RequestInit | undefined;
}

/** One endpoint family's router: the matching fixture response, or `null` when the request is not its own. */
export type FetchRouter = (options: { fixture: ResolvedAllKindsFixture; request: FetchRequest }) => Response | null;
