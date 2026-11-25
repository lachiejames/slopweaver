/**
 * Which Claude plans `slopweaver fleet recover` may open a throwaway session on, best first, and why it may not open one
 * on the rest.
 *
 * It asks the spawn gate's own questions of the spawn gate's own evidence — the register, one repaired sweep of every
 * weekly plan, the recorded spend of every monthly one, and the one ranker — rather than holding a second opinion. What
 * it adds is the whole list: a spawn needs the best plan, while this falls back from one to the next and has to say why
 * each plan it skipped was skipped. The spawn gate still judges the plan again when its session opens.
 */
import { shellQuoteToken } from "#lib/shellCommandLine.js";

import { unpausedAccounts } from "../claude/config.js";
import { type ClaudeAccount, probedClaudeAccount } from "../claude/contracts.js";
import { rankClaudeBudgets } from "../claude/loadBalance.js";
import { isSignInFault, observationOfReading } from "../claude/planProbeRecord.js";
import type { ClaudePlanProbesPort } from "../claude/planProbes.js";
import { type ProbeRepairDeps, repairSeams } from "../claude/probeRepair.js";
import { readClaudeFleet } from "../claude/spawnAccounts.js";
import { type SpawnGaugeSweep, sweepSpawnGauges } from "../claude/spawnGauges.js";
import { readClaudePlanSpends } from "../claude/spendBudgets.js";
import type { PlanRegisterPort } from "../plans/port.js";
import type { RecoveryCandidate, RecoveryEvidence, RecoveryExclusion } from "./recoveryCheck.js";

/** The plans the owner paused, each with their own words for why. */
function pausedExclusions({ accounts }: { accounts: readonly ClaudeAccount[] }): readonly RecoveryExclusion[] {
  return accounts.flatMap((account) =>
    account.paused === undefined
      ? []
      : [{ alias: account.alias, reason: `paused: ${account.paused.reason}`, vendor: "claude" as const }],
  );
}

/** One plan the sweep could not read, naming its sign-in only when the probe proved that is what it is missing. */
function unreadExclusion({
  unread,
  storeExists,
}: {
  unread: SpawnGaugeSweep["unread"][number];
  storeExists: (path: string) => boolean;
}): RecoveryExclusion {
  const { alias, storeDir } = unread.account;
  const observation = observationOfReading({ reading: unread.reading, storeExists: storeExists(storeDir) });
  if (observation.kind === "fault" && isSignInFault({ code: observation.code })) {
    return {
      alias,
      reason: observation.message,
      signInCommand: `slopweaver claude signin --plan ${shellQuoteToken({ token: alias })}`,
      vendor: "claude",
    };
  }
  return { alias, reason: unread.problem, vendor: "claude" };
}

/**
 * Read every Claude plan once and say which a throwaway session may open on.
 *
 * @param deps the probe and repair seams, or undefined for the real ones
 * @param home the state home whose register, probe record and spend readings are read
 * @param port where the plan register is read
 * @param probesPort where the sweep files what it probed, as every sweep does
 * @param storeExists whether a plan's store directory is on this machine
 * @returns the plans routing would spend, best first, and the ones it would not
 */
export async function readClaudeRecoveryEvidence({
  deps,
  home,
  port,
  probesPort,
  storeExists,
}: {
  deps: ProbeRepairDeps | undefined;
  home: string;
  port: PlanRegisterPort;
  probesPort: ClaudePlanProbesPort;
  storeExists: (path: string) => boolean;
}): Promise<RecoveryEvidence> {
  const fleet = await readClaudeFleet({ home, port });
  if (fleet.isErr()) {
    return { candidates: [], excluded: [], unreadable: fleet.error.message, vendor: "claude" };
  }
  const { accounts, thresholds } = fleet.value;
  if (accounts === undefined) {
    return { candidates: [], excluded: [], vendor: "claude" };
  }
  const live = unpausedAccounts({ accounts });
  const seams = repairSeams({ deps });
  const sweep = await sweepSpawnGauges({
    accounts: live.filter((account) => probedClaudeAccount({ account })),
    deps: seams,
    home,
    probesPort,
  });
  const ranking = rankClaudeBudgets({
    gauges: sweep.gauges,
    modelClass: "all-models",
    spends: readClaudePlanSpends({ accounts: live, home, nowIso: seams.nowIso() }),
    thresholds,
  });
  return {
    candidates: ranking.ranked.flatMap(({ alias }): readonly RecoveryCandidate[] =>
      live
        .filter((account) => account.alias === alias)
        .map((account) => ({ alias, storeDir: account.storeDir, vendor: "claude" })),
    ),
    excluded: [
      ...sweep.unread.map((unread) => unreadExclusion({ storeExists, unread })),
      ...ranking.excluded.map(({ alias, reason }) => ({ alias, reason, vendor: "claude" as const })),
      ...pausedExclusions({ accounts }),
    ],
    vendor: "claude",
  };
}
