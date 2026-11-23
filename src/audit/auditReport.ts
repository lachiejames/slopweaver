/**
 * PURE formatting for `slopweaver audit`: assemble the aggregator outputs into one {@link AuditReport},
 * then render either the human report (lines, for stderr) or the stable machine shape (for `--json` on
 * stdout). No IO — the shell hands these the composed report.
 */
import type { SourceStorage } from "../corpus/bronzeStorage.js";
import type { BatchDigest } from "../gold/distil.js";
import { groupThousands } from "../lib/progressRender.js";
import type { Opportunity } from "../silver/opportunity.js";
import {
  type AuditPerson,
  CRISP_MAX_EVIDENCE,
  type GroundingStat,
  groundingStats,
  type IdentityStat,
  identityStats,
  type RetentionStat,
  retentionStats,
  type SignalRatioStat,
  type SourceStat,
  type SupersededStat,
  signalRatio,
} from "./auditCore.js";
import type { AuditTallies } from "./auditFold.js";
import {
  calibrateRate,
  type DistilCostEstimate,
  estimateDistilCost,
  type PersistedBatchUsage,
} from "./costEstimate.js";

/** The whole snapshot: per-source volume, grounding, opportunity signal, identity, and the cost estimate. */
export interface AuditReport {
  readonly totalRecords: number;
  readonly sources: readonly SourceStat[];
  readonly grounding: GroundingStat;
  readonly signal: SignalRatioStat;
  readonly identity: IdentityStat;
  readonly cost: DistilCostEstimate;
  /** On-disk footprint + how much of it `slopweaver compact` would collapse (PR4.9). */
  readonly retention: RetentionStat;
  /** How much of physical bronze is a stale version — what a reader hides and `audit` counts. */
  readonly superseded: SupersededStat;
}

/**
 * Compose the whole audit report from the already-read inputs — the single PURE pipeline behind the verb,
 * so the shell only reads + renders. Pure.
 *
 * @param tallies what the audit fold gathered over physical bronze — volume, citation targets, duplicates,
 *   superseded versions
 * @param digests the persisted distil batch digests
 * @param cachedHashes the digest-cache hashes (batches served without a model call)
 * @param batchHashes every batch hash in the current plan (from `groupForDistil`)
 * @param usageByHash the persisted per-batch real usage (cost calibration)
 * @param opportunities the derived opportunities
 * @param people the derived canonical people
 * @param directoryPeople how many entries the silver people directory holds
 * @param directoryExcluded how many accounts derive filtered out of it (omit for a pre-PR4.8 artifact)
 * @param storage the per-source on-disk footprint (files + bytes), measured by the shell
 * @returns the composed report
 */
export function composeAuditReport({
  tallies,
  digests,
  cachedHashes,
  batchHashes,
  usageByHash,
  opportunities,
  people,
  directoryPeople,
  directoryExcluded,
  storage,
}: {
  tallies: AuditTallies;
  digests: readonly BatchDigest[];
  cachedHashes: ReadonlySet<string>;
  batchHashes: readonly string[];
  usageByHash: ReadonlyMap<string, PersistedBatchUsage>;
  opportunities: readonly Opportunity[];
  people: readonly AuditPerson[];
  directoryPeople: number;
  directoryExcluded?: number;
  storage: readonly SourceStorage[];
}): AuditReport {
  return {
    cost: estimateDistilCost({ batchHashes, cachedHashes, rate: calibrateRate({ usageByHash }) }),
    grounding: groundingStats({ digests, refs: tallies.refs }),
    identity: identityStats({
      directoryPeople,
      people,
      ...(directoryExcluded !== undefined ? { directoryExcluded } : {}),
    }),
    retention: retentionStats({ storage, tallies }),
    signal: signalRatio({ opportunities }),
    sources: tallies.sources,
    superseded: tallies.superseded,
    totalRecords: tallies.rows,
  };
}

/**
 * The people-directory clause. Only claims a filter when the artifact actually carries the exclusion count —
 * a pre-PR4.8 `directory.json` was never filtered, so presenting its count as filtered would be a lie. Pure.
 */
function directoryNote({ identity }: { identity: IdentityStat }): string {
  const excluded = identity.directoryExcluded;
  return excluded === undefined
    ? "(NOT yet filtered — re-run `slopweaver derive` to drop bots/integrations)"
    : `(${String(excluded)} bot/integration excluded — still in the corpus)`;
}

/**
 * A byte count as a human size (`1.2 MB`), binary-free: the corpus is JSONL, and a KB/MB the user can
 * compare against `du -h` beats an exact byte count nobody reads. Pure.
 *
 * @param bytes the byte count
 * @returns the formatted size
 */
function formatBytes({ bytes }: { bytes: number }): string {
  const units = ["B", "KB", "MB", "GB"] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? String(value) : value.toFixed(1)} ${units[unit]!}`;
}

/** The retention clause: what compaction would collapse, or that there is nothing to collapse. Pure. */
function retentionNote({ retention }: { retention: RetentionStat }): string {
  return retention.collapsibleDuplicates === 0
    ? "no cross-window duplicates (`slopweaver compact` would only consolidate files)"
    : `${String(retention.collapsibleDuplicates)} cross-window duplicate record(s) collapsible by \`slopweaver compact\``;
}

/** A ratio in [0,1] as a one-decimal percent string. Pure. */
function pct({ ratio }: { ratio: number }): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

/**
 * The superseded clause: how many physical rows are stale versions, or that none are.
 *
 * Says who hides them and who does not, because the asymmetry is the whole point — `store read`/`store cite`/`derive`
 * collapse to the latest version, `audit` counts every physical row, and a reader who does not know that
 * reads the two verbs' record counts as a contradiction. Pure.
 */
function supersededNote({ superseded }: { superseded: SupersededStat }): string {
  if (superseded.superseded === 0) {
    return "no stale versions — every physical row is the latest of its entity";
  }
  return [
    `${groupThousands({ value: superseded.superseded })} of ${groupThousands({ value: superseded.rows })} row(s)`,
    `are stale versions (${pct({ ratio: superseded.superseded / superseded.rows })}) —`,
    `${groupThousands({ value: superseded.logical })} logical record(s),`,
    `deepest entity ${String(superseded.deepest)} version(s).`,
    "`store read`/`store cite`/`derive` hide them; `audit` counts physical bronze",
  ].join(" ");
}

/**
 * The cost provenance clause: "calibrated from N real batch(es)" or "cold estimate". Pure.
 *
 * @param cost the estimate, which knows whether it was calibrated against real batches
 * @returns the clause — an uncalibrated estimate says so, so a number is never read as measured when it
 *   was extrapolated
 */
function costProvenance({ cost }: { cost: DistilCostEstimate }): string {
  const n = cost.rate.calibratedFrom;
  return n > 0 ? `calibrated from ${String(n)} real batch(es)` : "cold estimate";
}

/** A `~<tokens> tokens` clause, with an optional ` / ~$<usd>` when the rate carried a cost. Pure. */
function tokensCost({ tokens, costUsd }: { tokens: number; costUsd?: number }): string {
  const cost = costUsd !== undefined ? ` / ~$${costUsd.toFixed(2)}` : "";
  return `~${groupThousands({ value: tokens })} tokens${cost}`;
}

/** One per-source volume line: `github   6  <first>..<last>  (pr 3, review 1, ...)`. Pure. */
function sourceLine({ stat }: { stat: SourceStat }): string {
  const kinds = Object.entries(stat.kinds)
    .toSorted(([a], [b]) => (a < b ? -1 : 1))
    .map(([kind, count]) => `${kind} ${String(count)}`)
    .join(", ");
  const span = stat.spanStart === "" ? "(no dates)" : `${stat.spanStart.slice(0, 10)}..${stat.spanEnd.slice(0, 10)}`;
  return `  ${stat.source.padEnd(7)} ${String(stat.count).padStart(4)}  ${span}  (${kinds})`;
}

/**
 * The human report lines (for stderr) — counts, spans, grounding, signal, identity, and the `~`-labelled
 * cost estimate (initial backfill + ongoing marginal). Pure.
 *
 * @param report the composed audit report
 * @returns the report lines, in display order
 */
export function auditHumanLines({ report }: { report: AuditReport }): readonly string[] {
  const { grounding, signal, identity, cost, retention, superseded } = report;
  return [
    "slopweaver audit — local quality + cost snapshot (read-only, no network, no tokens)",
    "",
    `corpus: ${String(report.totalRecords)} record(s) across ${String(report.sources.length)} source(s)`,
    ...report.sources.map((stat) => sourceLine({ stat })),
    "",
    `digests: ${String(grounding.digests)} batch digest(s), grounding ${pct({ ratio: grounding.ratio })} (${String(grounding.grounded)}/${String(grounding.points)} points cite a real record)`,
    `opportunities: ${String(signal.total)} total — ${String(signal.crisp)} crisp (≤${String(CRISP_MAX_EVIDENCE)} evidence), ${String(signal.mega)} mega-clique  [signal ${pct({ ratio: signal.crispRatio })}]`,
    `  top ${String(signal.topN)}: ${String(signal.topCrisp)} crisp — the ranked head a human reads`,
    `retention: ${String(retention.files)} bronze file(s), ${formatBytes({ bytes: retention.bytes })} on disk — ${retentionNote({ retention })}`,
    `superseded: ${supersededNote({ superseded })}`,
    `identity: ${String(identity.resolved)} resolved, ${String(identity.linked)} cross-source-linked, ${String(identity.bots)} bot(s), ${String(identity.integrations)} integration(s)`,
    `people directory: ${String(identity.directoryPeople)} team member(s) ${directoryNote({ identity })}`,
    "",
    `distil cost (${costProvenance({ cost })}; assumes a full default distil plan):`,
    `  initial backfill: ${tokensCost({ tokens: cost.initialTokens, ...(cost.initialCostUsd !== undefined ? { costUsd: cost.initialCostUsd } : {}) })} for ${String(cost.uncachedBatches)} uncached batch(es)`,
    `  ongoing: ${tokensCost({ tokens: cost.ongoingTokensPerChangedBatch, ...(cost.ongoingCostUsdPerChangedBatch !== undefined ? { costUsd: cost.ongoingCostUsdPerChangedBatch } : {}) })} per changed batch (the cache serves the rest)`,
  ];
}

/**
 * The stable machine shape for `--json` (goes to stdout, pristine). A superset of the report with the
 * human-readable cost provenance label folded in. Pure.
 *
 * @param report the composed audit report
 * @returns the JSON-serialisable object
 */
export function auditJson({ report }: { report: AuditReport }): Readonly<Record<string, unknown>> {
  return {
    cost: { ...report.cost, provenance: costProvenance({ cost: report.cost }) },
    grounding: report.grounding,
    identity: report.identity,
    retention: report.retention,
    // v3: the additive `superseded` block. Bumped for the same reason v2 was — additive is still a change, and
    // a consumer that pins the version finds out from the version rather than from a missing field.
    schemaVersion: 3,
    signal: report.signal,
    sources: report.sources,
    superseded: report.superseded,
    totalRecords: report.totalRecords,
  };
}
