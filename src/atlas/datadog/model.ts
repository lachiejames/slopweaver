/**
 * What the Datadog atlas holds, and the permanent boundary of what it can ever claim.
 *
 * Kinds are the provider's own first meaningful path segment rather than an invented taxonomy, so a reader
 * who knows the Datadog console knows the kind. The version prefix is stripped, so `/api/v1/monitor` and
 * `/api/v2/monitor/...` are one kind: they are two ways to reach the same thing, and `kit/contract.ts`
 * exists to stop the same platform data appearing in the catalogue twice.
 */

/** The single platform this atlas maps. One PLATFORM, three SURFACES — see `kit/contract.ts`. */
export const DATADOG_ATLAS_PLATFORM = "datadog";

/**
 * Every REGISTRY kind this atlas publishes a file for — one per root the generated registry carries, without
 * exception.
 *
 * Written out rather than computed so the list stays a literal a caller can be checked against, and pinned
 * to the registry by `model.test.ts`, which asserts EXACT equality with EVERY kind the registry carries. A
 * kind here is a DECLARATION, never a claim that anything has been read: each kind's own coverage cell says
 * what actually happened to it.
 *
 * ## Why every kind, and not only the entity-bearing ones
 *
 * This list was 116 when it landed — the kinds carrying at least one `entity` row — and MEASURED against the
 * registry while writing `sync.ts` that left 50 of the 1,735 rows with no file to be published into, across
 * 28 kinds. Reproduce with `yarn tsx tools/datadogKindCensus.ts`. Two of the three groups were defects
 * rather than omissions:
 *
 * - **23 `shape-index` rows in 11 kinds** — `audit`, `events`, `spans`, `processes`, `containers`, `ddsql`,
 *   `query`, `logs-queries`, `dashboards`, `compliance_findings`, `posture_management`. `documents.ts` says
 *   a shape index "publishes entities into its own kind exactly like any other", and these had no own kind.
 *   An API sync would have computed eleven shape indexes and had nowhere to put them.
 * - **24 `excluded` rows** — `exclusions.ts` states that excluded rows "still exist … addressable by surface
 *   name for inventory and coverage", which is only true of a kind that has a file.
 * - **3 `probe-only` rows** in `validate` and `validate_keys`. They publish no entity by design, and they
 *   still have to be ANSWERABLE: "does Datadog have a call that validates a key" is exactly the question the
 *   compiled catalogue exists to answer offline.
 *
 * Several of these are surfaces Datadog does not document at all — `hamr`, `spa`, `bits-ai`, `graph`,
 * `pruned_trace`, `model-lab-api`. They are kept, and keeping them is the point: the owner's ruling is that
 * an undocumented endpoint that works is a usable source, and an atlas exists to surface exactly the things
 * nobody knew were there.
 * @internal
 */
export const DATADOG_REGISTRY_KINDS = [
  "actions",
  "actions-datastores",
  "agentless_scanning",
  "annotation",
  "anonymize_users",
  "api_key",
  "api_keys",
  "apicatalog",
  "apm",
  "app-builder",
  "application_key",
  "application_keys",
  "audit",
  "authn_mappings",
  "bits-ai",
  "cases",
  "catalog",
  "change-management",
  "check_run",
  "ci",
  "cloud_auth",
  "cloud_security_management",
  "cloudinventoryservice",
  "code-coverage",
  "compliance_findings",
  "container_images",
  "containers",
  "cost",
  "cost_by_tag",
  "csm",
  "current_user",
  "daily_custom_reports",
  "dashboard",
  "dashboards",
  "data-observability",
  "datasets",
  "ddsql",
  "deletion",
  "deployment_gates",
  "deployments",
  "distribution_points",
  "domain_allowlist",
  "dora",
  "downtime",
  "error-tracking",
  "events",
  "feature-flags",
  "fleet",
  "forms",
  "global_orgs",
  "governance",
  "graph",
  "hamr",
  "host",
  "hosts",
  "identity_providers",
  "idp",
  "incidents",
  "input",
  "integration",
  "integrations",
  "ip_allowlist",
  "llm-obs",
  "login",
  "logs",
  "logs-queries",
  "maintenance_windows",
  "metrics",
  "model-lab-api",
  "monitor",
  "monthly_custom_reports",
  "ndm",
  "network",
  "network-health-insights",
  "notebooks",
  "oauth2",
  "obs-pipelines",
  "on-call",
  "org",
  "org_authorized_clients",
  "org_configs",
  "org_connections",
  "org_group_memberships",
  "org_group_policies",
  "org_group_policy_configs",
  "org_group_policy_overrides",
  "org_group_policy_suggestions",
  "org_groups",
  "permissions",
  "personal_access_tokens",
  "posture_management",
  "powerpacks",
  "processes",
  "prodlytics",
  "product-analytics",
  "pruned_trace",
  "query",
  "reference-tables",
  "remote_config",
  "replay",
  "reporting",
  "restriction_policy",
  "roles",
  "root",
  "rum",
  "saml_configurations",
  "scorecard",
  "search",
  "seats",
  "security",
  "security-entities",
  "security_analytics",
  "security_monitoring",
  "sensitive-data-scanner",
  "series",
  "service_accounts",
  "services",
  "siem-historical-detections",
  "slo",
  "snapshot",
  "sourcemaps",
  "spa",
  "spans",
  "static-analysis",
  "static-analysis-sca",
  "statuspages",
  "stegadography",
  "synthetics",
  "tag_policies",
  "tags",
  "team",
  "team-hierarchy-links",
  "test",
  "trace",
  "usage",
  "user",
  "user_authorized_clients",
  "user_invitations",
  "users",
  "validate",
  "validate_keys",
  "web-integrations",
  "widgets",
  "workflows",
] as const;

/**
 * One registry kind.
 * @internal
 */
export type DatadogRegistryKind = (typeof DATADOG_REGISTRY_KINDS)[number];

/**
 * The two kinds the CONSOLE walk publishes, and the registry never does.
 *
 * `console-page` is one row per page the left nav declares (`consolePages.ts`) with what the walk found
 * there; `console-request` is one row per distinct first-party endpoint the console called while those
 * pages rendered — method, path shape and response field names, never a value. They are kinds rather than
 * a side file so `atlas datadog read --kind console-page` answers through the one reader, and they are
 * kept apart from {@link DATADOG_REGISTRY_KINDS} because a compile can never fill them: `surfaceFill.ts`
 * judges the compiled and `api` surfaces over the registry list alone, and the `console` surface over
 * these two.
 * @internal
 */
export const DATADOG_CONSOLE_KINDS = ["console-page", "console-request"] as const;

/**
 * One console kind.
 * @internal
 */
export type DatadogConsoleKind = (typeof DATADOG_CONSOLE_KINDS)[number];

/**
 * Every kind this atlas publishes a file for: the registry roots, then the two console kinds.
 * @internal
 */
export const DATADOG_KINDS = [...DATADOG_REGISTRY_KINDS, ...DATADOG_CONSOLE_KINDS] as const;

/**
 * One kind this atlas publishes.
 * @internal
 */
export type DatadogKind = (typeof DATADOG_KINDS)[number];

/**
 * The permanent claim boundary — what "complete" can ever mean for this installation.
 *
 * Stated in the credentials' own terms rather than as a reassurance. Three surfaces, three boundaries:
 * the compiled catalogue is bounded by what the pinned SDK declares and needs no credential at all; the
 * live API is bounded by what an `DD_API_KEY` plus `DD_APP_KEY` pair can read in one Datadog organisation
 * at one site; and the console walk is bounded by what the owner's own signed-in session can open. The
 * read-only property is carried by this repository's code — a closed operation registry, an allowlist
 * projection and a pre-publish refusal — never by the credentials' own scope, because a Datadog
 * application key inherits its owner's permissions and this owner can write.
 */
export const DATADOG_VISIBILITY_SCOPE =
  "one Datadog organisation at one configured site, read with an API key and an application key, plus the console as the owner's own browser session sees it; read-only is enforced by a closed operation registry, an allowlist projection and a pre-publish refusal, never by the credentials' own scope";
