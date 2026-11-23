/**
 * Folding one pass record's attempts into a token total that can say "I do not know".
 *
 * The whole reason this is a module rather than a `reduce` at a call site: a pass can be measured, PARTLY
 * measured, or not measured at all, and the three are different facts. `src/codex/types.ts`'s
 * {@link ./types.UsageMeasurement} already refuses to spell an unmeasured attempt as zero — this keeps that
 * property alive one level up, where a summary over several attempts is where the zero would reappear.
 *
 * The measured 9.6% that motivated it: on the author's ledger, roughly one pass in ten carries at least one
 * attempt the SDK never reported usage for (an abort at the bound produces no `Turn`, so no usage object
 * ever existed). Summing those as zero understates spend silently and by an amount nobody can bound.
 * Reproduce the fraction on any machine — it is an observation, never a constant:
 *
 * ```bash
 * slopweaver codex usage
 * ```
 *
 * Counters are summed INDEPENDENTLY, one accumulator per SDK field, and never added to each other. Which of
 * the five overlap their parents is not established (`./types.CodexUsage` says so), so a grand total would
 * be a guess wearing a measurement's clothes.
 */

import type { CodexArtifactRecord, CodexUsage, UnmeasuredReason } from "./types.js";

/** The five counters, all zero — the identity for the per-field fold below. */
const ZERO_USAGE: CodexUsage = {
  cache_write_input_tokens: 0,
  cached_input_tokens: 0,
  input_tokens: 0,
  output_tokens: 0,
  reasoning_output_tokens: 0,
};

/**
 * Why an attempt contributed no numbers.
 *
 * Extends {@link ./types.UnmeasuredReason} with the one case that is a property of the RECORD rather than of
 * an attempt: a record with no attempts at all. A pass that never got as far as one turn is unmeasured for a
 * reason no attempt could carry, and calling it `aborted` would invent an attempt that never happened.
 *
 * @internal a field of the exported summary, never imported by name.
 */
export type UsageGapReason = UnmeasuredReason | "no-attempt";

/** How many attempts went missing for one reason. */
export interface UsageGap {
  readonly reason: UsageGapReason;
  readonly attempts: number;
}

/**
 * What one pass record's attempts add up to.
 *
 * Three variants rather than a nullable total, for the reason the whole file exists: `partial` has to be
 * able to print its measured subtotal WITHOUT that subtotal being readable as the pass's spend, and
 * `unmeasured` has to have no numeric field for a formatter to reach for.
 */
export type PassUsageSummary =
  /** Every attempt reported usage. The counters are the pass's spend. */
  | { readonly kind: "complete"; readonly measured: CodexUsage; readonly measuredAttempts: number }
  /**
   * Some attempts reported usage and some did not. `measuredSubtotal` is a FLOOR, never the total — named
   * so that nothing downstream can print it beside a complete pass's figure as though they were comparable.
   */
  | {
      readonly kind: "partial";
      readonly measuredSubtotal: CodexUsage;
      readonly measuredAttempts: number;
      readonly gaps: readonly UsageGap[];
    }
  /** Nothing was measured. Carries no numbers at all, by construction. */
  | { readonly kind: "unmeasured"; readonly gaps: readonly UsageGap[] };

/**
 * Add two usage readings field by field.
 *
 * @returns a reading whose every counter is the sum of the two corresponding counters
 */
function addUsage({ left, right }: { left: CodexUsage; right: CodexUsage }): CodexUsage {
  return {
    cache_write_input_tokens: left.cache_write_input_tokens + right.cache_write_input_tokens,
    cached_input_tokens: left.cached_input_tokens + right.cached_input_tokens,
    input_tokens: left.input_tokens + right.input_tokens,
    output_tokens: left.output_tokens + right.output_tokens,
    reasoning_output_tokens: left.reasoning_output_tokens + right.reasoning_output_tokens,
  };
}

/**
 * Collapse a list of gap reasons into one counted row per reason, in first-seen order.
 *
 * @returns one {@link UsageGap} per distinct reason
 */
function countGaps({ reasons }: { reasons: readonly UsageGapReason[] }): readonly UsageGap[] {
  const order: UsageGapReason[] = [];
  const counts = new Map<UsageGapReason, number>();
  for (const reason of reasons) {
    const seen = counts.get(reason);
    if (seen === undefined) {
      order.push(reason);
      counts.set(reason, 1);
      continue;
    }
    counts.set(reason, seen + 1);
  }
  // Every reason in `order` was put there by the loop above at the same moment its count was set, so the
  // lookup cannot miss. An honest assertion rather than a zero, which would print "0 attempts" for a gap
  // that is the whole reason the row exists.
  return order.map((reason) => ({ attempts: counts.get(reason)!, reason }));
}

/**
 * Summarise one pass record's token usage across all of its attempts.
 *
 * An aborted initial attempt followed by a measured conclusion stays `partial`: the conclusion turn's
 * counters are real, and the abandoned turn's are genuinely unknown, so the pass has no total.
 *
 * @param record the pass record, as read from its sidecar
 * @returns the complete, partial or unmeasured summary for that pass
 */
export function summarizePassUsage({ record }: { record: CodexArtifactRecord }): PassUsageSummary {
  if (record.attempts.length === 0) {
    return { gaps: [{ attempts: 1, reason: "no-attempt" }], kind: "unmeasured" };
  }
  let measured = ZERO_USAGE;
  let measuredAttempts = 0;
  const gapReasons: UsageGapReason[] = [];
  for (const attempt of record.attempts) {
    if (attempt.usage.kind === "measured") {
      measured = addUsage({ left: measured, right: attempt.usage.usage });
      measuredAttempts += 1;
      continue;
    }
    gapReasons.push(attempt.usage.reason);
  }
  if (gapReasons.length === 0) {
    return { kind: "complete", measured, measuredAttempts };
  }
  if (measuredAttempts === 0) {
    return { gaps: countGaps({ reasons: gapReasons }), kind: "unmeasured" };
  }
  return { gaps: countGaps({ reasons: gapReasons }), kind: "partial", measuredAttempts, measuredSubtotal: measured };
}

/**
 * The token counters a summary is willing to expose, or `undefined` when it has none.
 *
 * The single accessor every consumer goes through, so no renderer has to re-derive which variants carry
 * numbers — and `unmeasured` cannot accidentally be read as a zero reading anywhere.
 *
 * @param summary one pass's usage summary
 * @returns the measured counters for `complete`, the measured subtotal for `partial`, `undefined` otherwise
 */
export function measuredTokens({ summary }: { summary: PassUsageSummary }): CodexUsage | undefined {
  if (summary.kind === "complete") {
    return summary.measured;
  }
  if (summary.kind === "partial") {
    return summary.measuredSubtotal;
  }
  return undefined;
}
