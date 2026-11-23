/**
 * A week of the fleet's own decisions over five plans on staggered resets, run through the REAL router and the
 * REAL chair cadence: no plan's week or Fable window reaches its wall while the chair routes, and the same demand
 * with the chair held on one plan walls that plan's Fable week — the plan-five incident, reproduced.
 *
 * The simulator stays here, test-only: it is a proof harness over `routeSpawnToPlan` and `judgeChairCadence`, not a
 * model of provider consumption anything should ship. Demand is fixed per tick, so every outcome is deterministic.
 *
 * Its spread invariant is LEVEL-LINE headroom (`headroomToReset`), never raw percentages: with staggered resets two
 * healthy plans at different phases of their weeks legitimately differ by more than the drifting band, and the
 * router equalises distance from each window's own line, which is the property under test.
 */
import { describe, expect, it } from "vitest";

import type { ClaudePlanGauge, ClaudeWindowReading } from "../../../claude/contracts.js";
import { type ChairCadenceGauge, judgeChairCadence } from "../../../supervisor/chairCadence.js";
import { chairLevelWith, headroomToReset, routeSpawnToPlan, THRESHOLDS } from "./defaultThresholds.js";

const DRIFTING_SPREAD = THRESHOLDS.driftingSpread;

const HOUR_MS = 3_600_000;
const WEEK_MS = 7 * 24 * HOUR_MS;
const START_MS = Date.parse("2026-11-02T00:00:00.000Z");
/** One tick an hour for one week. */
const TICKS = 168;

/** The chair's own Fable draw per hour, as a fraction of one plan's week — enough to wall one plan in ~4 days. */
const CHAIR_DRAW = 0.012;
/** One Fable worker spawn every this many hours, each drawing {@link FABLE_WORKER_DRAW} at once. */
const FABLE_WORKER_EVERY = 5;
const FABLE_WORKER_DRAW = 0.07;
/** Ordinary (all-models) worker spawns per hour, each drawing {@link OPUS_DRAW} of the plan-wide week. */
const OPUS_SPAWNS_PER_TICK = 2;
const OPUS_DRAW = 0.0005;

/** The Claude Code every simulated chair runs and every fresh boot runs, so only the plan can decide a handoff. */
const CURRENT = { kind: "measured", version: "2.1.283" } as const;

type ChairMode = "cadence-routed" | "fixed-plan";
type WallWindow = "week" | "fable";

interface SimulatedPlan {
  readonly alias: string;
  weekResetMs: number;
  fableResetMs: number;
  weekUsed: number;
  fableUsed: number;
}

interface Wall {
  readonly alias: string;
  readonly window: WallWindow;
  readonly atIso: string;
}

interface SimulationResult {
  readonly maxWeekUsed: number;
  readonly maxFableUsed: number;
  readonly finalFableHeadroomSpread: number;
  readonly chairPlans: readonly string[];
  readonly firstWall: Wall | undefined;
}

/** Each plan's first week and Fable reset, in hours from {@link START_MS}: no two plans share a phase. */
const RESETS: readonly (readonly [string, number, number])[] = [
  ["plan-one", 12, 12],
  ["plan-two", 45, 80],
  ["plan-three", 78, 78],
  ["plan-four", 111, 146],
  ["plan-five", 18, 165],
];

/** The chair's plan when the week opens — the plan-five of the incident, whose Fable week resets last. */
const CHAIR_START = "plan-five";

/** How far an evenly drawn window would be through its week at {@link START_MS}, under the 95% cap. */
function onLine({ resetMs }: { resetMs: number }): number {
  return 0.9 * 0.95 * (1 - (resetMs - START_MS) / WEEK_MS);
}

/** Five plans, each window starting a little behind its own level line. */
function initialPlans(): SimulatedPlan[] {
  return RESETS.map(([alias, weekHours, fableHours]) => {
    const weekResetMs = START_MS + weekHours * HOUR_MS;
    const fableResetMs = START_MS + fableHours * HOUR_MS;
    return {
      alias,
      fableResetMs,
      fableUsed: onLine({ resetMs: fableResetMs }),
      weekResetMs,
      weekUsed: onLine({ resetMs: weekResetMs }),
    };
  });
}

/** A window as the probe would read it: refused at or past its wall. */
function windowOf({ used, resetMs }: { used: number; resetMs: number }): ClaudeWindowReading {
  return { resetAtIso: new Date(resetMs).toISOString(), status: used >= 1 ? "rejected" : "allowed", utilization: used };
}

/** Every plan's gauge at one instant — Ultra plans, so no five-hour window. */
function gaugesOf({ plans, nowMs }: { plans: readonly SimulatedPlan[]; nowMs: number }): ClaudePlanGauge[] {
  return plans.map((plan) => ({
    alias: plan.alias,
    allowance: { kind: "weekly-window" },
    observedAtIso: new Date(nowMs).toISOString(),
    sevenDay: windowOf({ resetMs: plan.weekResetMs, used: plan.weekUsed }),
    sevenDayFable: windowOf({ resetMs: plan.fableResetMs, used: plan.fableUsed }),
    usageLimitPercent: 100,
  }));
}

/** Roll every window whose reset has passed into its next week. */
function applyResets({ plans, nowMs }: { plans: SimulatedPlan[]; nowMs: number }): void {
  for (const plan of plans) {
    if (nowMs >= plan.weekResetMs) {
      plan.weekUsed = 0;
      plan.weekResetMs += WEEK_MS;
    }
    if (nowMs >= plan.fableResetMs) {
      plan.fableUsed = 0;
      plan.fableResetMs += WEEK_MS;
    }
  }
}

/** One spend of a plan's windows, as `simulate` records it. */
type Spend = (draw: { alias: string; fable: number; week: number; nowMs: number }) => void;

/** One tick's routed spawns — a Fable worker on its cadence, then the Opus spawns — each spent where routing sends it. */
function routeTickSpawns({
  nowMs,
  plans,
  spend,
  tick,
}: {
  nowMs: number;
  plans: readonly SimulatedPlan[];
  spend: Spend;
  tick: number;
}): void {
  if (tick % FABLE_WORKER_EVERY === 0) {
    const route = routeSpawnToPlan({ gauges: gaugesOf({ nowMs, plans }), model: "fable" });
    if (route.kind === "route") {
      spend({ alias: route.to, fable: FABLE_WORKER_DRAW, nowMs, week: FABLE_WORKER_DRAW });
    }
  }
  for (let spawn = 0; spawn < OPUS_SPAWNS_PER_TICK; spawn += 1) {
    const route = routeSpawnToPlan({ gauges: gaugesOf({ nowMs, plans }), model: "opus" });
    if (route.kind === "route") {
      spend({ alias: route.to, fable: 0, nowMs, week: OPUS_DRAW });
    }
  }
}

/**
 * Run the week.
 *
 * @param chairMode whether the chair follows its cadence verdict or stays on {@link CHAIR_START} throughout
 * @returns the peaks, the final level-line spread, every plan the chair sat on and the first wall, if any
 */
function simulate({ chairMode }: { chairMode: ChairMode }): SimulationResult {
  const plans = initialPlans();
  let chair = CHAIR_START;
  const chairPlans = [chair];
  let firstWall: Wall | undefined;
  let maxWeekUsed = 0;
  let maxFableUsed = 0;
  const spend: Spend = ({ alias, fable, week, nowMs }) => {
    const plan = plans.find((candidate) => candidate.alias === alias)!;
    plan.weekUsed += week;
    plan.fableUsed += fable;
    maxWeekUsed = Math.max(maxWeekUsed, plan.weekUsed);
    maxFableUsed = Math.max(maxFableUsed, plan.fableUsed);
    const walled = (["fable", "week"] as const).find((window) =>
      window === "fable" ? plan.fableUsed >= 1 : plan.weekUsed >= 1,
    );
    if (firstWall === undefined && walled !== undefined) {
      firstWall = { alias, atIso: new Date(nowMs).toISOString(), window: walled };
    }
  };
  for (let tick = 0; tick < TICKS; tick += 1) {
    const nowMs = START_MS + tick * HOUR_MS;
    applyResets({ nowMs, plans });
    routeTickSpawns({ nowMs, plans, spend, tick });
    spend({ alias: chair, fable: CHAIR_DRAW, nowMs, week: CHAIR_DRAW });
    if (chairMode === "cadence-routed") {
      chair = nextChair({ chair, nowMs, plans });
      if (chairPlans.at(-1) !== chair) {
        chairPlans.push(chair);
      }
    }
  }
  const finalMs = START_MS + TICKS * HOUR_MS;
  const headrooms = gaugesOf({ nowMs: finalMs, plans }).map((gauge) =>
    headroomToReset({
      claim: "seven_day_fable",
      observedAtIso: gauge.observedAtIso,
      usageLimitPercent: gauge.usageLimitPercent,
      window: gauge.sevenDayFable!,
    }),
  );
  return {
    chairPlans,
    finalFableHeadroomSpread: Math.max(...headrooms) - Math.min(...headrooms),
    firstWall,
    maxFableUsed,
    maxWeekUsed,
  };
}

/**
 * The chair's plan after this tick's cadence verdict: the plan the successor routes to as a chair spawn on a
 * handoff, else the same plan. The cadence judges that same chair route, as `claude gauge` captures it.
 */
function nextChair({ chair, nowMs, plans }: { chair: string; nowMs: number; plans: readonly SimulatedPlan[] }): string {
  const gauges = gaugesOf({ nowMs, plans });
  const route = routeSpawnToPlan({ chair: true, gauges, model: "fable" });
  const gauge: ChairCadenceGauge = {
    kind: "read",
    ...(route.kind === "route" ? { chairLevelWith: chairLevelWith({ gauges, route: route.to }) } : {}),
    nextChair: route.kind === "route" ? route.to : null,
    plans: plans.map((plan) => ({
      fablePct: Math.round(plan.fableUsed * 100),
      plan: plan.alias,
      weekPct: Math.round(plan.weekUsed * 100),
    })),
    thresholds: {
      alertAtPercent: Math.round(THRESHOLDS.alertAt * 100),
      driftingSpreadPercent: Math.round(THRESHOLDS.driftingSpread * 100),
      routeAtPercent: Math.round(THRESHOLDS.routeAt * 100),
    },
  };
  const verdict = judgeChairCadence({
    boots: CURRENT,
    gauge,
    newestInstalled: CURRENT,
    nowIso: new Date(nowMs).toISOString(),
    sessions: [
      {
        canon: { bootedIso: new Date(nowMs - HOUR_MS).toISOString(), changed: [], kind: "measured" },
        claudeCode: CURRENT,
        pid: 1,
        plan: { alias: chair, kind: "token" },
        sessionId: "simulated-chair",
      },
    ],
  });
  if (verdict.kind === "stay" || route.kind !== "route") {
    return chair;
  }
  return route.to;
}

describe("a week of routing over five plans on staggered resets", () => {
  const routed = simulate({ chairMode: "cadence-routed" });
  const fixed = simulate({ chairMode: "fixed-plan" });

  it("never walls a week or Fable window while the chair follows its cadence", () => {
    expect(routed.firstWall).toBe(undefined);
    expect(routed.maxWeekUsed).toBeLessThan(1);
    expect(routed.maxFableUsed).toBeLessThan(1);
  });

  it("moves the chair across plans rather than riding one", () => {
    expect(new Set(routed.chairPlans).size).toBeGreaterThan(1);
  });

  it("ends the week with every Fable window inside the drifting band of its own level line", () => {
    expect(routed.finalFableHeadroomSpread).toBeLessThanOrEqual(DRIFTING_SPREAD);
  });

  it("walls the held plan's Fable week at an exact instant under the same demand — the incident, reproduced", () => {
    expect(fixed.firstWall).toEqual({ alias: "plan-five", atIso: "2026-11-05T10:00:00.000Z", window: "fable" });
    expect(fixed.chairPlans).toEqual(["plan-five"]);
  });

  it("is a spread the held chair breaks, so the band above is not true of any demand", () => {
    expect(fixed.finalFableHeadroomSpread).toBeGreaterThan(DRIFTING_SPREAD);
  });
});
