/**
 * The survival HISTORICAL TREND: the measured burn run forward against every plan's reset clock and usage limit.
 * Pure: samples and an instant in, a trend out. The journal read is `./drawdownJournalStore.ts`.
 *
 * ## The ask it answers, and why it is a trend and never a fact
 *
 * The owner wants confidence the fleet is on track to survive at all times over the coming months, with
 * capacity maxed where feasible, and no further plan: squeeze the most out of the existing plans. So this answers, from the drawdown journal the watch already writes every five minutes:
 * if the demand the fleet drew keeps repeating, would every plan reach its effective ceiling before a reset, when,
 * and which reset would end it — under today's router and under the two alternatives `./survivalSimulate.ts`
 * compares. It is history repeated, so every result carries `basis: "historical trend"` and every sentence built
 * from it is conditional. What the fleet drew, and why a misread alias is dropped before it is measured, is
 * `./survivalDemand.ts`, whose censored-hour test judges each plan at its effective ceiling too, so a 50% plan sitting
 * at 50% hides demand exactly as an unlimited one at the route bar does.
 *
 * ## A plan's state is its latest observation, never an assumed weekly repeat
 *
 * Each plan starts from its own newest sample. A plan whose newest sample is stale, or that has none, is
 * `unmeasurable` rather than guessed; one whose fresh newest sample's week has reset since it was read starts a
 * fresh week at that reset, because the reset to zero is the provider's rule (`currentWeekOf`).
 */
import type { ClaudeThresholds } from "../plans/thresholds.js";
import type { DrawdownSample } from "./drawdownAnomaly.js";
import { drawByPlan, type FleetDemand, measureDemand, withoutMisreadSeries } from "./survivalDemand.js";
import { type OwnPace, ownPaceProjection } from "./survivalOwnPace.js";
import type { SurvivalPlanInput, SurvivalPlanState } from "./survivalPlanState.js";
import {
  breakEvenDemand,
  type SimulationOutcome,
  SURVIVAL_ROUTERS,
  type SurvivalRouter,
  simulateFleet,
  TODAYS_ROUTER,
} from "./survivalSimulate.js";
import {
  currentWeekOf,
  FORECAST_STALE_AFTER_MS,
  msOf,
  newestOf,
  newestOfAnyAge,
  rolledForward,
  WEEK_MS,
} from "./survivalWeek.js";

/** Which demand figure the simulation is run at. */
export type DemandBasis = "trailing" | "peak";

/** What every trend is: the measured burn repeated, labelled so no reader takes it for a fact about the future. */
const SURVIVAL_FORECAST_BASIS = "historical trend" as const;

/**
 * A paused plan, still counted: what it is out for, and where its week stands at its last reading.
 *
 * Every configured plan is accounted for; none is excluded. A paused plan is not probed (`../cli/commands/claude/watchPlans.ts`), so its newest sample may be days old —
 * but nothing spends a paused plan either, so that sample rolled forward is where it stands: a reset since then
 * opened a fresh, unspent week (`rolled`). That is an estimate, and labelled one. What it cannot see is a pause
 * that IS the plan being unusable (a lapsed subscription), which is why a paused plan is never simulated as
 * spendable — its {@link ResumeScenario} only says what resuming it would buy.
 *
 * @internal -- a member of {@link SurvivalForecast}'s `paused`, which is what every caller reads; nothing names this
 */
export interface PausedPlanState {
  readonly alias: string;
  readonly reason: string;
  readonly sinceIso: string;
  /**
   * `observed` — its newest sample's week is still open; `rolled` — that week has reset since, so it is placed at a
   * fresh week; `unread` — the journal never read it, so where it stands and when it resets are unknown;
   * `misread` — the journal did read it, but every weekly reading shared another plan's reset instant and was
   * dropped as that account read twice, so where it stands and when it resets are unknown all the same.
   */
  readonly placement: "observed" | "rolled" | "unread" | "misread";
  /** Where its week stands, or `undefined` exactly when it is `unread` or `misread`. */
  readonly state: SurvivalPlanState | undefined;
  /** The usage limit its register row sets, carried even when it is unread, so the forecast still names it. */
  readonly usageLimitPercent: SurvivalPlanInput["usageLimitPercent"];
}

/** Today's router over the spendable plans plus ONE paused plan — what resuming that plan alone would buy. */
interface ResumeScenario {
  readonly alias: string;
  readonly simulation: SimulationOutcome;
}

/** A whole trend. */
export interface SurvivalForecast {
  /** Always `historical trend`: what the figures are, carried in `--json` so the document labels itself. */
  readonly basis: typeof SURVIVAL_FORECAST_BASIS;
  readonly nowIso: string;
  readonly weeks: number;
  readonly demandBasis: DemandBasis;
  readonly demand: FleetDemand;
  /** Every configured plan's alias, paused ones included, in the register's order. */
  readonly aliases: readonly string[];
  /** The plans seats can spend — every one the simulations route to. */
  readonly states: readonly SurvivalPlanState[];
  /** Every paused plan, never dropped: listed with its reason and its last-read week. */
  readonly paused: readonly PausedPlanState[];
  readonly ownPace: readonly OwnPace[];
  readonly simulations: readonly SimulationOutcome[];
  /** One per paused plan the journal placed, in the register's order; an `unread` one has none. */
  readonly resumeScenarios: readonly ResumeScenario[];
  /** Per router, the highest constant demand carried through the horizon with no dry hour. */
  readonly breakEven: readonly { readonly router: SurvivalRouter; readonly planWeeksPerHour: number }[];
  /** The register's Claude thresholds every figure above was judged under, so a reader names the bars it used. */
  readonly thresholds: ClaudeThresholds;
}

/** A forecast, or why none could be made. */
export type SurvivalRead =
  | { readonly kind: "forecast"; readonly forecast: SurvivalForecast }
  | { readonly kind: "unmeasurable"; readonly because: string };

/** Five hours, the span one five-hour window covers. */
const FIVE_HOURS = 5;

/** One paused plan as it is placed: its alias, its pause, and the usage limit a resume would still stop at. */
type PausedInput = Pick<SurvivalPlanInput, "alias" | "usageLimitPercent"> & {
  readonly reason: string;
  readonly sinceIso: string;
};

/**
 * Every plan's starting state, from its newest samples, carrying the usage limit its register row sets.
 *
 * @param samples every journal sample at or before `nowIso`
 * @param plans the configured, unpaused plans, each with its usage limit
 * @param nowIso the instant the trend starts at
 * @param thresholds the install's Claude thresholds, whose route bar sets how much a plan absorbs an hour
 * @returns one state per plan, or the sentence saying which plan could not be placed
 */
export function planStatesFromSamples({
  samples,
  plans,
  nowIso,
  thresholds,
}: {
  samples: readonly DrawdownSample[];
  plans: readonly Pick<SurvivalPlanInput, "alias" | "usageLimitPercent">[];
  nowIso: string;
  thresholds: ClaudeThresholds;
}): { readonly states: readonly SurvivalPlanState[] } | { readonly because: string } {
  const nowMs = msOf({ iso: nowIso });
  const newest = samples.reduce((latest, sample) => Math.max(latest, msOf({ iso: sample.observedAtIso })), 0);
  if (newest === 0 || nowMs - newest > FORECAST_STALE_AFTER_MS) {
    return {
      because:
        "the drawdown journal holds no sample from the last two hours — the gauge watch is not running, " +
        "so there is no current reading to forecast from (`slopweaver claude watch`)",
    };
  }
  const weekDraw = drawByPlan({ samples, window: "seven-day" });
  const fiveHourDraw = drawByPlan({ samples, window: "five-hour" });
  const states: SurvivalPlanState[] = [];
  for (const { alias, usageLimitPercent } of plans) {
    const placed = currentWeekOf({ alias, nowMs, samples });
    if ("because" in placed) {
      return placed;
    }
    const { week } = placed;
    const fable = newestOf({ alias, nowMs, samples, window: "fable-seven-day" });
    states.push({
      absorbPerHour: absorbPerHour({ fiveHour: fiveHourDraw.get(alias), thresholds, week: weekDraw.get(alias) }),
      alias,
      fableResetAtIso: fable === undefined ? undefined : fable.resetAtIso,
      fableUtilization: fable === undefined ? undefined : fable.utilization,
      observedAtIso: week.observedAtIso,
      resetAtIso: week.resetAtIso,
      usageLimitPercent,
      utilization: week.utilization,
    });
  }
  return { states };
}

/**
 * Every paused plan, placed from its newest seven-day sample of any age — never dropped for having none.
 *
 * @param samples every journal sample at or before `nowIso`, less every misread series
 * @param everyRead the same samples before the misread series came out, which tells `misread` from `unread`
 * @param paused the configured plans that are paused, in the register's order, each with its usage limit
 * @param nowIso the instant the trend starts at
 * @param thresholds the install's Claude thresholds, whose route bar sets how much a plan absorbs an hour
 * @returns one row per paused plan, `unread` when the journal never read it, `misread` when it dropped every read
 */
function pausedPlanStates({
  samples,
  everyRead,
  paused,
  nowIso,
  thresholds,
}: {
  samples: readonly DrawdownSample[];
  everyRead: readonly DrawdownSample[];
  paused: readonly PausedInput[];
  nowIso: string;
  thresholds: ClaudeThresholds;
}): readonly PausedPlanState[] {
  const nowMs = msOf({ iso: nowIso });
  const weekDraw = drawByPlan({ samples, window: "seven-day" });
  const fiveHourDraw = drawByPlan({ samples, window: "five-hour" });
  return paused.map(({ alias, reason, sinceIso, usageLimitPercent }): PausedPlanState => {
    const base = { alias, reason, sinceIso, usageLimitPercent };
    const week = newestOfAnyAge({ alias, samples, window: "seven-day" });
    if (week === undefined) {
      const wasRead = newestOfAnyAge({ alias, samples: everyRead, window: "seven-day" }) !== undefined;
      return { ...base, placement: wasRead ? "misread" : "unread", state: undefined };
    }
    const placedWeek = rolledForward({ nowMs, sample: week });
    const fableSample = newestOfAnyAge({ alias, samples, window: "fable-seven-day" });
    const fable = fableSample === undefined ? undefined : rolledForward({ nowMs, sample: fableSample });
    return {
      ...base,
      placement: placedWeek.rolled ? "rolled" : "observed",
      state: {
        absorbPerHour: absorbPerHour({ fiveHour: fiveHourDraw.get(alias), thresholds, week: weekDraw.get(alias) }),
        alias,
        fableResetAtIso: fable === undefined ? undefined : fable.resetAtIso,
        fableUtilization: fable === undefined ? undefined : fable.utilization,
        // The instant it was last READ, never `nowIso`: a rolled week is placed, not observed.
        observedAtIso: week.observedAtIso,
        resetAtIso: placedWeek.resetAtIso,
        usageLimitPercent,
        utilization: placedWeek.utilization,
      },
    };
  });
}

/** How much of its week a plan can take in an hour: one five-hour window's worth of week, at the route bar, over five hours. */
function absorbPerHour({
  fiveHour,
  week,
  thresholds,
}: {
  fiveHour: number | undefined;
  week: number | undefined;
  thresholds: ClaudeThresholds;
}): number | undefined {
  // No weekly draw yet — a plan whose week just opened — measures no ceiling, not a ceiling of zero: a zero would
  // read a plan at 0% as at its cap and forecast the fleet dry around it.
  if (fiveHour === undefined || week === undefined || fiveHour <= 0 || week <= 0) {
    return undefined;
  }
  return (thresholds.routeAt * (week / fiveHour)) / FIVE_HOURS;
}

/** One simulation's inputs bar the router: the spendable plans, the demand, the horizon and the register's bars. */
type FleetRun = Omit<Parameters<typeof simulateFleet>[0], "router">;

/** Today's router over the spendable plans plus each placed paused plan alone; an `unread` one has none. */
function resumeScenariosOf({
  paused,
  run,
}: {
  paused: readonly PausedPlanState[];
  run: FleetRun;
}): readonly ResumeScenario[] {
  return paused.flatMap((row) => {
    if (row.state === undefined) {
      return [];
    }
    const resumed = [...run.states, row.state];
    return [{ alias: row.alias, simulation: simulateFleet({ ...run, router: TODAYS_ROUTER, states: resumed }) }];
  });
}

/** Why a fleet with no spendable plan has nothing to forecast: none configured, or every one paused. */
function noSpendablePlanReason({ paused }: { paused: readonly { alias: string }[] }): string {
  if (paused.length === 0) {
    return "no Claude plan is configured, so there is no fleet to forecast";
  }
  return `every configured Claude plan is paused (${paused.map((plan) => plan.alias).join(", ")}), so no seat can spend one`;
}

/**
 * The whole historical trend: states, demand, each plan's own pace, and every router simulated.
 *
 * Only the spendable plans are simulated, measured for demand or projected at their own pace; every paused plan
 * is listed beside them and, where the journal placed it, gets its own {@link ResumeScenario}. Every plan, paused
 * or not, carries its usage limit into the simulation, so no scenario spends a plan past what the owner allowed.
 *
 * @param samples every journal sample; any after `nowIso` is ignored, so a past instant replays exactly
 * @param plans every configured plan, paused ones included, in the register's order, each with its usage limit
 * @param nowIso the instant the forecast starts at
 * @param weeks how many weeks to simulate
 * @param demandBasis whether to run at the trailing mean or the trailing peak day
 * @param thresholds the install's Claude thresholds, off the register the plans came from
 * @returns the forecast, or why none could be made
 */
export function forecastSurvival({
  samples,
  plans,
  nowIso,
  weeks,
  demandBasis,
  thresholds,
}: {
  samples: readonly DrawdownSample[];
  plans: readonly SurvivalPlanInput[];
  nowIso: string;
  weeks: number;
  demandBasis: DemandBasis;
  thresholds: ClaudeThresholds;
}): SurvivalRead {
  const spendable = plans.filter((plan) => plan.paused === undefined);
  const censorPlans = spendable.map((plan) => ({ alias: plan.alias, usageLimitPercent: plan.usageLimitPercent }));
  const pausedInputs = plans.flatMap((plan): PausedInput[] =>
    plan.paused === undefined ? [] : [{ alias: plan.alias, ...plan.paused, usageLimitPercent: plan.usageLimitPercent }],
  );
  if (censorPlans.length === 0) {
    return { because: noSpendablePlanReason({ paused: pausedInputs }), kind: "unmeasurable" };
  }
  const nowMs = msOf({ iso: nowIso });
  const everyRead = samples.filter((sample) => msOf({ iso: sample.observedAtIso }) <= nowMs);
  const past = withoutMisreadSeries({ samples: everyRead });
  const placed = planStatesFromSamples({ nowIso, plans: spendable, samples: past, thresholds });
  if ("because" in placed) {
    return { because: placed.because, kind: "unmeasurable" };
  }
  // Demand is what the SEATS drew, whichever plan carried it: a plan paused mid-window leaves its seats' draw for the
  // rest to carry, so it stays in. Only the censoring test asks the spendable plans, since a paused plan cannot cap.
  const demand = measureDemand({ nowIso, plans: censorPlans, samples: past, thresholds, windowMs: WEEK_MS });
  const demandPerHour = demandBasis === "peak" ? demand.peakPlanWeeksPerHour : demand.planWeeksPerHour;
  const { states } = placed;
  const paused = pausedPlanStates({ everyRead, nowIso, paused: pausedInputs, samples: past, thresholds });
  const run: FleetRun = { demandPerHour, nowIso, states, thresholds, weeks };
  return {
    forecast: {
      aliases: plans.map((plan) => plan.alias),
      basis: SURVIVAL_FORECAST_BASIS,
      breakEven: SURVIVAL_ROUTERS.map((router) => ({
        planWeeksPerHour: breakEvenDemand({ nowIso, router, states, thresholds, weeks }),
        router,
      })),
      demand,
      demandBasis,
      nowIso,
      ownPace: states.flatMap((state) => ownPaceProjection({ nowIso, state })),
      paused,
      resumeScenarios: resumeScenariosOf({ paused, run }),
      simulations: SURVIVAL_ROUTERS.map((router) => simulateFleet({ ...run, router })),
      states,
      thresholds,
      weeks,
    },
    kind: "forecast",
  };
}
