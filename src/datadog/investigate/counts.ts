/**
 * What one investigation's numbers may be read as: the sampling label on its total, and whether its groups
 * partition that total. Pure — the effectful engine in `run.ts` gathers the numbers, this judges them.
 *
 * ## Two guards that nothing called
 *
 * `labelCount` (`../domain.ts`) and `auditBucketPartition` (`../counting.ts`) existed while `datadog apm`
 * printed a sampled indexed-span total as a bare "N event(s)" and divided every group by it. MEASURED:
 * `datadog apm 'env:(prod OR production) status:error' --from 14d --by service` printed a total of
 * well under half what its groups summed to, so jobs-api showed well over 100%; a re-run converged to
 * within one row of the group sum.
 * Repro: run that command twice and compare the header to the group sum. This module is where both guards
 * are now called, once, for every product.
 *
 * ## Where the sampling evidence comes from, product by product
 *
 * - **apm** — the header total is the trace track's indexed-span `hitCount`, and that reply carries no
 *   `traffic_type`. So the label uses KNOWN-DOMAIN evidence (spans), whether or not the grouped aggregate
 *   succeeded, and never claims the track declared anything.
 * - **logs** — known-domain logs: unsampled here, an ordinary count.
 * - **rum, ci, tests** — the product aggregate's own `meta.traffic_type`, read only after that aggregate
 *   succeeded. It is AGGREGATE evidence about the same product and index, not a field on the track reply.
 * - **dbm, profiles** — no aggregate exists to read, so no `traffic_type` claim is made either way and the
 *   label stays a plain count. That `kind: "count"` is NOT a proof those products are unsampled; it is the
 *   absence of evidence, kept as the reported-event semantics they already had.
 */

import { auditBucketPartition, type PartitionAudit } from "../counting.js";
import { type CountLabel, type CountSamplingEvidence, labelCount } from "../domain.js";
import type { CensusBucket } from "../groupedAggregate.js";
import type { InvestigateProduct } from "./spec.js";

/** The label a total carries when no evidence could be read, matching what an unsampled reply earns. */
const PLAIN_COUNT: CountLabel = { kind: "count", statedAs: "events", caveats: [] };

/**
 * The sampling evidence for one product's header total.
 *
 * @param aggregateRead whether the product's own aggregate came back, which is the only source of RESPONSE evidence
 * @param trafficType that aggregate's declared `meta.traffic_type`, meaningful only when it was read
 * @returns the evidence, or nothing when this product has none to offer
 */
function evidenceFor({
  product,
  aggregateRead,
  trafficType,
}: {
  product: InvestigateProduct;
  aggregateRead: boolean;
  trafficType: string | null;
}): CountSamplingEvidence | null {
  if (product === "apm") {
    return { domain: "spans", kind: "known-domain" };
  }
  if (product === "logs") {
    return { domain: "logs", kind: "known-domain" };
  }
  if (product === "dbm" || product === "profiles" || !aggregateRead) {
    return null;
  }
  return { kind: "response", trafficType };
}

/**
 * The next move a sampled total carries, so blast radius is corroborated where events are not sampled. It is
 * part of the RESULT, not the human renderer, so `--json` carries it to whatever reads the number.
 */
export const SAMPLED_CORROBORATION_HINT =
  "a sampled figure is a lead, not blast radius — count the same failure with `datadog logs` (unsampled), translating the query to logs syntax rather than pasting it";

/**
 * Judge one investigation's numbers: how its total may be stated, whether its groups partition it, and what
 * to corroborate it with.
 *
 * The partition audit runs only when the comparison means something: the aggregate succeeded, the total is
 * known, the groups were counted over the window rather than folded from a page, and the grouping provably
 * did not truncate. That last gate is SINGLE-FACET ONLY, and deliberately: the aggregate's `truncated` flag
 * compares the bucket count against the product of the per-facet limits, which is exact for one facet (the
 * buckets are that facet's top-N) but not for several — 2 services × 20 statuses is 40 buckets against a
 * ceiling of 400, reading untruncated while each service's inner facet hit its 20-bucket limit. Nothing at
 * this seam carries the per-facet limit or the per-outer-group counts that would make a multi-facet check
 * sound, so a multi-facet grouping is never audited. A truncated shortfall is the limit, not an absent facet.
 *
 * `allowSampled` is passed as `true` deliberately. Choosing `datadog apm` IS the explicit request for the
 * spans product, so the verb qualifies the number rather than refusing its own default operation — and the
 * returned label makes the degradation visible wherever the number travels.
 *
 * @param total the track's `hitCount`, or nothing when the track could not say
 * @param groups the groups as counted, which are the buckets audited
 * @param groupedBy the facets grouped by; only a single one can be audited, and it names the audit's facet
 * @param groupsFromPage whether the groups were folded from a bounded page rather than counted over the window
 * @param aggregateRead whether the product's own aggregate came back
 * @param truncated whether the grouping reached its own limit, trusted only for a single facet
 * @param trafficType the aggregate's declared `meta.traffic_type`, or nothing when it declared none
 * @returns the count label, the partition audit (absent whenever it could mislead), and the corroboration
 *   hint, which is present exactly when the label is a sampled count
 */
export function investigationCountFacts({
  product,
  total,
  groups,
  groupedBy,
  groupsFromPage,
  aggregateRead,
  truncated,
  trafficType,
}: {
  product: InvestigateProduct;
  total: number | null;
  groups: readonly CensusBucket[];
  groupedBy: readonly string[];
  groupsFromPage: boolean;
  aggregateRead: boolean;
  truncated: boolean;
  trafficType: string | null;
}): {
  readonly countLabel: CountLabel;
  readonly partition: PartitionAudit | null;
  readonly corroborate: string | null;
} {
  const evidence = evidenceFor({ aggregateRead, product, trafficType });
  let countLabel = PLAIN_COUNT;
  if (evidence !== null) {
    const labelled = labelCount({ allowSampled: true, evidence, measure: "count" });
    if (labelled.isErr()) {
      // An invariant, not a fallback: `labelCount` refuses a count only when `allowSampled` is false, and a
      // plain label substituted here would print a sampled number as a population.
      throw new Error(`labelCount refused a count despite allowSampled: ${labelled.error.code}`);
    }
    countLabel = labelled.value;
  }
  const corroborate = countLabel.kind === "sampled-count" ? SAMPLED_CORROBORATION_HINT : null;
  const onlyFacet = groupedBy.length === 1 ? groupedBy[0] : undefined;
  if (!aggregateRead || truncated || groupsFromPage || total === null || onlyFacet === undefined) {
    return { corroborate, countLabel, partition: null };
  }
  return { corroborate, countLabel, partition: auditBucketPartition({ buckets: groups, facet: onlyFacet, total }) };
}
