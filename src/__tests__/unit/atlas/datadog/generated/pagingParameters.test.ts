/**
 * The generated Datadog paging side table, read directly: how many surfaces walk, exactly which ones, in the
 * order the generator emits them, and the complete parameter pair for one surface of each paging style the
 * pinned client uses — page number, cursor, offset, continuation token, a walk that reuses its size parameter,
 * and a walk with no size cap. The accessor's absent-surface answer belongs to `../pagingParameters.ts`.
 */
import { describe, expect, it } from "vitest";

import { DATADOG_PAGING_PARAMETERS } from "../../../../../atlas/datadog/generated/pagingParameters.js";

const surfaces = Object.keys(DATADOG_PAGING_PARAMETERS);

/**
 * The parameter pair the table holds for one surface, refusing a surface it does not carry.
 *
 * @returns the walk and size parameter names
 */
function pairFor({ surface }: { surface: string }): { size: string | null; walk: string | null } {
  const pair = DATADOG_PAGING_PARAMETERS[surface];
  if (pair === undefined) {
    throw new Error(`no paging parameters for ${surface}`);
  }
  return { size: pair.size, walk: pair.walk };
}

describe("DATADOG_PAGING_PARAMETERS", () => {
  it("carries exactly 168 surfaces", () => {
    expect(surfaces.length).toBeGreaterThan(0);
    expect(surfaces.length).toBe(168);
  });

  it("emits its surfaces in sorted order", () => {
    expect(surfaces).toEqual(surfaces.toSorted());
  });

  it("names exactly these surfaces, in this order", () => {
    expect(surfaces).toEqual([
      "v1-dashboards-get-public-dashboard-invitations",
      "v1-dashboards-list-dashboards",
      "v1-events-list-events",
      "v1-hosts-list-hosts",
      "v1-monitors-list-monitors",
      "v1-monitors-search-monitor-groups",
      "v1-monitors-search-monitors",
      "v1-notebooks-list-notebooks",
      "v1-service-level-objective-corrections-list-slocorrection",
      "v1-service-level-objectives-list-slos",
      "v1-service-level-objectives-search-slo",
      "v1-synthetics-list-tests",
      "v1-synthetics-search-tests",
      "v1-usage-metering-get-daily-custom-reports",
      "v1-usage-metering-get-hourly-usage-attribution",
      "v1-usage-metering-get-monthly-custom-reports",
      "v1-usage-metering-get-monthly-usage-attribution",
      "v1-usage-metering-get-usage-top-avg-metrics",
      "v2-action-connection-list-app-key-registrations",
      "v2-actions-datastores-list-datastore-items",
      "v2-apimanagement-list-apis",
      "v2-app-builder-list-app-versions",
      "v2-app-builder-list-apps",
      "v2-app-builder-list-blueprints",
      "v2-audit-list-audit-logs",
      "v2-auth-nmappings-list-auth-nmappings",
      "v2-bits-ai-list-investigations",
      "v2-case-management-count-cases",
      "v2-case-management-list-case-timeline",
      "v2-case-management-search-cases",
      "v2-civisibility-pipelines-list-ciapp-pipeline-events",
      "v2-civisibility-tests-list-ciapp-test-events",
      "v2-cloud-cost-management-get-cost-tag-key",
      "v2-cloud-cost-management-list-cost-anomalies",
      "v2-cloud-cost-management-list-cost-tags",
      "v2-cloud-cost-management-list-custom-costs-files",
      "v2-cloud-cost-management-search-cost-recommendations",
      "v2-cloud-network-monitoring-get-aggregated-connections",
      "v2-cloud-network-monitoring-get-aggregated-dns",
      "v2-container-images-list-container-images",
      "v2-containers-list-containers",
      "v2-csmagents-list-all-csmagents",
      "v2-csmagents-list-all-csmserverless-agents",
      "v2-csmownership-list-ownership-history",
      "v2-csmownership-list-ownership-history-by-owner-type",
      "v2-csmsettings-list-csmagentless-hosts",
      "v2-csmsettings-list-csmunified-hosts",
      "v2-dashboards-list-dashboards-usage",
      "v2-data-deletion-get-data-deletion-requests",
      "v2-deployment-gates-list-deployment-gates",
      "v2-downtimes-list-downtimes",
      "v2-downtimes-list-monitor-downtimes",
      "v2-entity-risk-scores-list-entity-risk-scores",
      "v2-events-list-events",
      "v2-feature-flags-list-feature-flags",
      "v2-feature-flags-list-feature-flags-environments",
      "v2-fleet-automation-list-fleet-agent-tracers",
      "v2-fleet-automation-list-fleet-agents-v2",
      "v2-fleet-automation-list-fleet-deployments-v2",
      "v2-fleet-automation-list-fleet-tracers",
      "v2-governance-console-list-governance-control-detections",
      "v2-identity-providers-list-identity-provider-users",
      "v2-incidents-list-incident-user-defined-fields",
      "v2-incidents-list-incidents",
      "v2-incidents-list-org-settings",
      "v2-incidents-search-incidents",
      "v2-key-management-list-apikeys",
      "v2-key-management-list-application-keys",
      "v2-key-management-list-current-user-application-keys",
      "v2-key-management-list-personal-access-tokens",
      "v2-llmobservability-get-llmobs-annotated-interactions-by-trace-ids",
      "v2-llmobservability-list-llmobs-dataset-records",
      "v2-llmobservability-list-llmobs-datasets",
      "v2-llmobservability-list-llmobs-experiment-events",
      "v2-llmobservability-list-llmobs-experiments",
      "v2-llmobservability-list-llmobs-patterns-clustered-points",
      "v2-llmobservability-list-llmobs-projects",
      "v2-llmobservability-list-llmobs-spans",
      "v2-logs-list-logs-get",
      "v2-logs-restriction-queries-list-restriction-queries",
      "v2-logs-restriction-queries-list-restriction-query-roles",
      "v2-metrics-list-tag-configurations",
      "v2-metrics-list-tag-indexing-rules",
      "v2-metrics-list-tags-by-metric-name",
      "v2-model-lab-api-list-model-lab-projects",
      "v2-model-lab-api-list-model-lab-runs",
      "v2-monitors-get-monitor-notification-rules",
      "v2-network-device-monitoring-list-devices",
      "v2-observability-pipelines-list-pipelines",
      "v2-org-authorized-clients-list-org-authorized-client-user-authorizations",
      "v2-org-authorized-clients-list-org-authorized-clients",
      "v2-org-connections-list-org-connections",
      "v2-org-groups-list-org-group-memberships",
      "v2-org-groups-list-org-group-policies",
      "v2-org-groups-list-org-group-policy-overrides",
      "v2-org-groups-list-org-groups",
      "v2-organizations-list-global-orgs",
      "v2-powerpack-list-powerpacks",
      "v2-processes-list-processes",
      "v2-reference-tables-list-reference-table-rows",
      "v2-reference-tables-list-tables",
      "v2-report-schedules-list-report-schedules",
      "v2-roles-list-role-users",
      "v2-roles-list-roles",
      "v2-rum-list-rumevents",
      "v2-rum-list-sourcemaps",
      "v2-rum-replay-heatmaps-list-replay-heatmap-snapshots",
      "v2-rum-replay-playlists-list-rum-replay-playlist-sessions",
      "v2-rum-replay-playlists-list-rum-replay-playlists",
      "v2-rum-replay-viewership-list-rum-replay-session-watchers",
      "v2-rum-replay-viewership-list-rum-replay-viewership-history-sessions",
      "v2-rumoperations-list-rumoperation-strong-links",
      "v2-rumoperations-list-rumoperations",
      "v2-scorecards-list-scorecard-campaigns",
      "v2-scorecards-list-scorecard-outcomes",
      "v2-scorecards-list-scorecard-rules",
      "v2-scorecards-list-scorecard-scores",
      "v2-scorecards-list-scorecards",
      "v2-seats-get-seats-users",
      "v2-security-monitoring-get-entity-context",
      "v2-security-monitoring-get-rule-version-history",
      "v2-security-monitoring-get-security-monitoring-dataset-version-history",
      "v2-security-monitoring-get-security-monitoring-histsignals-by-job-id",
      "v2-security-monitoring-get-signal-entities",
      "v2-security-monitoring-get-suppression-version-history",
      "v2-security-monitoring-list-assets-sboms",
      "v2-security-monitoring-list-findings",
      "v2-security-monitoring-list-historical-jobs",
      "v2-security-monitoring-list-indicators-of-compromise",
      "v2-security-monitoring-list-scanned-assets-metadata",
      "v2-security-monitoring-list-security-findings",
      "v2-security-monitoring-list-security-findings-automation-due-date-rules",
      "v2-security-monitoring-list-security-findings-automation-mute-rules",
      "v2-security-monitoring-list-security-findings-automation-ticket-creation-rules",
      "v2-security-monitoring-list-security-monitoring-datasets",
      "v2-security-monitoring-list-security-monitoring-histsignals",
      "v2-security-monitoring-list-security-monitoring-rules",
      "v2-security-monitoring-list-security-monitoring-signals",
      "v2-security-monitoring-list-security-monitoring-suppressions",
      "v2-security-monitoring-list-vulnerabilities",
      "v2-security-monitoring-list-vulnerable-assets",
      "v2-service-accounts-list-service-account-access-tokens",
      "v2-service-accounts-list-service-account-application-keys",
      "v2-service-definition-list-service-definitions",
      "v2-software-catalog-list-catalog-entity",
      "v2-software-catalog-list-catalog-kind",
      "v2-software-catalog-list-catalog-relation",
      "v2-spans-list-spans-get",
      "v2-static-analysis-list-ai-custom-rule-revisions",
      "v2-static-analysis-list-ai-custom-rulesets",
      "v2-static-analysis-list-custom-rule-revisions",
      "v2-status-pages-list-degradations",
      "v2-status-pages-list-maintenances",
      "v2-status-pages-list-status-pages",
      "v2-synthetics-list-synthetics-test-versions",
      "v2-synthetics-search-suites",
      "v2-teams-get-team-memberships",
      "v2-teams-list-member-teams",
      "v2-teams-list-team-connections",
      "v2-teams-list-team-hierarchy-links",
      "v2-teams-list-teams",
      "v2-usage-metering-get-hourly-usage",
      "v2-usage-metering-get-monthly-cost-attribution",
      "v2-user-authorized-clients-list-user-authorized-clients",
      "v2-users-list-users",
      "v2-widgets-search-widgets",
      "v2-workflow-automation-list-workflow-instances",
      "v2-workflow-automation-list-workflows",
    ]);
  });

  it("gives every surface a walk parameter, and leaves the size cap null on exactly 12 of them", () => {
    expect(surfaces.filter((surface) => pairFor({ surface }).walk === null)).toEqual([]);
    expect(surfaces.filter((surface) => pairFor({ surface }).size === null).length).toBe(12);
  });

  it("pins one complete pair for each paging style the pinned client uses", () => {
    expect(
      [
        "v1-synthetics-list-tests",
        "v2-audit-list-audit-logs",
        "v2-downtimes-list-downtimes",
        "v2-reference-tables-list-reference-table-rows",
        "v1-dashboards-list-dashboards",
        "v2-security-monitoring-list-vulnerabilities",
        "v1-usage-metering-get-hourly-usage-attribution",
        "v2-usage-metering-get-hourly-usage",
      ].map((surface) => pairFor({ surface })),
    ).toEqual([
      { size: "page_size", walk: "page_number" },
      { size: "page[limit]", walk: "page[cursor]" },
      { size: "page[limit]", walk: "page[offset]" },
      { size: "page[limit]", walk: "page[continuation_token]" },
      { size: "count", walk: "count" },
      { size: null, walk: "page[token]" },
      { size: null, walk: "next_record_id" },
      { size: "page[limit]", walk: "page[next_record_id]" },
    ]);
  });

  it("carries a row for a listed surface and none for an unlisted neighbour", () => {
    expect(Object.hasOwn(DATADOG_PAGING_PARAMETERS, "v1-dashboards-get-dashboard")).toBe(false);
    expect(Object.hasOwn(DATADOG_PAGING_PARAMETERS, "v1-dashboards-list-dashboards")).toBe(true);
  });
});
