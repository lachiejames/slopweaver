/**
 * Which plan a spawn should land on, ranked so every decision pushes the fleet toward balance. Pure: no
 * clock, no filesystem, no network, no credential.
 *
 * ## The rulings this implements: the plan furthest below its own level line
 *
 * A spawn lands on the plan the owner would have chosen on seeing all the available usage data: draw down all
 * plans at roughly equal rates, avoid maxing one plan while another sits unused, keep capacity maxed, and leave
 * no plan usage on the table. A plan at eighty percent that resets in an hour is a different story from one at
 * eighty percent that reset an hour ago — keep the plans level, weigh the resets, and the chair never hits a
 * limit.
 *
 * So the primary key is each window's `headroom.ts`'s `headroomToReset`: how many points it sits below the line an evenly
 * drawn week would have reached by now. It refines the earlier rule that the next spawn goes on the plan with
 * the lowest Fable usage rather than reversing it — on
 * two plans resetting together the lower level is the one further behind. On two plans resetting on different
 * days it weighs the reset: a plan at 60% resetting tomorrow is behind its line and takes the spawn from one at
 * 55% resetting in six days, which is far ahead of its own (ranked on level alone that 40% stranded — a third of a
 * plan-week every week, `slopweaver claude forecast`, router `least-used`). And a plan nearing its wall is never
 * behind a plan that has barely started: counted in points, a plan at 78% a day from its reset is 7 behind its
 * line while one at 0% six days out is 15 behind, so the empty plan takes the chair.
 *
 * Ranking on the lowest-Fable-usage rule alone ranked on the GAP between the two windows, `F - W`, and that is wrong in a way
 * worth keeping written down: a plan at `F=80% W=95%` has a gap of `-15`, and a plan at `F=10% W=20%` has a
 * gap of `-10`, so ranking on the gap alone sends the next Fable spawn to the plan that is 80% through its
 * Fable week. It maximises the wrong thing. The headroom is the primary key and the gap is demoted to the
 * tie-break that corrects stranding.
 *
 * ## Lexicographic, never a weighted scalar
 *
 * There is no measured conversion between a five-hour window and a seven-day one, and no known cost for
 * newly opening a long-lived session. A weighted sum would therefore be inventing an exchange rate and
 * presenting it as arithmetic. Keys are applied in order, and each one only breaks the ties the one above
 * it left.
 *
 * ## The asymmetry that sets the direction of the second key
 *
 * MEASURED (`routeSpawn.ts` carries it): a Fable request against a plan whose plan-wide week
 * reads `rejected` is refused `429` even while its Fable window reads `allowed` with half the week left. So
 * **week-before-Fable strands the Fable week outright, and Fable-before-week strands nothing** — whatever
 * is left of the plan-wide week is still spendable by Opus, Sonnet and Haiku. The correction key therefore
 * prefers burning Fable EARLY on each plan, never late.
 *
 * ## Absent is NOT MEASURED, and it never sorts as zero
 *
 * A gauge taken with a non-Fable model carries no Fable window at all. Treating that as `0` would rank an
 * unmeasured plan as the emptiest one and send every Fable spawn to the plan nobody has read. Unmeasured
 * plans are DEFERRED behind measured ones, and when nothing is measured the whole comparison falls back to
 * the plan-wide week and says so through {@link ClaudeRankBasis}.
 */

import { absentAsNumber } from "#lib/absent.js";
import { rankBy, type SortKey } from "../plans/rankKeys.js";
import type { ClaudeThresholds } from "../plans/thresholds.js";
import {
  type ClaudeAccountAlias,
  type ClaudeAccountGauge,
  type ClaudeExclusion,
  type ClaudeModelClass,
  type ClaudePlanGauge,
  type ClaudePlanSpend,
  fiveHourRankKey,
} from "./contracts.js";
import { fableSeatThresholds, gatingWindows } from "./fableSeatBars.js";
import { bindingFableHeadroom, weekHeadroom } from "./headroom.js";
import {
  type ClaudeOpenSpend,
  claudeSpendExclusion,
  claudeWindowExclusion,
  monthlyGaugeExclusion,
  rankMonthlySpends,
  strictestExclusion,
  weeklyLane,
} from "./select.js";

/**
 * Which key set produced a ranking, so a caller can print the degradation rather than hide it.
 *
 * @internal — a field of {@link ClaudePlanRanking}; a caller reads it off the ranking.
 */
export type ClaudeRankBasis =
  /** Ranked on the window the spawn will actually spend. */
  | "full"
  /** No plan carried a usable Fable reading, so a Fable spawn was ranked on the plan-wide week instead. */
  | "weekly-fallback";

/**
 * What a ranking pass concluded.
 *
 * @internal — the value {@link rankClaudePlans} returns; `routeSpawnToPlan` reads `ranked[0]` off it.
 */
export interface ClaudePlanRanking {
  /** Every eligible plan, best first. Empty when none can take this spawn. */
  readonly ranked: readonly ClaudePlanGauge[];
  readonly excluded: readonly ClaudeExclusion[];
  /** Eligible plans held behind the measured ones because this spawn's window was never read on them. */
  readonly deferredUnmeasured: readonly ClaudeAccountAlias[];
  readonly basis: ClaudeRankBasis;
}

/*
 * ## The acceptance bar is a GRADING bar, and it only grades while it sits under the routing bar
 *
 * `thresholds.acceptanceAt` (default 90%, the owner's own number, quoted at {@link acceptanceShortfall}) and the
 * routing bar are coupled, which is not obvious from either. The bar asks every plan to reach it; the routing bar
 * decides how far routing will spend one before excluding it. A routing bar of 0.85 would put the acceptance bar
 * ABOVE it, so `acceptance: MET` would be unreachable by the router being graded — the routing bar is 0.95, which
 * makes the verdict earnable. So the register refuses an acceptance bar at or
 * past the routing bar (`../plans/thresholds.ts`), and spend-out only lifts the routing bar, which makes it easier to
 * earn. Check the standing gap with `slopweaver claude gauge`.
 */

/**
 * Why this plan cannot take this spawn, or undefined when it can.
 *
 * A monthly-spend plan's gauge is `not-measured` before any window is read: its allowance is dollars, judged in the
 * monthly lane ({@link rankClaudeBudgets}). Each window's bar is `select.ts`'s
 * {@link claudeWindowExclusion}: the house bar ({@link spendCapFor}, which lets a weekly window in its last five
 * hours take a spawn at 97%), lowered on both weekly windows to the plan's usage limit. The
 * Fable week lifts on its OWN reset rather than the plan-wide one, because it is its own weekly budget and strands
 * its own points, and it carries the same usage limit as the plan-wide week.
 *
 * An `all-models` spawn is never excluded for a spent Fable window: a plan refusing every Fable seat is a
 * perfectly good home for an Opus worker. A `fable` spawn's plan-wide week bars the seat at the routing bar whatever
 * the Fable week reads, the last five hours included, and so does the chair's Fable week ({@link gatingWindows}).
 *
 * @param chair whether this spawn seats the supervisor chair, whose Fable week loses the last-five-hours lift too
 * @param gauge the plan's reading, carrying its allowance and usage limit
 * @param modelClass which budget the spawn will spend
 * @param thresholds the install's Claude thresholds, off the register
 * @returns the typed exclusion, or undefined when the plan is eligible
 */
export function planExcludedBy({
  chair,
  gauge,
  modelClass,
  thresholds,
}: {
  chair?: boolean;
  gauge: ClaudePlanGauge;
  modelClass: ClaudeModelClass;
  thresholds: ClaudeThresholds;
}): ClaudeExclusion | undefined {
  const notMeasured = monthlyGaugeExclusion({ plan: gauge });
  if (notMeasured !== undefined) {
    return notMeasured;
  }
  const gates = gatingWindows({ chair: chair === true, gauge, modelClass, thresholds });
  const exclusions = gates.flatMap(({ label, thresholds: bars, window }) => {
    if (window === undefined) {
      return [];
    }
    const excluded = claudeWindowExclusion({
      alias: gauge.alias,
      claim: label,
      observedAtIso: gauge.observedAtIso,
      thresholds: bars,
      usageLimitPercent: gauge.usageLimitPercent,
      window,
    });
    return excluded === undefined ? [] : [excluded];
  });
  return strictestExclusion({ exclusions });
}

/** The earlier of two reset instants, ISO-8601 strings comparing lexicographically. */
function earlier({ left, right }: { left: string; right: string }): string {
  return left < right ? left : right;
}

/**
 * The key a FABLE spawn ranks a measured plan on.
 *
 * Primary is the BINDING headroom: the lesser of the Fable week's and the plan-wide week's
 * headroom to reset (`headroom.ts`'s `bindingFableHeadroom`), because a Fable seat walls on whichever of the two runs out first. Ranked on the Fable
 * week alone, plan-two's 53 points of Fable headroom outranked every plan while its plan-wide week sat 4 points
 * from the wall ({@link fableSeatThresholds}, under which the plan-wide week is lined up here). Second
 * is the gap, which on a tie prefers the plan whose Fable week is furthest BEHIND its plan-wide week — the capacity
 * most at risk of stranding, and therefore the one to spend first. The chair's Fable week is lined up under
 * {@link fableSeatThresholds} as well, exactly as it is gated.
 *
 * @param chair whether this spawn seats the supervisor chair
 * @param gauge the plan's reading, which must carry a Fable window
 * @param thresholds the install's Claude thresholds
 * @returns the sort key
 */
function fableKey({
  chair,
  gauge,
  thresholds,
}: {
  chair: boolean;
  gauge: ClaudePlanGauge;
  thresholds: ClaudeThresholds;
}): SortKey {
  const fable = gauge.sevenDayFable!;
  return [
    -bindingFableHeadroom({ chair, gauge, thresholds }),
    fable.utilization - gauge.sevenDay.utilization,
    ...fiveHourRankKey({ gauge }),
    earlier({ left: fable.resetAtIso, right: gauge.sevenDay.resetAtIso }),
  ];
}

/**
 * The key an ALL-MODELS spawn ranks on when every eligible plan carried a Fable reading.
 *
 * Second key is the mirror of {@link fableKey}'s: it prefers a plan whose plan-wide week is behind its
 * Fable week, letting ordinary work catch that plan up rather than widening the gap.
 *
 * @param gauge the plan's reading, which must carry a Fable window
 * @param thresholds the install's Claude thresholds
 * @returns the sort key
 */
function allModelsKey({ gauge, thresholds }: { gauge: ClaudePlanGauge; thresholds: ClaudeThresholds }): SortKey {
  return [
    -weekHeadroom({ gauge, thresholds }),
    gauge.sevenDay.utilization - gauge.sevenDayFable!.utilization,
    ...fiveHourRankKey({ gauge }),
    gauge.sevenDay.resetAtIso,
  ];
}

/**
 * The key used when Fable coverage is incomplete, so no cross-window term is available.
 *
 * Dropping the cross-window key for the WHOLE comparison rather than per pair is deliberate: a key present
 * on some pairs and absent on others is not a total order, and a sort over a non-transitive comparator
 * produces an arbitrary result that looks deterministic.
 *
 * @param gauge the plan's reading
 * @param thresholds the install's Claude thresholds
 * @returns the sort key
 */
function weeklyKey({ gauge, thresholds }: { gauge: ClaudePlanGauge; thresholds: ClaudeThresholds }): SortKey {
  return [-weekHeadroom({ gauge, thresholds }), ...fiveHourRankKey({ gauge }), gauge.sevenDay.resetAtIso];
}

/**
 * Rank every configured plan for one spawn.
 *
 * @param gauges every plan's reading paired with its usage policy, in configured order — which survives as the
 *   final tie-break
 * @param modelClass which budget the spawn will spend
 * @param thresholds the install's Claude thresholds, off the register
 * @param chair whether this spawn seats the supervisor chair ({@link planExcludedBy})
 * @returns the eligible plans best first, what was excluded, what was deferred, and which keys were used
 */
export function rankClaudePlans({
  chair,
  gauges,
  modelClass,
  thresholds,
}: {
  chair?: boolean;
  gauges: readonly ClaudePlanGauge[];
  modelClass: ClaudeModelClass;
  thresholds: ClaudeThresholds;
}): ClaudePlanRanking {
  const isChair = chair === true;
  const excluded = gauges
    .map((gauge) => planExcludedBy({ chair: isChair, gauge, modelClass, thresholds }))
    .filter((exclusion): exclusion is ClaudeExclusion => exclusion !== undefined);
  const barred = new Set(excluded.map((exclusion) => exclusion.alias));
  const eligible = gauges.filter((gauge) => !barred.has(gauge.alias));

  if (modelClass === "fable") {
    // An unmeasured plan ranks on its plan-wide week alone, lined up as a Fable seat's is gated.
    const seat = fableSeatThresholds({ thresholds });
    const measured = eligible.filter((gauge) => gauge.sevenDayFable !== undefined);
    const unmeasured = eligible.filter((gauge) => gauge.sevenDayFable === undefined);
    if (measured.length > 0) {
      return {
        basis: "full",
        deferredUnmeasured: unmeasured.map((gauge) => gauge.alias),
        excluded,
        ranked: [
          ...rankBy({ key: (gauge) => fableKey({ chair: isChair, gauge, thresholds }), pool: measured }),
          ...rankBy({ key: (gauge) => weeklyKey({ gauge, thresholds: seat }), pool: unmeasured }),
        ],
      };
    }
    return {
      basis: "weekly-fallback",
      deferredUnmeasured: unmeasured.map((gauge) => gauge.alias),
      excluded,
      ranked: rankBy({ key: (gauge) => weeklyKey({ gauge, thresholds: seat }), pool: unmeasured }),
    };
  }

  const everyPlanCarriesFable = eligible.length > 0 && eligible.every((gauge) => gauge.sevenDayFable !== undefined);
  const key = everyPlanCarriesFable ? allModelsKey : weeklyKey;
  return {
    basis: "full",
    deferredUnmeasured: [],
    excluded,
    ranked: rankBy({ key: (gauge) => key({ gauge, thresholds }), pool: eligible }),
  };
}

/**
 * How close to the chair route another plan must sit to count as LEVEL with it: one whole percent of a week, the
 * resolution the tick reads a plan at. Two plans closer than that are a near-tie the next reading can flip, so a
 * chair seated on one is not handed to the other. The week simulation is the witness that it strands nothing
 * (`yarn vitest run --config config/vitest/unit.ts src/__tests__/unit/claude/routingSpreadSimulation.test.ts`).
 */
export const CHAIR_LEVEL_BAND = 0.01;

/**
 * The slack a headroom gap is compared to {@link CHAIR_LEVEL_BAND} with, so a plan EXACTLY one point behind the route
 * counts as level: each headroom is a float subtraction, and two plans 74% and 75% through the same window read a gap
 * of `0.010000000000000009` (`node -e 'const x=0.6993865030674846; console.log((x-0.74)-(x-0.75))'`). Far below the
 * hundredth of a percent any reading carries, so it widens the band by nothing a gauge can see.
 */
const LEVEL_TOLERANCE = 1e-9;

/**
 * Every OTHER plan a chair spawn could take whose binding Fable headroom sits within {@link CHAIR_LEVEL_BAND} of the
 * chair route's: a plan the router counts as level with that route. The chair's cadence keeps a chair seated on one
 * of them (`../supervisor/chairCadenceBudget.ts`), so a spawn and its own first close agree on the plan.
 *
 * MEASURED, on one chair: routed to plan-one at 87% of its week, 5.9 points behind its level line against
 * plan-three's 5.6, and told to hand off at its first close, one tick later, when one point of its
 * own draw moved the route to plan-three — a boot of about 167k of context for under a point of balance. Ranking the
 * chair's SPAWN off a plan past the alert bar instead was tried and refused on evidence: inside a one-point band it
 * nearly doubled the week simulation's final Fable spread and saved no handoff, and at two points it broke the
 * drifting band. Reproduce the incident:
 * `yarn vitest run --config config/vitest/unit.ts src/__tests__/unit/claude/chairHandOffLineRoute.test.ts`.
 *
 * @param gauges every plan's reading, in configured order
 * @param route the plan the chair spawn routes to
 * @param thresholds the install's Claude thresholds
 * @returns the level plans' aliases in configured order, empty when the route stands alone or is unmeasured
 */
export function chairLevelWith({
  gauges,
  route,
  thresholds,
}: {
  gauges: readonly ClaudePlanGauge[];
  route: string;
  thresholds: ClaudeThresholds;
}): readonly string[] {
  const ranking = rankClaudePlans({ chair: true, gauges, modelClass: "fable", thresholds });
  const measured = ranking.ranked.filter((gauge) => gauge.sevenDayFable !== undefined);
  const routed = measured.find((gauge) => gauge.alias === route);
  if (routed === undefined) {
    return [];
  }
  const routeHeadroom = bindingFableHeadroom({ chair: true, gauge: routed, thresholds });
  const level = new Set(
    measured
      .filter((gauge) => gauge.alias !== route)
      .filter(
        (gauge) =>
          routeHeadroom - bindingFableHeadroom({ chair: true, gauge, thresholds }) <=
          CHAIR_LEVEL_BAND + LEVEL_TOLERANCE,
      )
      .map((gauge) => gauge.alias),
  );
  return gauges.filter((gauge) => level.has(gauge.alias)).map((gauge) => gauge.alias);
}

/**
 * One plan a routing pass may land a spawn on: a weekly-window plan with the gauge it was ranked on, or a
 * monthly-spend plan with the open spend verdict it was admitted on.
 *
 * @internal — the element of {@link ClaudeBudgetRanking}'s `ranked`; `routeSpawn.ts` carries the first one.
 */
export type ClaudeRankedPlan =
  | { readonly lane: "weekly-window"; readonly alias: ClaudeAccountAlias; readonly gauge: ClaudePlanGauge }
  | { readonly lane: "monthly-spend"; readonly alias: ClaudeAccountAlias; readonly spend: ClaudeOpenSpend };

/**
 * What a ranking pass over BOTH lanes concluded.
 *
 * @internal — the value {@link rankClaudeBudgets} returns.
 */
export interface ClaudeBudgetRanking extends Omit<ClaudePlanRanking, "ranked"> {
  /** Every eligible plan, best first: the weekly lane, then the monthly lane. Empty when none can take this spawn. */
  readonly ranked: readonly ClaudeRankedPlan[];
}

/**
 * Rank every configured plan for one spawn, across both allowance lanes.
 *
 * The weekly lane is {@link rankClaudePlans}, unchanged. The monthly lane follows it: a `monthly-spend` plan is
 * judged on its recorded spend (`select.ts`'s `claudeSpendExclusion`) and ordered by `rankMonthlySpends`. It is a
 * FALLBACK, and that is a product-policy assumption rather than provider evidence: there is no measured exchange
 * rate between a plan-week and dollars at API rates, so no key mixes the lanes, and spending dollars while paid-for
 * subscription capacity is eligible is the one order that cannot be the owner's. A monthly plan has no Fable week,
 * so its verdict is the same for either model class.
 *
 * @param gauges every weekly-window plan's reading, in configured order; a monthly-spend plan's gauge is ignored
 * @param spends every unpaused monthly-spend plan's spend verdict, in configured order
 * @param modelClass which budget the spawn will spend
 * @param thresholds the install's Claude thresholds, off the register
 * @param chair whether this spawn seats the supervisor chair ({@link planExcludedBy})
 * @returns the eligible plans best first, what was excluded, what was deferred, and which keys the weekly lane used
 */
export function rankClaudeBudgets({
  chair,
  gauges,
  modelClass,
  spends,
  thresholds,
}: {
  chair?: boolean;
  gauges: readonly ClaudePlanGauge[];
  modelClass: ClaudeModelClass;
  spends: readonly ClaudePlanSpend[];
  thresholds: ClaudeThresholds;
}): ClaudeBudgetRanking {
  const weekly = rankClaudePlans({ chair: chair === true, gauges: weeklyLane({ gauges }), modelClass, thresholds });
  const monthlyExcluded = spends
    .map((spend) => claudeSpendExclusion({ spend }))
    .filter((exclusion): exclusion is ClaudeExclusion => exclusion !== undefined);
  return {
    ...weekly,
    excluded: [...weekly.excluded, ...monthlyExcluded],
    ranked: [
      ...weekly.ranked.map((gauge): ClaudeRankedPlan => ({ alias: gauge.alias, gauge, lane: "weekly-window" })),
      ...rankMonthlySpends({ spends }).map((spend): ClaudeRankedPlan => ({
        alias: spend.alias,
        lane: "monthly-spend",
        spend,
      })),
    ],
  };
}

/**
 * How the fleet scores against the owner's own acceptance test.
 *
 * The test: if a limit is hit on any plan, every plan shows at least 90% usage on Fable and Weekly, because
 * otherwise the fleet is not load balancing well.
 *
 * ## Why it refuses to grade a partly-readable fleet
 *
 * The test is a statement about ALL the plans, so it cannot be evaluated over the subset that happen to hold
 * a login. A plan with no login yields no gauge at all, so scoring only what is readable would report a
 * shortfall list that LOOKS like a balance verdict while actually being a sign-in census — measured, one plan of three was readable, and grading that would have named the single live plan as the
 * fleet's problem while saying nothing about the two that were not there. So a fleet with fewer readings
 * than configured plans grades `unmeasurable`, in the same spirit as a one-plan spread refusing to call
 * itself balanced.
 *
 * ## And why "no limit hit" is not a pass
 *
 * The criterion is CONDITIONAL: it says what the owner expects to see IF a limit is hit. A fleet that has not hit
 * one has not satisfied the test, it has not triggered it. Reporting that as `met` would claim evidence the
 * fleet has not yet produced.
 *
 * @param configured how many plans are configured — the denominator the all-plans test names
 * @param gauges every READABLE plan's reading
 * @param thresholds the install's Claude thresholds, whose `acceptanceAt` is the bar
 * @returns the verdict, the readable-over-configured count, and which plans fall short when it can grade
 */
export function acceptanceShortfall({
  configured,
  gauges,
  thresholds,
}: {
  configured: number;
  gauges: readonly ClaudeAccountGauge[];
  thresholds: ClaudeThresholds;
}): {
  readonly verdict: "unmeasurable" | "not-triggered" | "met" | "short";
  readonly readable: number;
  readonly configured: number;
  readonly anyPlanAtLimit: boolean;
  /** The bar graded against, as a whole percent — what the rendered line names. */
  readonly barPercent: number;
  readonly shortOfBar: readonly ClaudeAccountAlias[];
} {
  const bar = thresholds.acceptanceAt;
  const atLimit = gauges.some(
    (gauge) =>
      gauge.sevenDay.status === "rejected" ||
      gauge.sevenDay.utilization >= 1 ||
      gauge.sevenDayFable?.status === "rejected" ||
      absentAsNumber({ value: gauge.sevenDayFable?.utilization, whenAbsent: 0 }) >= 1,
  );
  const short = gauges
    .filter((gauge) => gauge.sevenDay.utilization < bar || fableShortOfBar({ bar, gauge }))
    .map((gauge) => gauge.alias);
  const base = {
    anyPlanAtLimit: atLimit,
    barPercent: Math.round(bar * 100),
    configured,
    readable: gauges.length,
    shortOfBar: short,
  };
  if (gauges.length < configured || gauges.length === 0) {
    return { ...base, verdict: "unmeasurable" };
  }
  if (!atLimit) {
    return { ...base, verdict: "not-triggered" };
  }
  return { ...base, verdict: short.length === 0 ? "met" : "short" };
}

/**
 * Whether one plan's Fable week falls short of the acceptance bar.
 *
 * An UNREAD Fable window counts as short, deliberately: the test asks to see the bar reached on all the plans,
 * and a window nobody measured has not been seen at all.
 *
 * @param bar the acceptance bar, a fraction
 * @param gauge the plan's reading
 * @returns true when the Fable week is unread or below the bar
 */
function fableShortOfBar({ bar, gauge }: { bar: number; gauge: ClaudeAccountGauge }): boolean {
  return gauge.sevenDayFable === undefined || gauge.sevenDayFable.utilization < bar;
}

/**
 * The line the fleet's acceptance verdict renders as.
 *
 * It is printed on EVERY fleet read rather than only a failing one, for the reason the budget fold line is:
 * a line that appears only when something is wrong is a line nobody has the habit of reading, and this is
 * the one number the owner named as their own success criterion.
 *
 * It renders aliases and percentages only, never an organisation or an email.
 *
 * @param shortfall what {@link acceptanceShortfall} concluded
 * @returns the line to print
 */
export function renderAcceptance({ shortfall }: { shortfall: ReturnType<typeof acceptanceShortfall> }): string {
  const seen = `${String(shortfall.readable)}/${String(shortfall.configured)} plans readable`;
  if (shortfall.verdict === "unmeasurable") {
    return `acceptance: UNMEASURABLE — ${seen}, so the owner's all-plans test has nothing to grade yet`;
  }
  if (shortfall.verdict === "not-triggered") {
    return `acceptance: not triggered — ${seen}, no plan has hit a limit, so the test has not run rather than passed`;
  }
  if (shortfall.verdict === "met") {
    return `acceptance: MET — a limit was hit with every one of ${String(shortfall.configured)} plans at or past ${String(shortfall.barPercent)}% on both windows`;
  }
  return `acceptance: SHORT — a limit was hit while ${shortfall.shortOfBar.join(", ")} sat under ${String(shortfall.barPercent)}% on a window; by the owner's test the load balancing is not working`;
}
