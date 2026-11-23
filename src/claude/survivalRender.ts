/**
 * `claude forecast`'s text. Pure: a forecast in, lines out.
 *
 * Every line is a HISTORICAL TREND (`SurvivalForecast.basis`) and says so in conditional words — "would survive",
 * "would leave the fleet dry" — never a present-tense claim about the future: the figures are the measured burn
 * repeated, and the owner reads them as a trend, never a fact.
 *
 * Every rate is printed PER DAY in plan-weeks, because that is the unit the owner's own plan pages count in —
 * a plan is one week, five plans hold 5/7 of a week a day — and an hourly figure of 0.028 reads as nothing.
 */
import type { ClaudeThresholds } from "../plans/thresholds.js";
import type { SurvivalForecast } from "./survivalForecast.js";
import type { OwnPace } from "./survivalOwnPace.js";
import { type SimulationOutcome, TODAYS_ROUTER, type WeekOutcome } from "./survivalSimulate.js";
import { type DrySpell, spellEndClause } from "./survivalSpells.js";

/** A fraction as a whole percentage. */
function percent({ fraction }: { fraction: number }): string {
  return `${String(Math.round(fraction * 100))}%`;
}

/** An hourly plan-week rate as a daily one, two places. */
function perDay({ perHour }: { perHour: number }): string {
  return `${(perHour * 24).toFixed(2)}/day`;
}

/** An ISO instant to the minute, the seconds and zone suffix dropped. */
function minute({ iso }: { iso: string }): string {
  return `${iso.slice(0, 16)}Z`;
}

/** One own-pace line. */
function paceLine({ pace }: { pace: OwnPace }): string {
  const window = pace.window === "seven-day" ? "week " : "Fable";
  const head = `  ${pace.alias.padEnd(11)} ${window} ${percent({ fraction: pace.utilization }).padStart(4)}  resets ${minute({ iso: pace.resetAtIso })}`;
  if (pace.wallAtIso === undefined) {
    return `${head}  nothing drawn this week yet`;
  }
  const verdict = pace.capsBeforeReset ? "BEFORE its reset" : "after its reset";
  return `${head}  at its historical pace would wall ${minute({ iso: pace.wallAtIso })}, ${verdict}`;
}

/** One simulated week, on one line. */
function weekLine({ week }: { week: WeekOutcome }): string {
  const worst = week.earlyCaps.toSorted((left, right) => right.hoursBeforeReset - left.hoursBeforeReset)[0];
  const caps =
    worst === undefined
      ? "no plan caps early"
      : `${String(week.earlyCaps.length)} early cap(s), the earliest ${worst.alias} ${String(worst.hoursBeforeReset)}h before its reset`;
  return (
    `    week of ${week.weekStartIso.slice(0, 10)}: dry ${String(week.dryHours)}h, ` +
    `unmet ${week.unmetPlanWeeks.toFixed(2)}, stranded ${week.strandedPlanWeeks.toFixed(2)} plan-weeks; ${caps}`
  );
}

/** One router's block. */
function routerBlock({
  simulation,
  breakEvenPerHour,
  thresholds,
}: {
  simulation: SimulationOutcome;
  breakEvenPerHour: number;
  thresholds: ClaudeThresholds;
}): readonly string[] {
  const today = simulation.router === TODAYS_ROUTER ? " (today's router)" : "";
  const dry =
    simulation.drySpells.length === 0
      ? "no dry hour in the trend"
      : `${String(simulation.drySpells.length)} dry spell(s) in the trend`;
  return [
    `  ${simulation.router}${today}: historical trend carries up to ${perDay({ perHour: breakEvenPerHour })} with no dry hour; ${dry}`,
    ...simulation.drySpells.map((spell) => `    ${spellSentence({ spell, thresholds })}`),
    ...simulation.weeks.map((week) => weekLine({ week })),
  ];
}

/** One dry spell as a sentence: when, how long, and what ends it. */
function spellSentence({ spell, thresholds }: { spell: DrySpell; thresholds: ClaudeThresholds }): string {
  const relief = spell.reliefHours > 0 ? ` (and ${String(spell.reliefHours)}h a final-hours lift freed)` : "";
  return `dry ${minute({ iso: spell.startIso })} for ${String(spell.hours)}h${relief}, until ${spellEndClause({ spell, thresholds })}`;
}

/** One router's totals across the horizon: what the owner's "every plan full to its cap, none early" is judged on. */
export interface RouterTotals {
  readonly router: SimulationOutcome["router"];
  readonly dry: number;
  readonly stranded: number;
  /** Plan-hours spent sitting at the cap before a reset — the "capping early" the owner asked to see none of. */
  readonly earlyCapHours: number;
}

/** A difference in stranded plan-weeks below this is simulation noise, not a routing effect. */
const STRANDED_NOISE = 0.05;

/** A simulation's totals. */
function totals({ simulation }: { simulation: SimulationOutcome }): RouterTotals {
  return simulation.weeks.reduce<RouterTotals>(
    (sum, week) => ({
      dry: sum.dry + week.dryHours,
      earlyCapHours: sum.earlyCapHours + week.earlyCaps.reduce((hours, cap) => hours + cap.hoursBeforeReset, 0),
      router: sum.router,
      stranded: sum.stranded + week.strandedPlanWeeks,
    }),
    { dry: 0, earlyCapHours: 0, router: simulation.router, stranded: 0 },
  );
}

/**
 * Order two routers best first: fewer dry hours, then less stranded beyond noise, then fewer early-cap hours.
 *
 * @param left one router's totals
 * @param right the other's
 * @returns negative when `left` is better, positive when `right` is, zero when neither is
 */
export function compareRouters({ left, right }: { left: RouterTotals; right: RouterTotals }): number {
  if (left.dry !== right.dry) {
    return left.dry - right.dry;
  }
  if (Math.abs(left.stranded - right.stranded) >= STRANDED_NOISE) {
    return left.stranded - right.stranded;
  }
  return left.earlyCapHours - right.earlyCapHours;
}

/**
 * The verdict, conditional on the historical trend repeating: would today's router survive, and would another one
 * do strictly better.
 *
 * @param forecast the whole trend
 * @returns one or two lines
 */
export function survivalVerdict({ forecast }: { forecast: SurvivalForecast }): readonly string[] {
  const today = forecast.simulations.find((simulation) => simulation.router === TODAYS_ROUTER)!;
  const todayTotals = totals({ simulation: today });
  const horizon = `${String(forecast.weeks)} week(s) at ${forecast.demandBasis} demand`;
  const longest = today.drySpells.toSorted((left, right) => right.hours - left.hours)[0];
  const head =
    longest === undefined
      ? `verdict, ${forecast.basis}: the fleet would survive ${horizon} under today's router`
      : `verdict, ${forecast.basis}: at ${horizon} today's router would leave the fleet dry ${String(todayTotals.dry)}h, ` +
        `the longest ${spellSentence({ spell: longest, thresholds: forecast.thresholds })}`;
  const better = forecast.simulations
    .filter((simulation) => simulation.router !== TODAYS_ROUTER)
    .map((simulation) => totals({ simulation }))
    .filter((other) => compareRouters({ left: other, right: todayTotals }) < 0)
    .toSorted((left, right) => compareRouters({ left, right }))[0];
  if (better === undefined) {
    return [`${head}; no other router does better.`];
  }
  const line = ({ of }: { of: RouterTotals }): string =>
    `${String(of.dry)} dry hours, ${of.stranded.toFixed(2)} plan-weeks stranded, ${String(of.earlyCapHours)} plan-hours capped early`;
  return [
    `${head}.`,
    `routing: ${better.router} would leave ${line({ of: better })}; today's would leave ${line({ of: todayTotals })} — ` +
      "today's ranking has drifted from the owner's balance desires, so `rankClaudePlans` is the fleet's to fix.",
  ];
}

/** Every paused plan, never dropped: where its week stands, how that was placed, and what resuming it alone buys. */
function pausedBlock({ forecast }: { forecast: SurvivalForecast }): readonly string[] {
  if (forecast.paused.length === 0) {
    return [];
  }
  return [
    "paused, not spent by any router above:",
    ...forecast.paused.map((row) => {
      const head = `  ${row.alias.padEnd(11)} PAUSED since ${minute({ iso: row.sinceIso }).slice(0, 10)} — ${row.reason}`;
      if (row.placement === "misread") {
        return `${head}; every weekly reading shared another plan's reset, dropped as misread, so its week and reset are unread`;
      }
      if (row.state === undefined) {
        return `${head}; never read by the watch, so its week and reset are unread`;
      }
      const read = minute({ iso: row.state.observedAtIso });
      const placed = row.placement === "rolled" ? `estimated: last read ${read}, reset since` : `as read ${read}`;
      const scenario = forecast.resumeScenarios.find((entry) => entry.alias === row.alias)!;
      const dry = scenario.simulation.weeks.reduce((sum, week) => sum + week.dryHours, 0);
      return (
        `${head}; week ${percent({ fraction: row.state.utilization })} (${placed}), ` +
        `resets ${minute({ iso: row.state.resetAtIso })}; resumed alone, the ${forecast.basis} would leave ${String(dry)} dry hours`
      );
    }),
  ];
}

/**
 * The whole forecast as the lines `claude forecast` prints.
 *
 * @param forecast the whole forecast
 * @returns every line, in order
 */
export function renderSurvivalForecast({ forecast }: { forecast: SurvivalForecast }): readonly string[] {
  const { demand } = forecast;
  const { routeAt } = forecast.thresholds;
  // Each plan's ORDINARY ceiling, the route bar or its usage limit where lower: never the last-five-hours lift, and
  // never the share above a limit, which the fleet is not allowed to take.
  const ceilings = forecast.states.reduce((sum, state) => sum + Math.min(routeAt, state.usageLimitPercent / 100), 0);
  const capacityPerHour = ceilings / 168;
  const limitWording = forecast.states.some((state) => state.usageLimitPercent < 100)
    ? " or each plan's usage limit where lower"
    : "";
  const floor =
    demand.censoredHours > 0 ? `; ${String(demand.censoredHours)}h had every plan at its cap, so this is a floor` : "";
  const peak =
    demand.peakDay === undefined
      ? "no whole day in the window"
      : `peak ${perDay({ perHour: demand.peakPlanWeeksPerHour })} on ${demand.peakDay}`;
  const pausedCount = forecast.paused.length === 0 ? "" : `, ${String(forecast.paused.length)} paused`;
  return [
    `claude ${forecast.basis} at ${minute({ iso: forecast.nowIso })}: ${String(forecast.aliases.length)} plans configured, ` +
      `${String(forecast.states.length)} spendable${pausedCount}; ${String(forecast.weeks)} weeks, ${forecast.demandBasis} demand`,
    `demand ${perDay({ perHour: demand.planWeeksPerHour })} over ${demand.fromIso.slice(0, 10)} → ${demand.toIso.slice(0, 10)}, ` +
      `${peak}; the spendable plans hold ${perDay({ perHour: capacityPerHour })} at the ${percent({ fraction: routeAt })} cap` +
      `${limitWording}${floor}`,
    "plans, each at its own pace:",
    ...forecast.ownPace.map((pace) => paceLine({ pace })),
    ...pausedBlock({ forecast }),
    "routers, best placement each could reach (seats are sticky, so real routing does no better):",
    ...forecast.simulations.flatMap((simulation) =>
      routerBlock({
        breakEvenPerHour: forecast.breakEven.find((entry) => entry.router === simulation.router)!.planWeeksPerHour,
        simulation,
        thresholds: forecast.thresholds,
      }),
    ),
    ...survivalVerdict({ forecast }),
  ];
}
