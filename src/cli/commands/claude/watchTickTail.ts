/**
 * The three halves of a `claude watch` tick that ride the readings it already took — the drawdown journal, each
 * plan's usage snapshot the running-seat gate judges a limited plan by (`../../../claude/planUsageSnapshotStore.ts`),
 * and the per-plan health record whose `claude-plan-unusable` pass floats a note on a plan gone signed out, missing
 * locally or failing its probe. None probes again and none is a daemon; `--dry-run` writes none of them.
 *
 * ## Why the keep-alive fires the pass itself
 *
 * One gap: `plan-two` sat unread about 72 hours with no note, and no supervisor tick ran for about 46
 * of them. The keep-alive is the probe most likely to be running, so it records what it found and fires the pass at
 * once, in-process through `monitor check --only claude-plan-unusable --fire` exactly as `../turn/signInCard.ts` fires
 * its monitor. The fired-pass lock (`../../../monitor/firedPassLock.ts`) keeps a concurrent chair tick from posting
 * the same card twice. A refused pass is REPORTED and changes nothing above it.
 *
 * A watch whose own read of the plans register fails — at its opening, or on a re-read between ticks — has no tick
 * to finish, and fires the pass bare ({@link firePlanHealth}) so the register card still goes up; `--dry-run` fires
 * nothing there either.
 */
import type { ClaudeAccountGauge } from "../../../claude/contracts.js";
import { type DrawdownTickMode, processDrawdownTick } from "../../../claude/drawdownTick.js";
import { type ClaudePlanProbesPort, claudePlanProbesPort } from "../../../claude/planProbes.js";
import { recordPlanUsageSnapshots } from "../../../claude/planUsageSnapshotStore.js";
import { recordPlanProbes, type SweptPlanProbe } from "../../../claude/recordPlanProbes.js";
import { logger } from "../../../lib/logger.js";
import { runMonitorCheck } from "../monitor/check.js";
import { hostedPassDeps, type MonitorDeps, productionMonitorDeps } from "../monitor/deps.js";
import { PRODUCTION_DRAWDOWN_DEPS } from "./drawdownDeps.js";

/**
 * Record each plan's probe, then run the `claude-plan-unusable` pass once over the result.
 *
 * @param deps the monitor seams — `productionMonitorDeps()` from a verb, plain fakes from a test
 * @param home the state home the probes and the hand register live under
 * @param nowIso this tick's instant, stamped on each probe record
 * @param probes each configured plan's store and typed reading, as this tick took them
 * @param probesPort where the probe records are kept
 * @param verb the verb firing it, recorded as the acting session and named on any refusal line
 * @returns the pass's exit code, which the caller reports and never returns as its own
 */
export async function recordAndFirePlanHealth({
  deps,
  home,
  nowIso,
  probes,
  probesPort,
  verb,
}: {
  deps: MonitorDeps;
  home: string;
  nowIso: string;
  probes: readonly SweptPlanProbe[];
  probesPort: ClaudePlanProbesPort;
  verb: string;
}): Promise<number> {
  const problems = await recordPlanProbes({ home, nowIso, port: probesPort, probes });
  for (const problem of problems) {
    logger.error({ msg: `${verb}: ${problem}` });
  }
  return firePlanHealth({ deps, home, verb });
}

/**
 * Run the `claude-plan-unusable` pass once, recording nothing first — what a watch does when its own read of the
 * plans register failed, so there was no tick to record. The pass reads the register itself and floats the ONE
 * register card when it still does not read (the owner should hear early), so the keep-alive
 * that cannot tick is still the probe that tells them.
 *
 * @param deps the monitor seams — `productionMonitorDeps()` from a verb, plain fakes from a test
 * @param home the state home the hand register lives under
 * @param verb the verb firing it, recorded as the acting session and named on any refusal line
 * @returns the pass's exit code, which the caller reports and never returns as its own
 */
export async function firePlanHealth({
  deps,
  home,
  verb,
}: {
  deps: MonitorDeps;
  home: string;
  verb: string;
}): Promise<number> {
  const code = await runMonitorCheck({
    // `claude watch` owns stdout, its `--json` document included, so the pass reports on stderr.
    deps: hostedPassDeps({ deps }),
    rest: ["--only", "claude-plan-unusable", "--fire", "--by-session", verb, "--home", home],
  });
  if (code !== 0) {
    logger.error({
      msg:
        `${verb}: the plan-health pass exited ${String(code)} — ` +
        "the chair's next tick runs `slopweaver monitor check --only claude-plan-unusable --fire` again",
    });
  }
  return code;
}

/**
 * What a watch does when its own read of the plans register failed: fire {@link firePlanHealth} over the production
 * seams, unless the run is a dry run, which writes nothing.
 *
 * @param dryRun whether the run reports without touching anything
 * @param home the state home the hand register lives under
 * @returns nothing; a refused pass is reported on stderr
 */
export async function fireOnUnreadRegister({ dryRun, home }: { dryRun: boolean; home: string }): Promise<void> {
  if (dryRun) {
    return;
  }
  await firePlanHealth({ deps: productionMonitorDeps(), home, verb: "claude watch" });
}

/**
 * Which drawdown mode this tick runs in.
 *
 * @param dryRun whether the tick reports without touching anything
 * @param once whether this is a single reporting pass rather than the recurring loop
 * @returns the mode
 */
function drawdownModeFor({ dryRun, once }: { dryRun: boolean; once: boolean }): DrawdownTickMode {
  if (dryRun) {
    return "dry-run";
  }
  return once ? "sample-only" : "watch";
}

/**
 * Finish one tick: the drawdown half, then — unless the tick is a dry run — each plan's usage snapshot, and the
 * plan-health record and its pass.
 *
 * Only the recurring foreground loop may open a drawdown investigation: `--dry-run` writes nothing and `--once`
 * records the sample without spawning, so neither a report nor a probe opens a workspace as a side effect.
 *
 * @param dryRun whether this tick reports without touching anything
 * @param gauges the readings this tick took
 * @param home the state home the journal, the probe records and the hand register live under
 * @param nowIso this tick's instant
 * @param once whether this is a single pass rather than the recurring loop
 * @param probes each configured plan's store and typed reading, as this tick took them
 * @param wantsJson whether the machine document is being emitted instead of human lines
 * @returns nothing
 */
export async function finishWatchTick({
  dryRun,
  gauges,
  home,
  nowIso,
  once,
  probes,
  wantsJson,
}: {
  dryRun: boolean;
  gauges: readonly ClaudeAccountGauge[];
  home: string;
  nowIso: string;
  once: boolean;
  probes: readonly SweptPlanProbe[];
  wantsJson: boolean;
}): Promise<void> {
  const drawdown = await processDrawdownTick({
    deps: PRODUCTION_DRAWDOWN_DEPS,
    gauges,
    home,
    mode: drawdownModeFor({ dryRun, once }),
    nowIso,
  });
  if (!wantsJson) {
    for (const line of drawdown.lines) {
      logger.out({ line });
    }
  }
  for (const problem of drawdown.errors) {
    logger.error({ msg: `claude watch: ${problem}` });
  }
  if (dryRun) {
    return;
  }
  // The lease is dated by the wall clock as it is taken, never the tick's `nowIso`, which the sweep may have outlived.
  const wallClock = (): string => new Date().toISOString();
  for (const problem of recordPlanUsageSnapshots({ gauges, home, now: wallClock })) {
    logger.error({ msg: `claude watch: ${problem.message}` });
  }
  await recordAndFirePlanHealth({
    deps: productionMonitorDeps(),
    home,
    nowIso,
    probes,
    probesPort: claudePlanProbesPort(),
    verb: "claude watch",
  });
}
