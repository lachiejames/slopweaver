/**
 * What a set of buckets is allowed to be read as, and the two ways a group-by silently inflates a number.
 *
 * ## A group-by result is never a population
 *
 * `buckets.length` is how many groups came BACK, which is capped by the requested limit. It is not how many
 * groups exist. On a frozen closed hour (`status:error`, grouped by `@userId`), one estate measured:
 *
 * | requested limit | buckets returned | cursor present |
 * |---|---|---|
 * | 5   | **5**  | yes |
 * | 10  | **10** | yes |
 * | 50  | 13     | no  |
 *
 * `cardinality(@userId)` over the identical window returned **13**. So reading the limit-10 result as a
 * population gives "10 distinct users" against a true 13 — and the two smaller limits returned exactly
 * their limit, which is the only signal truncation ever gives. This is the shape that can ship
 * "10 of 10 users = 100% affected" when the truth is a much smaller share.
 *
 * A population therefore comes from a `cardinality()` compute or it is not stated. {@link populationOf} has
 * no branch that derives one from a bucket count, so the wrong answer is unreachable rather than
 * discouraged. Note it costs a second call, which matters against a tight rate-limit budget.
 *
 * ## The partition check, and why it catches two different bugs at once
 *
 * If a facet partitions the matched events, the bucket counts sum to the ungrouped total. Both directions
 * of failure are real, they mean opposite things, and the verdict is ARITHMETIC — it states the gap and never
 * claims to know its cause:
 *
 * - **Σbuckets < total is a residual.** Events where the facet is ABSENT are one explanation — that is its
 *   own bucket a group-by does not return. Reported as a shortfall, never as an error.
 * - **Σbuckets > total is an INFLATION and must not be reported as a count.** An event cannot be in a
 *   partition twice, so these buckets are not one. Three possible causes, none proven by the arithmetic:
 *
 *   1. **An array-valued facet counts per element, not per event.** A group-by on an array-valued facet
 *      counts one event once per element it holds, which can inflate a duration or count wildly.
 *   2. **The same error double-logged under two field shapes** is counted once per shape.
 *   3. **The total and the buckets came from two endpoints, or two moments, that disagreed.** MEASURED:
 *      one `datadog apm 'env:(prod OR production) status:error' --from 14d --by service` run
 *      printed a total well under half of what its groups summed to; a re-run with no query change
 *      converged to within one row of the group sum. Repro: run that command twice and compare the header to the group sum.
 *
 * The first cause is detectable BEFORE the call, from a platform atlas: an attribute records every JSON
 * type it has been observed carrying, so `types` including `array` says so. That check belongs with plan
 * construction, where the atlas is in hand. This module is the after-the-fact arithmetic.
 *
 * Nothing here fetches. It grades numbers a caller already has.
 */
import { err, ok, type Result } from "../lib/result.js";
import type { CensusBucket } from "./groupedAggregate.js";
import { type DatadogQueryError, DatadogQueryErrors } from "./queryErrors.js";

/** How a bucket set relates to the ungrouped total it was measured against. */
export interface PartitionAudit {
  /**
   * - `partition` — the buckets sum to the total exactly.
   * - `residual` — they sum to less. Events with the facet absent are one explanation, not a proven cause.
   * - `inflated` — they sum to MORE, so they are not a one-event-once partition. Not a count.
   */
  readonly verdict: "partition" | "residual" | "inflated";
  /** The sum of the bucket counts. */
  readonly bucketed: number;
  /** The independently obtained ungrouped total for the same query and window. */
  readonly total: number;
  /** `total - bucketed`: positive is a residual, negative is inflation. */
  readonly difference: number;
  /** The counting rule this result must be stated with, in a form a finding prints verbatim. */
  readonly countingRule: string;
  /** Why the verdict is what it is. */
  readonly reasons: readonly string[];
}

/**
 * Sum the counts across buckets.
 *
 * @param buckets the buckets to sum
 * @returns the sum of every bucket's count
 */
export function sumBuckets({ buckets }: { buckets: readonly CensusBucket[] }): number {
  return buckets.reduce((running, bucket) => running + bucket.count, 0);
}

/**
 * Grade a bucket set against the ungrouped total for the same query and window.
 *
 * @param buckets the buckets from the grouped call
 * @param total the ungrouped total, obtained independently over the identical query and window
 * @param facet the facet grouped by, so every message names it
 * @returns the audit, including the counting rule the result must be stated with
 */
export function auditBucketPartition({
  buckets,
  total,
  facet,
}: {
  buckets: readonly CensusBucket[];
  total: number;
  facet: string;
}): PartitionAudit {
  const bucketed = sumBuckets({ buckets });
  const difference = total - bucketed;
  const base = { bucketed, total, difference };
  if (difference === 0) {
    return {
      ...base,
      verdict: "partition",
      countingRule: `one event counted once: the ${String(buckets.length)} '${facet}' buckets sum exactly to the ${String(total)} matched events`,
      reasons: [],
    };
  }
  if (difference > 0) {
    return {
      ...base,
      verdict: "residual",
      countingRule: `the '${facet}' buckets are short by ${String(difference)}: they sum to ${String(bucketed)} against ${String(total)} matched events, so ${String(difference)} appear in no bucket`,
      reasons: [
        `the '${facet}' buckets sum to ${String(bucketed)} against ${String(total)} matched events, leaving ${String(difference)} unaccounted for`,
        "an absent facet is its own bucket that a group_by does not return, and it is different from an empty-string value — that is one explanation, not a proven cause",
        "a total and buckets read from two endpoints, or at two moments, can also disagree; a re-run tells that apart",
      ],
    };
  }
  return {
    ...base,
    verdict: "inflated",
    countingRule: `NOT a count of events: the '${facet}' buckets sum to ${String(bucketed)} against only ${String(total)} matched events, an excess of ${String(-difference)}, so they do not establish a one-event-once partition`,
    reasons: [
      `the '${facet}' buckets sum to ${String(bucketed)} but only ${String(total)} events matched, an excess of ${String(-difference)}`,
      "an event cannot be in a partition twice, so these buckets are not a partition of the total and no bucket may be read as a share of it",
      `possible causes, none proven by the arithmetic: an array-valued '${facet}' (one event counted once per element), the same error logged under two field shapes, or the total and the buckets disagreeing across endpoints or indexing moments`,
      "reporting this as an event count could overstate by an amount nothing here establishes",
    ],
  };
}

/**
 * Refuse a bucket set as a population, and say what to ask for instead.
 *
 * There is deliberately no parameter that would let a caller opt out. The measured failure is not that
 * people do this knowing it is wrong — it is that a bucket count looks exactly like a population, so the
 * only effective guard is one with no bypass.
 *
 * @param facet the facet a population was wanted for
 * @param bucketCount how many buckets came back
 * @param requestedLimit the per-facet limit that was asked for
 * @returns always an error, naming the call that would answer the question honestly
 */
export function refuseBucketsAsPopulation({
  facet,
  bucketCount,
  requestedLimit,
}: {
  facet: string;
  bucketCount: number;
  requestedLimit: number;
}): Result<never, DatadogQueryError> {
  const truncated = bucketCount >= requestedLimit;
  const limitLine = truncated
    ? `the count equals the requested limit of ${String(requestedLimit)}, which is the only signal truncation ever gives — a group_by can return exactly its limit while the true distinct count is higher`
    : `the count is below the requested limit of ${String(requestedLimit)}, which is consistent with completeness but does not establish it`;
  return err(DatadogQueryErrors.bucketsNotPopulation({ bucketCount, facet, limitLine }));
}

/**
 * Read a total off an aggregate that was supposed to be ungrouped.
 *
 * The three checks are all "the response does not answer the question that was asked", and each is a
 * different way of being wrong:
 *
 * - **No buckets is a genuine zero.** Datadog encodes an empty ungrouped count as no buckets, never a
 *   bucket holding `c0: 0`. So this zero is its answer being read, not an unreadable response being
 *   coerced, and it is the reading an absence claim rests on.
 * - **Several buckets means the request was not the one assumed.** Reading the first would report a
 *   fragment of the answer as the whole of it.
 * - **A populated `by` means it is a per-group total.** That is a different claim from "there is only one
 *   of them": an org with a single matching service returns one bucket that is nonetheless per-service.
 *
 * @param route the endpoint, so every reason names which call misbehaved
 * @param buckets the buckets the aggregate returned
 * @returns the total, or every reason the response does not carry one
 */
export function readUngroupedTotal({
  route,
  buckets,
}: {
  route: string;
  buckets: readonly CensusBucket[];
}): Result<number, DatadogQueryError> {
  if (buckets.length === 0) {
    return ok(0);
  }
  if (buckets.length > 1) {
    return err(DatadogQueryErrors.ungroupedBucketCountInvalid({ bucketCount: buckets.length, route }));
  }
  const only = buckets[0]!; // exactly one bucket: the two checks above returned on none and on several
  const groupKeys = Object.keys(only.by);
  if (groupKeys.length > 0) {
    return err(DatadogQueryErrors.ungroupedBucketGrouped({ groupKeys, route }));
  }
  return ok(only.count);
}

/**
 * Read a population from an ungrouped cardinality result.
 *
 * The guard is that the compute really was ungrouped. A GROUPED cardinality lies about presence — one
 * estate measured a grouped `cardinality(@role)` reporting the field absent entirely over a 24h window,
 * where a direct `@role:*` filter found thousands of matching logs. So a grouped cardinality is not a
 * smaller population; it is not a population.
 *
 * @param facet the facet counted
 * @param buckets the buckets the cardinality call returned
 * @returns the distinct count, or every reason the response does not carry one
 */
export function populationOf({
  facet,
  buckets,
}: {
  facet: string;
  buckets: readonly CensusBucket[];
}): Result<number, DatadogQueryError> {
  if (buckets.length === 0) {
    // Datadog encodes "nothing matched" as no buckets, so a genuine zero-population window lands here. It
    // is reported as zero rather than refused, matching how `logsCount` reads an empty ungrouped aggregate.
    return ok(0);
  }
  if (buckets.length > 1) {
    return err(DatadogQueryErrors.cardinalityBucketCountInvalid({ bucketCount: buckets.length, facet }));
  }
  const only = buckets[0]!; // exactly one bucket: the two checks above returned on none and on several
  const groupKeys = Object.keys(only.by);
  if (groupKeys.length > 0) {
    return err(DatadogQueryErrors.cardinalityBucketGrouped({ facet, groupKeys }));
  }
  return ok(only.count);
}
