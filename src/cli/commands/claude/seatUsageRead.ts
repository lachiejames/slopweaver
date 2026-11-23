/**
 * The effectful half of the per-turn usage gate (`../../../claude/seatUsageGate.ts`) for `claude seat`: read the one
 * recorded reading a seat on a limited plan is judged by, and say how long a pass may be cached for.
 *
 * A plan at 100% reads nothing at all, so an install that set no usage limit pays no read and gets exactly the pass
 * it got before the gate existed. A recorded reading that cannot be read is NOT MEASURED, never open: the owner's
 * limit fails closed (`../../../claude/seatUsageGate.ts` § Why it fails closed).
 */
import type { ClaudeAccount } from "../../../claude/contracts.js";
import { readClaudePlanUsageSnapshot } from "../../../claude/planUsageSnapshotStore.js";
import type { SeatPassCachePolicy } from "../../../claude/seatPass.js";
import {
  type ClaudeSeatUsageVerdict,
  monthlySeatUsageVerdict,
  seatUsageNotMeasured,
  weeklySeatUsageVerdict,
} from "../../../claude/seatUsageGate.js";
import { latestClaudeSpendReading } from "../../../claude/spendStore.js";
import {
  decodePlanAllowance,
  decodeUsageLimitPercent,
  NO_USAGE_LIMIT,
  type PlanAllowance,
  type UsageLimitPercent,
} from "../../../plans/usageLimit.js";

/** What the usage gate made of one on-plan seat: nothing to judge, or a limited plan's verdict. */
export type SeatUsageJudgement =
  | { readonly kind: "unlimited" }
  | {
      readonly kind: "limited";
      readonly allowance: PlanAllowance;
      readonly usageLimitPercent: UsageLimitPercent;
      readonly verdict: ClaudeSeatUsageVerdict;
    };

/**
 * Read and judge the usage of the plan an on-plan seat runs on.
 *
 * @param accounts the configured plans, off the same register read the seat's identity was judged against
 * @param alias the plan the seat was found on — one of `accounts` by construction
 * @param home the state home the snapshot and the spend readings live under
 * @param nowIso the instant of the prompt
 * @returns `unlimited` for a plan at 100%, else the limited plan's verdict
 */
export function judgeSeatUsage({
  accounts,
  alias,
  home,
  nowIso,
}: {
  accounts: readonly ClaudeAccount[];
  alias: string;
  home: string;
  nowIso: string;
}): SeatUsageJudgement {
  // The identity verdict named this alias out of this very array, so it is there.
  const account = accounts.find((each) => each.alias === alias)!;
  const usageLimitPercent = decodeUsageLimitPercent({ usageLimitPercent: account.usageLimitPercent });
  if (usageLimitPercent === NO_USAGE_LIMIT) {
    return { kind: "unlimited" };
  }
  const allowance = decodePlanAllowance({ allowance: account.allowance });
  const verdict = limitedVerdict({ alias: account.alias, allowance, home, nowIso, usageLimitPercent });
  return { allowance, kind: "limited", usageLimitPercent, verdict };
}

/**
 * Read the one recorded reading the plan's allowance is judged by, and judge it.
 *
 * @param alias the plan
 * @param allowance which reading applies — a weekly snapshot or a monthly spend reading
 * @param home the state home
 * @param nowIso the instant of the prompt
 * @param usageLimitPercent the plan's usage limit, below 100
 * @returns the verdict, NOT MEASURED whenever the reading could not be read
 */
function limitedVerdict({
  alias,
  allowance,
  home,
  nowIso,
  usageLimitPercent,
}: {
  alias: string;
  allowance: PlanAllowance;
  home: string;
  nowIso: string;
  usageLimitPercent: UsageLimitPercent;
}): ClaudeSeatUsageVerdict {
  if (allowance.kind === "monthly-spend") {
    const reading = latestClaudeSpendReading({ alias, home, nowIso });
    if (reading.isErr()) {
      return seatUsageNotMeasured({
        alias,
        reason: `${alias}: its spend readings could not be read (${reading.error.message})`,
      });
    }
    return monthlySeatUsageVerdict({ alias, nowIso, reading: reading.value, usageLimitPercent });
  }
  const snapshot = readClaudePlanUsageSnapshot({ alias, home });
  if (snapshot.isErr()) {
    return seatUsageNotMeasured({ alias, reason: snapshot.error.message });
  }
  return weeklySeatUsageVerdict({ alias, nowIso, snapshot: snapshot.value, usageLimitPercent });
}

/**
 * How long the pass this prompt earned may be cached for: as long as today for a plan with no limit, until the
 * verdict's own cache window for an open weekly one, and not at all otherwise — a hold, or a monthly-spend plan.
 *
 * @param usage what the usage gate made of the seat
 * @returns the cache policy `seatPassWrite` applies
 */
export function seatPassCacheFor({ usage }: { usage: SeatUsageJudgement }): SeatPassCachePolicy {
  if (usage.kind === "unlimited") {
    return { kind: "unlimited" };
  }
  const { allowance, verdict } = usage;
  if (verdict.kind !== "open" || allowance.kind !== "weekly-window" || verdict.cacheWindow === undefined) {
    return { kind: "uncacheable" };
  }
  return {
    alias: verdict.alias,
    kind: "limited-weekly",
    validFromEpochSeconds: verdict.cacheWindow.fromEpochSeconds,
    validUntilEpochSeconds: verdict.cacheWindow.untilEpochSeconds,
  };
}
