/**
 * Whether the Claude plans, together, are projected to run out before a reset: `./survivalForecast.ts`'s historical
 * trend supplies each plan's start and the trailing demand off the drawdown journal, and `./survivalSimulate.ts`
 * re-runs today's router at the criterion's share of that demand. A spell the full-rate forecast shows but the guarded
 * run does not is the noise `../capacity/weekRisk.ts` names, and never opens a card.
 *
 * A routable monthly-spend plan reads unmeasurable: its spend is not a weekly window, so the simulation would read a
 * plan the router spends as one it never can.
 *
 * So does a journal covering under a day of the trailing week, as Codex's readings do (`../capacity/weekDemand.ts`).
 *
 * Pure: the forecast, the register and a criterion in, a projection out.
 */
import { MIN_DEMAND_SPAN_HOURS } from "../capacity/weekDemand.js";
import {
  type HostWeekProjection,
  pausedLineOf,
  perDay,
  spanOf,
  WEEK_RISK_HORIZON_HOURS,
  type WeekRiskCriterion,
} from "../capacity/weekRisk.js";
import type { RegisteredPlan } from "../plans/types.js";

import type { DrawdownSample } from "./drawdownAnomaly.js";
import type { SurvivalForecast, SurvivalRead } from "./survivalForecast.js";
import { type EarlyCap, simulateFleet, TODAYS_ROUTER } from "./survivalSimulate.js";

const HOUR_MS = 3_600_000;

/** An instant as a card prints it, to the minute. */
function minuteOf({ iso }: { iso: string }): string {
  return `${new Date(Date.parse(iso)).toISOString().slice(0, 16)}Z`;
}

/**
 * How many hours of the trailing week the drawdown journal actually covers: from its earliest sample inside the
 * week to the judged instant. The forecast divides the week's draw by a fixed week, so a journal begun an hour ago
 * reads as almost no demand — a span this short is a gap, never a clear week.
 *
 * @param samples every journal sample
 * @param nowIso the judged instant, the end of the trailing week
 * @returns whole-and-fractional hours covered; 0 when no sample falls inside the week
 */
export function journalSpanHours({ nowIso, samples }: { nowIso: string; samples: readonly DrawdownSample[] }): number {
  const nowMs = Date.parse(nowIso);
  const fromMs = nowMs - WEEK_RISK_HORIZON_HOURS * HOUR_MS;
  const inWeek = samples
    .map((sample) => Date.parse(sample.observedAtIso))
    .filter((atMs) => atMs >= fromMs && atMs <= nowMs);
  if (inWeek.length === 0) {
    return 0;
  }
  return (nowMs - Math.min(...inWeek)) / HOUR_MS;
}

/** Why the Claude week cannot be simulated at all — no routable plan, a monthly one, a gap — or the forecast to run. */
function claudeWeekGate({
  read,
  registered,
  spanHours,
}: {
  read: SurvivalRead;
  registered: readonly RegisteredPlan[];
  spanHours: number;
}): { settled: HostWeekProjection } | { forecast: SurvivalForecast } {
  const routable = registered.filter((plan) => plan.provider === "claude" && plan.paused === undefined);
  if (routable.length === 0) {
    return { settled: { kind: "clear", why: "no Claude plan is routable, so there is no Claude week to run out" } };
  }
  const monthly = routable.find((plan) => plan.allowance.kind === "monthly-spend");
  if (monthly !== undefined) {
    return {
      settled: {
        kind: "unmeasurable",
        why: `Claude plan ${monthly.alias} is a monthly-spend plan, which no week measures`,
      },
    };
  }
  if (read.kind === "unmeasurable") {
    return { settled: { kind: "unmeasurable", why: `Claude forecast: ${read.because}` } };
  }
  if (spanHours < MIN_DEMAND_SPAN_HOURS) {
    return {
      settled: {
        kind: "unmeasurable",
        why: `the Claude drawdown journal spans ${spanHours.toFixed(1)}h, under the ${String(MIN_DEMAND_SPAN_HOURS)}h a trailing rate needs`,
      },
    };
  }
  // A routable plan the forecast does not start is a different fleet — simulating the rest would read a spell the
  // missing plan may carry (the register is read twice, so a plan can be added between the reads).
  const started = new Set(read.forecast.states.map((state) => state.alias));
  const unstarted = routable.find((plan) => !started.has(plan.alias));
  if (unstarted !== undefined) {
    return {
      settled: {
        kind: "unmeasurable",
        why: `Claude plan ${unstarted.alias} is routable but the forecast does not start it, so the week is not measured`,
      },
    };
  }
  return { forecast: read.forecast };
}

/**
 * One plan's line: where it stands, the room before its reset, and when the routed draw fills that room. Only a cap
 * inside THIS window counts: the week's early caps span every cycle, and a later window's fill instant printed beside
 * this window's reset would state a lead time no window has.
 */
function planLineOf({
  earlyCaps,
  state,
}: {
  earlyCaps: readonly EarlyCap[];
  state: SurvivalForecast["states"][number];
}): string {
  const usedPercent = state.utilization * 100;
  const stands =
    `${state.alias}: ${String(Math.round(usedPercent))}% used of a ${String(state.usageLimitPercent)}% limit, ` +
    `${String(Math.max(0, Math.round(state.usageLimitPercent - usedPercent)))}% of a week left before its ${minuteOf({ iso: state.resetAtIso })} reset`;
  const resetMs = Date.parse(state.resetAtIso);
  const cap = earlyCaps.find((candidate) => candidate.alias === state.alias && Date.parse(candidate.atIso) < resetMs);
  if (cap === undefined) {
    // No early cap is recorded for a fill inside the week's last spend-out hours, so this claims no more than that.
    return `${stands}; the routed draw does not fill it before its last spend-out hours`;
  }
  return `${stands}; the routed draw fills it ${minuteOf({ iso: cap.atIso })}, ${spanOf({ ms: cap.hoursBeforeReset * HOUR_MS })} before that reset`;
}

/** The basis line: the projected and trailing draw, the week's need, what goes unmet and what is left unspent. */
function basisOf({
  criterion,
  demandPerHour,
  firstWeek,
  forecast,
}: {
  criterion: WeekRiskCriterion;
  demandPerHour: number;
  firstWeek: { readonly strandedPlanWeeks: number; readonly unmetPlanWeeks: number };
  forecast: SurvivalForecast;
}): string {
  return (
    `Claude, projected at ${String(Math.round(criterion.demandShare * 100))}% of the trailing draw: ` +
    `${perDay({ planWeeksPerHour: demandPerHour })} (trailing ${perDay({ planWeeksPerHour: forecast.demand.planWeeksPerHour })}, ` +
    `measured ${minuteOf({ iso: forecast.demand.fromIso })} to ${minuteOf({ iso: forecast.demand.toIso })}), routed by ${TODAYS_ROUTER}, ` +
    `${(demandPerHour * WEEK_RISK_HORIZON_HOURS).toFixed(2)} plan-weeks over the next 7 days, ` +
    `${firstWeek.unmetPlanWeeks.toFixed(2)} of them unmet; ` +
    `${firstWeek.strandedPlanWeeks.toFixed(2)} plan-weeks left unspent at the resets; a Claude free reset is not counted`
  );
}

/**
 * Project the Claude plans' week.
 *
 * @param read what `forecastSurvival` returned for one trailing week at this instant
 * @param registered every registered plan, every model host; only Claude rows are read
 * @param criterion the demand share and shortest spell that count
 * @param spanHours how much of the trailing week the journal covers ({@link journalSpanHours})
 * @returns at risk with the first counted spell, clear, or unmeasurable naming the gap
 */
export function claudeWeekProjection({
  criterion,
  read,
  registered,
  spanHours,
}: {
  criterion: WeekRiskCriterion;
  read: SurvivalRead;
  registered: readonly RegisteredPlan[];
  spanHours: number;
}): HostWeekProjection {
  const gate = claudeWeekGate({ read, registered, spanHours });
  if ("settled" in gate) {
    return gate.settled;
  }
  const { forecast } = gate;
  const demandPerHour = forecast.demand.planWeeksPerHour * criterion.demandShare;
  const outcome = simulateFleet({
    demandPerHour,
    nowIso: forecast.nowIso,
    router: TODAYS_ROUTER,
    states: forecast.states,
    thresholds: forecast.thresholds,
    weeks: Math.ceil(WEEK_RISK_HORIZON_HOURS / (7 * 24)),
  });
  // One week is simulated, so its outcome is always there.
  const firstWeek = outcome.weeks[0]!;
  const planLines = [
    ...forecast.states.map((state) => planLineOf({ earlyCaps: firstWeek.earlyCaps, state })),
    ...forecast.paused.map((plan) => pausedLineOf({ alias: plan.alias, reason: plan.reason })),
  ];
  const basis = basisOf({ criterion, demandPerHour, firstWeek, forecast });
  const spell = outcome.drySpells.find((candidate) => candidate.hours >= criterion.minDryHours);
  if (spell === undefined) {
    return {
      kind: "clear",
      lines: [basis, ...planLines],
      why: `no Claude spell of ${String(criterion.minDryHours)}h or more is projected at ${perDay({ planWeeksPerHour: demandPerHour })}`,
    };
  }
  return {
    kind: "at-risk",
    spell: {
      basis,
      endIso: spell.endedAtIso,
      endedById: `claude:${spell.endedByAlias}`,
      host: "claude",
      hours: spell.hours,
      identity: forecast.states.map((state) => `claude:${state.alias}@${String(state.usageLimitPercent)}`),
      planLines,
      startIso: spell.startIso,
    },
  };
}
