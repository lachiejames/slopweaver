/**
 * The env-facet guard: checking that events a prod-scoped query matched really are prod.
 *
 * ## Why a string filter is not a scope
 *
 * A prod env filter is a clause in a query, and a clause only excludes what the index can see. An event
 * whose `env` tag is unindexed or absent can satisfy the search without carrying a prod env at all — which
 * is how a staging-only burst from an unrelated service can surface into an alerting channel as a
 * production incident. So the query's own scope is never taken as evidence: the guard groups the matched
 * events by their real `env` facet and decides from that breakdown.
 *
 * ## Why untagged is its own bucket, and not folded into non-prod
 *
 * A naive classifier lumps every non-prod value and every absent value together as `nonProd`. In a real
 * estate a meaningful share of logs can carry no `env` tag at all, so a stream that is genuinely production
 * but poorly instrumented would land almost entirely in that bucket and get suppressed as staging noise.
 * The two are not the same claim: `env:staging` is evidence the events are not prod, while an absent tag is
 * evidence of *nothing*, and collapsing them turns missing instrumentation into a confident negative.
 *
 * So there are three shares, and {@link classifyEnvFacet} will only call a stream non-prod on the strength
 * of events that positively declared a non-prod env. An untagged majority produces `unproven`, which is a
 * different answer from both — and it names the share, so the reader can see why.
 *
 * Everything above is pure — it interprets a breakdown some caller already obtained, which is what makes
 * every branch a unit test. {@link verifyEnvScope} at the bottom is the one effectful exception: it runs
 * the `group_by env` call and hands the result to {@link classifyEnvFacet}, so a `DatadogClient`-based
 * caller gets the same re-check a raw-request-based caller would give its own callers, without adopting a
 * separate plan/execute pipeline.
 */
import { absentAsNull } from "#lib/absent.js";
import { err, ok, type Result } from "../lib/result.js";
import type { DatadogClient } from "./client.js";
import type { CensusBucket } from "./groupedAggregate.js";
import { runGroupedLogsAggregate } from "./groupedAggregate.js";
import { DEFAULT_PROD_ENVS, isProdEnv } from "./prodEnvFilter.js";
import { type DatadogQueryError, DatadogQueryErrors } from "./queryErrors.js";
import type { AbsoluteWindow } from "./window.js";

/**
 * The share of *env-tagged* events that must be production for a stream to count as a production signal.
 *
 * The denominator is deliberately the tagged events only, not the total — see the file header. This
 * package's own tuned default is `0.1`, set so a trickle of genuine prod errors riding alongside a staging
 * burst still counts as prod; a caller with a different tolerance passes its own `prodShareFloor`.
 */
export const DEFAULT_PROD_ENV_SHARE_FLOOR = 0.1;

/**
 * How much of a stream may be untagged before the verdict is `unproven` rather than a decision.
 *
 * At or above this share, the tagged events are too small a minority to speak for the stream. This
 * package's own tuned default is a majority (`0.5`) rather than any one estate's measured untagged rate: a
 * stream at a typical estate's average is still mostly describable, and setting the bar at that average
 * would make `unproven` the ordinary answer and train a reader to ignore it. A caller with a different
 * instrumentation baseline passes its own `untaggedShareCeiling`.
 */
export const DEFAULT_UNTAGGED_SHARE_CEILING = 0.5;

/** What the `env` facet of a set of matched events actually says. */
export interface EnvFacetVerdict {
  /**
   * - `prod` — enough tagged events declare a production env.
   * - `non-prod` — tagged events declare a non-prod env, so this must not drive a production claim.
   * - `unproven` — too few events carry an `env` tag to say either way. NOT a synonym for non-prod.
   */
  readonly verdict: "prod" | "non-prod" | "unproven";
  /** Events whose env tag is one of the production envs. */
  readonly prod: number;
  /** Events whose env tag is present and is something else. */
  readonly nonProd: number;
  /** Events carrying no `env` tag at all. Counted separately because absence proves nothing. */
  readonly untagged: number;
  /** Every event in the breakdown. */
  readonly total: number;
  /** Why the verdict is what it is, in a form a finding can print. */
  readonly reasons: readonly string[];
}

/** The share of a whole, or 0 when the whole is empty — so no caller divides by zero itself. */
function shareOf({ part, whole }: { part: number; whole: number }): number {
  return whole > 0 ? part / whole : 0;
}

/** Render a share as a percentage with one decimal, for a reason line. */
function asPercent({ share }: { share: number }): string {
  return `${(share * 100).toFixed(1)}%`;
}

/**
 * Split an `env` group-by into prod, non-prod and untagged tallies.
 *
 * A bucket whose `env` value is `null` is the untagged case: that is how the aggregate encodes a facet that
 * was absent on the matched events. An empty string is treated the same way, because `env:""` is not a
 * value anything emits deliberately.
 *
 * @param buckets the buckets from a `group_by env` over the query being checked
 * @param facet the facet the buckets are keyed by, so a breakdown grouped by something else is not misread
 * @param prodEnvs the env tag values that count as production; defaults to {@link DEFAULT_PROD_ENVS}
 * @returns the three tallies
 */
export function tallyEnvBuckets({
  buckets,
  facet = "env",
  prodEnvs = DEFAULT_PROD_ENVS,
}: {
  buckets: readonly CensusBucket[];
  facet?: string;
  prodEnvs?: readonly string[];
}): { prod: number; nonProd: number; untagged: number } {
  let prod = 0;
  let nonProd = 0;
  let untagged = 0;
  for (const bucket of buckets) {
    const value = absentAsNull({ value: bucket.by[facet] });
    if (value === null || value.trim() === "") {
      untagged += bucket.count;
      continue;
    }
    if (isProdEnv({ env: value, prodEnvs })) {
      prod += bucket.count;
    } else {
      nonProd += bucket.count;
    }
  }
  return { prod, nonProd, untagged };
}

/**
 * Decide whether a prod-scoped query's matched events really are production.
 *
 * The order of the branches is the whole logic. An empty breakdown is `unproven` rather than non-prod,
 * because no evidence is not negative evidence — the same reason untagged has its own bucket.
 *
 * @param buckets the buckets from a `group_by env` over the query being checked
 * @param facet the facet the buckets are keyed by, default `env`
 * @param prodEnvs the env tag values that count as production; defaults to {@link DEFAULT_PROD_ENVS}
 * @param prodShareFloor the tagged-share floor a stream must clear to be called `prod`; defaults to
 *   {@link DEFAULT_PROD_ENV_SHARE_FLOOR}
 * @param untaggedShareCeiling the untagged share above which the verdict is `unproven`; defaults to
 *   {@link DEFAULT_UNTAGGED_SHARE_CEILING}
 * @returns the verdict, its tallies, and why
 */
export function classifyEnvFacet({
  buckets,
  facet = "env",
  prodEnvs = DEFAULT_PROD_ENVS,
  prodShareFloor = DEFAULT_PROD_ENV_SHARE_FLOOR,
  untaggedShareCeiling = DEFAULT_UNTAGGED_SHARE_CEILING,
}: {
  buckets: readonly CensusBucket[];
  facet?: string;
  prodEnvs?: readonly string[];
  prodShareFloor?: number;
  untaggedShareCeiling?: number;
}): EnvFacetVerdict {
  const { prod, nonProd, untagged } = tallyEnvBuckets({ buckets, facet, prodEnvs });
  const total = prod + nonProd + untagged;
  const tagged = prod + nonProd;
  const base = { prod, nonProd, untagged, total };

  if (total === 0) {
    return {
      ...base,
      verdict: "unproven",
      reasons: [`the '${facet}' breakdown came back empty, so nothing establishes which env these events are from`],
    };
  }
  const untaggedShare = shareOf({ part: untagged, whole: total });
  if (tagged === 0 || untaggedShare >= untaggedShareCeiling) {
    return {
      ...base,
      verdict: "unproven",
      reasons: [
        `${asPercent({ share: untaggedShare })} of the ${String(total)} matched events carry no '${facet}' tag, so the tagged minority cannot speak for the stream`,
        "untagged is NOT non-prod — an absent tag is missing instrumentation, and treating it as evidence of staging would suppress a real production signal",
      ],
    };
  }
  const prodShare = shareOf({ part: prod, whole: tagged });
  if (prodShare < prodShareFloor) {
    return {
      ...base,
      verdict: "non-prod",
      reasons: [
        `only ${asPercent({ share: prodShare })} of the ${String(tagged)} env-tagged events are production (${String(prod)} prod, ${String(nonProd)} non-prod), so this must not drive a production claim`,
        "the query carried a prod env filter and matched these anyway, which is the point of re-checking the facet rather than trusting the clause",
      ],
    };
  }
  return {
    ...base,
    verdict: "prod",
    reasons: [
      `${String(prod)} of ${String(tagged)} env-tagged events are production (${asPercent({ share: prodShare })})`,
    ],
  };
}

/** How many distinct `env` values to ask Datadog for. Generous against an org with a handful of envs. */
const ENV_FACET_LIMIT = 20;

/**
 * Re-check that a prod-scoped query's matched events really are production, via a live `group_by env`
 * call over a `DatadogClient`.
 *
 * Costs one extra metered call. Call it once per query whose result will be REPORTED as a production
 * finding — not for every exploratory query.
 *
 * @param client the shared client
 * @param query the query being re-checked — normally the same query, with its prod-env filter clause still
 *   attached, so what is graded is exactly what the caller intends to report
 * @param window the absolute window the original query was run over
 * @param prodEnvs the env tag values that count as production; defaults to {@link DEFAULT_PROD_ENVS}
 * @param prodShareFloor the tagged-share floor a stream must clear to be called `prod`; defaults to
 *   {@link DEFAULT_PROD_ENV_SHARE_FLOOR}
 * @param untaggedShareCeiling the untagged share above which the verdict is `unproven`; defaults to
 *   {@link DEFAULT_UNTAGGED_SHARE_CEILING}
 * @returns the verdict, or why the env facet could not be re-checked at all
 */
export async function verifyEnvScope({
  client,
  query,
  window,
  prodEnvs = DEFAULT_PROD_ENVS,
  prodShareFloor = DEFAULT_PROD_ENV_SHARE_FLOOR,
  untaggedShareCeiling = DEFAULT_UNTAGGED_SHARE_CEILING,
}: {
  client: DatadogClient;
  query: string;
  window: AbsoluteWindow;
  prodEnvs?: readonly string[];
  prodShareFloor?: number;
  untaggedShareCeiling?: number;
}): Promise<Result<EnvFacetVerdict, DatadogQueryError>> {
  const grouped = await runGroupedLogsAggregate({ client, query, window, facet: "env", limit: ENV_FACET_LIMIT });
  if (grouped.isErr()) {
    return err(DatadogQueryErrors.envScopeUnverified({ reasons: grouped.error }));
  }
  return ok(classifyEnvFacet({ buckets: grouped.value.buckets, prodEnvs, prodShareFloor, untaggedShareCeiling }));
}
