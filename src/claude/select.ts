/**
 * Which plan the fleet should be on, given every plan's gauge. Pure: no clock, no filesystem, no network.
 *
 * ## The ordering, and why it is not "most headroom"
 *
 * Eligible accounts are sorted by **earliest seven-day reset first**, then lowest five-hour utilization,
 * then lowest seven-day utilization, then configured order. The first key is the one that is not obvious:
 * weekly capacity that is about to reset is capacity that will be LOST if it is not spent, so spending it
 * first is strictly better than spending a plan whose week has just begun. Sorting by raw headroom instead —
 * the intuitive choice, and the one this module was first written with — reliably saves the plan that is
 * about to be refilled anyway. The five-hour key then breaks ties toward the plan least likely to need a
 * second switch within the hour, and the configured order makes the whole result deterministic, which is
 * what lets the unit tests assert an exact alias rather than a set. A plan with no five-hour limit (the Ultra
 * shape) has no five-hour limit to approach, so it wins that key outright ({@link fiveHourRankKey}).
 *
 * ## The reserved plan IS the pinned plan, and why it is last rather than excluded

One plan is RESERVED, and it is the same plan that is PINNED — not a second setting that could drift out of
step with the first. The pinned account is where the owner's react-now pages live and where the owner's browser is
signed in, so it is also the account whose budget those pages depend on. Workers would otherwise drain it, so it
is reserved. The fleet therefore drains every other plan first and
falls back to the reserved one only when nothing else is eligible.

Passing the pinned alias as `reserved` is what makes them one concept. A caller that reserved some OTHER
plan would be expressing a preference nothing in this design supports, and the two settings would disagree
the first time the pinned account changed — as it did, from plan-three to plan-one, within a day.

It is ordered LAST rather than excluded, because excluding it would turn "the other two are spent" into a
fleet-wide stall while a perfectly good plan sat idle. The reserved plan is a bridge to cross only when it is reached, and the
bridge is this one line of ordering.

## N plans, never three
 *
 * Adding a further plan must be trivial. Nothing here counts accounts, and the
 * all-exhausted decision is simply the case where the eligible list came back empty.
 *
 * ## The cap is a function, not a constant
 *
 * {@link spendCapFor} is the number every gate in `src/claude` asks for, and it answers differently in a
 * weekly window's last five hours. It stays pure by reading the gauge's own
 * `observedAtIso` rather than a clock, which is also the only honest way to judge a reading that may be
 * hours old.
 *
 * ## And the house cap is not the whole ceiling
 *
 * {@link claudeEffectiveUsageCeiling} lowers a WEEKLY window's cap to the owner's usage limit on that plan, and
 * {@link claudeWindowExclusion} is the one window judgement every gate asks, so an exclusion says which rule fired
 * (`provider-refused`, `routing-bar`, `usage-limit`). The two local-policy kinds are never provider exhaustion, and no
 * override crosses them (`spawnStore.ts`).
 *
 * ## A monthly-spend plan is a second lane, judged in dollars
 *
 * A `monthly-spend` plan has no rate-limit windows to read: it is judged by {@link claudeSpendExclusion} on its
 * recorded spend (`./spendPolicy.ts`), and an eligible one is a FALLBACK behind every eligible weekly plan
 * ({@link rankMonthlySpends}). There is no measured exchange rate between a plan-week and dollars at API rates, so
 * the lanes are never mixed into one key, and subscription capacity that is already paid for goes first. The RESERVED
 * plan stays last across BOTH lanes, so an open monthly plan is taken before a reserved weekly one: the reserved
 * plan is the fallback only when nothing else is eligible, and an open monthly plan is eligible.
 */
import { parseIsoMs } from "#lib/date.js";
import { compareKeys } from "../plans/rankKeys.js";
import type { ClaudeThresholds } from "../plans/thresholds.js";
import { MONTHLY_SPEND_REASON_PREFIX, type PlanAllowance, type UsageLimitPercent } from "../plans/usageLimit.js";

import {
  CLAUDE_PLAN_CLAIMS,
  type ClaudeAccountAlias,
  type ClaudeAccountGauge,
  type ClaudeExclusion,
  type ClaudePlanClaim,
  type ClaudePlanGauge,
  type ClaudePlanSpend,
  type ClaudeRotationDecision,
  type ClaudeWindowReading,
  fiveHourRankKey,
} from "./contracts.js";

/*
 * ## The house bars are the register's thresholds, not constants
 *
 * The routing bar (`thresholds.routeAt`), the spend-out bar (`spendOutAt`) and its lead time
 * (`spendOutBeforeResetMs`) are read from the plan register (`../plans/thresholds.ts`: every limit
 * fixed in code goes into the store), so every function here takes them as an argument. Their defaults carry the
 * rulings that set them:
 *
 * - **routeAt, 95%.** Spawning once stopped at 85% with every plan at 76%, which left 15% on the table. It is the cap AWAY
 *   from a reset: a reader wanting the number that actually gates a window asks {@link spendCapFor}. The direct
 *   comparisons against it elsewhere are forecasts and warnings, never gates — `chairBudgetAlert.ts` among them,
 *   which must speak BEFORE the wall the lifted cap allows.
 * - **spendOutAt, 100%, inside the last five hours.** Rounding may spin a plan to 100% in this last stretch.
 *   Exactly 1 rather than 0.99 because {@link excludeReason} compares with `>=`, so a window AT 100% is still
 *   refused — spendable up to the wall and excluded at it.
 */

/**
 * Which window a spend cap is being asked about.
 *
 * @internal — the `claim` {@link spendCapFor} takes; every caller already has this name in hand, because it
 *   is the label its own exclusion reasons print.
 */
export type ClaudeCapWindow = "five_hour" | "seven_day" | "seven_day_fable";

/**
 * The utilization at which THIS window of THIS plan is treated as spent, right now.
 *
 * ## Weekly windows lift, the five-hour window never does
 *
 * The criterion is what a reset DOES to the capacity left in the window, not how soon it arrives. A weekly
 * window's reset STRANDS whatever is unspent — those points are gone, and taking a wall to spend them is a
 * good trade in the last hours. A five-hour window's reset REPLENISHES it — nothing is lost by waiting an
 * hour, so hitting that wall buys nothing and costs a stalled session. Written the other way round ("any
 * window resetting soon"), the rule would delete the five-hour rotation guard entirely, since a five-hour
 * window is by construction always inside five hours of its own reset.
 *
 * ## The gauge's own timestamp is the clock
 *
 * There is no `Date.now()` here, and that is correctness rather than purity theatre: `contracts.ts` states
 * that a gauge is only ever as good as its own timestamp, so judging a reading against a wall clock it never
 * saw would lift a cap off a number that may be hours old.
 *
 * A gauge observed AFTER its own reset is exactly that stale reading, and it keeps the routing bar
 * (`thresholds.routeAt`) — the direction that makes the plan MORE likely to be excluded. Lifting a
 * cap on a utilization the provider has already zeroed is the one move that spends a plan against a figure
 * known to be false; being wrong the safe way costs one skipped plan for one tick, until the next probe.
 *
 * @param claim which window is being judged
 * @param observedAtIso when the gauge carrying this window was taken
 * @param thresholds the install's Claude thresholds, off the register
 * @param window the reading whose own reset decides whether the cap lifts
 * @returns the fraction at or above which this window is spent
 */
export function spendCapFor({
  claim,
  observedAtIso,
  thresholds,
  window,
}: {
  claim: ClaudeCapWindow;
  observedAtIso: string;
  thresholds: ClaudeThresholds;
  window: ClaudeWindowReading;
}): number {
  return spendCapForSample({ claim, observedAtIso, resetAtIso: window.resetAtIso, thresholds });
}

/**
 * {@link spendCapFor} for a reading that is only an instant and a reset — a drawdown journal sample, which
 * carries no provider status. The policy is the same function, so the two cannot drift.
 *
 * @param claim which window is being judged
 * @param observedAtIso when the reading was taken — the clock, exactly as {@link spendCapFor} says
 * @param resetAtIso the instant this window resets
 * @param thresholds the install's Claude thresholds, off the register
 * @returns the fraction at or above which this window is spent
 */
export function spendCapForSample({
  claim,
  observedAtIso,
  resetAtIso,
  thresholds,
}: {
  claim: ClaudeCapWindow;
  observedAtIso: string;
  resetAtIso: string;
  thresholds: ClaudeThresholds;
}): number {
  if (insideSpendOut({ claim, observedAtIso, resetAtIso, thresholds })) {
    return thresholds.spendOutAt;
  }
  return thresholds.routeAt;
}

/**
 * Whether a window's spend-out bar is in force: a WEEKLY window, read inside the lead time before its own reset
 * and not after it.
 *
 * @param claim which window is being judged
 * @param observedAtIso when the reading was taken
 * @param resetAtIso the instant this window resets
 * @param thresholds the install's Claude thresholds, whose lead time decides
 * @returns true when the spend-out bar replaces the routing bar
 */
export function insideSpendOut({
  claim,
  observedAtIso,
  resetAtIso,
  thresholds,
}: {
  claim: ClaudeCapWindow;
  observedAtIso: string;
  resetAtIso: string;
  thresholds: ClaudeThresholds;
}): boolean {
  if (claim === "five_hour") {
    return false;
  }
  const resetMs = parseIsoMs({ tsIso: resetAtIso });
  const observedMs = parseIsoMs({ tsIso: observedAtIso });
  if (resetMs === undefined || observedMs === undefined) {
    return false;
  }
  const untilReset = resetMs - observedMs;
  // Exactly the lead time lifts; a negative gap is the stale gauge the header describes, and does not.
  return untilReset >= 0 && untilReset <= thresholds.spendOutBeforeResetMs;
}

/**
 * The ceiling one window of one plan is spent to right now: the house routing bar ({@link spendCapForSample}),
 * lowered to the owner's own usage limit on a WEEKLY window.
 *
 * @internal — the value {@link claudeEffectiveUsageCeiling} returns.
 */
export interface ClaudeUsageCeiling {
  /** The fraction at or above which this window bars new work — compared with `>=` on the raw reading. */
  readonly utilization: number;
  /** Which rule set it: the house bar, or the owner's usage limit when that is strictly lower. */
  readonly source: "routing-bar" | "usage-limit";
}

/**
 * The EFFECTIVE ceiling of one window: the lower of the house bar and the plan's usage limit on a weekly window,
 * and the house bar alone on the five-hour window.
 *
 * ## Why the five-hour window ignores the limit
 *
 * The owner's usage limit is a share of the WEEK (`../plans/usageLimit.ts`): a 30% limit means 30% of the plan's
 * weekly allowance, and a five-hour window at 30% has spent a share of five hours, not of the week. So the
 * five-hour window keeps the house bar and nothing else.
 *
 * ## Why the last-five-hours lift never raises a limit
 *
 * The house bar lifts from 0.95 to 1 near a weekly reset. The limit is a ceiling the owner set
 * and the fleet must stop at (`../plans/usageLimit.ts`), so this is a `min`: a 30% or 40% limit stays
 * 30% or 40% inside those hours. `source` names the usage limit whenever one below 100 is at or under the house
 * bar, so a 100% limit always reads as the house bar, and a limit EQUAL to the bar is still the owner's and no `--force`
 * crosses it (unreachable at today's steps of ten, held anyway).
 *
 * Every gate compares with `>=` on the provider's raw, unrounded fraction: `30 / 100` and the header's `0.3` are
 * the same double, so a reading of exactly 30% is excluded at a 30% limit with no epsilon.
 *
 * @param claim which window is being judged
 * @param observedAtIso when the reading was taken — the only clock, exactly as {@link spendCapFor} says
 * @param resetAtIso the instant this window resets
 * @param thresholds the install's Claude thresholds, which set the house bar
 * @param usageLimitPercent the plan's usage limit, a share of its weekly allowance
 * @returns the fraction at or above which this window bars new work, and which rule set it
 */
export function claudeEffectiveUsageCeiling({
  claim,
  observedAtIso,
  resetAtIso,
  thresholds,
  usageLimitPercent,
}: {
  claim: ClaudeCapWindow;
  observedAtIso: string;
  resetAtIso: string;
  thresholds: ClaudeThresholds;
  usageLimitPercent: UsageLimitPercent;
}): ClaudeUsageCeiling {
  const house = spendCapForSample({ claim, observedAtIso, resetAtIso, thresholds });
  const limit = usageLimitPercent / 100;
  if (claim !== "five_hour" && usageLimitPercent < 100 && limit <= house) {
    return { source: "usage-limit", utilization: limit };
  }
  return { source: "routing-bar", utilization: house };
}

/**
 * Why ONE window of one plan bars new work, or undefined when it does not — the one judgement every Claude routing
 * gate (`selectClaudeAccount`, `loadBalance.ts`'s `planExcludedBy`) asks, so none restates it. The watch trigger
 * asks {@link claudeEffectiveUsageCeiling} directly, because a `rejected` week past the bar must still rotate there.
 *
 * A window at or past the usage limit is `usage-limit` whatever the provider's status, because `provider-refused`
 * is bypassable and the limit is not — a rejected 50% week on a 30% plan reported as the provider's refusal let
 * `--force` boot past the owner's limit. BELOW the limit a provider `rejected` stays
 * `provider-refused`: that is the provider's fact, and calling it the owner's limit would hide a real wall.
 *
 * @param alias the plan the window belongs to
 * @param claim which window, which is also the label its reason prints
 * @param observedAtIso when the reading carrying this window was taken
 * @param thresholds the install's Claude thresholds
 * @param usageLimitPercent the plan's usage limit
 * @param window the reading
 * @returns the typed exclusion, or undefined when the window is open
 */
export function claudeWindowExclusion({
  alias,
  claim,
  observedAtIso,
  thresholds,
  usageLimitPercent,
  window,
}: {
  alias: ClaudeAccountAlias;
  claim: ClaudeCapWindow;
  observedAtIso: string;
  thresholds: ClaudeThresholds;
  usageLimitPercent: UsageLimitPercent;
  window: ClaudeWindowReading;
}): ClaudeExclusion | undefined {
  const ceiling = claudeEffectiveUsageCeiling({
    claim,
    observedAtIso,
    resetAtIso: window.resetAtIso,
    thresholds,
    usageLimitPercent,
  });
  const atCeiling = window.utilization >= ceiling.utilization;
  const atUsageLimit = atCeiling && ceiling.source === "usage-limit";
  if (window.status === "rejected" && !atUsageLimit) {
    return { alias, eligibleAtIso: window.resetAtIso, kind: "provider-refused", reason: `${claim} refused` };
  }
  if (!atCeiling) {
    return undefined;
  }
  const spent = `${claim} at ${String(Math.round(window.utilization * 100))}%`;
  if (atUsageLimit) {
    return {
      alias,
      eligibleAtIso: window.resetAtIso,
      kind: "usage-limit",
      reason: `${spent}, at its usage limit of ${String(usageLimitPercent)}%`,
    };
  }
  return { alias, eligibleAtIso: window.resetAtIso, kind: "routing-bar", reason: spent };
}

/** Why a monthly-spend plan's rate-limit windows never decide anything, printed wherever a gate meets one. */
export const MONTHLY_GAUGE_NOT_ITS_ALLOWANCE =
  "a monthly-spend plan is judged on its recorded spend, never on its rate-limit windows";

/**
 * The exclusion a WINDOW gate gives a monthly-spend plan's gauge: NOT MEASURED, with no reset instant. Its allowance
 * is dollars, so its windows say nothing about it; the routing passes judge it on its spend instead
 * ({@link claudeSpendExclusion}) and keep its gauge out of the window lane, so this fires only for a weekly-only
 * reader handed one.
 *
 * @param plan the plan's reading, or the plan itself when it was never probed
 * @returns the `not-measured` exclusion when the plan's allowance is monthly spend, else undefined
 */
export function monthlyGaugeExclusion({
  plan,
}: {
  plan: { readonly alias: ClaudeAccountAlias; readonly allowance: PlanAllowance };
}): ClaudeExclusion | undefined {
  if (plan.allowance.kind !== "monthly-spend") {
    return undefined;
  }
  return { alias: plan.alias, kind: "not-measured", reason: MONTHLY_GAUGE_NOT_ITS_ALLOWANCE };
}

/**
 * Why a monthly-spend plan cannot take new work, off its spend verdict, or undefined when it can.
 *
 * The verdict's kind IS the exclusion's kind: `usage-limit` and `not-measured` are the owner's policy and no override
 * crosses them, and `provider-refused` is the provider saying extra usage is off or its own limit is reached. No
 * kind carries a reset instant — the reading does not say when the month turns over.
 *
 * @param spend the plan and its verdict
 * @returns the typed exclusion, or undefined when the verdict is open
 */
export function claudeSpendExclusion({ spend }: { spend: ClaudePlanSpend }): ClaudeExclusion | undefined {
  const { verdict } = spend;
  if (verdict.kind === "open") {
    return undefined;
  }
  return { alias: spend.alias, kind: verdict.kind, reason: `${MONTHLY_SPEND_REASON_PREFIX}${verdict.reason}` };
}

/**
 * The monthly-spend plans that can take new work, best first: least of the permitted spend already used, then
 * configured order (a stable sort). A fraction rather than dollars left, so two plans with different limits are
 * drawn down evenly against their own limits.
 *
 * @param spends every monthly-spend plan, in configured order
 * @returns the plans whose verdict is open, ordered
 */
export function rankMonthlySpends({ spends }: { spends: readonly ClaudePlanSpend[] }): readonly ClaudeOpenSpend[] {
  return spends
    .filter((spend): spend is ClaudeOpenSpend => spend.verdict.kind === "open")
    .toSorted((left, right) => left.verdict.usedFraction - right.verdict.usedFraction);
}

/** A monthly-spend plan whose verdict is open — the only kind the monthly lane ranks. */
export interface ClaudeOpenSpend extends ClaudePlanSpend {
  readonly verdict: Extract<ClaudePlanSpend["verdict"], { kind: "open" }>;
}

/**
 * Only the weekly-window gauges — the window lane's input. A monthly-spend plan's gauge, when a reader took one, is
 * dropped here because the monthly lane judges that plan on its spend.
 *
 * @param gauges every reading, in configured order
 * @returns the weekly-window readings, in the same order
 */
export function weeklyLane({ gauges }: { gauges: readonly ClaudePlanGauge[] }): readonly ClaudePlanGauge[] {
  return gauges.filter((gauge) => gauge.allowance.kind === "weekly-window");
}

/**
 * The plan-wide windows one gauge carries, paired with the claim each belongs to, so callers iterate rather
 * than restating the pair. A plan with no five-hour limit (the Ultra shape, `contracts.ts`) yields the week
 * alone.
 *
 * @param gauge the account reading to walk
 * @returns each plan-wide claim the gauge carries, with its window reading
 */
function planWindows({
  gauge,
}: {
  gauge: ClaudeAccountGauge;
}): readonly { claim: ClaudePlanClaim; window: ClaudeWindowReading }[] {
  return CLAUDE_PLAN_CLAIMS.flatMap((claim) => {
    const window = claim === "five_hour" ? gauge.fiveHour : gauge.sevenDay;
    return window === undefined ? [] : [{ claim, window }];
  });
}

/**
 * Why this account cannot be selected right now, or undefined when it can.
 *
 * @param gauge the account's reading
 * @param thresholds the install's Claude thresholds
 * @returns the exclusion, or undefined when the account is eligible
 */
function excludeReason({
  gauge,
  thresholds,
}: {
  gauge: ClaudePlanGauge;
  thresholds: ClaudeThresholds;
}): ClaudeExclusion | undefined {
  const notMeasured = monthlyGaugeExclusion({ plan: gauge });
  if (notMeasured !== undefined) {
    return notMeasured;
  }
  const exclusions = planWindows({ gauge }).flatMap(({ claim, window }) => {
    const excluded = claudeWindowExclusion({
      alias: gauge.alias,
      claim,
      observedAtIso: gauge.observedAtIso,
      thresholds,
      usageLimitPercent: gauge.usageLimitPercent,
      window,
    });
    return excluded === undefined ? [] : [excluded];
  });
  return strictestExclusion({ exclusions });
}

/**
 * The exclusion a plan reports when several of its windows exclude it at once: a `usage-limit` one ahead of any
 * other, because the owner's limit is the one no override crosses. Reported in window order instead, a five-hour
 * `routing-bar` would mask the week's limit, and the spent-plan override that releases a routing bar would boot the
 * plan past it. Otherwise the first, in window order.
 *
 * @param exclusions every window's exclusion, in window order
 * @returns the exclusion to report, or undefined when no window excludes the plan
 */
export function strictestExclusion({
  exclusions,
}: {
  exclusions: readonly ClaudeExclusion[];
}): ClaudeExclusion | undefined {
  const limited = exclusions.find((exclusion) => exclusion.kind === "usage-limit");
  if (limited !== undefined) {
    return limited;
  }
  return exclusions[0];
}

/**
 * The earliest reset across every plan-wide window of every MEASURED gauge — what an all-exhausted alert carries
 * so the owner is told when the fleet comes back rather than only that it is down. A monthly-spend plan's windows
 * are left out: no reset of theirs brings that plan back to autonomous work.
 *
 * @param gauges every account's reading
 * @returns the earliest reset instant, ISO-8601, or undefined when there were no measured gauges at all
 */
function earliestReset({ gauges }: { gauges: readonly ClaudePlanGauge[] }): string | undefined {
  const resets = gauges
    .filter((gauge) => gauge.allowance.kind === "weekly-window")
    .flatMap((gauge) => planWindows({ gauge }).map(({ window }) => window.resetAtIso));
  return resets.reduce<string | undefined>(
    (earliest, reset) => (earliest === undefined || reset < earliest ? reset : earliest),
    undefined,
  );
}

/**
 * Rank two eligible gauges. Earliest weekly reset wins; then least five-hour spent; then least weekly spent.
 * A zero result leaves `toSorted`'s stable order holding configured order.
 *
 * @param left the first gauge
 * @param right the second gauge
 * @returns a standard comparator result
 */
function rank({ left, right }: { left: ClaudeAccountGauge; right: ClaudeAccountGauge }): number {
  if (left.sevenDay.resetAtIso !== right.sevenDay.resetAtIso) {
    return left.sevenDay.resetAtIso < right.sevenDay.resetAtIso ? -1 : 1;
  }
  const fiveHour = compareKeys({ left: fiveHourRankKey({ gauge: left }), right: fiveHourRankKey({ gauge: right }) });
  if (fiveHour !== 0) {
    return fiveHour;
  }
  return left.sevenDay.utilization - right.sevenDay.utilization;
}

/**
 * Decide which plan the fleet should be on.
 *
 * Every eligible plan is put in one order — the weekly lane ranked, then the monthly lane ranked (this module's
 * header says why monthly is the fallback) — and the reserved plan is taken out of it unless it is all that is left.
 * The active plan STAYS while it is eligible, unless it is the reserved plan with another plan eligible, or a
 * monthly-spend plan while a weekly plan is eligible: both are spends the owner would not choose with an
 * alternative in hand.
 *
 * @param gauges every weekly-window plan's reading, in configured order — the final tie-break; a monthly-spend
 *   plan's gauge is ignored ({@link weeklyLane})
 * @param spends every unpaused monthly-spend plan's spend verdict, in configured order
 * @param active the plan the fleet is on now, when it is on one
 * @param reserved the plan the browser is pinned to, which is chosen only when nothing else is eligible
 * @param thresholds the install's Claude thresholds, off the register
 * @returns rotate to a named plan, stay put, or report every plan exhausted with the earliest weekly reset
 */
export function selectClaudeAccount({
  active,
  gauges,
  reserved,
  spends,
  thresholds,
}: {
  active?: ClaudeAccountAlias;
  gauges: readonly ClaudePlanGauge[];
  reserved?: ClaudeAccountAlias;
  spends: readonly ClaudePlanSpend[];
  thresholds: ClaudeThresholds;
}): ClaudeRotationDecision {
  const weekly = weeklyLane({ gauges });
  const excluded = [
    ...weekly.map((gauge) => excludeReason({ gauge, thresholds })),
    ...spends.map((spend) => claudeSpendExclusion({ spend })),
  ].filter((x): x is ClaudeExclusion => x !== undefined);
  const excludedAliases = new Set(excluded.map((x) => x.alias));
  const weeklyEligible = weekly
    .filter((gauge) => !excludedAliases.has(gauge.alias))
    .toSorted((left, right) => rank({ left, right }))
    .map((gauge) => gauge.alias);
  const monthlyEligible = rankMonthlySpends({ spends }).map((spend) => spend.alias);
  const eligible = [...weeklyEligible, ...monthlyEligible];

  if (eligible.length === 0) {
    const earliest = earliestReset({ gauges: weekly });
    return {
      excluded,
      kind: "all-exhausted",
      ...(earliest === undefined ? {} : { earliestResetIso: earliest }),
    };
  }
  const activeIsEligible = active !== undefined && eligible.includes(active);
  const activeIsReservedWithAlternatives = active === reserved && eligible.some((alias) => alias !== reserved);
  const activeIsMonthlyWithWeekly =
    active !== undefined && monthlyEligible.includes(active) && weeklyEligible.some((alias) => alias !== reserved);
  if (activeIsEligible && !activeIsReservedWithAlternatives && !activeIsMonthlyWithWeekly) {
    const reason = monthlyEligible.includes(active)
      ? "the active plan is still under its monthly usage limit"
      : "the active plan still has plan-wide headroom";
    return { kind: "stay", on: active, reason };
  }
  const preferred = eligible.filter((alias) => alias !== reserved);
  const best = preferred.length > 0 ? preferred[0]! : eligible[0]!;
  return {
    excluded,
    kind: "rotate",
    to: best,
    ...(active === undefined ? {} : { from: active }),
  };
}
