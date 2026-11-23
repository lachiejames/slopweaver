/**
 * What Codex passes have actually cost — the report behind `slopweaver codex usage`.
 *
 * The owner asked for a price beside each pass kind, next to its find rate, so that the model question
 * (a cheaper-model option, priced and UNBUILT) becomes answerable later from measurements rather than
 * from an argument. This is that measurement, and three of its rules are what make it one:
 *
 *  1. **A pass nobody measured is COUNTED, never summed as zero.** `./passUsage.ts` carries the three-way
 *     summary; this file carries the fraction. The 9.6% in the ruling is an observation of one machine on
 *     one day, so it is computed here and never written down as a constant.
 *  2. **Every pass kind gets a row, including the ones that never ran.** A table of what happened cannot
 *     show an absence, and an absent `p1` is exactly the kind of thing the pass ledger exists to surface.
 *  3. **Unpriced is a first-class column.** With no `--rates` card there are no dollars at all and the report
 *     says so; with one, a pass the card cannot price is reported as unpriced rather than as free.
 *
 * Pure. `./ledgerStore.ts` does the scan, `./usageRender.ts` does the printing.
 */

import { verdictOf } from "./ledger.js";
import type { LedgerScan } from "./ledgerStore.js";
import { type MarginalPassReading, type MarginalTarget, marginalPassReading } from "./marginalYield.js";
import { measuredTokens, type PassUsageSummary, summarizePassUsage } from "./passUsage.js";
import { type CodexPriceEstimate, type CodexRateCard, priceCodexAttempt } from "./pricing.js";
import type { CodexArtifactRecord, CodexPassId, CodexUsage } from "./types.js";

/** Every pass kind, in loop order, so a row can exist for one that never ran. */
const ALL_PASSES: readonly CodexPassId[] = ["p1", "p2", "p3", "r1", "r2", "r3"];

const ZERO_USAGE: CodexUsage = {
  cache_write_input_tokens: 0,
  cached_input_tokens: 0,
  input_tokens: 0,
  output_tokens: 0,
  reasoning_output_tokens: 0,
};

/**
 * How a pass kind's verdicts came out, so a price sits beside a find rate rather than alone.
 *
 * @internal a field of the exported report, never imported by name.
 */
export interface KindOutcomes {
  readonly broken: number;
  readonly clean: number;
  readonly ready: number;
  readonly blocked: number;
  readonly noVerdict: number;
  readonly fatal: number;
}

/** One pass kind's row. */
export interface PassKindRow {
  readonly pass: CodexPassId;
  readonly runs: number;
  /** Passes whose every attempt reported usage. */
  readonly complete: number;
  /** Passes with at least one measured and at least one unmeasured attempt. */
  readonly partial: number;
  /** Passes with nothing measured at all. */
  readonly unmeasured: number;
  /**
   * The counters summed over the measured attempts only — a FLOOR when `partial` or `unmeasured` is non-zero.
   *
   * Named as a subtotal everywhere it is printed. It is not this pass kind's spend unless both of those are
   * zero, and the renderer is required to say so.
   */
  readonly measuredSubtotal: CodexUsage;
  readonly outcomes: KindOutcomes;
  /** Attempts the card priced. */
  readonly pricedAttempts: number;
  /** Attempts the card could not price, for any reason. */
  readonly unpricedAttempts: number;
  /** The summed estimate over the priced attempts, or undefined when nothing was priced. */
  readonly estimate: number | undefined;
  /** One reason per distinct unpriced cause, first-seen order — so "no dollars" is never unexplained. */
  readonly unpricedReasons: readonly string[];
}

/**
 * How much of the ledger the report could actually read.
 *
 * @internal a field of the exported report, never imported by name.
 */
export interface ScanCoverage {
  /** Pass records that parsed and are in scope. */
  readonly records: number;
  /** Finished passes written before the sidecar existed — ordinary, not a fault. */
  readonly withoutSidecar: number;
  /** Finished passes whose sidecar will not parse — a fault, and kept apart from {@link withoutSidecar}. */
  readonly unreadable: number;
}

/**
 * The measured unmeasured-pass fraction, with its own denominator beside it.
 *
 * @internal a field of the exported report, never imported by name.
 */
export interface UnmeasuredFraction {
  readonly passes: number;
  /** Passes carrying at least one attempt the SDK never reported usage for. */
  readonly incomplete: number;
  /** `incomplete / passes`, or undefined when no pass was in scope at all. */
  readonly fraction: number | undefined;
}

/**
 * What the report can say about money.
 *
 * @internal a field of the exported report, never imported by name.
 */
export type PricingBasis =
  | { readonly kind: "none"; readonly why: string }
  | {
      readonly kind: "card";
      readonly currency: string;
      readonly source: string;
      readonly effectiveFromIso: string;
      readonly effectiveToIso: string | undefined;
      readonly verifiedBy: string;
    };

/** The whole report. */
export interface CodexUsageReport {
  /** Which checkout's passes were counted, or undefined when every checkout was. */
  readonly repoRoot: string | undefined;
  readonly coverage: ScanCoverage;
  readonly rows: readonly PassKindRow[];
  readonly unmeasured: UnmeasuredFraction;
  readonly pricing: PricingBasis;
  /** The marginal-pass reading for the diff a caller named, or undefined when it named none. */
  readonly marginal: MarginalPassReading | undefined;
}

/** Add two usage readings field by field. */
function addUsage({ left, right }: { left: CodexUsage; right: CodexUsage }): CodexUsage {
  return {
    cache_write_input_tokens: left.cache_write_input_tokens + right.cache_write_input_tokens,
    cached_input_tokens: left.cached_input_tokens + right.cached_input_tokens,
    input_tokens: left.input_tokens + right.input_tokens,
    output_tokens: left.output_tokens + right.output_tokens,
    reasoning_output_tokens: left.reasoning_output_tokens + right.reasoning_output_tokens,
  };
}

/** Fold one verdict token into a kind's outcome counts. */
function addOutcome({ outcomes, verdict }: { outcomes: KindOutcomes; verdict: string }): KindOutcomes {
  if (verdict === "BROKEN") {
    return { ...outcomes, broken: outcomes.broken + 1 };
  }
  if (verdict === "CLEAN") {
    return { ...outcomes, clean: outcomes.clean + 1 };
  }
  if (verdict === "READY") {
    return { ...outcomes, ready: outcomes.ready + 1 };
  }
  if (verdict === "BLOCKED") {
    return { ...outcomes, blocked: outcomes.blocked + 1 };
  }
  if (verdict.startsWith("FATAL")) {
    return { ...outcomes, fatal: outcomes.fatal + 1 };
  }
  return { ...outcomes, noVerdict: outcomes.noVerdict + 1 };
}

/** What each attempt of one record priced at, or why it did not. */
function priceRecord({
  rateCard,
  record,
}: {
  rateCard: CodexRateCard | undefined;
  record: CodexArtifactRecord;
}): readonly CodexPriceEstimate[] {
  if (rateCard === undefined) {
    return record.attempts.map((): CodexPriceEstimate => ({ kind: "unpriced", reason: "no rate card was supplied" }));
  }
  return record.attempts.map((attempt) =>
    priceCodexAttempt({
      rateCard,
      requestedModel: record.requestedModel,
      startedAtIso: attempt.startedAtIso,
      usage: attempt.usage,
    }),
  );
}

/** The empty row for a pass kind, so an absence is a row rather than a gap. */
function emptyRow({ pass }: { pass: CodexPassId }): PassKindRow {
  return {
    complete: 0,
    estimate: undefined,
    measuredSubtotal: ZERO_USAGE,
    outcomes: { blocked: 0, broken: 0, clean: 0, fatal: 0, noVerdict: 0, ready: 0 },
    partial: 0,
    pass,
    pricedAttempts: 0,
    runs: 0,
    unmeasured: 0,
    unpricedAttempts: 0,
    unpricedReasons: [],
  };
}

/** Fold one record into its pass kind's row. */
function foldRecord({
  rateCard,
  record,
  row,
  summary,
}: {
  rateCard: CodexRateCard | undefined;
  record: CodexArtifactRecord;
  row: PassKindRow;
  summary: PassUsageSummary;
}): PassKindRow {
  const tokens = measuredTokens({ summary });
  const estimates = priceRecord({ rateCard, record });
  const priced = estimates.filter((estimate) => estimate.kind === "priced");
  const unpriced = estimates.filter((estimate) => estimate.kind === "unpriced");
  const amount = priced.reduce((total, estimate) => total + estimate.amount, 0);
  const reasons = [...row.unpricedReasons];
  for (const estimate of unpriced) {
    if (!reasons.includes(estimate.reason)) {
      reasons.push(estimate.reason);
    }
  }
  // A row with no estimate yet is not a row that priced at zero, and the difference is the whole point of
  // the field. Read it as its own case: nothing priced so far contributes nothing to the running total,
  // while the `estimate` below stays undefined unless something actually priced.
  const priceSoFar = runningTotal({ estimate: row.estimate });
  return {
    complete: row.complete + (summary.kind === "complete" ? 1 : 0),
    estimate: priced.length === 0 && row.estimate === undefined ? undefined : priceSoFar + amount,
    measuredSubtotal:
      tokens === undefined ? row.measuredSubtotal : addUsage({ left: row.measuredSubtotal, right: tokens }),
    outcomes: addOutcome({ outcomes: row.outcomes, verdict: verdictOf({ record }) }),
    partial: row.partial + (summary.kind === "partial" ? 1 : 0),
    pass: row.pass,
    pricedAttempts: row.pricedAttempts + priced.length,
    runs: row.runs + 1,
    unmeasured: row.unmeasured + (summary.kind === "unmeasured" ? 1 : 0),
    unpricedAttempts: row.unpricedAttempts + unpriced.length,
    unpricedReasons: reasons,
  };
}

/**
 * The running price total so far, where a row that has priced nothing yet contributes nothing.
 *
 * Stated as its own case rather than folded into an operator, because "no estimate yet" and "priced at zero"
 * are the distinction the `estimate` field exists to keep, and this is the one place they meet.
 *
 * @param estimate the row's estimate so far
 * @returns what to add the new prices to
 */
function runningTotal({ estimate }: { estimate: number | undefined }): number {
  if (estimate === undefined) {
    return 0;
  }
  return estimate;
}

/** What the report can say about money, from the card it was or was not given. */
function pricingBasis({ rateCard }: { rateCard: CodexRateCard | undefined }): PricingBasis {
  if (rateCard === undefined) {
    return {
      kind: "none",
      why: "no --rates card was supplied, and this repository holds no Codex tariff to fall back on",
    };
  }
  return {
    currency: rateCard.currency,
    effectiveFromIso: rateCard.effectiveFromIso,
    effectiveToIso: rateCard.effectiveToIso,
    kind: "card",
    source: rateCard.source,
    verifiedBy: rateCard.counterMapping.verifiedBy,
  };
}

/**
 * Build the usage report.
 *
 * @param scan every pass record on the machine, plus what the scan could not read
 * @param rateCard the installation's card, or undefined when none was supplied
 * @param repoRoot the checkout to count, or undefined to count every one
 * @param target the diff to produce a marginal reading for, or undefined for none
 * @returns the report, with a row for every pass kind and an explicitly counted unmeasured fraction
 */
export function buildCodexUsageReport({
  scan,
  rateCard,
  repoRoot,
  target,
}: {
  scan: LedgerScan;
  rateCard: CodexRateCard | undefined;
  repoRoot: string | undefined;
  target: MarginalTarget | undefined;
}): CodexUsageReport {
  const inScope = scan.records.filter((record) => repoRoot === undefined || record.repoRoot === repoRoot);
  const rows = new Map<CodexPassId, PassKindRow>(ALL_PASSES.map((pass) => [pass, emptyRow({ pass })]));
  let incomplete = 0;
  for (const record of inScope) {
    const row = rows.get(record.scope.pass);
    if (row === undefined) {
      continue;
    }
    const summary = summarizePassUsage({ record });
    if (summary.kind !== "complete") {
      incomplete += 1;
    }
    rows.set(record.scope.pass, foldRecord({ rateCard, record, row, summary }));
  }
  return {
    coverage: { withoutSidecar: scan.withoutSidecar, records: inScope.length, unreadable: scan.unreadable },
    marginal:
      target === undefined
        ? undefined
        : marginalPassReading({
            historyGap: { withoutSidecar: scan.withoutSidecar, unreadable: scan.unreadable },
            records: scan.records,
            target,
          }),
    pricing: pricingBasis({ rateCard }),
    repoRoot,
    // The map was seeded with every pass kind before the fold, so the lookup cannot miss. Asserted rather
    // than defaulted: a silent `emptyRow` here would print a counted pass kind as never run.
    rows: ALL_PASSES.map((pass) => rows.get(pass)!),
    unmeasured: {
      fraction: inScope.length === 0 ? undefined : incomplete / inScope.length,
      incomplete,
      passes: inScope.length,
    },
  };
}
