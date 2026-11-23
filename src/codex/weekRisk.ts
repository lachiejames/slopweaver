/**
 * Whether the Codex plans, together, are projected to run out before a reset: the latest filed ceilings start every
 * routable plan, the trailing draw off the readings ledger (`../capacity/weekDemand.ts`) is the demand, and
 * `./weekSimulation.ts` routes it the way the router does, claiming free resets the way the chair tick does.
 *
 * ## Every gap reads unmeasurable, never clear and never at risk
 *
 * A routable plan the reading does not measure, a monthly-spend plan (whose spend no reader measures,
 * `../plans/usageLimit.ts`'s `CODEX_MONTHLY_SPEND_NOT_MEASURED`), or a trailing draw the ledger cannot give, each make
 * the projection unmeasurable — a model host projected over part of its plans is a different fleet. Free resets are the
 * one asymmetric case: an unread count is read as none only when no spell results; a spell that might be one a claim
 * prevents is unmeasurable instead.
 *
 * Pure: the reading, the register, the demand and a criterion in, a projection out.
 */
import { parseIsoMs } from "#lib/date.js";

import type { Ceiling, CeilingsReading } from "../capacity/ceilings.js";
import type { WeekDemand } from "../capacity/weekDemand.js";
import {
  type HostWeekProjection,
  pausedLineOf,
  perDay,
  spanOf,
  WEEK_RISK_HORIZON_HOURS,
  type WeekRiskCriterion,
} from "../capacity/weekRisk.js";
import type { CodexThresholds } from "../plans/thresholds.js";
import type { RegisteredPlan } from "../plans/types.js";

import { CODEX_WEEK_MS } from "./levelLine.js";
import { codexEffectiveUsageCeiling } from "./routingCapacity.js";
import {
  type CodexWeekPlan,
  type CodexWeekPlanOutcome,
  type CodexWeekRun,
  simulateCodexWeek,
} from "./weekSimulation.js";

/** One routable plan, ready to simulate, with what its card line needs. */
interface StartedPlan {
  readonly plan: CodexWeekPlan;
  readonly alias: string;
  /** Whether the chair claims for it at all: false where the ceiling is the owner's own usage limit. */
  readonly claims: boolean;
  /** The free resets the reading says it holds, or `undefined` when none were read. */
  readonly freeResetsHeld: number | undefined;
  readonly freeResetsUnread: boolean;
}

/** A minute as a card prints it. */
function minuteOf({ ms }: { ms: number }): string {
  return `${new Date(ms).toISOString().slice(0, 16)}Z`;
}

/** A share of one plan's week, to the whole point. */
function pointsOf({ percent }: { percent: number }): string {
  return `${String(Math.round(percent))}%`;
}

/** What the plan does with its free resets in the run, as the line's last clause. */
function resetsClause({ entry, outcome }: { entry: StartedPlan; outcome: CodexWeekPlanOutcome }): string {
  if (!entry.claims) {
    return "it stops at your own usage limit, where no free reset is claimed";
  }
  if (entry.freeResetsHeld === undefined) {
    return "its free resets were not read";
  }
  const held = `${String(entry.freeResetsHeld)} free reset(s) held`;
  return `${held}, ${String(outcome.claimsMs.length)} claimed in the projection`;
}

/**
 * One plan's line: where it stands, the room before its reset, what the routed draw does with that room, and its
 * free resets — the calculation the card must show.
 */
function planLineOf({ entry, outcome }: { entry: StartedPlan; outcome: CodexWeekPlanOutcome }): string {
  const { ceilingPercent, resetMs, usedPercent } = entry.plan;
  const stands =
    `${entry.alias}: ${pointsOf({ percent: usedPercent })} used of a ${pointsOf({ percent: ceilingPercent })} ceiling, ` +
    `${pointsOf({ percent: Math.max(0, ceilingPercent - usedPercent) })} of a week left before its ${minuteOf({ ms: resetMs })} reset`;
  const resets = resetsClause({ entry, outcome });
  if (outcome.ceilingAtMs !== undefined && outcome.ceilingAtMs < resetMs) {
    const early = spanOf({ ms: resetMs - outcome.ceilingAtMs });
    return `${stands}; the routed draw fills it ${minuteOf({ ms: outcome.ceilingAtMs })}, ${early} before that reset; ${resets}`;
  }
  const unspent = Math.max(0, ceilingPercent - outcome.usedAtWindowEndPercent);
  return `${stands}; the routed draw takes it to ${pointsOf({ percent: outcome.usedAtWindowEndPercent })} by then, ${pointsOf({ percent: unspent })} unspent; ${resets}`;
}

/** Every configured Codex plan's line: each started one off its run outcome, then each paused one. */
function planLinesOf({
  codex,
  run,
  started,
}: {
  codex: readonly RegisteredPlan[];
  run: CodexWeekRun;
  started: readonly StartedPlan[];
}): readonly string[] {
  return [
    ...started.map((entry, index) => planLineOf({ entry, outcome: run.plans[index]! })),
    ...codex.flatMap((plan) =>
      plan.paused === undefined ? [] : [pausedLineOf({ alias: plan.alias, reason: plan.paused.reason })],
    ),
  ];
}

/**
 * The basis line: the projected and trailing draw, the week's need in plan-weeks, the free resets held and claimed,
 * and the week left unspent at the current resets — the one number "not leaving usage on the table" is chased by.
 */
function basisOf({
  criterion,
  demand,
  demandPerHour,
  run,
  started,
}: {
  criterion: WeekRiskCriterion;
  demand: Extract<WeekDemand, { kind: "measured" }>;
  demandPerHour: number;
  run: CodexWeekRun;
  started: readonly StartedPlan[];
}): string {
  const held = started.reduce((sum, entry) => sum + entry.plan.claimableResets, 0);
  const claimed = run.plans.reduce((sum, outcome) => sum + outcome.claimsMs.length, 0);
  const unspent = started.reduce((sum, entry, index) => {
    const outcome = run.plans[index]!;
    return sum + Math.max(0, entry.plan.ceilingPercent - outcome.usedAtWindowEndPercent);
  }, 0);
  const weekNeed = (demandPerHour * WEEK_RISK_HORIZON_HOURS) / 100;
  return (
    `Codex, projected at ${String(Math.round(criterion.demandShare * 100))}% of the trailing draw: ` +
    `${perDay({ planWeeksPerHour: demandPerHour / 100 })} (trailing ${perDay({ planWeeksPerHour: demand.pointsPerHour / 100 })}, ` +
    `over ${String(Math.round(demand.spanHours))}h of capacity readings), ${weekNeed.toFixed(2)} plan-weeks over the next 7 days, ` +
    `${(run.unmetPoints / 100).toFixed(2)} of them unmet; ` +
    `${String(held)} free reset(s) the chair may claim, ${String(claimed)} claimed; ` +
    `${(unspent / 100).toFixed(2)} plan-weeks left unspent at the current resets`
  );
}

/**
 * How far past a week from the reading an unstarted window's reset may land and still be that week's end. MEASURED
 * 2.957s: a plan at 0% read a weekly `resetAtIso` that far past seven days from the reading's `observedAtIso`
 * (`slopweaver codex route` prints both for a plan at 0%). A minute bounds second-rounding and the read's own
 * latency, and is still nothing a real window could be.
 */
const UNSTARTED_WEEK_SKEW_MS = 60_000;

/** One routable plan's start, or why the reading cannot start it. */
function startOf({
  ceilings,
  nowMs,
  plan,
  thresholds,
}: {
  ceilings: readonly Ceiling[];
  /** The reading's own instant, which a reset at or before has already passed. */
  nowMs: number;
  plan: RegisteredPlan;
  thresholds: CodexThresholds;
}): StartedPlan | { readonly why: string } {
  const id = `codex:${plan.alias}`;
  const ceiling = ceilings.find((candidate) => candidate.id === id);
  if (ceiling === undefined || ceiling.status === "unreadable") {
    return { why: `Codex plan ${plan.alias} has no readable weekly window in the latest capacity reading` };
  }
  const weekly = ceiling.windows.find((window) => window.window === "weekly");
  const resetMs = weekly?.resetAtIso == null ? undefined : parseIsoMs({ tsIso: weekly.resetAtIso });
  if (weekly === undefined || resetMs === undefined) {
    return { why: `Codex plan ${plan.alias}'s weekly window names no reset in the latest capacity reading` };
  }
  const effective = codexEffectiveUsageCeiling({
    label: "weekly",
    thresholds,
    usageLimitPercent: plan.usageLimitPercent,
  });
  const claims = effective.source === "routing-bar";
  const freeResets = ceiling.freeResets;
  const known = typeof freeResets === "number";
  // A reset already past at the reading's instant means that window is gone: start the plan in the window the
  // simulation would roll it into, so its card line never describes an expired window the run does not route.
  let currentResetMs = resetMs;
  while (currentResetMs <= nowMs) {
    currentResetMs += CODEX_WEEK_MS;
  }
  // A weekly window resets within a week, a claimed one at its claim plus seven days; a reset further out is no
  // window this simulation's horizon reaches, and its line would print the horizon's end as the reset's outcome.
  // An UNSTARTED window is the exception in name only: Codex stamps its reset as its own clock plus seven days,
  // rounded up to the second, so it lands a moment past the week: that week's end, read on a different clock.
  if (currentResetMs - nowMs > CODEX_WEEK_MS + UNSTARTED_WEEK_SKEW_MS) {
    return {
      why: `Codex plan ${plan.alias}'s weekly window resets more than a week after the latest capacity reading, which no weekly window does`,
    };
  }
  const rolled = currentResetMs !== resetMs;
  return {
    alias: plan.alias,
    claims,
    freeResetsHeld: known ? freeResets : undefined,
    freeResetsUnread: claims && !known,
    plan: {
      ceilingPercent: effective.usedPercent,
      claimableResets: claims && known ? freeResets : 0,
      id,
      resetMs: Math.min(currentResetMs, nowMs + CODEX_WEEK_MS),
      usedPercent: rolled ? 0 : weekly.used,
    },
  };
}

/** Why the Codex week cannot be simulated at all — no routable plan, a monthly one, a gap — or every plan's start. */
function codexWeekGate({
  demand,
  reading,
  routable,
  thresholds,
}: {
  demand: WeekDemand;
  reading: CeilingsReading;
  routable: readonly RegisteredPlan[];
  thresholds: CodexThresholds;
}):
  | { readonly settled: HostWeekProjection }
  | {
      readonly nowMs: number;
      readonly demand: Extract<WeekDemand, { kind: "measured" }>;
      readonly started: readonly StartedPlan[];
    } {
  if (routable.length === 0) {
    return { settled: { kind: "clear", why: "no Codex plan is routable, so there is no Codex week to run out" } };
  }
  const monthly = routable.find((plan) => plan.allowance.kind === "monthly-spend");
  if (monthly !== undefined) {
    return {
      settled: {
        kind: "unmeasurable",
        why: `Codex plan ${monthly.alias} is a monthly-spend plan, whose spend no reading measures`,
      },
    };
  }
  if (demand.kind === "unmeasurable") {
    return { settled: { kind: "unmeasurable", why: `Codex trailing demand: ${demand.why}` } };
  }
  const nowMs = parseIsoMs({ tsIso: reading.observedAtIso });
  if (nowMs === undefined) {
    return {
      settled: {
        kind: "unmeasurable",
        why: `the capacity reading's instant ${reading.observedAtIso} does not parse`,
      },
    };
  }
  const started: StartedPlan[] = [];
  for (const plan of routable) {
    const start = startOf({ ceilings: reading.ceilings, nowMs, plan, thresholds });
    if ("why" in start) {
      return { settled: { kind: "unmeasurable", why: start.why } };
    }
    started.push(start);
  }
  return { demand, nowMs, started };
}

/**
 * Project the Codex plans' week.
 *
 * @param reading the latest filed ceilings, already judged fresh and unheld by the caller
 * @param registered every registered plan, every model host; only Codex rows are read
 * @param thresholds the register's Codex bars
 * @param demand the trailing draw off the readings ledger
 * @param criterion the demand share and shortest spell that count
 * @returns at risk with the first counted spell, clear, or unmeasurable naming the gap
 */
export function codexWeekProjection({
  criterion,
  demand: trailing,
  reading,
  registered,
  thresholds,
}: {
  criterion: WeekRiskCriterion;
  demand: WeekDemand;
  reading: CeilingsReading;
  registered: readonly RegisteredPlan[];
  thresholds: CodexThresholds;
}): HostWeekProjection {
  const codex = registered.filter((plan) => plan.provider === "codex");
  const routable = codex.filter((plan) => plan.paused === undefined);
  const gate = codexWeekGate({ demand: trailing, reading, routable, thresholds });
  if ("settled" in gate) {
    return gate.settled;
  }
  const { demand, nowMs, started } = gate;
  const demandPerHour = demand.pointsPerHour * criterion.demandShare;
  const run = simulateCodexWeek({
    demandPerHour,
    horizonHours: WEEK_RISK_HORIZON_HOURS,
    nowMs,
    plans: started.map((entry) => entry.plan),
  });
  const basis = basisOf({ criterion, demand, demandPerHour, run, started });
  const planLines = planLinesOf({ codex, run, started });
  const spell = run.spells.find((candidate) => candidate.hours >= criterion.minDryHours);
  if (spell === undefined) {
    return {
      kind: "clear",
      lines: [basis, ...planLines],
      why: `no Codex spell of ${String(criterion.minDryHours)}h or more is projected at ${perDay({ planWeeksPerHour: demandPerHour / 100 })}`,
    };
  }
  const unread = started.find((entry) => entry.freeResetsUnread);
  if (unread !== undefined) {
    return {
      kind: "unmeasurable",
      why: `a Codex spell is projected, but ${unread.plan.id}'s free resets are not read, and a claim may prevent it`,
    };
  }
  return {
    kind: "at-risk",
    spell: {
      basis,
      endIso: new Date(spell.endMs).toISOString(),
      endedById: spell.endedById,
      host: "codex",
      hours: spell.hours,
      identity: started.map((entry) => `${entry.plan.id}@${String(entry.plan.ceilingPercent)}`),
      planLines,
      startIso: new Date(spell.startMs).toISOString(),
    },
  };
}
