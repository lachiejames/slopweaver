/**
 * The plan gauge `supervisor chair-watch` judges the chair's cadence on, built from RECORDED readings alone.
 *
 * A tick judges on the gauge it captured by running `claude gauge`, which probes every plan and spends a token on each.
 * The control plane's watch runs on a timer, so it never probes: each weekly Claude plan's last snapshot
 * (`../claude/planUsageSnapshot.ts`, filed by `claude gauge` and `claude watch`) is its reading, each monthly-spend
 * plan's spend verdict is read off the local ledger by the caller, and the bars are the register's own.
 *
 * A snapshot is judged on only while it is fresh — no older than {@link CLAUDE_USAGE_READING_FRESH_MS}, the hour
 * the seat gate trusts a reading for — and only while neither window it carries has reset since it was taken: a
 * reset window has reopened, so its old number says nothing about it (the rule `../plans/planUsage.ts` applies). A
 * plan left out for either reason, or with nothing recorded, is named in the gauge's `gap`, so the cadence reads it
 * PARTIAL exactly as it reads a tick whose capture missed a plan, and the route UNMEASURED. No fresh reading at all
 * is an `unmeasured` gauge.
 *
 * The route is {@link nextSpawnTargets}'s — the router itself, asked with the chair flag — never a second ranking.
 * The rows mirror what `./tickGaugeShapes.ts`'s `gaugePlansOf` makes of a capture: a complete row per plan with a
 * Fable week, a week-only row per plan without one.
 *
 * Every reading names an alias, percentages and instants only — never a store path or an account address.
 *
 * Pure: the register rows, the snapshots, the spends and the instant arrive already read.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import { parseIsoMs } from "#lib/date.js";

import {
  type ClaudeAccountGauge,
  type ClaudePlanGauge,
  type ClaudePlanSpend,
  type ClaudeWindowReading,
  claudePlanGauge,
} from "../claude/contracts.js";
import type { ClaudePlanUsageSnapshot } from "../claude/planUsageSnapshot.js";
import { nextSpawnTargets } from "../claude/routeSpawn.js";
import { CLAUDE_USAGE_READING_FRESH_MS } from "../claude/seatUsageGate.js";
import type { PlanUsageRead } from "../plans/planUsageTypes.js";
import { type ClaudeThresholds, claudeThresholdFieldsOf } from "../plans/thresholds.js";
import type { RegisteredPlan } from "../plans/types.js";
import type { ChairCadenceGauge } from "./chairCadence.js";
import type { ChairCadenceThresholds } from "./chairCadenceThresholds.js";
import type { ChairWatchReading } from "./chairWatch.js";

/** Why a Codex plan carries no reading here. */
export const CODEX_PLAN_NOT_READ =
  "a Codex plan — the watch reads no Codex rollout; `slopweaver plans usage` reads its week";

/** One plan's recorded snapshot, as the caller read it. */
export interface RecordedClaudeSnapshot {
  readonly alias: string;
  readonly read: PlanUsageRead<ClaudePlanUsageSnapshot | undefined>;
}

/** What {@link recordedChairGauge} concludes. */
export interface RecordedChairGauge {
  readonly gauge: ChairCadenceGauge;
  /** Every registered plan, in register order, with its chair flag unset (see {@link markChairReadings}). */
  readonly readings: readonly ChairWatchReading[];
}

/**
 * A window's spend as the whole percentage the gauge itself prints.
 *
 * @param window the window
 * @returns the rounded percentage
 */
function percentOf({ window }: { window: ClaudeWindowReading }): number {
  return Math.round(window.utilization * 100);
}

/**
 * A snapshot's windows as one phrase.
 *
 * @param snapshot the recorded reading
 * @returns e.g. `week 44%, Fable week 71%`
 */
function windowsPhrase({ snapshot }: { snapshot: ClaudePlanUsageSnapshot }): string {
  const week = `week ${String(percentOf({ window: snapshot.sevenDay }))}%`;
  if (snapshot.sevenDayFable === undefined) {
    return week;
  }
  return `${week}, Fable week ${String(percentOf({ window: snapshot.sevenDayFable }))}%`;
}

/**
 * The first window of a snapshot whose reset has passed at `nowMs`.
 *
 * @param snapshot the recorded reading
 * @param nowMs the pass's instant
 * @returns the passed reset instant, or `undefined` while every window it carries is still the open one
 */
function passedReset({ snapshot, nowMs }: { snapshot: ClaudePlanUsageSnapshot; nowMs: number }): string | undefined {
  const windows = [snapshot.sevenDay, ...(snapshot.sevenDayFable === undefined ? [] : [snapshot.sevenDayFable])];
  for (const window of windows) {
    const resetMs = parseIsoMs({ tsIso: window.resetAtIso });
    if (resetMs !== undefined && resetMs <= nowMs) {
      return window.resetAtIso;
    }
  }
  return undefined;
}

/** One weekly plan judged: its reading, and either the gauge it contributes or the gap it leaves. */
type WeeklyJudged =
  | { readonly kind: "measured"; readonly reading: ChairWatchReading; readonly snapshot: ClaudePlanUsageSnapshot }
  | { readonly kind: "gap"; readonly reading: ChairWatchReading; readonly gap: string };

/**
 * One unpaused weekly Claude plan, judged off its recorded snapshot.
 *
 * @param alias the plan
 * @param read what the caller read for it
 * @param nowMs the pass's instant
 * @returns the measured snapshot, or the gap it leaves and why
 */
function judgeWeekly({
  alias,
  read,
  nowMs,
}: {
  alias: string;
  read: PlanUsageRead<ClaudePlanUsageSnapshot | undefined> | undefined;
  nowMs: number;
}): WeeklyJudged {
  const base = { alias, chair: false, vendor: "claude" } as const;
  if (read === undefined || (read.kind === "read" && read.value === undefined)) {
    return {
      gap: `${alias} has no recorded reading`,
      kind: "gap",
      reading: { ...base, reading: "no reading recorded", state: "none" },
    };
  }
  if (read.kind === "unreadable") {
    // The read's own reason can name the snapshot's path, so the reading and the gap say only that it failed.
    return {
      gap: `${alias}'s recorded reading could not be read`,
      kind: "gap",
      reading: { ...base, reading: "its recorded reading could not be read", state: "none" },
    };
  }
  const snapshot = read.value!;
  const observedAtIso = snapshot.observedAtIso;
  const phrase = windowsPhrase({ snapshot });
  const observedMs = parseIsoMs({ tsIso: observedAtIso })!;
  if (observedMs > nowMs) {
    return {
      gap: `${alias}'s reading is dated ${observedAtIso}, after this pass`,
      kind: "gap",
      reading: { ...base, observedAtIso, reading: `${phrase}, dated after this pass`, state: "stale" },
    };
  }
  const reset = passedReset({ nowMs, snapshot });
  if (reset !== undefined) {
    return {
      gap: `${alias}'s window reset at ${reset}, after its last reading`,
      kind: "gap",
      reading: { ...base, observedAtIso, reading: `window reset at ${reset}, after the last reading`, state: "none" },
    };
  }
  if (nowMs - observedMs > CLAUDE_USAGE_READING_FRESH_MS) {
    return {
      gap: `${alias}'s last reading, at ${observedAtIso}, is older than the hour a reading stays evidence`,
      kind: "gap",
      reading: { ...base, observedAtIso, reading: `${phrase} at ${observedAtIso}`, state: "stale" },
    };
  }
  return {
    kind: "measured",
    reading: { ...base, observedAtIso, reading: phrase, state: "measured" },
    snapshot,
  };
}

/**
 * The three bars the cadence reads, off the register's decoded thresholds.
 *
 * @param thresholds the install's Claude thresholds, as a gate compares them
 * @returns the alert bar, the drifting band and the routing bar in the register's own spelling
 */
function cadenceThresholdsFrom({ thresholds }: { thresholds: ClaudeThresholds }): ChairCadenceThresholds {
  const fields = claudeThresholdFieldsOf({ thresholds });
  return {
    alertAtPercent: fields.alertAtPercent,
    driftingSpreadPercent: fields.driftingSpreadPercent,
    routeAtPercent: fields.routeAtPercent,
  };
}

/**
 * The reading a plan the gauge does not judge carries: Codex, paused, or monthly spend.
 *
 * @param plan the register row
 * @param spends every monthly-spend plan's verdict
 * @returns the reading
 */
function unjudgedReading({
  plan,
  spends,
}: {
  plan: RegisteredPlan;
  spends: readonly ClaudePlanSpend[];
}): ChairWatchReading {
  if (plan.provider === "codex") {
    return { alias: plan.alias, chair: false, reading: CODEX_PLAN_NOT_READ, state: "not-measured", vendor: "codex" };
  }
  if (plan.paused !== undefined) {
    return {
      alias: plan.alias,
      chair: false,
      reading: `paused since ${plan.paused.sinceIso}`,
      state: "not-measured",
      vendor: "claude",
    };
  }
  const spend = spends.find((one) => one.alias === plan.alias);
  let reading = "monthly spend, no verdict read";
  if (spend !== undefined) {
    reading = `monthly spend ${spend.verdict.kind}`;
  }
  return { alias: plan.alias, chair: false, reading, state: "not-measured", vendor: "claude" };
}

/**
 * Build the cadence's gauge from what was recorded, and one reading per registered plan.
 *
 * @param plans every register row, in register order
 * @param snapshots each unpaused weekly Claude plan's recorded snapshot read
 * @param spends each unpaused monthly-spend plan's verdict at {@link nowIso} (`../claude/spendBudgets.ts`)
 * @param thresholds the install's Claude thresholds, off the same register read
 * @param nowIso the pass's instant
 * @returns the gauge the cadence judges on, and the readings it judged
 */
export function recordedChairGauge({
  plans,
  snapshots,
  spends,
  thresholds,
  nowIso,
}: {
  plans: readonly RegisteredPlan[];
  snapshots: readonly RecordedClaudeSnapshot[];
  spends: readonly ClaudePlanSpend[];
  thresholds: ClaudeThresholds;
  nowIso: string;
}): RecordedChairGauge {
  const nowMs = parseIsoMs({ tsIso: nowIso })!;
  const readings: ChairWatchReading[] = [];
  const gaps: string[] = [];
  const gauges: ClaudePlanGauge[] = [];
  for (const plan of plans) {
    if (!judgedOnSnapshot({ plan })) {
      readings.push(unjudgedReading({ plan, spends }));
      continue;
    }
    const judged = judgeWeekly({
      alias: plan.alias,
      nowMs,
      read: snapshots.find((one) => one.alias === plan.alias)?.read,
    });
    readings.push(judged.reading);
    if (judged.kind === "gap") {
      gaps.push(judged.gap);
      continue;
    }
    gauges.push(planGaugeOf({ plan, snapshot: judged.snapshot }));
  }
  const spendMeasured = spends.some((spend) => spend.verdict.kind !== "not-measured");
  if (gauges.length === 0 && !spendMeasured) {
    const why = gaps.length === 0 ? "no Claude plan is registered to read" : gaps.join("; ");
    return { gauge: { kind: "unmeasured", why: `no Claude plan has a fresh recorded reading — ${why}` }, readings };
  }
  return { gauge: readGaugeOf({ gaps, gauges, spends, thresholds }), readings };
}

/**
 * Whether the gauge judges a plan off its recorded snapshot: an unpaused weekly Claude plan. Every other row carries
 * an {@link unjudgedReading}.
 *
 * @param plan the register row
 * @returns true for an unpaused Claude plan on a weekly window
 */
function judgedOnSnapshot({ plan }: { plan: RegisteredPlan }): boolean {
  return plan.provider === "claude" && plan.paused === undefined && plan.allowance.kind === "weekly-window";
}

/**
 * One measured plan's gauge, off the snapshot {@link judgeWeekly} judged fresh.
 *
 * @param plan the register row, for its allowance and usage limit
 * @param snapshot the fresh recorded reading
 * @returns the plan's gauge, as the router reads one
 */
function planGaugeOf({ plan, snapshot }: { plan: RegisteredPlan; snapshot: ClaudePlanUsageSnapshot }): ClaudePlanGauge {
  const account: ClaudeAccountGauge = {
    alias: plan.alias,
    observedAtIso: snapshot.observedAtIso,
    sevenDay: snapshot.sevenDay,
    ...(snapshot.sevenDayFable === undefined ? {} : { sevenDayFable: snapshot.sevenDayFable }),
  };
  return claudePlanGauge({ account: plan, gauge: account });
}

/** The `read` arm of the cadence's gauge. */
type ReadCadenceGauge = Extract<ChairCadenceGauge, { kind: "read" }>;

/**
 * The cadence's rows, in register order: a complete row per plan with a Fable week, a week-only row per plan without.
 *
 * @param gauges every measured plan's gauge, in register order
 * @returns the complete rows and the week-only rows
 */
function cadenceRowsOf({ gauges }: { gauges: readonly ClaudePlanGauge[] }): {
  plans: ReadCadenceGauge["plans"];
  weekOnly: NonNullable<ReadCadenceGauge["weekOnly"]>;
} {
  const plans: ReadCadenceGauge["plans"][number][] = [];
  const weekOnly: NonNullable<ReadCadenceGauge["weekOnly"]>[number][] = [];
  for (const gauge of gauges) {
    const weekPct = percentOf({ window: gauge.sevenDay });
    if (gauge.sevenDayFable === undefined) {
      weekOnly.push({ plan: gauge.alias, usageLimitPercent: gauge.usageLimitPercent, weekPct });
      continue;
    }
    plans.push({
      fablePct: percentOf({ window: gauge.sevenDayFable }),
      plan: gauge.alias,
      usageLimitPercent: gauge.usageLimitPercent,
      weekPct,
    });
  }
  return { plans, weekOnly };
}

/**
 * The gauge the cadence judges on once at least one plan measured: the rows, the router's chair route, the gaps.
 *
 * @param gaps every plan the gauge could not judge, and why
 * @param gauges every measured plan's gauge, in register order
 * @param spends each unpaused monthly-spend plan's verdict
 * @param thresholds the install's Claude thresholds
 * @returns the `read` gauge
 */
function readGaugeOf({
  gaps,
  gauges,
  spends,
  thresholds,
}: {
  gaps: readonly string[];
  gauges: readonly ClaudePlanGauge[];
  spends: readonly ClaudePlanSpend[];
  thresholds: ClaudeThresholds;
}): ChairCadenceGauge {
  const targets = nextSpawnTargets({ gauges, spends, thresholds });
  const rows = cadenceRowsOf({ gauges });
  return {
    ...(targets.chairLevelWith === undefined ? {} : { chairLevelWith: targets.chairLevelWith }),
    ...(gaps.length === 0 ? {} : { gap: gaps.join("; ") }),
    kind: "read",
    nextChair: unsetFieldAsNull({ key: "nextChair", record: targets }),
    plans: rows.plans,
    thresholds: cadenceThresholdsFrom({ thresholds }),
    weekOnly: rows.weekOnly,
  };
}

/**
 * Set each reading's chair flag from the plans the chair's sessions booted on.
 *
 * @param readings the readings {@link recordedChairGauge} returned
 * @param chairPlans the aliases a chair session spends, Claude only
 * @returns the readings, each flagged when a chair session spends it
 */
export function markChairReadings({
  readings,
  chairPlans,
}: {
  readings: readonly ChairWatchReading[];
  chairPlans: readonly string[];
}): readonly ChairWatchReading[] {
  return readings.map((reading) => ({
    ...reading,
    chair: reading.vendor === "claude" && chairPlans.includes(reading.alias),
  }));
}
