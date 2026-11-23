/**
 * What `claude gauge` keeps of a sweep for the verbs that judge it later: each plan's probe outcome, and each plan's
 * usage snapshot. Neither calls a provider, and a failure is said on stderr, never fatal.
 */
import type { ChairProbe } from "../../../claude/chairBudgetAlert.js";
import type { ClaudeAccount, ClaudePlanGauge } from "../../../claude/contracts.js";
import { claudePlanProbesPort } from "../../../claude/planProbes.js";
import { recordPlanUsageSnapshots } from "../../../claude/planUsageSnapshotStore.js";
import { recordableProbes, recordPlanProbes, type SweptPlanProbe } from "../../../claude/recordPlanProbes.js";
import { logger } from "../../../lib/logger.js";

/**
 * Record a sweep's probe outcomes and usage snapshots, saying each failure on stderr.
 *
 * @param chairProbe the chair's own probe, whose reading is kept too
 * @param configured every configured plan, paused included
 * @param gauges the readable gauges the sweep took
 * @param home the state home
 * @param nowIso when the sweep ran, which dates the probe records
 * @param probes every swept plan's probe outcome
 */
export async function keepSweepReadings({
  chairProbe,
  configured,
  gauges,
  home,
  nowIso,
  probes,
}: {
  chairProbe: ChairProbe;
  configured: readonly ClaudeAccount[];
  gauges: readonly ClaudePlanGauge[];
  home: string;
  nowIso: string;
  probes: readonly SweptPlanProbe[];
}): Promise<void> {
  // Kept for `claude-plan-unusable`, which the tick fires right after this reading.
  const recordable = recordableProbes({ accounts: configured, probes });
  const port = claudePlanProbesPort();
  for (const line of await recordPlanProbes({ home, nowIso, port, probes: recordable })) {
    logger.error({ msg: `claude gauge: ${line}` });
  }
  // The running-seat gate judges each limited plan's seats against this, so every reading this sweep already took is
  // kept — a paused plan the chair still spends included.
  const readings = [...gauges, ...(chairProbe.chairReading === undefined ? [] : [chairProbe.chairReading])];
  // The lease is dated by the wall clock as it is taken, never `nowIso`, which the sweep may have outlived.
  const wallClock = (): string => new Date().toISOString();
  for (const problem of recordPlanUsageSnapshots({ gauges: readings, home, now: wallClock })) {
    logger.error({ msg: `claude gauge: ${problem.message}` });
  }
}
