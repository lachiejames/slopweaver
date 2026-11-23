/**
 * Lazy manifest for the `datadog` noun — a Datadog API client + query/citation/aggregation/rate-limit
 * toolkit (`src/datadog/**`), a peer of `src/atlas/**` rather than a tenant of it: this is a platform
 * client library a caller's own investigation logic builds on, not a synced local ground-truth atlas.
 *
 * Every verb here but four only READS Datadog and writes nothing outside the machine, so none of those is
 * `doorRouted` — matching `github read`/`github search`'s own `effect: "external-read"` classification.
 * `shot` writes a PNG under `$SLOPWEAVER_HOME` (or a stated `--out`), which is the product working normally
 * rather than an external write, exactly as `notion verify`'s own report is classified.
 *
 * `submit` is the first exception: it POSTs gauge and count points to `/api/v1/series`, which changes what
 * Datadog says about the estate and cannot be undone — Datadog deletes no metric point, ever. So it is
 * `effect: "external-write"` + `doorRouted: true`, and the decision is journalled in the door ledger — the
 * days it stamped travel on the request's ARTIFACT, which `admit/ledger.ts` deliberately does not write out,
 * so the verb prints them on its own data channel instead.
 * `hmi --enable` is the second: it switches Historical Metrics Ingestion on per metric through the SDK
 * (`datadog/historicalIngestion.ts`), which changes how Datadog ingests those metrics and may add to the
 * custom-metric bill, so it is door-routed the same way; without `--enable` it only reads.
 * `monitor update|delete` is the third (`./datadogMonitor.ts`): it changes or deletes exact monitors through
 * the SDK, each write held by the door until `--approve` carries the digest of the change as it stands now.
 * `triage` is the fourth (`./datadogErrorTracking.ts`): it moves Error Tracking issues between states through
 * the SDK's `updateIssueState`, door-routed with no digest, because moving triaged issues unattended is the
 * error-tracking batch's job and the same verb undoes a move — which still changes what a monitor notifies on.
 * None is reachable through `raw`: `datadog/rawTransport.ts` enforces read-only in its TYPE, and adding a
 * mutation to that allowlist would retire the one property an auditor can read off a single file.
 *
 * `shot` is the one verb here that reaches Datadog through a BROWSER SESSION rather than the two API keys,
 * so it needs the site (`profile.json`'s `datadog.site`, or `DD_SITE`) and neither key. It opens nothing itself: it briefs the visible
 * session on what to capture in the owner's own Chrome and grades what comes back
 * (`docs/browser-route.md`, `docs/browser-route/proof-and-capture-verbs.md`). Datadog is not a doored provider, so nothing in `src/admit/browserSurface.ts`
 * stands between that session and the console.
 */
import {
  CATALOGUE_USAGE,
  DATADOG_ALERT_DIGEST_USAGE,
  DATADOG_PRODUCE_USAGE,
  DATADOG_SHOT_USAGE,
} from "../commands/datadog/usage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";
import { datadogErrorTrackingManifest } from "./datadogErrorTracking.js";
import { datadogInvestigateManifest } from "./datadogInvestigate.js";
import { datadogMonitorManifest } from "./datadogMonitor.js";

// Exported so a test can assert each one stays in sync with its own `*Run.ts`'s copy.
export const VERIFY_USAGE = "usage: slopweaver datadog verify [--json]";
export const PROBE_USAGE =
  "usage: slopweaver datadog probe [--query Q] [--from 15m] [--to now] [--prod-env] [--sum-metric ATTR] [--verify-env] [--json]";
export const RAW_USAGE = "usage: slopweaver datadog raw --path P [--method GET|POST] [--body JSON] [--json]";
export const METRICS_USAGE =
  "usage: slopweaver datadog metrics --query Q [--by tag1,tag2] [--limit 100] [--from 15m] [--to now] [--json]";
export const SUBMIT_USAGE =
  "usage: slopweaver datadog submit --series FILE|- [--allow-late] [--dry-run] [--home DIR] [--json]";
export const HMI_USAGE =
  "usage: slopweaver datadog hmi --metric NAME[,NAME...] [--enable [--dry-run]] [--home DIR] [--json]";
export const COMPARE_ENVS_USAGE =
  "usage: slopweaver datadog compare-envs --query Q --before ENV --after ENV [--by tag1,tag2] [--limit 50] [--from 1h] [--to now] [--json]";
// `shot`'s usage is IMPORTED rather than copied: `shotCore.ts` is pure (no Datadog client, no browser),
// so the manifest can read the real string without the eager-import cost the other five are duplicated to
// avoid. A copy that cannot exist cannot drift — see `defineCommand.ts`'s header on the twenty fields that did.
// `catalogue` is the second one on the same terms, and the terms are what matter rather than the count:
// `catalogueCore.ts` imports only pure modules at RUNTIME (`detective/family`, `detective/plan`,
// `detective/catalogue`, `parseFlags`) and takes `BuildReport`/`Catalogue`/`ShapeRow` as `import type`, which
// is erased — so enumerating the surface still loads no Datadog SDK. `alertDigestCore.ts` is the third on
// exactly those terms: zod, `datadog/alertProbe`, the outbound digest form and `parseFlags`, no client.
// Check that before adding a fourth.

export const datadogManifest: Readonly<Record<string, VerbManifestEntry>> = {
  ...datadogInvestigateManifest,
  "alert-digest": lazy({
    load: () => import("../commands/datadog/alertDigestRun.js").then((m) => m.datadogAlertDigestCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      // Reads only: every call is a logs aggregate, and the card it emits is POSTED by `slack post`, which
      // carries its own door request. Classified exactly as `probe` is, for the reason in this file's header.
      doorRouted: false,
      dryParseSafe: true,
      effect: "external-read",
      example: "slopweaver datadog alert-digest --probes ./knock-probes.json --label Knock --form",
      parseRejectIsIoFree: true,
      summary:
        "Run a declared probe set as read-only Datadog aggregates and emit the alert card's digest FORM — " +
        "every count an aggregate, every severity arithmetic, nothing posted and no model launched",
      usage: DATADOG_ALERT_DIGEST_USAGE,
    },
  }),
  "compare-envs": lazy({
    load: () => import("../commands/datadog/compareEnvsRun.js").then((m) => m.datadogCompareEnvsCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      // Two scalar queries and nothing else, classified exactly as `metrics` is.
      doorRouted: false,
      dryParseSafe: true,
      effect: "external-read",
      example:
        "slopweaver datadog compare-envs --query 'p90:trace.http.server.request{*} by {resource_name}' " +
        "--before local-proof-before --after local-proof-after --by resource_name",
      parseRejectIsIoFree: true,
      summary:
        "Run one metrics query twice, once per environment tag, and print the per-group movement between " +
        "the two sides, worst regression first — the before/after half of a local bisect",
      usage: COMPARE_ENVS_USAGE,
    },
  }),
  catalogue: lazy({
    load: () => import("../commands/datadog/catalogueRun.js").then((m) => m.datadogCatalogueCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      // Every call it makes is a GET or an allowlisted read-only aggregate, and what it writes is under
      // `$SLOPWEAVER_HOME` — the product working normally, classified exactly as `datadog shot`'s PNG is.
      effect: "external-read",
      example: "slopweaver datadog catalogue build --from 7d",
      parseRejectIsIoFree: true,
      summary:
        "Build the local Datadog census — every log pattern, span kind, RUM event type, CI pipeline, test " +
        "suite, database query signature, profile and metric this organisation has, each counted and " +
        "exemplified, plus the service map — or read one back",
      usage: CATALOGUE_USAGE,
    },
  }),
  metrics: lazy({
    load: () => import("../commands/datadog/metricsRun.js").then((m) => m.datadogMetricsCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "external-read",
      example:
        "slopweaver datadog metrics --query 'sum:example.metric{*} by {delivery_status}.as_count()' --by delivery_status",
      parseRejectIsIoFree: true,
      summary: "Run one grouped sum scalar query against Datadog's v2 metrics endpoint and print the buckets",
      usage: METRICS_USAGE,
    },
  }),
  ...datadogErrorTrackingManifest,
  ...datadogMonitorManifest,
  submit: lazy({
    load: () => import("../commands/datadog/submitRun.js").then((m) => m.datadogSubmitCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      example: "slopweaver datadog submit --series ./daily-delivery.json --allow-late",
      parseRejectIsIoFree: true,
      summary:
        "Submit gauge or count metric points to Datadog from a payload file, naming the UTC days they stamp and " +
        "refusing backdated points unless --allow-late says Historical Metrics Ingestion covers them",
      usage: SUBMIT_USAGE,
    },
  }),
  hmi: lazy({
    load: () => import("../commands/datadog/hmiRun.js").then((m) => m.datadogHmiCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      example: "slopweaver datadog hmi --metric trajectory.task.turns,trajectory.task.risk_score --enable",
      parseRejectIsIoFree: true,
      summary:
        "Read whether Historical Metrics Ingestion is on for each named metric, or with --enable switch it on " +
        "for the ones that are off and read every one back, exiting non-zero unless all read on",
      usage: HMI_USAGE,
    },
  }),
  produce: lazy({
    load: () => import("../commands/datadog/produceRun.js").then((m) => m.datadogProduceCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      // Writes one local file and nothing to Datadog: the producer's own reads are its business, and the
      // submission it prepares is `submit`, which carries the door request.
      doorRouted: false,
      dryParseSafe: true,
      effect: "external-read",
      example: "slopweaver datadog produce --producer daily-delivery --day 2026-09-07 --out ./daily-delivery.json",
      parseRejectIsIoFree: true,
      summary:
        "Run one metrics producer the profile declares for one UTC day and write the payload datadog submit " +
        "takes — the PRODUCE half of a metrics push; nothing reaches Datadog",
      usage: DATADOG_PRODUCE_USAGE,
    },
  }),
  shot: lazy({
    load: () => import("../commands/datadog/shotRun.js").then((m) => m.datadogShotCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "external-read",
      example: "slopweaver datadog shot monitor --id 600101 --out ~/.slopweaver/proof/<pr>/shots",
      parseRejectIsIoFree: true,
      summary:
        "Photograph a Datadog view through the signed-in console: `monitor` captures a monitor's 7-day " +
        "backtest panel itself through the relay into the owner's Chrome, cropped to its graph, window and counts " +
        "row with the Alert count boxed and the window proved; `explorer` plans a metric/log/notebook view",
      usage: DATADOG_SHOT_USAGE,
    },
  }),
  probe: lazy({
    load: () => import("../commands/datadog/probeRun.js").then((m) => m.datadogProbeCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "external-read",
      example: "slopweaver datadog probe --query 'service:example-api status:error' --from 1h",
      parseRejectIsIoFree: true,
      summary:
        "Verify credentials, run one real logs count (or sum, or env re-check) over a window, and print a validated console link",
      usage: PROBE_USAGE,
    },
  }),
  raw: lazy({
    load: () => import("../commands/datadog/rawRun.js").then((m) => m.datadogRawCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "external-read",
      example: "slopweaver datadog raw --path /api/v1/logs-analytics/list?type=logs",
      parseRejectIsIoFree: true,
      summary: "Issue a rate-limit-aware, read-only-enforced request to an endpoint the typed SDK does not cover",
      usage: RAW_USAGE,
    },
  }),
  verify: lazy({
    load: () => import("../commands/datadog/verifyRun.js").then((m) => m.datadogVerifyCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: true,
      doorRouted: false,
      dryParseSafe: true,
      effect: "external-read",
      example: "slopweaver datadog verify --json",
      parseRejectIsIoFree: true,
      summary: "Verify DD_API_KEY and DD_APP_KEY both work, without spending a query against the rate-limit budget",
      usage: VERIFY_USAGE,
    },
  }),
};
