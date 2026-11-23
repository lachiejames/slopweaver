/**
 * The Datadog console's navigation surface: every page the left nav offers, read from the LIVE nav.
 *
 * ## This denominator is the console's own nav, read on a date, and the owner accepted it as bounded
 *
 * Datadog publishes no sitemap. `GET /api/ui/cmd-k/navigation-mappings` is the command palette's shortcut
 * table, a subset of the pages, and the app-shell `/config` carries no route key, so the only list of "every page
 * the owner can open" is the left nav itself — which renders its section links in the DOM and each section's
 * pages only while that section is HOVERED. This file is that nav, read on {@link DATADOG_CONSOLE_NAV_READ_AT}
 * in the owner's own Chrome on this install's console through `slopweaver browser open`/`act --do hover`/`read`, one
 * hover per top-level entry, every fly-out's `a[href]` collected. The owner chose this
 * lean read over accepting the earlier recon as it stood, and that choice is what makes this a stated bounded
 * denominator rather than a subset: `descriptor.ts`'s console surface declares `known: true` against it.
 *
 * The earlier recon (`$SLOPWEAVER_HOME/atlas/datadog/`, `ui-inventory.md`, its pages grouped by section) was
 * the starting point and is a snapshot to READ, never to copy: it ages, Cloud Cost grew from one onboarding
 * page to a full section of its own, Developer Portal lands on `/idp/home` rather than `/idp`, and a
 * page it names that the live nav no longer offers is a finding about the snapshot, not a page this walk
 * failed to reach.
 *
 * ## Three things the nav renders that are NOT pages, excluded by rule
 *
 * {@link isConsolePageHref} is the rule, exported so the test names it rather than restating it:
 *
 * - **The organisation's own resources.** The Dashboards fly-out pins this org's own dashboards
 *   (`/dashboard/<abc-def-ghi>/<slug>`) and the Profile fly-out links a team (`/teams/<uuid>/platform`).
 *   Those are entities, held by the API surface under their own kinds; a page list that carried them would
 *   change every time somebody starred a dashboard.
 * - **Off-origin links.** The Help fly-out's Support Portal is `help.datadoghq.com`, outside the relay
 *   lease's origins and outside the console.
 * - **The mobile login QR page** (`/personal-settings/organizations/qrcode?orgUuid=…`). It renders a
 *   credential on screen and carries the org id in its query; it is the one in-console link left out, and
 *   it is left out for what it shows rather than for what it is.
 *
 * Some hrefs are reachable from two sections (`/actions/agents` from Bits AI and Automation, the Code
 * Security pages from Security and Software Delivery). A page is one page, so each is declared once, under
 * the first section the nav lists it in.
 *
 * ## Every route is a READ; `compose` says which render a form, `photograph` which are never pictured
 *
 * The transport navigates and observes; it clicks nothing and submits nothing, so opening `/monitors/create`
 * creates no monitor. Those pages stay in the list because the owner ruled out subsets, and each carries
 * `posture: "compose"` so a reader knows its screenshot is a blank form rather than evidence about a list.
 *
 * Thirty-two routes carry `photograph: "withheld"` instead — an occurrence explorer or a page listing
 * people, whose PICTURE would carry this organisation's own data past the response reduction that exists to
 * refuse it. See the field's own comment for the class and the mechanism; the page is still visited and
 * every call it makes is still recorded.
 *
 * ## The walk checks this file against the live nav on every run
 *
 * A hand-transcribed list is exactly what goes stale, so `consoleWalk.ts` re-reads
 * the section links the landing page renders and, through the `datadog-nav-observe` arm, every fly-out —
 * and `navDrift` turns the difference into a `console-nav-drifted` gap in BOTH directions. A route that
 * REDIRECTS somewhere this list does not carry is the same evidence from the other side
 * ({@link undeclaredDestinations}).
 */

/** One top-level entry of the left nav: what the console calls it, and where its own link lands. */
export interface DatadogConsoleSection {
  /** A stable kebab-case id, used as the `section` of every route beneath it. */
  readonly id: string;
  /** The nav's own accessible name for the entry. */
  readonly label: string;
  /** Where the section's own link lands, relative to the console origin. */
  readonly href: string;
}

/** One page the left nav offers. */
export interface DatadogConsoleRoute {
  /** The path relative to the console origin, query included where the nav carries one. */
  readonly href: string;
  /** The nav's own label for the page, badges (`new`, `preview`) stripped. */
  readonly label: string;
  /** `compose` marks a page whose content is a form for creating something; the walk submits nothing. */
  readonly posture: "read" | "compose";
  /**
   * Whether this page may be PHOTOGRAPHED. Omitted means yes — the common case, and a configuration page's
   * picture is the proof an investigation quotes.
   *
   * `withheld` is a standing decision rather than a run's outcome, and the walk passes it to the transport
   * BEFORE the visit, so no bytes are produced at any point (`pageTransport.ts`'s `photograph`). It marks
   * the pages whose content is not Datadog's configuration but this organisation's own data: an occurrence
   * explorer (logs, traces, RUM sessions, session replay, events, audit, security signals, CI runs, LLM
   * traces, database queries), or a page listing people (the org's users, teams and service accounts, and
   * the owner's own personal settings). A log line here carries `db.statement` against customer tables and a RUM
   * session carries user and session ids; a full-page PNG of one is exactly the thing the response
   * reduction exists to refuse, arriving by another route. The page is still VISITED and every call it
   * makes is still recorded — what is refused is the picture.
   */
  readonly photograph?: "withheld";
  /** The {@link DatadogConsoleSection.id} this page sits under. */
  readonly section: string;
}

/** The date the live nav was read to produce {@link DATADOG_CONSOLE_ROUTES}. */
export const DATADOG_CONSOLE_NAV_READ_AT = "2026-09-16";

/**
 * The left nav's top-level entries, in the order the console renders them: the products list, then the two
 * utility entries and the help menu. The landing page renders every one of these as an `a[href]`, so a walk
 * can check this list against the live nav without hovering anything.
 */
export const DATADOG_CONSOLE_SECTIONS: readonly DatadogConsoleSection[] = [
  { href: "/ask", id: "bits-ai", label: "Bits AI" },
  { href: "/dashboard/lists", id: "dashboards", label: "Dashboards" },
  { href: "/monitors/manage", id: "monitoring", label: "Monitoring" },
  { href: "/idp/home", id: "developer-portal", label: "Developer Portal" },
  { href: "/incidents", id: "incident-response", label: "Incident Response" },
  { href: "/actions", id: "automation", label: "Automation" },
  { href: "/infrastructure", id: "infrastructure", label: "Infrastructure" },
  { href: "/cost", id: "cloud-cost", label: "Cloud Cost" },
  { href: "/apm/home", id: "apm", label: "APM" },
  { href: "/synthetics/tests", id: "digital-experience", label: "Digital Experience" },
  { href: "/ci", id: "software-delivery", label: "Software Delivery" },
  { href: "/security/overview", id: "security", label: "Security" },
  { href: "/data-obs", id: "data-observability", label: "Data Observability" },
  { href: "/llm", id: "ai-observability", label: "AI Observability" },
  { href: "/error-tracking", id: "errors", label: "Errors" },
  { href: "/metric/overview", id: "metrics", label: "Metrics" },
  { href: "/logs", id: "logs", label: "Logs" },
  { href: "/integrations", id: "integrations", label: "Integrations" },
  { href: "/personal-settings", id: "profile", label: "Profile" },
  { href: "/help", id: "help", label: "Help" },
];

/**
 * Every console page this atlas declares, grouped by section in nav order.
 *
 * Grouped rather than sorted because the sections are what a coverage reason reports, and a reader checking
 * "did we look at the cost half" reads the group rather than counting rows.
 */
export const DATADOG_CONSOLE_ROUTES: readonly DatadogConsoleRoute[] = [
  // bits-ai
  { href: "/ask", label: "Bits Chat", posture: "read", section: "bits-ai" },
  { href: "/ask/usage", label: "Reports", posture: "read", section: "bits-ai" },
  { href: "/ask/settings", label: "Settings", posture: "read", section: "bits-ai" },
  { href: "/bits-ai/investigations", label: "Investigations List", posture: "read", section: "bits-ai" },
  { href: "/bits-ai/investigations/new", label: "New Investigation", posture: "compose", section: "bits-ai" },
  { href: "/bits-ai/reports", label: "Reports", posture: "read", section: "bits-ai" },
  { href: "/bits-ai/settings", label: "Settings", posture: "read", section: "bits-ai" },
  { href: "/bits-ai/monitors", label: "Monitors", posture: "read", section: "bits-ai" },
  { href: "/code", label: "Sessions", posture: "read", section: "bits-ai" },
  { href: "/code/automations", label: "Automations", posture: "read", section: "bits-ai" },
  { href: "/code/usage", label: "Usage", posture: "read", section: "bits-ai" },
  { href: "/code/settings", label: "Settings", posture: "read", section: "bits-ai" },
  { href: "/actions/agents", label: "Bits Agent Builder", posture: "read", section: "bits-ai" },
  { href: "/bits-ai/ai-credits-management", label: "AI Credits Management", posture: "read", section: "bits-ai" },
  { href: "/llm/ai-agents-console/datadog-agents", label: "Usage", posture: "read", section: "bits-ai" },
  // dashboards
  { href: "/dashboard/lists", label: "Dashboard List", posture: "read", section: "dashboards" },
  { href: "/dashboard/reports", label: "Reports", posture: "read", section: "dashboards" },
  { href: "/notebook/list", label: "Notebooks List", posture: "read", section: "dashboards" },
  { href: "/notebook", label: "New Notebook", posture: "compose", section: "dashboards" },
  { href: "/sheets", label: "Spreadsheets List", posture: "read", section: "dashboards" },
  { href: "/ddsql/editor", label: "DDSQL Editor", posture: "read", section: "dashboards" },
  // monitoring
  { href: "/monitors/manage", label: "Monitor List", posture: "read", section: "monitoring" },
  { href: "/monitors/settings", label: "Settings", posture: "read", section: "monitoring" },
  { href: "/monitors/create", label: "New Monitor", posture: "compose", section: "monitoring" },
  { href: "/monitors/triggered", label: "Triggered", posture: "read", section: "monitoring" },
  { href: "/monitors/downtimes", label: "Downtimes", posture: "read", section: "monitoring" },
  { href: "/monitors/quality", label: "Quality", posture: "read", section: "monitoring" },
  { href: "/slo/manage", label: "SLOs", posture: "read", section: "monitoring" },
  { href: "/check/summary", label: "Check Summary", posture: "read", section: "monitoring" },
  { href: "/event/correlation", photograph: "withheld", label: "Triage Inbox", posture: "read", section: "monitoring" },
  { href: "/event/settings", label: "Settings", posture: "read", section: "monitoring" },
  { href: "/event/explorer", photograph: "withheld", label: "All Events", posture: "read", section: "monitoring" },
  { href: "/watchdog", label: "Watchdog", posture: "read", section: "monitoring" },
  {
    href: "/watchdog/external-provider-status",
    label: "External Provider Status",
    posture: "read",
    section: "monitoring",
  },
  // developer-portal
  { href: "/idp/home", label: "Internal Developer Portal", posture: "read", section: "developer-portal" },
  { href: "/software?lens=Ownership", label: "Catalog", posture: "read", section: "developer-portal" },
  { href: "/software/settings/entity-management", label: "Settings", posture: "read", section: "developer-portal" },
  { href: "/software/scorecards", label: "Scorecards", posture: "read", section: "developer-portal" },
  { href: "/idp/reports", label: "Reports", posture: "read", section: "developer-portal" },
  { href: "/idp/surveys", label: "Surveys", posture: "read", section: "developer-portal" },
  { href: "/software/self-service-actions", label: "Actions", posture: "read", section: "developer-portal" },
  // incident-response
  { href: "/incidents", photograph: "withheld", label: "Incident List", posture: "read", section: "incident-response" },
  { href: "/on-call", label: "On-Call", posture: "read", section: "incident-response" },
  { href: "/on-call/teams", label: "Teams", posture: "read", section: "incident-response" },
  { href: "/on-call/pages", photograph: "withheld", label: "Pages", posture: "read", section: "incident-response" },
  {
    href: "/personal-settings/profile?tab=on-call-notifications",
    photograph: "withheld",
    label: "Profile",
    posture: "read",
    section: "incident-response",
  },
  { href: "/on-call/settings", label: "Settings", posture: "read", section: "incident-response" },
  { href: "/incidents/settings", label: "Settings", posture: "read", section: "incident-response" },
  { href: "/status-pages", label: "Status Pages", posture: "read", section: "incident-response" },
  { href: "/work", label: "Work Management", posture: "read", section: "incident-response" },
  // automation
  { href: "/actions", label: "Actions", posture: "read", section: "automation" },
  { href: "/workflow", label: "Workflow Automation", posture: "read", section: "automation" },
  { href: "/actions/action-catalog", label: "Action Catalog", posture: "read", section: "automation" },
  { href: "/workflow/create", label: "New Workflow", posture: "compose", section: "automation" },
  { href: "/app-builder/apps/list", label: "Apps", posture: "read", section: "automation" },
  { href: "/app-builder/apps/edit?newApp=true", label: "New App", posture: "compose", section: "automation" },
  { href: "/forms", label: "Forms", posture: "read", section: "automation" },
  // infrastructure
  { href: "/infrastructure", label: "Hosts", posture: "read", section: "infrastructure" },
  { href: "/software?selectedComponent=infrastructure", label: "Catalog", posture: "read", section: "infrastructure" },
  { href: "/cloud-maps", label: "Cloudcraft", posture: "read", section: "infrastructure" },
  { href: "/infrastructure/catalog/governance", label: "Policies", posture: "read", section: "infrastructure" },
  {
    href: "/infrastructure/catalog/configuration",
    label: "Add Resources",
    posture: "compose",
    section: "infrastructure",
  },
  { href: "/infrastructure/catalog/changes", label: "Changes", posture: "read", section: "infrastructure" },
  {
    href: "/software?lens=Performance&query=telemetry:universal_service_monitoring",
    label: "Universal Service Monitoring",
    posture: "read",
    section: "infrastructure",
  },
  { href: "/infrastructure/map", label: "Host Map", posture: "read", section: "infrastructure" },
  { href: "/gpu-monitoring", label: "GPU Monitoring", posture: "read", section: "infrastructure" },
  { href: "/containers", label: "Containers", posture: "read", section: "infrastructure" },
  { href: "/kubernetes", label: "Kubernetes Overview", posture: "read", section: "infrastructure" },
  { href: "/orchestration/explorer", label: "Kubernetes Explorer", posture: "read", section: "infrastructure" },
  {
    href: "/orchestration/scaling/summary",
    label: "Kubernetes Autoscaling",
    posture: "read",
    section: "infrastructure",
  },
  { href: "/container-images", label: "Container Images", posture: "read", section: "infrastructure" },
  { href: "/orchestration/explorer/ecsTask", label: "ECS Explorer", posture: "read", section: "infrastructure" },
  { href: "/process", label: "Processes", posture: "read", section: "infrastructure" },
  { href: "/serverless", label: "Serverless", posture: "read", section: "infrastructure" },
  { href: "/network/health", label: "Cloud Network", posture: "read", section: "infrastructure" },
  { href: "/network", label: "Analytics", posture: "read", section: "infrastructure" },
  { href: "/network/map", label: "Network Map", posture: "read", section: "infrastructure" },
  { href: "/devices", label: "Network Devices", posture: "read", section: "infrastructure" },
  { href: "/devices/maps/geomap", label: "Device Geomap", posture: "read", section: "infrastructure" },
  { href: "/devices/settings/profiles", label: "Settings", posture: "read", section: "infrastructure" },
  { href: "/devices/maps/topology", label: "Device Topology Map", posture: "read", section: "infrastructure" },
  { href: "/devices/netflow", label: "NetFlow", posture: "read", section: "infrastructure" },
  { href: "/network-path", label: "Network Path", posture: "read", section: "infrastructure" },
  { href: "/storage-management", label: "Storage Management", posture: "read", section: "infrastructure" },
  { href: "/end-user-devices", label: "End User Devices", posture: "read", section: "infrastructure" },
  // cloud-cost
  { href: "/cost", label: "Cloud Cost", posture: "read", section: "cloud-cost" },
  { href: "/cost/summarize", label: "Summarize", posture: "read", section: "cloud-cost" },
  { href: "/cost/summarize/overview", label: "Overview", posture: "read", section: "cloud-cost" },
  { href: "/cost/summarize/containers", label: "Containers", posture: "read", section: "cloud-cost" },
  { href: "/cost/summarize/ai-costs", label: "AI Costs", posture: "read", section: "cloud-cost" },
  { href: "/cost/settings", label: "Settings", posture: "read", section: "cloud-cost" },
  { href: "/cost/settings/data-history", label: "Data History", posture: "read", section: "cloud-cost" },
  { href: "/cost/onboarding-checklist", label: "Onboarding Checklist", posture: "read", section: "cloud-cost" },
  { href: "/cost/analyze", label: "Analyze", posture: "read", section: "cloud-cost" },
  { href: "/cost/analyze/explorer", label: "Explorer", posture: "read", section: "cloud-cost" },
  { href: "/cost/analyze/reports", label: "Reports", posture: "read", section: "cloud-cost" },
  { href: "/cost/monitor", label: "Monitor", posture: "read", section: "cloud-cost" },
  { href: "/cost/optimize", label: "Optimize", posture: "read", section: "cloud-cost" },
  { href: "/cost/optimize/recommendations", label: "Recommendations", posture: "read", section: "cloud-cost" },
  { href: "/cost/optimize/automations/notifications", label: "Automations", posture: "read", section: "cloud-cost" },
  { href: "/cost/allocate", label: "Allocate", posture: "read", section: "cloud-cost" },
  { href: "/cost/allocate/tag-pipelines", label: "Tag Pipelines", posture: "read", section: "cloud-cost" },
  {
    href: "/cost/allocate/custom-allocation-rules",
    label: "Custom Allocation Rules",
    posture: "read",
    section: "cloud-cost",
  },
  { href: "/cost/plan", label: "Plan", posture: "read", section: "cloud-cost" },
  { href: "/cost/plan/budgets", label: "Budgets", posture: "read", section: "cloud-cost" },
  { href: "/cost/plan/commitment-programs", label: "Commitment Programs", posture: "read", section: "cloud-cost" },
  // apm
  { href: "/apm/home", label: "Application Performance Monitoring", posture: "read", section: "apm" },
  { href: "/software", label: "Services", posture: "read", section: "apm" },
  { href: "/software?selectedComponent=endpoint", label: "Endpoints", posture: "read", section: "apm" },
  { href: "/apm/service-setup", label: "Instrument a Service", posture: "compose", section: "apm" },
  { href: "/apm/settings", label: "Settings", posture: "read", section: "apm" },
  { href: "/apm/traces", photograph: "withheld", label: "Traces", posture: "read", section: "apm" },
  { href: "/apm/recommendations", label: "Recommendations", posture: "read", section: "apm" },
  { href: "/profiling/overview", label: "Profiles", posture: "read", section: "apm" },
  { href: "/profiling/explorer?viz=flame_graph", label: "Explorer", posture: "read", section: "apm" },
  { href: "/profiling/comparison", label: "Comparison", posture: "read", section: "apm" },
  { href: "/profiling/insights", label: "Insights", posture: "read", section: "apm" },
  { href: "/debugging", label: "Live Debugger", posture: "read", section: "apm" },
  { href: "/debugging/sessions", label: "Sessions List", posture: "read", section: "apm" },
  { href: "/debugging/settings", label: "Configuration", posture: "read", section: "apm" },
  { href: "/dynamic-instrumentation", label: "Dynamic Instrumentation", posture: "read", section: "apm" },
  { href: "/databases/list", photograph: "withheld", label: "Database Monitoring", posture: "read", section: "apm" },
  { href: "/data-streams", label: "Data Streams Monitoring", posture: "read", section: "apm" },
  { href: "/data-obs/jobs", label: "Data Jobs Monitoring", posture: "read", section: "apm" },
  {
    href: "/sensitive-data-scanner/coverage?source=apm",
    label: "Sensitive Data Scanner",
    posture: "read",
    section: "apm",
  },
  // digital-experience
  { href: "/synthetics/tests", label: "Tests", posture: "read", section: "digital-experience" },
  { href: "/synthetics/settings", label: "Settings", posture: "read", section: "digital-experience" },
  { href: "/synthetics/suites", label: "Test Suites", posture: "read", section: "digital-experience" },
  { href: "/synthetics/test-suite/create", label: "New Test Suite", posture: "compose", section: "digital-experience" },
  {
    href: "/synthetics/explorer?track=synthetics",
    photograph: "withheld",
    label: "Results Explorer",
    posture: "read",
    section: "digital-experience",
  },
  {
    href: "/synthetics/explorer?track=synbatch",
    photograph: "withheld",
    label: "Continuous Testing",
    posture: "read",
    section: "digital-experience",
  },
  { href: "/synthetics/test-coverage", label: "Test Coverage", posture: "read", section: "digital-experience" },
  { href: "/rum/performance-monitoring", label: "Summary", posture: "read", section: "digital-experience" },
  { href: "/rum/operation-catalog", label: "Operations", posture: "read", section: "digital-experience" },
  { href: "/rum/optimization", label: "Investigate", posture: "read", section: "digital-experience" },
  { href: "/rum/list", label: "Manage Applications", posture: "read", section: "digital-experience" },
  { href: "/rum/generate-metrics", label: "Generate Metrics", posture: "read", section: "digital-experience" },
  {
    href: "/sensitive-data-scanner?source=rum-navigation",
    label: "Sensitive Data Scanner",
    posture: "read",
    section: "digital-experience",
  },
  { href: "/rum/sessions", photograph: "withheld", label: "Explore", posture: "read", section: "digital-experience" },
  {
    href: "/rum/replay/search",
    photograph: "withheld",
    label: "Recordings",
    posture: "read",
    section: "digital-experience",
  },
  {
    href: "/rum/replay/playlists",
    photograph: "withheld",
    label: "Playlists",
    posture: "read",
    section: "digital-experience",
  },
  {
    href: "/product-analytics",
    photograph: "withheld",
    label: "Product Analytics",
    posture: "read",
    section: "digital-experience",
  },
  { href: "/product-analytics/experiments", label: "Experiments", posture: "read", section: "digital-experience" },
  // software-delivery
  { href: "/ci", label: "Software Delivery", posture: "read", section: "software-delivery" },
  { href: "/ci/pipelines/health", label: "CI Health", posture: "read", section: "software-delivery" },
  { href: "/ci/pipelines", label: "CI Pipeline List", posture: "read", section: "software-delivery" },
  { href: "/ci/setup/pipeline", label: "Add a Pipeline Provider", posture: "compose", section: "software-delivery" },
  { href: "/ci/settings/visibility", label: "Settings", posture: "read", section: "software-delivery" },
  {
    href: "/ci/pipeline-executions",
    photograph: "withheld",
    label: "Executions",
    posture: "read",
    section: "software-delivery",
  },
  { href: "/feature-flags", label: "Feature Flags", posture: "read", section: "software-delivery" },
  {
    href: "/feature-flags/settings/environments",
    label: "Environments",
    posture: "read",
    section: "software-delivery",
  },
  {
    href: "/ci/deployment-gates/getting-started",
    label: "Deployment Gates",
    posture: "read",
    section: "software-delivery",
  },
  { href: "/ci/test/health", label: "Test Health", posture: "read", section: "software-delivery" },
  { href: "/ci/test/flaky", label: "Flaky Management", posture: "read", section: "software-delivery" },
  { href: "/ci/setup/test", label: "Add Repository", posture: "compose", section: "software-delivery" },
  { href: "/ci/settings/test-optimization", label: "Settings", posture: "read", section: "software-delivery" },
  { href: "/ci/test/runs", photograph: "withheld", label: "Test Runs", posture: "read", section: "software-delivery" },
  {
    href: "/ci/code-coverage/getting-started",
    label: "Intro to Code Coverage",
    posture: "read",
    section: "software-delivery",
  },
  { href: "/security/code-security/summary", label: "Code Security", posture: "read", section: "software-delivery" },
  { href: "/security/code-security", label: "Vulnerabilities", posture: "read", section: "software-delivery" },
  {
    href: "/security/code-security/repositories",
    label: "Repositories",
    posture: "read",
    section: "software-delivery",
  },
  {
    href: "/security/configuration/code-security/settings",
    label: "Repository Settings",
    posture: "read",
    section: "software-delivery",
  },
  {
    href: "/security/configuration/code-security/setup",
    label: "Setup",
    posture: "read",
    section: "software-delivery",
  },
  { href: "/ci/pr-gates", label: "PR Gates", posture: "read", section: "software-delivery" },
  { href: "/ci/dora", label: "DORA Metrics", posture: "read", section: "software-delivery" },
  { href: "/ci/settings/dora", label: "Settings", posture: "read", section: "software-delivery" },
  { href: "/ci/dora/ai-impact", label: "AI Impact", posture: "read", section: "software-delivery" },
  // security
  { href: "/security/overview", label: "Security", posture: "read", section: "security" },
  { href: "/security/signals", photograph: "withheld", label: "Signals", posture: "read", section: "security" },
  { href: "/security/configuration", label: "Settings", posture: "read", section: "security" },
  { href: "/security/feed", label: "Research Feed", posture: "read", section: "security" },
  { href: "/security/siem/home", label: "Cloud SIEM", posture: "read", section: "security" },
  { href: "/security/csm/onboarding", label: "Cloud Security", posture: "read", section: "security" },
  { href: "/security/appsec", label: "App & API Protection", posture: "read", section: "security" },
  {
    href: "/security/workload-protection/overview",
    label: "Workload Protection",
    posture: "read",
    section: "security",
  },
  {
    href: "/sensitive-data-scanner?source=security-navigation",
    label: "Sensitive Data Scanner",
    posture: "read",
    section: "security",
  },
  {
    href: "/sensitive-data-scanner/findings",
    photograph: "withheld",
    label: "Findings",
    posture: "read",
    section: "security",
  },
  { href: "/sensitive-data-scanner/configuration/telemetry", label: "Settings", posture: "read", section: "security" },
  { href: "/security/ai-guard", label: "AI Guard", posture: "read", section: "security" },
  // data-observability
  { href: "/data-obs", label: "Data Observability", posture: "read", section: "data-observability" },
  { href: "/data-obs/catalog", label: "Catalog", posture: "read", section: "data-observability" },
  { href: "/data-obs/settings", label: "Settings", posture: "read", section: "data-observability" },
  { href: "/data-obs/monitors", label: "Monitors", posture: "read", section: "data-observability" },
  {
    href: "/data-obs/queries",
    photograph: "withheld",
    label: "Queries",
    posture: "read",
    section: "data-observability",
  },
  { href: "/data-obs/lineage", label: "Lineage", posture: "read", section: "data-observability" },
  { href: "/data-obs/ci-cd", label: "CI/CD", posture: "read", section: "data-observability" },
  // ai-observability
  { href: "/llm", label: "Agent Observability", posture: "read", section: "ai-observability" },
  { href: "/llm/applications", label: "Overview", posture: "read", section: "ai-observability" },
  { href: "/llm/traces", photograph: "withheld", label: "Traces", posture: "read", section: "ai-observability" },
  { href: "/llm/evaluations", label: "Evaluations", posture: "read", section: "ai-observability" },
  { href: "/llm/experiments", label: "Experiments", posture: "read", section: "ai-observability" },
  { href: "/llm/ai-agents-console", label: "Agent Console", posture: "read", section: "ai-observability" },
  // errors
  { href: "/error-tracking", photograph: "withheld", label: "Errors", posture: "read", section: "errors" },
  // metrics
  { href: "/metric/overview", label: "Metrics", posture: "read", section: "metrics" },
  { href: "/metric/explorer", label: "Explorer", posture: "read", section: "metrics" },
  { href: "/metric/settings", label: "Settings", posture: "read", section: "metrics" },
  { href: "/metric/summary", label: "Summary", posture: "read", section: "metrics" },
  { href: "/metric/volume?sort=-volume_total", label: "Volume", posture: "read", section: "metrics" },
  // logs
  { href: "/logs", photograph: "withheld", label: "Explorer", posture: "read", section: "logs" },
  { href: "/logs/archive-search", photograph: "withheld", label: "Archive Search", posture: "read", section: "logs" },
  { href: "/logs/livetail", photograph: "withheld", label: "Live Tail", posture: "read", section: "logs" },
  { href: "/logs/pipelines", label: "Pipelines", posture: "read", section: "logs" },
  { href: "/logs/indexes", label: "Indexes", posture: "read", section: "logs" },
  { href: "/logs/flex-logs-controls", label: "Flex Logs Controls", posture: "read", section: "logs" },
  { href: "/logs/onboarding", label: "Add a Log Source", posture: "compose", section: "logs" },
  { href: "/logs/metrics", label: "Generate Metrics", posture: "read", section: "logs" },
  { href: "/logs/data-access", label: "Data Access", posture: "read", section: "logs" },
  { href: "/logs/forwarding", label: "Archiving & Forwarding", posture: "read", section: "logs" },
  { href: "/observability-pipelines", label: "Observability Pipelines", posture: "read", section: "logs" },
  { href: "/observability-pipelines?tab=packs", label: "Volume Control Packs", posture: "read", section: "logs" },
  { href: "/observability-pipelines?tab=pipelines", label: "New Pipeline", posture: "compose", section: "logs" },
  {
    href: "/sensitive-data-scanner?source=logs-navigation",
    label: "Sensitive Data Scanner",
    posture: "read",
    section: "logs",
  },
  // integrations
  { href: "/integrations", label: "Integrations", posture: "read", section: "integrations" },
  { href: "/marketplace", label: "Marketplace", posture: "read", section: "integrations" },
  { href: "/reference-tables", label: "Reference Tables", posture: "read", section: "integrations" },
  { href: "/source-code", label: "Source Code Integration", posture: "read", section: "integrations" },
  { href: "/fleet", label: "Fleet View", posture: "read", section: "integrations" },
  {
    href: "/fleet/install-agent/latest?platform=overview",
    label: "Install Agents",
    posture: "compose",
    section: "integrations",
  },
  { href: "/fleet/agent-management", label: "Configuration", posture: "read", section: "integrations" },
  { href: "/fleet/agent-upgrades", label: "Upgrades", posture: "read", section: "integrations" },
  { href: "/ide-integrations/intro", label: "IDE Plugins", posture: "read", section: "integrations" },
  // profile
  {
    href: "/personal-settings",
    photograph: "withheld",
    label: "Personal Settings",
    posture: "read",
    section: "profile",
  },
  {
    href: "/personal-settings/profile",
    photograph: "withheld",
    label: "My Profile",
    posture: "read",
    section: "profile",
  },
  {
    href: "/personal-settings/preferences",
    photograph: "withheld",
    label: "My Preferences",
    posture: "read",
    section: "profile",
  },
  {
    href: "/personal-settings/organizations",
    photograph: "withheld",
    label: "My Organizations",
    posture: "read",
    section: "profile",
  },
  {
    href: "/personal-settings/access-tokens",
    photograph: "withheld",
    label: "My Access Tokens",
    posture: "read",
    section: "profile",
  },
  { href: "/organization-settings", label: "Organization Settings", posture: "read", section: "profile" },
  { href: "/billing", label: "Plan & Usage", posture: "read", section: "profile" },
  { href: "/organization-settings/users", photograph: "withheld", label: "Users", posture: "read", section: "profile" },
  { href: "/organization-settings/teams", photograph: "withheld", label: "Teams", posture: "read", section: "profile" },
  { href: "/organization-settings/roles", label: "Roles", posture: "read", section: "profile" },
  {
    href: "/organization-settings/service-accounts",
    photograph: "withheld",
    label: "Service Accounts",
    posture: "read",
    section: "profile",
  },
  { href: "/organization-settings/api-keys", label: "API Keys", posture: "read", section: "profile" },
  { href: "/organization-settings/access-tokens", label: "Access Tokens", posture: "read", section: "profile" },
  { href: "/audit-trail", photograph: "withheld", label: "Audit Trail", posture: "read", section: "profile" },
  // help
  { href: "/organization-settings/users/invite", label: "Invite", posture: "compose", section: "help" },
  { href: "/help", label: "All Resources", posture: "read", section: "help" },
  { href: "/release-notes", label: "View All", posture: "read", section: "help" },
  { href: "/help/quick_start", label: "Quick Start", posture: "read", section: "help" },
];

/** A Datadog dashboard id: three groups of three, as in `/dashboard/abc-def-ghi/<slug>`. */
const DASHBOARD_ID_SEGMENT = /^\/dashboard\/[a-z0-9]{3}-[a-z0-9]{3}-[a-z0-9]{3}(?:\/|$)/;

/** A team page addressed by its uuid, as in `/teams/<uuid>/platform`. */
const TEAM_UUID_SEGMENT = /^\/teams\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\/|$)/;

/** A query carrying the organisation's own id. */
const ORG_UUID_QUERY = /[?&]orgUuid=/;

/**
 * Whether a nav href names a console PAGE rather than one of this organisation's resources or an outside
 * site — the exclusion rule this file's header states.
 *
 * @param href the href exactly as the nav rendered it, relative or absolute
 * @returns `true` for a page this list may declare
 */
export function isConsolePageHref({ href }: { href: string }): boolean {
  if (!href.startsWith("/")) {
    return false;
  }
  return !DASHBOARD_ID_SEGMENT.test(href) && !TEAM_UUID_SEGMENT.test(href) && !ORG_UUID_QUERY.test(href);
}

/** A tracking parameter the nav appends to some links, which names the click rather than the page. */
const NAV_TRACKING_PARAM = /[?&]from-top-level-nav=true/;

/**
 * Reduce an href the nav rendered to the form this list declares it in: the tracking parameter dropped,
 * a bare `?` that leaves behind removed.
 *
 * @param href the href exactly as the nav rendered it
 * @returns the href as {@link DATADOG_CONSOLE_ROUTES} would spell it
 */
export function canonicalNavHref({ href }: { href: string }): string {
  const stripped = href.replace(NAV_TRACKING_PARAM, (match) => (match.startsWith("?") ? "?" : ""));
  return stripped.endsWith("?") ? stripped.slice(0, -1) : stripped;
}

/**
 * Every console path a walk settled on that this registry does not declare.
 *
 * A redirect's destination is evidence about THIS FILE: the console has a page the list never heard of.
 * Only same-origin destinations count, and each is reported once.
 *
 * @param finalUrls where each visit actually settled
 * @param origin the console origin, so a foreign destination is not mistaken for an undeclared page
 * @returns the undeclared paths, sorted
 */
export function undeclaredDestinations({
  finalUrls,
  origin,
}: {
  finalUrls: readonly string[];
  origin: string;
}): readonly string[] {
  const declared = new Set(DATADOG_CONSOLE_ROUTES.map((route) => route.href));
  const found = new Set<string>();
  for (const url of finalUrls) {
    if (!url.startsWith(`${origin}/`)) {
      continue;
    }
    const path = url.slice(origin.length);
    if (isConsolePageHref({ href: path }) && !declared.has(path) && !declared.has(path.split("?")[0]!)) {
      found.add(path);
    }
  }
  return [...found].toSorted();
}

/** One link the live nav rendered, as the nav-observe arm reports it. */
export interface DatadogNavLink {
  readonly section: string;
  readonly href: string;
  readonly label: string;
}

/**
 * How the live nav differs from what this file declares, in both directions.
 *
 * `undeclared` are pages the console offers today that no route names — the list has gone stale.
 * `gone` are declared routes the live nav no longer offers — a page removed, moved or renamed. Links the
 * exclusion rule refuses are ignored on both sides, and a section the arm could not hover is skipped rather
 * than reported as emptied: its routes are only judged `gone` when the section's fly-out was actually read.
 *
 * @param live every link the nav-observe arm collected
 * @param hovered the section ids whose fly-outs the arm actually read
 * @param declared the routes to judge, {@link DATADOG_CONSOLE_ROUTES} in production
 * @returns both directions, each sorted
 */
export function navDrift({
  live,
  hovered,
  declared = DATADOG_CONSOLE_ROUTES,
}: {
  live: readonly DatadogNavLink[];
  hovered: readonly string[];
  declared?: readonly DatadogConsoleRoute[];
}): { readonly undeclared: readonly string[]; readonly gone: readonly string[] } {
  const declaredHrefs = new Set(declared.map((route) => route.href));
  const liveHrefs = new Set(
    live.map((link) => canonicalNavHref({ href: link.href })).filter((href) => isConsolePageHref({ href })),
  );
  const read = new Set(hovered);
  return {
    gone: [...declaredHrefs]
      .filter((href) => !liveHrefs.has(href))
      .filter((href) => {
        const route = declared.find((candidate) => candidate.href === href)!;
        return read.has(route.section);
      })
      .toSorted(),
    undeclared: [...liveHrefs].filter((href) => !declaredHrefs.has(href)).toSorted(),
  };
}
