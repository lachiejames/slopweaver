/**
 * The survival historical trend's per-plan contracts: a configured plan as the trend is asked about it, and a
 * plan's starting state. Pure. Both carry the plan's own usage limit off the register, because the owner's limit is
 * a ceiling the trend must stop at exactly as every routing gate does (`../plans/usageLimit.ts`): a plan
 * limited to 50% is spent to 50% in `./survivalSimulate.ts`, never to the house bar.
 */
import { decodeUsageLimitPercent, type UsageLimitPercent } from "../plans/usageLimit.js";
import type { ClaudeAccount } from "./contracts.js";

/**
 * One configured plan as the trend is asked about it: its alias, its pause when it is deliberately out, and the
 * share of its weekly allowance the owner lets the fleet take.
 */
export interface SurvivalPlanInput {
  readonly alias: string;
  readonly paused: { readonly reason: string; readonly sinceIso: string } | undefined;
  readonly usageLimitPercent: UsageLimitPercent;
}

/** One plan as the trend starts it: its latest observation, and the usage limit its register row sets. */
export interface SurvivalPlanState {
  readonly alias: string;
  /** The owner's usage limit on this plan, a share of its weekly allowance — the ceiling no hour passes. */
  readonly usageLimitPercent: UsageLimitPercent;
  /** The seven-day window's next reset, ISO-8601. */
  readonly resetAtIso: string;
  /** The seven-day window's fraction spent, 0..1. */
  readonly utilization: number;
  /** When it was read — or, for a week placed fresh at a reset passed since its last reading, that reset. */
  readonly observedAtIso: string;
  /** The Fable week's fraction spent, when the latest probe read one. */
  readonly fableUtilization: number | undefined;
  /** The Fable week's reset, when read. */
  readonly fableResetAtIso: string | undefined;
  /** At most this much of a week the plan can take in one hour, or `undefined` when no five-hour draw was measured. */
  readonly absorbPerHour: number | undefined;
}

/**
 * Every configured plan as the trend takes it — paused ones included, never filtered out before it is asked, each
 * with the usage limit its register row carries (absent on a hand-built account, which decodes to the whole plan).
 *
 * @param accounts the register's plans, or `undefined` when none is configured
 * @returns one input per plan, in the register's order
 */
export function survivalPlansOf({
  accounts,
}: {
  accounts: readonly ClaudeAccount[] | undefined;
}): readonly SurvivalPlanInput[] {
  if (accounts === undefined) {
    return [];
  }
  return accounts.map((account) => ({
    alias: account.alias,
    paused: account.paused,
    usageLimitPercent: decodeUsageLimitPercent({ usageLimitPercent: account.usageLimitPercent }),
  }));
}
