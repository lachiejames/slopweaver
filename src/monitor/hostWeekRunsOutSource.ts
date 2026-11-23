/**
 * The effectful half of `host-week-runs-out`: read the plan register, the newest filed `machine capacity`
 * reading and the trailing week of them, the Claude drawdown journal, and whether this monitor's card is already
 * open; then project each model host and fold the two.
 *
 * Every read is local — the register through its port, the readings ledger, the journal and the hand register — so a
 * pass spends no probe and opens no connection off the machine. Both model hosts are always projected at the opening
 * bar; only while a card is held are they projected at the holding bar too, and `./hostWeekRunsOutHold.ts` admits
 * from that run only what keeps the held card. An unreadable hand register reads as no card, so it can only make
 * the bar stricter.
 */
import { parseIsoMs } from "#lib/date.js";
import { isRecord } from "#lib/parsers.js";

import { ceilingsReadingSchema } from "../capacity/ceilingsSchema.js";
import { type DemandPoint, trailingWeekDemand } from "../capacity/weekDemand.js";
import type { HostWeekProjection, WeekRiskCriterion } from "../capacity/weekRisk.js";
import { samplesOf } from "../claude/drawdownJournal.js";
import { readDrawdownJournal } from "../claude/drawdownJournalStore.js";
import { readClaudeFleet } from "../claude/spawnAccounts.js";
import { forecastSurvival } from "../claude/survivalForecast.js";
import { survivalPlansOf } from "../claude/survivalPlanState.js";
import { claudeWeekProjection, journalSpanHours } from "../claude/weekRisk.js";
import { codexWeekProjection } from "../codex/weekRisk.js";
import { openHandSteps } from "../hand/row.js";
import { handRegisterPath, readHandRows } from "../hand/store.js";
import type { PlanRegisterPort } from "../plans/port.js";
import type { CodexThresholds } from "../plans/thresholds.js";
import type { RegisteredPlan } from "../plans/types.js";
import { readingsInWindow } from "../readings/store.js";

import { FLEET_DRY_MAX_AGE_MS } from "./fleetRunsDryCeilings.js";
import { CAPACITY_PRODUCER, filedCeilings } from "./fleetRunsDrySource.js";
import {
  hostWeekRunsOutReading,
  PLAN_WEEK_HOLDING,
  PLAN_WEEK_OPENING,
  type PlanWeekProjections,
} from "./hostWeekRunsOut.js";
import { heldPlanWeek, planWeekHeldRevisions } from "./hostWeekRunsOutHold.js";
import type { MonitorReading } from "./types.js";

/** How far back the Codex draw is read: one week, the window the Claude forecast's trailing demand also spans. */
const DEMAND_WINDOW_MS = 7 * 24 * 3_600_000;

/** An `unmeasurable` reading of this monitor, saying why. */
function unmeasurable({ because }: { because: string }): MonitorReading {
  return { because, monitorId: "host-week-runs-out", state: "unmeasurable" };
}

/**
 * Every filed capacity reading in the trailing week, decoded — or why the week cannot be measured. One reading that
 * does not decode makes the whole week unmeasurable rather than being skipped: dropping the EARLIEST reading shortens
 * the span the draw is divided by while keeping all of its draw, so a skip can double the rate and fire a card the
 * full series would not. Unmeasurable reads quiet, the side this monitor errs on.
 */
function demandSeries({
  home,
  nowIso,
}: {
  home: string;
  nowIso: string;
}): readonly DemandPoint[] | { because: string } {
  const fromIso = new Date(Date.parse(nowIso) - DEMAND_WINDOW_MS).toISOString();
  const series = readingsInWindow({ fromIso, home, producer: CAPACITY_PRODUCER, toIso: nowIso });
  if (series.isErr()) {
    return { because: `the trailing capacity readings could not be read: ${series.error.message}` };
  }
  const points: DemandPoint[] = [];
  for (const { document } of series.value) {
    const parsed = isRecord(document) ? ceilingsReadingSchema.safeParse(document["ceilings"]) : undefined;
    if (parsed === undefined || !parsed.success) {
      return {
        because: `a capacity reading in the trailing week does not decode, so the Codex draw is not measured (${String(series.value.length)} readings read)`,
      };
    }
    points.push({ ceilings: parsed.data.ceilings, observedAtIso: parsed.data.observedAtIso });
  }
  return points;
}

/** The Codex projection off the filed readings, or why the readings cannot start one. */
function codexProjection({
  criterion,
  home,
  nowIso,
  registered,
  thresholds,
}: {
  criterion: WeekRiskCriterion;
  home: string;
  nowIso: string;
  registered: readonly RegisteredPlan[];
  thresholds: CodexThresholds;
}): HostWeekProjection {
  // A held machine stops seats for its own reason; the plans' windows are measured all the same.
  const reading = filedCeilings({ home, machineHold: "read", nowIso });
  if ("because" in reading) {
    return { kind: "unmeasurable", why: reading.because };
  }
  const observedMs = parseIsoMs({ tsIso: reading.observedAtIso });
  const nowMs = parseIsoMs({ tsIso: nowIso });
  if (observedMs === undefined || nowMs === undefined || nowMs - observedMs > FLEET_DRY_MAX_AGE_MS) {
    return {
      kind: "unmeasurable",
      why: `the newest capacity reading, observed ${reading.observedAtIso}, is older than ${String(FLEET_DRY_MAX_AGE_MS / 3_600_000)}h`,
    };
  }
  const series = demandSeries({ home, nowIso });
  if ("because" in series) {
    return { kind: "unmeasurable", why: series.because };
  }
  const demand = trailingWeekDemand({ kind: "codex", points: series, window: "weekly" });
  return codexWeekProjection({ criterion, demand, reading, registered, thresholds });
}

/** The Claude projection off the drawdown journal, or why the journal cannot start one. */
async function claudeProjection({
  criterion,
  home,
  nowIso,
  port,
  registered,
}: {
  criterion: WeekRiskCriterion;
  home: string;
  nowIso: string;
  port: PlanRegisterPort;
  registered: readonly RegisteredPlan[];
}): Promise<HostWeekProjection> {
  const fleet = await readClaudeFleet({ home, port });
  if (fleet.isErr()) {
    return { kind: "unmeasurable", why: `the Claude plans could not be read: ${fleet.error.message}` };
  }
  const journal = readDrawdownJournal({ home });
  if (journal.isErr()) {
    return { kind: "unmeasurable", why: `the Claude drawdown journal could not be read: ${journal.error.message}` };
  }
  const samples = samplesOf({ events: journal.value.events });
  const read = forecastSurvival({
    demandBasis: "trailing",
    nowIso,
    plans: survivalPlansOf({ accounts: fleet.value.accounts }),
    samples,
    thresholds: fleet.value.thresholds,
    weeks: 1,
  });
  return claudeWeekProjection({ criterion, read, registered, spanHours: journalSpanHours({ nowIso, samples }) });
}

/**
 * The revisions of this monitor's cards held open now, so the pass may hold them on the looser criterion.
 *
 * @param home the state home the hand register lives under
 * @param nowIso the judged instant; a card whose key has lapsed by then is settled this pass, so it holds nothing
 * @param stepPrefix the id prefix every card of this monitor carries
 * @returns each held card's revision; empty when none is held or the register does not read
 */
function heldRevisions({
  home,
  nowIso,
  stepPrefix,
}: {
  home: string;
  nowIso: string;
  stepPrefix: string;
}): readonly string[] {
  const register = readHandRows({ missing: "empty", path: handRegisterPath({ home }) });
  if (register.isErr()) {
    return [];
  }
  const openIds = openHandSteps({ rows: register.value.rows }).map((step) => step.id);
  return planWeekHeldRevisions({ nowIso, openIds, stepPrefix });
}

/** Both model hosts projected at one criterion. */
async function projectBoth({
  criterion,
  home,
  nowIso,
  port,
  registered,
  thresholds,
}: {
  criterion: WeekRiskCriterion;
  home: string;
  nowIso: string;
  port: PlanRegisterPort;
  registered: readonly RegisteredPlan[];
  thresholds: CodexThresholds;
}): Promise<PlanWeekProjections> {
  const codex = codexProjection({ criterion, home, nowIso, registered, thresholds });
  const claude = await claudeProjection({ criterion, home, nowIso, port, registered });
  return { claude, codex };
}

/**
 * Read and evaluate `host-week-runs-out`.
 *
 * @param home the state home every source lives under
 * @param nowIso the instant to judge at — `--now` replays a past pass against the ledger and journal as of then
 * @param port where the plan register is read
 * @param stepPrefix the id prefix this monitor's cards carry, so an open one is held on the looser criterion
 * @returns firing on an at-risk model host, clear, or unmeasurable naming each gap
 */
export async function readHostWeekRunsOut({
  home,
  nowIso,
  port,
  stepPrefix,
}: {
  home: string;
  nowIso: string;
  port: PlanRegisterPort;
  stepPrefix: string;
}): Promise<MonitorReading> {
  const register = await port.read({ home });
  if (register.isErr()) {
    return unmeasurable({ because: `the plan register could not be read: ${register.error.message}` });
  }
  const shared = { home, nowIso, port, registered: register.value.plans, thresholds: register.value.thresholds.codex };
  const opening = await projectBoth({ ...shared, criterion: PLAN_WEEK_OPENING });
  const held = heldRevisions({ home, nowIso, stepPrefix });
  if (held.length === 0) {
    return hostWeekRunsOutReading({ projections: opening });
  }
  const holding = await projectBoth({ ...shared, criterion: PLAN_WEEK_HOLDING });
  return hostWeekRunsOutReading({ projections: heldPlanWeek({ heldRevisions: held, holding, opening }) });
}
