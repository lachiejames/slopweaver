import { type DatadogOperationGroup, groupFor } from "./exclusions.js";

/**
 * The shape-indexed set — the owner's scope rule applied, one operation at a time.
 *
 * The rule that decides membership, stated once so a future family can be judged without re-litigating the
 * list: **a family is voluminous when its records are time-series OBSERVATIONS** — emitted by the platform
 * rather than created by a person, unbounded, growing with the clock, and identified by an instant rather
 * than by a name somebody chose. Configuration is what a person or a system CREATED and can be listed
 * exhaustively.
 *
 * The rule cuts THROUGH families rather than around them, which is why this is an operation table and not a
 * kind list: `logs` holds both `GET /api/v2/logs/events` (telemetry, shape-indexed) and
 * `GET /api/v2/logs/config/indexes` (configuration, stored), and a kind-level decision would lose one.
 */
export const DATADOG_SHAPE_INDEXED: readonly DatadogOperationGroup[] = [
  {
    detail:
      "log events themselves. This atlas records which log sources, services and attributes exist and what an entry's shape is, never the entries. The log CONFIGURATION — indexes, pipelines, archives, custom destinations, metrics and restriction queries — is stored in full",
    operations: [
      { method: "GET", path: "/api/v2/logs/events" },
      { method: "POST", path: "/api/v2/logs/events/search" },
      { method: "POST", path: "/api/v2/logs/analytics/aggregate" },
      { method: "POST", path: "/api/v1/logs-queries/list" },
    ],
  },
  {
    detail:
      "APM spans and their aggregates. Unbounded telemetry identified by an instant; the service catalogue, retention filters and APM configuration are stored instead",
    operations: [
      { method: "GET", path: "/api/v2/spans/events" },
      { method: "POST", path: "/api/v2/spans/events/search" },
      { method: "POST", path: "/api/v2/spans/analytics/aggregate" },
    ],
  },
  {
    detail:
      "RUM events, session replay segments and viewership history. Session replay additionally carries recorded end-user interaction, which is customer content rather than organisation configuration, so its shape index keeps attribute PATHS and never a value. RUM applications and replay playlists are configured objects and are stored",
    operations: [
      { method: "GET", path: "/api/v2/rum/events" },
      { method: "POST", path: "/api/v2/rum/events/search" },
      { method: "POST", path: "/api/v2/rum/analytics/aggregate" },
      { method: "POST", path: "/api/v2/rum/query/insight/aggregated_long_tasks" },
      { method: "POST", path: "/api/v2/rum/query/insight/aggregated_signals_problems" },
      { method: "POST", path: "/api/v2/rum/query/insight/aggregated_waterfall" },
      { method: "GET", path: "/api/v2/rum/replay/playlists/{playlist_id}/sessions" },
      { method: "GET", path: "/api/v2/rum/replay/sessions/{session_id}/views/{view_id}/segments" },
      { method: "GET", path: "/api/v2/rum/replay/sessions/{session_id}/watchers" },
      { method: "GET", path: "/api/v2/rum/replay/viewership-history/sessions" },
    ],
  },
  {
    detail:
      "the event stream and the audit trail. Both are append-only records of what happened, which is the definition this atlas uses for voluminous",
    operations: [
      { method: "GET", path: "/api/v1/events" },
      { method: "GET", path: "/api/v1/events/{event_id}" },
      { method: "GET", path: "/api/v2/events" },
      { method: "GET", path: "/api/v2/events/{event_id}" },
      { method: "POST", path: "/api/v2/events/search" },
      { method: "GET", path: "/api/v2/audit/events" },
      { method: "POST", path: "/api/v2/audit/events/search" },
    ],
  },
  {
    detail:
      "CI pipeline and test events, error-tracking issues, and their aggregates. Every push produces more of them; the deployment gates, DORA definitions and scorecard rules that govern them are stored",
    operations: [
      { method: "GET", path: "/api/v2/ci/pipelines/events" },
      { method: "GET", path: "/api/v2/ci/tests/events" },
      { method: "POST", path: "/api/v2/ci/pipelines/events/search" },
      { method: "POST", path: "/api/v2/ci/pipelines/analytics/aggregate" },
      { method: "POST", path: "/api/v2/ci/tests/events/search" },
      { method: "POST", path: "/api/v2/ci/tests/analytics/aggregate" },
      { method: "POST", path: "/api/v2/error-tracking/issues/search" },
    ],
  },
  {
    detail:
      "security signals, historical detections, findings and vulnerabilities — the detections themselves rather than the rules that produce them. The detection RULES, suppressions, notification rules, mute rules, due-date rules and ticket-creation rules are all configuration and are stored",
    operations: [
      { method: "GET", path: "/api/v2/security_monitoring/signals" },
      { method: "GET", path: "/api/v2/security_monitoring/signals/{signal_id}" },
      { method: "GET", path: "/api/v2/security_monitoring/signals/{signal_id}/entities" },
      { method: "GET", path: "/api/v2/security_monitoring/signals/{signal_id}/investigation_queries" },
      { method: "GET", path: "/api/v2/security_monitoring/signals/{signal_id}/suggested_actions" },
      { method: "POST", path: "/api/v2/security_monitoring/signals/search" },
      { method: "GET", path: "/api/v2/siem-historical-detections/histsignals" },
      { method: "GET", path: "/api/v2/siem-historical-detections/histsignals/{histsignal_id}" },
      { method: "GET", path: "/api/v2/siem-historical-detections/jobs/{job_id}/histsignals" },
      { method: "POST", path: "/api/v2/siem-historical-detections/histsignals/search" },
      { method: "GET", path: "/api/v2/security/findings" },
      { method: "POST", path: "/api/v2/security/findings/search" },
      { method: "GET", path: "/api/v2/security/vulnerabilities" },
      { method: "GET", path: "/api/v2/posture_management/findings" },
      { method: "GET", path: "/api/v2/posture_management/findings/{finding_id}" },
      { method: "GET", path: "/api/v2/compliance_findings/rule_based_view" },
      { method: "GET", path: "/api/v2/governance/control/{detection_type}/detections" },
      { method: "GET", path: "/api/v2/governance/detections/{detection_id}" },
    ],
  },
  {
    detail:
      "metric and cost POINTS, and the arbitrary tabular query behind them. A metric's tag configuration, unit and metadata are what this atlas holds; the values at each timestamp are telemetry the console already queries better than a stored copy could",
    operations: [
      { method: "GET", path: "/api/v1/query" },
      { method: "POST", path: "/api/v2/query/scalar" },
      { method: "POST", path: "/api/v2/query/timeseries" },
      { method: "POST", path: "/api/v2/ddsql/query/tabular" },
      { method: "POST", path: "/api/v2/ddsql/query/tabular/fetch" },
    ],
  },
  {
    detail:
      "live process and container inventories. Both turn over continuously and are a snapshot of a moment rather than a configured set; host tags and the host list are stored",
    operations: [
      { method: "GET", path: "/api/v2/processes" },
      { method: "GET", path: "/api/v2/containers" },
    ],
  },
  {
    detail:
      "hourly and time-series billing rows. The billing METADATA — which dimensions exist, which attribution types are available, which summary fields can be asked for — is configuration and is stored",
    operations: [
      { method: "GET", path: "/api/v1/usage/hourly-attribution" },
      { method: "GET", path: "/api/v1/usage/monthly-attribution" },
      { method: "GET", path: "/api/v1/usage/timeseries" },
      { method: "GET", path: "/api/v1/usage/top_avg_metrics" },
      { method: "GET", path: "/api/v2/usage/hourly_usage" },
      { method: "GET", path: "/api/v2/usage/cost_by_org" },
      { method: "GET", path: "/api/v2/usage/estimated_cost" },
      { method: "GET", path: "/api/v2/usage/historical_cost" },
      { method: "GET", path: "/api/v2/usage/projected_cost" },
      { method: "GET", path: "/api/v2/cost_by_tag/monthly_cost_attribution" },
      { method: "GET", path: "/api/v2/cost/commitments/coverage/scalar" },
      { method: "GET", path: "/api/v2/cost/commitments/coverage/timeseries" },
      { method: "GET", path: "/api/v2/cost/commitments/on-demand-hot-spots/scalar" },
      { method: "GET", path: "/api/v2/cost/commitments/savings/scalar" },
      { method: "GET", path: "/api/v2/cost/commitments/savings/timeseries" },
      { method: "GET", path: "/api/v2/cost/commitments/utilization/scalar" },
      { method: "GET", path: "/api/v2/cost/commitments/utilization/timeseries" },
      { method: "GET", path: "/api/v2/dashboards/usage" },
      { method: "GET", path: "/api/v2/dashboards/{dashboard_id}/usage" },
    ],
  },
  {
    detail:
      "LLM Observability spans, experiment events and experimentation analytics — model call telemetry, and the family most likely to carry prompt and completion text, which is customer content rather than organisation configuration",
    operations: [
      { method: "GET", path: "/api/v2/llm-obs/v1/spans/events" },
      { method: "GET", path: "/api/v2/llm-obs/v1/experiments/{experiment_id}/events" },
      { method: "GET", path: "/api/v2/llm-obs/v2/experiments/{experiment_id}/events" },
      { method: "GET", path: "/api/v2/llm-obs/v3/experiments/{experiment_id}/events" },
      { method: "POST", path: "/api/v2/llm-obs/v1/spans/events/search" },
      { method: "POST", path: "/api/v2/llm-obs/v1/experimentation/analytics" },
      { method: "POST", path: "/api/v2/llm-obs/v1/experimentation/search" },
      { method: "POST", path: "/api/v2/llm-obs/v1/experimentation/simple-search" },
    ],
  },
  {
    detail:
      "product-analytics account and user queries. These return per-END-USER rows, so they are both unbounded and customer content; the entity mappings that define them are stored",
    operations: [
      { method: "POST", path: "/api/v2/product-analytics/accounts/facet_info" },
      { method: "POST", path: "/api/v2/product-analytics/accounts/query" },
      { method: "POST", path: "/api/v2/product-analytics/analytics/scalar" },
      { method: "POST", path: "/api/v2/product-analytics/analytics/timeseries" },
      { method: "POST", path: "/api/v2/product-analytics/users/event_filtered_query" },
      { method: "POST", path: "/api/v2/product-analytics/users/facet_info" },
      { method: "POST", path: "/api/v2/product-analytics/users/query" },
    ],
  },
  {
    detail:
      "synthetic test RESULTS and CI batches — one record per run, growing every minute a test is scheduled. The tests, suites, variables, private locations, downtimes and settings that produce them are stored in full",
    operations: [
      { method: "GET", path: "/api/v1/synthetics/ci/batch/{batch_id}" },
      { method: "GET", path: "/api/v1/synthetics/tests/{public_id}/results" },
      { method: "GET", path: "/api/v1/synthetics/tests/{public_id}/results/{result_id}" },
      { method: "GET", path: "/api/v1/synthetics/tests/browser/{public_id}/results" },
      { method: "GET", path: "/api/v1/synthetics/tests/browser/{public_id}/results/{result_id}" },
      { method: "GET", path: "/api/v2/synthetics/tests/{public_id}/results" },
      { method: "GET", path: "/api/v2/synthetics/tests/{public_id}/results/{result_id}" },
      { method: "GET", path: "/api/v2/synthetics/tests/browser/{public_id}/results" },
      { method: "GET", path: "/api/v2/synthetics/tests/browser/{public_id}/results/{result_id}" },
      { method: "GET", path: "/api/v2/synthetics/tests/poll_results" },
      { method: "POST", path: "/api/v1/synthetics/tests/uptimes" },
    ],
  },
];

/**
 * Whether one operation is shape-indexed rather than stored, and why.
 *
 * @param method the operation's HTTP method
 * @param path the SDK's own path template
 * @returns the group that shape-indexes it, or `undefined` when its records are stored whole
 * @internal
 */
export function datadogShapeIndexFor({
  method,
  path,
}: {
  method: "GET" | "POST";
  path: string;
}): DatadogOperationGroup | undefined {
  return groupFor({ groups: DATADOG_SHAPE_INDEXED, method, path });
}
