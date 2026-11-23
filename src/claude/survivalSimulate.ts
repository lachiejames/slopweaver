/**
 * Hour by hour, where the fleet's measured demand lands across the plans and whether it ever finds none left.
 * Pure: no clock, no filesystem — the instant is passed in, every plan state is a value.
 *
 * ## `headroom` IS the production router, not a copy of it
 *
 * The owner asked which routing keeps every plan full to its cap, so the simulation has to tell the router the owner
 * runs today apart from an alternative. `headroom` builds one synthetic gauge per open plan per slice and asks
 * `rankClaudePlans` — the function every spawn asks, which spends the plan furthest below its own level line — so
 * a change to the real ranking moves this forecast with it. The two alternatives are the only routing
 * arithmetic invented here: `least-used` spends the plan with the least of its week drawn, the level-only rule
 * production once ran, and `earliest-reset` spends the plan whose unspent week is lost soonest.
 *
 * ## One plan cannot absorb the fleet in an hour
 *
 * A plan's five-hour window caps how fast its week can be drawn. MEASURED across the journal,
 * one full five-hour window is worth 0.19 to 0.25 of a plan's week. Each state carries that ceiling as
 * `absorbPerHour`, measured per run (`./survivalForecast.ts`), so a fleet left with one open plan is
 * throttled rather than flattered.
 *
 * ## What this model is not
 *
 * Demand is split into slices each hour and every slice is routed afresh. Real seats are STICKY — a spawn's
 * plan is fixed for the seat's life, and the chair moves only on a handoff — so this is the best placement each
 * rule could achieve. Read its error with a backtest: `slopweaver claude forecast --now <a past instant>`.
 * The Fable week is not simulated, because its share of demand is not measured. Which dry hours form one
 * spell, and what ended it, is `./survivalSpells.ts`. It is a historical trend: the measured demand repeated,
 * never a prediction.
 *
 * ## Every plan stops at its EFFECTIVE ceiling, never past the owner's limit
 *
 * A plan is spent to `claudeEffectiveUsageCeiling` — the house bar, lowered to the owner's usage limit — in both
 * the room arithmetic and the gauge `headroom` ranks, so the two cannot disagree. A limit the owner sets is respected even if it means taking the fleet down.
 * So a 50% plan closes at 50% even in its week's last five hours: the house rule lifts the HOUSE bar there, and the
 * lift never raises a plan past its limit (a 90% plan under an 80% bar rises to 90%, never above). An hour whose
 * demand finds every plan at its ceiling is DRY however much nominal allowance sits above a limit. The room
 * arithmetic, and the exact comparison it keeps with routing, is `./survivalRoom.ts`. What a reset STRANDS is owner-authorised capacity left unspent — up to that
 * ceiling, never the forbidden remainder above it, which no router was allowed to take.
 */
import type { ClaudeThresholds } from "../plans/thresholds.js";
import { WEEKLY_WINDOW } from "../plans/usageLimit.js";
import type { ClaudePlanGauge } from "./contracts.js";
import { rankClaudePlans } from "./loadBalance.js";
import { insideSpendOut } from "./select.js";
import type { SurvivalPlanState } from "./survivalPlanState.js";
import { EPSILON, isoAt, type LivePlan, roomOf, take, weeklyCeilingAt } from "./survivalRoom.js";
import { type DrySpell, finishSpells, newSpellTracker, spellRunning, trackHour } from "./survivalSpells.js";

/** Which rule sends the next slice of demand to a plan. */
export type SurvivalRouter = "least-used" | "earliest-reset" | "headroom";

/** The router every spawn runs today: `rankClaudePlans` itself. */
export const TODAYS_ROUTER: SurvivalRouter = "headroom";

/** Every router the forecast compares, today's first. */
export const SURVIVAL_ROUTERS: readonly SurvivalRouter[] = [TODAYS_ROUTER, "least-used", "earliest-reset"];

/**
 * One plan reaching its effective ceiling outside its week's spend-out hours, before its own reset.
 *
 * @internal
 */
export interface EarlyCap {
  readonly alias: string;
  readonly atIso: string;
  readonly hoursBeforeReset: number;
}

/** What one simulated week looked like. */
export interface WeekOutcome {
  readonly weekStartIso: string;
  /** Hours that left demand over with every plan's week at its effective ceiling. */
  readonly dryHours: number;
  /** Plan-weeks of demand no plan could take — dry hours and five-hour throttling together. */
  readonly unmetPlanWeeks: number;
  readonly earlyCaps: readonly EarlyCap[];
  /** Owner-authorised plan-weeks left unspent at the resets inside this week — never the share above a limit. */
  readonly strandedPlanWeeks: number;
}

/** One router's whole simulation. */
export interface SimulationOutcome {
  readonly router: SurvivalRouter;
  readonly weeks: readonly WeekOutcome[];
  /**
   * Every dry spell that STARTS inside the horizon, in order, each followed to its end even past the horizon.
   * All of them, not the first: a short spell early in the week must not hide a long one after it.
   */
  readonly drySpells: readonly DrySpell[];
}

const HOUR_MS = 3_600_000;
const HOURS_PER_WEEK = 7 * 24;
const WEEK_MS = HOURS_PER_WEEK * HOUR_MS;
/** How many slices each hour's demand is routed in — enough that no single slice decides a plan's cap. */
const SLICES_PER_HOUR = 12;

/** The whole fleet at one instant under the install's thresholds: what each per-hour judgement below reads. */
interface FleetAt {
  readonly plans: readonly LivePlan[];
  readonly atMs: number;
  readonly thresholds: ClaudeThresholds;
}

/**
 * A live plan as the gauge a spawn would read: the Ultra shape, with no five-hour window, which leaves the
 * hourly ceiling to `roomOf`. It carries the plan's own usage limit, so `rankClaudePlans` ranks against the
 * same ceiling `weeklyCeilingAt` gives the room arithmetic.
 */
function syntheticGauge({ plan, atMs }: { plan: LivePlan; atMs: number }): ClaudePlanGauge {
  return {
    alias: plan.alias,
    allowance: WEEKLY_WINDOW,
    observedAtIso: isoAt({ ms: atMs }),
    usageLimitPercent: plan.usageLimitPercent,
    sevenDay: { resetAtIso: isoAt({ ms: plan.resetMs }), status: "allowed", utilization: plan.utilization },
  };
}

/** One router: the best plan for the next slice, among those still able to take one. */
type RouterFn = (options: { plans: readonly LivePlan[]; atMs: number; thresholds: ClaudeThresholds }) => LivePlan;

const ROUTERS: Readonly<Record<SurvivalRouter, RouterFn>> = {
  "earliest-reset": ({ plans }) => plans.toSorted((left, right) => left.resetMs - right.resetMs)[0]!,
  "least-used": ({ plans }) =>
    plans.toSorted((left, right) => left.utilization - right.utilization || left.resetMs - right.resetMs)[0]!,
  headroom: ({ plans, atMs, thresholds }) => {
    // Every plan passed in has room under the same effective ceiling the ranker applies, so it ranks at least one.
    const best = rankClaudePlans({
      gauges: plans.map((plan) => syntheticGauge({ atMs, plan })),
      modelClass: "all-models",
      thresholds,
    }).ranked[0]!;
    return plans.find((plan) => plan.alias === best.alias)!;
  },
};

/** Route one hour's demand, returning the plan-weeks no plan could take. */
function routeHour({
  plans,
  demand,
  router,
  atMs,
  thresholds,
}: {
  plans: readonly LivePlan[];
  demand: number;
  router: SurvivalRouter;
  atMs: number;
  thresholds: ClaudeThresholds;
}): number {
  let unmet = 0;
  for (let slice = 0; slice < SLICES_PER_HOUR; slice += 1) {
    let left = demand / SLICES_PER_HOUR;
    let open = plans.filter((plan) => roomOf({ atMs, plan, thresholds }) > 0);
    while (left > 0 && open.length > 0) {
      const chosen = ROUTERS[router]({ atMs, plans: open, thresholds });
      const room = roomOf({ atMs, plan: chosen, thresholds });
      // A slice that overshoots the room only by this simulator's own float drift is wholly taken, so no residue
      // of rounding is ever counted as unmet demand.
      const taken = left <= room + EPSILON ? left : room;
      take({ amount: taken, atMs, plan: chosen, thresholds });
      left -= taken;
      open = open.filter((plan) => roomOf({ atMs, plan, thresholds }) > 0);
    }
    unmet += left;
  }
  return unmet;
}

/**
 * Roll every plan whose reset has arrived, returning the owner-authorised plan-weeks each one stranded: what sat
 * between its spend and its HARD stop — the whole week on an unlimited plan, the usage limit on a limited one —
 * never the remainder above a limit, which no router was allowed to take. The house bar plays no part: it is a
 * routing setting, and the allowance under the provider's wall is what a reset throws away.
 */
function rollResets({ plans, atMs }: FleetAt): number {
  let stranded = 0;
  for (const plan of plans) {
    while (plan.resetMs <= atMs) {
      const hardStop = Math.min(1, plan.usageLimitPercent / 100);
      stranded += Math.max(0, hardStop - plan.utilization);
      plan.utilization = 0;
      plan.resetMs += WEEK_MS;
      plan.cappedThisCycle = false;
      plan.rolledAtMs = atMs;
    }
  }
  return stranded;
}

/**
 * Every plan that newly sat at its effective ceiling this hour, early. Where the house bar binds, that is a cap at the
 * UNLIFTED route bar, exactly as before limits existed; where the usage limit binds, it is one reached outside the
 * week's spend-out hours, since a limit is never raised and a week about to reset is no early cap.
 */
function newEarlyCaps({ plans, atMs, thresholds }: FleetAt): readonly EarlyCap[] {
  const caps: EarlyCap[] = [];
  for (const plan of plans) {
    const ceiling = weeklyCeilingAt({ atMs, plan, thresholds });
    if (plan.cappedThisCycle || plan.utilization < ceiling.utilization) {
      continue;
    }
    plan.cappedThisCycle = true;
    const observedAtIso = isoAt({ ms: atMs });
    const resetAtIso = isoAt({ ms: plan.resetMs });
    const early =
      ceiling.source === "routing-bar"
        ? ceiling.utilization === thresholds.routeAt
        : !insideSpendOut({ claim: "seven_day", observedAtIso, resetAtIso, thresholds });
    if (early) {
      const hoursBeforeReset = Math.round((plan.resetMs - atMs) / HOUR_MS);
      caps.push({ alias: plan.alias, atIso: observedAtIso, hoursBeforeReset });
    }
  }
  return caps;
}

/** Whether every plan's week sits at its effective ceiling. */
function everyPlanSpent({ plans, atMs, thresholds }: FleetAt): boolean {
  return plans.every((plan) => roomOf({ atMs, plan: { ...plan, takenThisHour: 0 }, thresholds }) <= 0);
}

/** A plan state as a mutable simulation plan. */
function livePlanOf({ state }: { state: SurvivalPlanState }): LivePlan {
  return {
    absorbPerHour: state.absorbPerHour,
    alias: state.alias,
    cappedThisCycle: false,
    resetMs: Date.parse(state.resetAtIso),
    rolledAtMs: undefined,
    takenThisHour: 0,
    usageLimitPercent: state.usageLimitPercent,
    utilization: state.utilization,
  };
}

/** One simulated hour: what it stranded, left unmet, capped early, and whether it was dry. */
interface HourOutcome {
  readonly stranded: number;
  readonly unmet: number;
  readonly earlyCaps: readonly EarlyCap[];
  readonly dry: boolean;
}

/**
 * Run one hour: roll the resets that arrived, route the hour's demand, and judge it.
 *
 * An hour is DRY when demand was left over AND every plan's week sat at its effective ceiling by its end. Left over
 * with a plan still open is five-hour throttling, which some seat can still ride; every plan at its cap with
 * the hour's demand all served is the hour BEFORE a dry one, and at zero demand no hour is dry at all.
 *
 * @param plans the fleet, mutated in place
 * @param demand plan-weeks arriving this hour
 * @param router which rule routes each slice
 * @param atMs this hour's instant
 * @param thresholds the install's Claude thresholds, which set every plan's cap
 * @returns the hour's outcome
 */
function stepHour({
  plans,
  demand,
  router,
  atMs,
  thresholds,
}: {
  plans: readonly LivePlan[];
  demand: number;
  router: SurvivalRouter;
  atMs: number;
  thresholds: ClaudeThresholds;
}): HourOutcome {
  const stranded = rollResets({ atMs, plans, thresholds });
  for (const plan of plans) {
    plan.takenThisHour = 0;
  }
  const unmet = routeHour({ atMs, demand, plans, router, thresholds });
  const earlyCaps = newEarlyCaps({ atMs, plans, thresholds });
  return { dry: unmet > 0 && everyPlanSpent({ atMs, plans, thresholds }), earlyCaps, stranded, unmet };
}

/** A week's running totals. */
interface WeekTally {
  dryHours: number;
  unmet: number;
  stranded: number;
  readonly earlyCaps: EarlyCap[];
}

/**
 * Simulate the fleet under one router for a number of weeks at a constant demand.
 *
 * A spell still open when the horizon ends is followed for up to one more week, untallied, so its length and
 * end are the model's and not the horizon's: a card keyed on where a spell ends must not move every pass.
 *
 * @param states every unpaused plan's starting observation
 * @param demandPerHour plan-weeks of demand arriving each hour
 * @param router which rule routes each slice
 * @param nowIso the instant the simulation starts at
 * @param weeks how many weeks to run
 * @param thresholds the install's Claude thresholds, which set every plan's cap and its spend-out hours
 * @returns each week's outcome and every dry spell starting inside the horizon
 */
export function simulateFleet({
  states,
  demandPerHour,
  router,
  nowIso,
  weeks,
  thresholds,
}: {
  states: readonly SurvivalPlanState[];
  demandPerHour: number;
  router: SurvivalRouter;
  nowIso: string;
  weeks: number;
  thresholds: ClaudeThresholds;
}): SimulationOutcome {
  const startMs = Date.parse(nowIso);
  const plans = states.map((state) => livePlanOf({ state }));
  const tallies: WeekTally[] = Array.from({ length: weeks }, () => ({
    dryHours: 0,
    earlyCaps: [],
    stranded: 0,
    unmet: 0,
  }));
  const tracker = newSpellTracker({ spendOutBeforeResetMs: thresholds.spendOutBeforeResetMs });
  const horizonHours = weeks * HOURS_PER_WEEK;
  for (let hour = 0; hour < horizonHours + HOURS_PER_WEEK; hour += 1) {
    if (hour >= horizonHours && !spellRunning({ tracker })) {
      break;
    }
    const atMs = startMs + hour * HOUR_MS;
    const outcome = stepHour({ atMs, demand: demandPerHour, plans, router, thresholds });
    const tally = tallies[Math.floor(hour / HOURS_PER_WEEK)];
    if (tally !== undefined) {
      tally.stranded += outcome.stranded;
      tally.unmet += outcome.unmet;
      tally.earlyCaps.push(...outcome.earlyCaps);
      tally.dryHours += outcome.dry ? 1 : 0;
    }
    trackHour({ atMs, dry: outcome.dry, mayOpen: hour < horizonHours, plans, tracker });
  }
  return {
    drySpells: finishSpells({ plans, stoppedAtMs: startMs + (horizonHours + HOURS_PER_WEEK) * HOUR_MS, tracker }),
    router,
    weeks: tallies.map((tally, index) => ({
      dryHours: tally.dryHours,
      earlyCaps: tally.earlyCaps,
      strandedPlanWeeks: tally.stranded,
      unmetPlanWeeks: tally.unmet,
      weekStartIso: isoAt({ ms: startMs + index * WEEK_MS }),
    })),
  };
}

/**
 * The highest constant demand one router carries through the horizon with no dry hour, found by bisection.
 *
 * One number is sturdier than one forecast: measured demand sits within a few percent of what five plans
 * hold, so a single run flips on small measurement error while this line says how much room there is.
 *
 * @param states every unpaused plan's starting observation
 * @param router which rule routes each slice
 * @param nowIso the instant the simulation starts at
 * @param weeks how many weeks the demand must be carried
 * @param thresholds the install's Claude thresholds, which set every plan's cap
 * @returns plan-weeks per hour, to within a fraction of a percent of the fleet's capacity
 */
export function breakEvenDemand({
  states,
  router,
  nowIso,
  weeks,
  thresholds,
}: {
  states: readonly SurvivalPlanState[];
  router: SurvivalRouter;
  nowIso: string;
  weeks: number;
  thresholds: ClaudeThresholds;
}): number {
  let low = 0;
  let high = (2 * states.length) / HOURS_PER_WEEK;
  for (let step = 0; step < 12; step += 1) {
    const mid = (low + high) / 2;
    const outcome = simulateFleet({ demandPerHour: mid, nowIso, router, states, thresholds, weeks });
    if (outcome.drySpells.length === 0) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return low;
}
