/**
 * Which telemetry domain answers which question, and why a count off sampled data is not a count.
 *
 * ## The most expensive default a naive integration makes
 *
 * A Datadog aggregate defaulting to the traces domain is sampled APM, so a bare count undercounts, and it
 * undercounts silently — the response is a healthy 200 with a plausible smaller number. On a frozen closed
 * hour (`service:example-api status:error`), the same window measured through both routes:
 *
 * | route | count | `meta.traffic_type` |
 * |---|---|---|
 * | `/api/v2/logs/analytics/aggregate` | **7** | absent |
 * | `/api/v2/spans/analytics/aggregate` | **2** | `"sampled"` |
 *
 * A 3.5x undercount on an hour small enough to check by hand.
 *
 * ## The mechanism, because the multiplier is not a constant
 *
 * The loss is two-stage and only the first stage undercounts. **Adaptive sampling** at the tracer decides
 * which traces reach Datadog at all; **retention filters** then decide which ingested spans stay searchable.
 * Stage one sits upstream, so a 100%-error retention filter cannot rescue a trace the agent never sent —
 * which is why error spans sit below error logs on the same window even with that filter on and at full
 * rate. Adaptive sampling throttles harder exactly when volume spikes, which is when anyone is investigating
 * — carry the mechanism forward, and cite a dated measurement as evidence rather than treating the ratio as
 * a constant.
 *
 * ## Why this is a default with a stated override, not doctrine
 *
 * This is a strong default with a stated mechanism, **not** absolute doctrine. Latency and span shape
 * genuinely have no substitute in logs, and a deliberate spans count is sometimes what somebody wants.
 *
 * So the enforcement is not "you may not have this number". It is that **the response decides the label when
 * it carries the field**: every spans aggregate self-declares `traffic_type: "sampled"` and every logs
 * aggregate omits it, so {@link labelCount} reads the reply rather than trusting anyone's memory of the rule.
 * A route whose sampling is known by construction — a total read off the unified track's indexed-span
 * `hitCount`, which carries no `traffic_type` of its own — may instead supply explicit DOMAIN evidence, and
 * is labelled with a caveat that says so rather than one claiming a field the reply never had. A sampled
 * number can be reported, but only as a sampled one, and only when the caller said they would accept that.
 */
import { err, ok, type Result } from "../lib/result.js";
import { type DatadogDomainError, DatadogDomainErrors } from "./domainErrors.js";

/** What a caller is actually asking for. The question, not the route. */
const MEASURES = ["count", "attribution", "latency", "shape"] as const;

export type Measure = (typeof MEASURES)[number];

/** The telemetry domains a measure can be answered from. */
export type TelemetryDomain = "logs" | "spans";

/**
 * The domain each measure is answered from by default.
 *
 * `count` and `attribution` come from logs because logs are unsampled here. `latency` and `shape` come from
 * spans because logs do not carry a span tree or a duration distribution at all — that is not a sampling
 * trade-off, it is the only place the data exists.
 */
export const DOMAIN_FOR_MEASURE: Readonly<Record<Measure, TelemetryDomain>> = {
  count: "logs",
  attribution: "logs",
  latency: "spans",
  shape: "spans",
};

/** The value a spans aggregate puts in `meta.traffic_type`. Logs aggregates omit the field entirely. */
export const SAMPLED_TRAFFIC = "sampled";

/** How a number may be reported, decided by the evidence about its own traffic. */
export interface CountLabel {
  /**
   * - `count` — no evidence says its traffic was sampled: the reply declared nothing, or its domain is logs.
   * - `sampled-count` — the reply declared itself sampled, or its domain is spans. A lower bound of unknown
   *   tightness.
   */
  readonly kind: "count" | "sampled-count";
  /** The wording a finding prints with the number, so the qualifier travels with it. */
  readonly statedAs: string;
  /** What the reader needs to know about how this number was obtained. Empty when it is a plain count. */
  readonly caveats: readonly string[];
}

/**
 * Resolve the domain for a measure, honouring an explicit override.
 *
 * @param measure what is being asked for
 * @param override a domain the caller named explicitly, or `null` to take the default
 * @returns the domain to query, and whether the default was overridden
 */
export function domainFor({ measure, override = null }: { measure: Measure; override?: TelemetryDomain | null }): {
  domain: TelemetryDomain;
  overridden: boolean;
} {
  const preferred = DOMAIN_FOR_MEASURE[measure];
  if (override === null || override === preferred) {
    return { domain: preferred, overridden: false };
  }
  return { domain: override, overridden: true };
}

/**
 * Refuse a routing that cannot answer the question at all.
 *
 * Distinct from the sampling label below, and the distinction matters. Counting on spans is *degraded* — a
 * real number, sampled. Asking logs for a latency distribution is *impossible* — the data is not there, so
 * there is no qualifier that would make the answer honest.
 *
 * @param measure what is being asked for
 * @param domain the domain the caller routed it to
 * @returns nothing when the domain can answer, or the reason it cannot
 */
export function assertDomainCanAnswer({
  measure,
  domain,
}: {
  measure: Measure;
  domain: TelemetryDomain;
}): Result<null, DatadogDomainError> {
  if (domain === "logs" && (measure === "latency" || measure === "shape")) {
    return err(DatadogDomainErrors.logsDomainUnsupported({ measure }));
  }
  return ok(null);
}

/**
 * Refuse a count routed to a domain that is known in advance to answer only from sampled traffic.
 *
 * This overlaps {@link labelCount} deliberately, and the two are not the same check wearing two hats:
 *
 * - **This one is a budget optimisation with a certain outcome.** Every spans aggregate declares itself
 *   sampled, so a spans count with no opt-in is already decided before the call — and the spans endpoint
 *   allows very few requests per minute in practice, so spending one to be told what was knowable is a real
 *   cost, and it also makes the refusal a caller mistake caught before the act phase rather than after it.
 * - **{@link labelCount} is the general guarantee**, and it stays. It reads the reply, so it also catches a
 *   response that declares itself sampled where nobody expected one — which is the case no rule about
 *   domains could cover.
 *
 * @param measure what is being asked for
 * @param domain the domain it is routed to
 * @param allowSampled whether the caller said they would accept a sampled number
 * @returns nothing when the pairing can produce a stateable number, or the reason it cannot
 */
export function assertCountNotKnownSampled({
  measure,
  domain,
  allowSampled,
}: {
  measure: Measure;
  domain: TelemetryDomain;
  allowSampled: boolean;
}): Result<null, DatadogDomainError> {
  const counting = measure === "count" || measure === "attribution";
  if (!counting || domain !== "spans" || allowSampled) {
    return ok(null);
  }
  return err(DatadogDomainErrors.knownSampledCountRefused({ measure, trafficType: SAMPLED_TRAFFIC }));
}

/**
 * What a caller knows about whether a number came off sampled traffic, and where that knowledge came from.
 *
 * - `response` — the reply's own `meta.traffic_type`, or `null` when it declared none. The general case.
 * - `known-domain` — the route is sampled or not by construction, and the reply that carried the number has
 *   no field to read: the unified track's `hitCount` for a spans query is the case that needs it.
 */
export type CountSamplingEvidence =
  | { readonly kind: "response"; readonly trafficType: string | null }
  | { readonly kind: "known-domain"; readonly domain: TelemetryDomain };

/**
 * Decide how a number may be stated, from the evidence about its own traffic.
 *
 * The whole point is that RESPONSE evidence reads the reply. A rule a human has to remember was tried and did
 * not hold; a field Datadog sets on every sampled response cannot be forgotten. DOMAIN evidence is for a reply
 * that carries no such field while its domain settles the question anyway, and its caveat names the domain
 * rather than claiming a declaration the reply never made.
 *
 * @param measure what was asked for
 * @param evidence the response's declared traffic type, or the domain known to have produced the number
 * @param allowSampled whether the caller said they would accept a sampled number
 * @returns the label to report the number under, or the reason it must not be reported as a count
 */
export function labelCount({
  measure,
  evidence,
  allowSampled,
}: {
  measure: Measure;
  evidence: CountSamplingEvidence;
  allowSampled: boolean;
}): Result<CountLabel, DatadogDomainError> {
  if (evidence.kind === "known-domain") {
    if (evidence.domain !== "spans") {
      return ok({ kind: "count", statedAs: "events", caveats: [] });
    }
    const refusal = DatadogDomainErrors.knownSampledCountRefused({ measure, trafficType: SAMPLED_TRAFFIC });
    return sampledLabel({ allowSampled, caveat: INDEXED_SPANS_CAVEAT, measure, refusal });
  }
  if (evidence.trafficType !== SAMPLED_TRAFFIC) {
    return ok({ kind: "count", statedAs: "events", caveats: [] });
  }
  const refusal = DatadogDomainErrors.sampledResponseCountRefused({ measure, trafficType: SAMPLED_TRAFFIC });
  return sampledLabel({ allowSampled, caveat: SAMPLING_CAVEAT, measure, refusal });
}

/**
 * The label for a number already established as sampled, whichever evidence established it.
 *
 * @param caveat the mechanism line matching the evidence, so a domain fact never reads as a declared field
 * @param refusal what is returned when a count was asked for and the caller did not accept a sampled one
 * @returns the sampled label, or the refusal
 */
function sampledLabel({
  measure,
  allowSampled,
  caveat,
  refusal,
}: {
  measure: Measure;
  allowSampled: boolean;
  caveat: string;
  refusal: DatadogDomainError;
}): Result<CountLabel, DatadogDomainError> {
  if (measure !== "count" && measure !== "attribution") {
    // A latency or shape answer is EXPECTED to come off sampled traffic and is not invalidated by it — the
    // shape of a distribution survives sampling in a way a total does not.
    return ok({ kind: "sampled-count", statedAs: "events (sampled traffic)", caveats: [caveat] });
  }
  if (!allowSampled) {
    return err(refusal);
  }
  return ok({
    kind: "sampled-count",
    statedAs: `${measure} over sampled traffic — a lower bound, not a total`,
    caveats: [caveat],
  });
}

/** The mechanism, attached to every sampled number so the qualifier travels with it rather than being looked up. */
export const SAMPLING_CAVEAT =
  "this response declared its traffic sampled: adaptive sampling at the tracer drops traces before any retention filter sees them, so the figure is a lower bound whose tightness is not established and which widens as volume rises";

/**
 * The same mechanism for a number known to be sampled by its DOMAIN: it says the figure counts indexed spans,
 * and never that the reply carrying it declared a `traffic_type`.
 */
export const INDEXED_SPANS_CAVEAT =
  "this figure counts indexed spans: adaptive sampling at the tracer drops traces before any retention filter sees them, so it is a lower bound whose tightness is not established and which widens as volume rises";
