/**
 * Turning what the local Datadog catalogue knows into leads a wave can spend a detective on. Pure.
 *
 * ## The gate is the join, and this is where it becomes a fan-out decision
 *
 * `store detect` probes the local store for a question's keywords and counts the leads. This adds the second
 * half: the same keywords are probed against the local Datadog SHAPE CATALOGUE, which costs no network at
 * all, and a hit there becomes a lead exactly as a Slack hit does. A question whose keywords hit nothing in
 * the catalogue produces no Datadog lead and the wave never touches Datadog.
 *
 * That is the answer to the question the previous page ended on — would a wave have thought to check Datadog
 * for "is the partners sync still running"? It would, and not because anything guessed: a service on the
 * installation's census is named in the shape of `acme-nightly-job-sync-partners`, the catalogue holds it, and `partners` matches it
 * as a substring. Reproduce the whole thing with
 * `slopweaver datadog catalogue show --service acme-nightly-job-sync-partners`.
 *
 * ## One lead per SERVICE, never one per hit
 *
 * A keyword that matches a service also matches every shape row of that service, so a lead per hit would
 * spawn twenty detectives at one service and call the duplication a fan-out — the identical mistake
 * {@link ./fanout} refuses for the store's seven shapes. The service is the unit a detective can actually
 * investigate, so the hits are folded onto it and carried in the `why`.
 *
 * A hit that names no service — a monitor title, a metric namespace, a RUM application — produces ONE
 * catalogue-wide lead rather than none, because "37 monitors mention this word" is a real thing to go and
 * read and there is no service to hang it on.
 */

import { type GateVerdict, HIT_KINDS, type HitKind } from "../datadog/detective/gate.js";
import type { Lead } from "./fanout.js";

/** The `source` every Datadog lead carries, so a brief and a report can tell it from a store lead. *
 * @internal
 */
export const DATADOG_LEAD_SOURCE = "datadog";

/**
 * How much one rank of hit kind is worth, in the nominal units {@link leadWeight} counts in.
 *
 * Larger than any plausible hit count for one bucket, so the kind always dominates. A thousand rather than a
 * tighter bound because the number is nominal on both sides — nothing downstream reads it as a measurement,
 * and {@link ./fanout.planWave} deliberately exempts these leads from its row ceiling for the same reason.
 */
const KIND_WEIGHT = 1000;

/**
 * How much one bucket of hits is worth, used only to ORDER it against the store's leads.
 *
 * A Datadog lead has no row count — a count would mean running the live ladder, which is the thing the gate
 * exists to avoid doing before a detective is assigned. So it claims a nominal weight rather than pretending
 * to a measurement.
 *
 * **The weight is dominated by the strongest hit KIND, with the count only breaking ties**, and that is a
 * measured correction rather than a refinement. A first cut weighted by raw hit count alone, and on the
 * owner's own worked example it ranked the service-less "nine monitors mention these words" lead ABOVE the
 * `acme-nightly-job-sync-partners` service lead — then the wave's per-source round-robin gave Datadog one
 * slot, which the weaker lead had already taken. The worked example produced a Datadog detective pointed at
 * the wrong thing. A service name is a categorically better lead than a word appearing in a monitor query,
 * so the ordering has to say so rather than count.
 *
 * Reproduce: `slopweaver store detect "is the partners sync still running" --term partners --term sync --slots 6`.
 *
 * @param hits how many things in the catalogue this bucket matched
 * @param kinds every kind of thing it matched
 * @returns the nominal weight
 */
export function leadWeight({ hits, kinds }: { hits: number; kinds: ReadonlySet<HitKind> }): number {
  const strongest = Math.min(...[...kinds].map((kind) => HIT_KINDS.indexOf(kind)));
  return (HIT_KINDS.length - strongest) * KIND_WEIGHT + hits;
}

/**
 * Order two leads with equal weight: a named service first, then alphabetically.
 *
 * @param left one lead
 * @param right the other
 * @returns the comparison
 */
function compareStartShape({ left, right }: { left: Lead; right: Lead }): number {
  if (left.startShape === null || right.startShape === null) {
    return Number(left.startShape === null) - Number(right.startShape === null);
  }
  return left.startShape.localeCompare(right.startShape);
}

/** What one service accumulated across every keyword that hit it. */
interface Bucket {
  readonly keywords: Set<string>;
  readonly kinds: Set<HitKind>;
  hits: number;
}

/** A fresh, empty bucket. */
function emptyBucket(): Bucket {
  return { hits: 0, keywords: new Set<string>(), kinds: new Set<HitKind>() };
}

/**
 * Which bucket one hit accumulates into — its service's, or the service-less one.
 *
 * Both absences are named here rather than coalesced at the loop: a hit with no service goes to the shared
 * `unattached` bucket, and the first hit for a service mints that service's bucket.
 *
 * @param byService the per-service buckets so far
 * @param hit the hit being placed
 * @param unattached the bucket for hits the catalogue could not attach to a service
 * @returns the bucket to accumulate into
 */
function bucketFor({
  byService,
  hit,
  unattached,
}: {
  byService: Map<string, Bucket>;
  hit: { service: string | null };
  unattached: Bucket;
}): Bucket {
  if (hit.service === null) {
    return unattached;
  }
  const existing = byService.get(hit.service);
  if (existing === undefined) {
    return emptyBucket();
  }
  return existing;
}

/**
 * The keyword a bucket's lead is named for — its first alphabetically, or nothing when it has none.
 *
 * A bucket only ever enters the fold through a hit, so in practice it always carries one; the empty case is
 * answered out loud rather than coalesced because the type genuinely allows it.
 *
 * @param keywords every keyword that hit this bucket
 * @returns the first keyword, or nothing
 */
function firstKeyword({ keywords }: { keywords: ReadonlySet<string> }): string | null {
  const first = [...keywords].toSorted()[0];
  if (first === undefined) {
    return null;
  }
  return first;
}

/**
 * Turn one gate verdict into the leads a wave can spend detectives on.
 *
 * @param verdict what the catalogue gate concluded
 * @returns one lead per service hit, plus at most one for the service-less hits
 */
export function datadogLeads({ verdict }: { verdict: GateVerdict }): readonly Lead[] {
  const byService = new Map<string, Bucket>();
  const unattached: Bucket = {
    hits: 0,
    keywords: new Set(),
    kinds: new Set(),
  };
  for (const hit of verdict.hits) {
    const bucket = bucketFor({ byService, hit, unattached });
    bucket.hits += 1;
    bucket.keywords.add(hit.keyword);
    bucket.kinds.add(hit.kind);
    if (hit.service !== null) {
      byService.set(hit.service, bucket);
    }
  }
  const leads: Lead[] = [...byService.entries()].map(([service, bucket]) => ({
    keyword: firstKeyword({ keywords: bucket.keywords }),
    rows: leadWeight({ hits: bucket.hits, kinds: bucket.kinds }),
    source: DATADOG_LEAD_SOURCE,
    startShape: service,
    why:
      `the Datadog catalogue names ${service} for ${[...bucket.keywords].map((word) => `"${word}"`).join(", ")} ` +
      `(${[...bucket.kinds].toSorted((left, right) => HIT_KINDS.indexOf(left) - HIT_KINDS.indexOf(right)).join(", ")})`,
  }));
  if (unattached.hits > 0) {
    leads.push({
      keyword: firstKeyword({ keywords: unattached.keywords }),
      rows: leadWeight({ hits: unattached.hits, kinds: unattached.kinds }),
      source: DATADOG_LEAD_SOURCE,
      startShape: null,
      why:
        `the Datadog catalogue matches ${[...unattached.keywords].map((word) => `"${word}"`).join(", ")} ` +
        `outside any one service (${[...unattached.kinds].toSorted().join(", ")}) — ${String(unattached.hits)} match(es)`,
    });
  }
  // Ties break on the service so two runs of one gate order identically. The catalogue-wide lead carries no
  // service, and it sorts LAST among ties rather than being coalesced to an empty name.
  return leads.toSorted((left, right) => right.rows - left.rows || compareStartShape({ left, right }));
}
