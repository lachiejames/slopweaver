/**
 * The readable gauges the pre-spawn gate decides from: every configured plan probed through `probeRepair.ts`'s
 * two-pass read, each repair and each unreadable plan said out loud, and only the readings that came back kept.
 *
 * Both arms of `spawnStore.ts` — routing an unpinned spawn and judging a pinned seat — take the same sweep, so it
 * is one function rather than two copies of the probe-then-filter pair.
 *
 * ## Why the gate files what it probed
 *
 * The owner's sign-in note (`claude-plan-unusable`) floats from the plan-probe register, and that register used to
 * hear only from `claude gauge` and the `claude watch` keep-alive. Every spawn probes every plan, so a plan the
 * provider refused on every spawn could sit out of the fleet with the gate saying so in a transcript nobody reads.
 * MEASURED on this machine: one plan printed its refusal on every spawn for over three hours while the keep-alive
 * had last recorded days earlier. So the sweep records each plan's EFFECTIVE probe — the second one when a repair
 * re-probed — and a store that could not record is a stderr line, never a refusal and never a changed route.
 */
import { logger } from "#lib/logger.js";

import { type ClaudeAccount, type ClaudePlanGauge, claudePlanGauge } from "./contracts.js";
import type { ClaudePlanProbesPort } from "./planProbes.js";
import { effectiveProbe, type ProbeRepairDeps, probePlansWithRepair, renderRepair } from "./probeRepair.js";
import { recordableProbes, recordPlanProbes } from "./recordPlanProbes.js";

/**
 * Probe every plan, repairing any whose token had merely expired, file what each plan's effective probe found, and
 * keep the gauges that came back readable.
 *
 * Each reading is PAIRED here with the account it was probed against (`claudePlanGauge`), so every gate downstream
 * judges it against that plan's own usage limit — this is the one place the probe and the policy meet.
 *
 * @param accounts the configured plans to probe, already filtered to the unpaused, PROBED ones — a monthly-spend
 *   plan is never probed for routing, since the probe is itself a billed request and its spend reading is its
 *   evidence (`./spendBudgets.ts`)
 * @param deps the repair seams
 * @param home the Slopweaver home whose store keeps the plan-probe register
 * @param probesPort where the register is kept — required, so a gate a test forgot to inject cannot reach a real store
 * @returns the readings routing may choose from, each carrying its plan's usage policy, in configured order
 */
export async function readSpawnGauges({
  accounts,
  deps,
  home,
  probesPort,
}: {
  accounts: readonly ClaudeAccount[];
  deps: ProbeRepairDeps;
  home: string;
  probesPort: ClaudePlanProbesPort;
}): Promise<readonly ClaudePlanGauge[]> {
  const repairs = await probePlansWithRepair({ accounts, deps });
  const gauges = repairs.flatMap((repair) => {
    const line = renderRepair({ repair });
    if (line !== undefined) {
      logger.error({ msg: line });
    }
    const { gauge, problem } = effectiveProbe({ repair }).outcome;
    if (problem !== undefined) {
      logger.error({ msg: `claude routing: ${repair.account.alias} unreadable — ${problem}` });
    }
    return gauge === undefined ? [] : [claudePlanGauge({ account: repair.account, gauge })];
  });
  // `recordableProbes` keeps a paused plan out even though no production caller passes one: the paused-plan rule
  // belongs at the write, not at whichever caller happened to filter first.
  const probes = recordableProbes({
    accounts,
    probes: repairs.map((repair) => ({
      alias: repair.account.alias,
      reading: effectiveProbe({ repair }).reading,
      storeDir: repair.account.storeDir,
    })),
  });
  // One clock reading for the whole finished sweep, so the record is dated no earlier than its last probe.
  for (const problem of await recordPlanProbes({ home, nowIso: deps.nowIso(), port: probesPort, probes })) {
    logger.error({ msg: `claude routing: ${problem}` });
  }
  return gauges;
}
