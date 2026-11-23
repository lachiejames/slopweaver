/**
 * What this atlas does with each operation that is not simply stored — the tables the generator consults,
 * bar the shape-indexed one in `shapeIndexed.ts`, and the reason attached to every row in them.
 *
 * ## Four dispositions, and why `voluminous` is not one of them
 *
 * `surfaceRow.ts` defines them. The one worth stating here is what ISN'T: the owner's scope rule,
 * "everything reachable minus the voluminous", is expressed as the `shape-index` DISPOSITION rather than as
 * an exclusion, because refusing log search outright would make this atlas answer "Datadog has no log
 * search" and would contradict the owner's rule that voluminous telemetry is still acted on, never skipped. A
 * shape-indexed operation IS called, over a bounded window; what it never does is publish an entry.
 *
 * ## The HTTP verb decides NOTHING, in either direction, and there is a Datadog case that proves it
 *
 * Datadog uses POST for both searching and creating: `POST /api/v2/logs/events/search` reads and
 * `POST /api/v2/monitor` creates. So the observational POSTs are an explicit reviewed LIST
 * ({@link DATADOG_OBSERVATIONAL_POSTS}) rather than a suffix pattern — the same conclusion
 * `src/datadog/rawTransport.ts` reached for its own `READ_ONLY_POST_ROUTES`.
 *
 * ## Where the line actually is: OUTSIDE the response
 *
 * "Side-effecting" is not "produces something". Every read produces a representation — `GET
 * /api/v1/dashboard/{id}` serialises a dashboard into JSON — so a bar of "generates content" fails every
 * operation in the registry. The line is whether anything changes OUTSIDE the operation's own response
 * body. `GET /api/v1/graph/snapshot` uploads a PNG to cloud storage, and
 * `GET /api/v2/cost/tag_descriptions/{tag_key}/generate` invokes a model and spends credit; both cross it.
 *
 * `GET /api/v2/remote_config/products/cws/policy/download` does NOT, and it is recorded here because a
 * review pass raised it and it will be raised again. Datadog's own description is "generates a Workload
 * Protection policy file from your currently active Workload Protection agent rules, and downloads them as
 * a `.policy` file" — a rendering of rules the tenant already holds, into the response and nowhere else.
 * Nothing is stored, nothing is sent, no credit is spent, and refusing it would cost this atlas exactly the
 * Workload Protection posture an audit asks for. It stays an `entity`, and `exclusions.test.ts` pins that
 * decision so the next pass argues with a recorded judgement rather than rediscovering the question.
 *
 * And the converse is real here rather than hypothetical. MEASURED by reading every GET
 * operation's own description in the pinned SDK (reproduce with `yarn tsx tools/datadogOperationScan.ts --actions`): `GET /api/v1/graph/snapshot` renders a widget in a web page, captures it, and **uploads the
 * image to cloud storage**. It is a GET that creates an artifact. It is refused, and it is the row to point
 * at whenever somebody proposes deciding safety from a method.
 *
 * ## Excluded rows still exist
 *
 * They are addressable by surface name for inventory and coverage, publishing `state: "excluded"` with the
 * reason below, because an atlas that silently omitted them would answer "Datadog has no such endpoint",
 * which is false. What they do not have is a callable request variant — unreachable rather than merely
 * unused, the shape `atlas/onepassword/inventory.ts` proves.
 *
 * ## Endpoint exclusion is only half the boundary
 *
 * Endpoints NOT listed here return secret material in ordinary fields — `GET /api/v1/api_key` carries every
 * key's value, `GET /api/v1/integration/aws` carries an access key id and secret access key per account —
 * and they are legitimately admitted, because they are the only way to answer "which keys exist, who made
 * them, when were they last used" and "which cloud accounts are integrated". That half is
 * `sensitiveFields.ts`. Reading this file as the whole defence is the mistake its own header prevents.
 */
import type { DatadogExclusionReason } from "./surfaceRow.js";

/**
 * One group of operations sharing a disposition and a justification.
 *
 * Grouped rather than one row per operation because the shape-indexed set alone runs to ninety operations
 * across a dozen families, and ninety near-identical sentences would be less reviewable than a dozen real
 * ones. The operations are exact, so nothing is decided by a pattern.
 * @internal
 */
export interface DatadogOperationGroup {
  /** Stated in the atlas's coverage output, so a reader learns what exists without it being fetched. */
  readonly detail: string;
  /** The SDK's own path templates, `{brace}` parameters intact, with the method each applies at. */
  readonly operations: readonly { readonly method: "GET" | "POST"; readonly path: string }[];
}

/**
 * An excluded group, which additionally says which of the three refusals applied.
 * @internal
 */
export interface DatadogExclusionGroup extends DatadogOperationGroup {
  readonly reason: DatadogExclusionReason;
}

/**
 * The POST operations that only ever QUERY, reviewed one at a time.
 *
 * Every other POST in the SDK is refused by omission. Membership here says an operation does not WRITE; it
 * says nothing about whether the atlas STORES what it returns, and most of this list is shape-indexed
 * in `shapeIndexed.ts`. Keeping the two judgements apart is what lets each row carry the right reason.
 *
 * ## This list was wrong once, and how it was wrong is why a test sits beside it
 *
 * The first draft admitted `POST /api/v2/replay/heatmap/snapshots` because the path ends in a plural noun
 * that reads like a collection. It is `createReplayHeatmapSnapshot`, and the same surface carries separate
 * list, update and delete operations — so admitting it would have let this atlas CREATE a heatmap snapshot
 * in the tenant. An adversarial review pass found it; reading the table again would not have.
 *
 * The lesson is not "read more carefully". It is that a PATH is a weak signal while the SDK hands over a
 * strong one for free: every operation names itself, and `createX` is a create. So `exclusions.test.ts`
 * asserts that no admitted POST's operation key begins with a mutating verb — a cheap second opinion on a
 * hand-reviewed list, which is exactly what a list reviewed once and grown afterwards needs.
 */
export const DATADOG_OBSERVATIONAL_POSTS: readonly string[] = [
  "/api/v2/audit/events/search",
  "/api/v2/cases/aggregate",
  "/api/v2/ci/pipelines/analytics/aggregate",
  "/api/v2/ci/pipelines/events/search",
  "/api/v2/ci/tests/analytics/aggregate",
  "/api/v2/ci/tests/events/search",
  "/api/v2/ddsql/query/tabular",
  "/api/v2/ddsql/query/tabular/fetch",
  "/api/v2/error-tracking/issues/search",
  "/api/v2/events/search",
  "/api/v2/llm-obs/v1/experimentation/analytics",
  "/api/v2/llm-obs/v1/experimentation/search",
  "/api/v2/llm-obs/v1/experimentation/simple-search",
  "/api/v2/llm-obs/v1/spans/events/search",
  "/api/v1/logs-queries/list",
  "/api/v2/logs/analytics/aggregate",
  "/api/v2/logs/events/search",
  "/api/v2/product-analytics/accounts/facet_info",
  "/api/v2/product-analytics/accounts/query",
  "/api/v2/product-analytics/analytics/scalar",
  "/api/v2/product-analytics/analytics/timeseries",
  "/api/v2/product-analytics/users/event_filtered_query",
  "/api/v2/product-analytics/users/facet_info",
  "/api/v2/product-analytics/users/query",
  "/api/v2/query/scalar",
  "/api/v2/query/timeseries",
  "/api/v2/rum/analytics/aggregate",
  "/api/v2/rum/events/search",
  "/api/v2/rum/query/insight/aggregated_long_tasks",
  "/api/v2/rum/query/insight/aggregated_signals_problems",
  "/api/v2/rum/query/insight/aggregated_waterfall",
  "/api/v2/security/findings/search",
  "/api/v2/security_monitoring/signals/search",
  "/api/v2/siem-historical-detections/histsignals/search",
  "/api/v2/spans/analytics/aggregate",
  "/api/v2/spans/events/search",
  "/api/v1/synthetics/tests/uptimes",
];

/**
 * Operations called to establish posture and never stored.
 *
 * The whole set is credential validation. "Does this key work" is a fact about this INSTALLATION, not about
 * the Datadog organisation, so it is not a thing an atlas holds — `slopweaver datadog verify` is the verb
 * that asks it. They are listed rather than excluded because refusing them would say Datadog has no way to
 * check a credential, which is false.
 */
export const DATADOG_PROBE_ONLY: DatadogOperationGroup = {
  detail:
    "credential validation. It answers whether this installation's keys work, which is a fact about the installation rather than about the organisation, so no entity is published from it. `slopweaver datadog verify` is the verb that asks it",
  operations: [
    { method: "GET", path: "/api/v1/validate" },
    { method: "GET", path: "/api/v2/validate" },
    { method: "GET", path: "/api/v2/validate_keys" },
  ],
};

/**
 * The refused set.
 */
export const DATADOG_EXCLUSIONS: readonly DatadogExclusionGroup[] = [
  {
    detail:
      "the path parameter IS the credential, so the operation cannot be issued without already holding the secret it returns, and issuing it would put a live key in a URL that reaches request logs, proxies and rate-limit records. This is why it is unreachable rather than merely field-denied: no projection of a RESPONSE can undo a secret in the REQUEST",
    operations: [
      { method: "GET", path: "/api/v1/api_key/{key}" },
      { method: "GET", path: "/api/v1/application_key/{key}" },
    ],
    reason: "secret-bearing",
  },
  {
    detail:
      "renders a widget in a web page, captures it as a PNG and uploads the image to cloud storage. A GET that creates an artifact — the row that proves an HTTP method decides nothing here",
    operations: [{ method: "GET", path: "/api/v1/graph/snapshot" }],
    reason: "side-effecting",
  },
  {
    detail:
      "invokes Datadog's own AI to GENERATE a draft tag description from the associated cost data. A GET that produces new content and spends model credit, however transient the draft — the second row proving the method decides nothing, and the one that made the action scan widen from send-and-trigger words to creation words",
    operations: [{ method: "GET", path: "/api/v2/cost/tag_descriptions/{tag_key}/generate" }],
    reason: "side-effecting",
  },
  {
    detail:
      "runs synthetic tests against real targets — traffic leaves Datadog and reaches whatever the test points at, so it is an action rather than a reading of stored state whatever its verb",
    operations: [
      { method: "POST", path: "/api/v1/synthetics/tests/trigger" },
      { method: "POST", path: "/api/v1/synthetics/tests/trigger/ci" },
    ],
    reason: "side-effecting",
  },
];

/**
 * One whole KIND this atlas cannot yet store safely, refused as a unit.
 * @internal
 */
export interface DatadogKindExclusion {
  /** The atlas kind, exactly as `surfaceNaming.ts` derives it from the path. */
  readonly kind: string;
  /** Stated in coverage, and on every row this refuses. */
  readonly detail: string;
  readonly reason: DatadogExclusionReason;
}

/**
 * Kinds excluded whole, because their response models carry free-form fields no projection here denies.
 *
 * ## Why this is a KIND table rather than 34 more rows in {@link DATADOG_EXCLUSIONS}
 *
 * Because the enumeration failure is the whole history of this decision. Four Codex review rounds each
 * found a different credential-bearing free-form field in the synthetics models, each fix enumerated one
 * more model, and each next round found a field on a model the last enumeration had not reached
 * (`sensitiveFields.ts` carries the four). A hand-listed set of synthetics PATHS would fail the same way
 * one layer up: Datadog adds an operation, the generator emits it as an `entity` because no row names it,
 * and the kind quietly reopens with nobody deciding that it should. Keying on the kind means an operation
 * added next month is excluded by the same decision that excluded the rest, which is the property a list
 * does not have.
 *
 * ## Where this sits in the generator's order, and why a write keeps its own reason
 *
 * The generator asks the method rule and {@link DATADOG_EXCLUSIONS} FIRST, so a synthetics `PUT` stays
 * `mutating` and a secret-bearing path stays `secret-bearing`. Those reasons are true about the operation
 * forever; this one is true about this atlas until the projection ships. The more durable reason wins, and
 * the row still reads correctly once the kind is admitted.
 */
export const DATADOG_EXCLUDED_KINDS: readonly DatadogKindExclusion[] = [
  {
    detail:
      "the synthetics response models carry free-form fields (request bodies, headers, scripts, variables) where a test's credentials live, and this atlas has no ALLOWLIST projection for them yet, so a stored test could carry a secret nothing denies. `sensitiveFields.ts` describes the projection that would admit the kind. This is NOT a volume judgement — voluminous families are shape-indexed and still called",
    kind: "synthetics",
    reason: "unsupported-sensitive-shape",
  },
];

/**
 * Whether one operation appears in one group table.
 *
 * @returns the first group listing that method and path, or `undefined` when none does
 */
export function groupFor<TGroup extends DatadogOperationGroup>({
  groups,
  method,
  path,
}: {
  groups: readonly TGroup[];
  method: "GET" | "POST";
  path: string;
}): TGroup | undefined {
  return groups.find((group) =>
    group.operations.some((operation) => operation.method === method && operation.path === path),
  );
}

/**
 * Whether one operation is refused by a row in {@link DATADOG_EXCLUSIONS}, and why.
 *
 * Does NOT decide the mutating case: a write is refused by the generator from its method and its absence
 * from {@link DATADOG_OBSERVATIONAL_POSTS}, so it never reaches here. Keeping that out means this table
 * holds only decisions somebody made, rather than a rule's 950 consequences.
 *
 * @param method the operation's HTTP method
 * @param path the SDK's own path template
 * @returns the group that refuses it, or `undefined` when no row does
 * @internal
 */
export function datadogExclusionFor({
  method,
  path,
}: {
  method: "GET" | "POST";
  path: string;
}): DatadogExclusionGroup | undefined {
  return groupFor({ groups: DATADOG_EXCLUSIONS, method, path });
}

/**
 * Whether one operation's whole KIND is excluded because this atlas cannot yet store it safely.
 *
 * Asked AFTER {@link datadogExclusionFor} so an operation-level reason — which is true about the operation
 * forever — wins over one that is only true until a projection ships.
 *
 * @param kind the atlas kind, as `surfaceNaming.ts` derived it from the path
 * @returns the row that refuses the whole kind, or `undefined` when no row does
 * @internal
 */
export function datadogKindExclusionFor({ kind }: { kind: string }): DatadogKindExclusion | undefined {
  return DATADOG_EXCLUDED_KINDS.find((row) => row.kind === kind);
}

/**
 * Whether one operation is a credential probe that publishes nothing.
 *
 * @param method the operation's HTTP method
 * @param path the SDK's own path template
 * @returns the probe group, or `undefined` when the operation is not one
 * @internal
 */
export function datadogProbeOnlyFor({
  method,
  path,
}: {
  method: "GET" | "POST";
  path: string;
}): DatadogOperationGroup | undefined {
  return groupFor({ groups: [DATADOG_PROBE_ONLY], method, path });
}
