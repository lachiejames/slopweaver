/**
 * `slopweaver fleet recover` — whether each vendor can start a session in the desktop app, the plan it worked on and why
 * not otherwise, and, when the supervisor is down, a new one seated on the first plan that passed (`./recoverChair.ts`).
 * It is run from the command line, or by the desktop app when the owner presses Recovery
 * (`desktop/src/fleetProcess.ts`'s `recoverFleet`, the one app child that causes visible app sessions). It works with no model running,
 * because nothing in it is one. What a pass does lives in `../../../fleet/recoveryPass.ts`; this file is the flag, the
 * lock, the real effects and the exit code.
 *
 * Exactly one JSON line goes to stdout; every diagnostic, the gates' own included, goes to stderr.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { logger } from "#lib/logger.js";
import { isContained } from "#lib/pathContainment.js";
import { installedTreeRoot } from "#lib/pluginRoot.js";

import { claudePlanProbesPort } from "../../../claude/planProbes.js";
import { readCodexAccountsLive } from "../../../codex/accountLive.js";
import { codexFleetCapPort } from "../../../codex/fleetCapPort.js";
import { codexSignInPort } from "../../../codex/signInPort.js";
import { acquireFleetRecoverLock } from "../../../fleet/locks.js";
import type { FleetRecoveryResult, RecoveryEvidence, RecoveryVendor } from "../../../fleet/recoveryCheck.js";
import { readClaudeRecoveryEvidence } from "../../../fleet/recoveryClaude.js";
import { readCodexRecoveryEvidence } from "../../../fleet/recoveryCodex.js";
import { appRecoveryHost, recoveryLaunchDeps } from "../../../fleet/recoveryHost.js";
import { runRecoveryPass } from "../../../fleet/recoveryPass.js";
import type { RecoveryChairDeps, RecoveryHost, RecoveryPassDeps } from "../../../fleet/recoveryPassDeps.js";
import { clearRecoveryScratch, makeRecoveryScratch, recoveryScratchRoot } from "../../../fleet/recoveryScratch.js";
import { planRegisterPort } from "../../../plans/port.js";
import { APP_SOCKET_ROOT, socketAppTransport } from "../../../sessionHarness/appSocketTransport.js";
import { sessionLedgerDeps } from "../../../sessionHarness/sessionLedger.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { stringFlag } from "./core.js";
import { fleetFlagsOnly } from "./flagsOnly.js";
import { realRecoveryChair } from "./recoverChair.js";

/** How long between two looks at a session. */
const LOOK_EVERY_MS = 1000;

/** The effects one invocation runs over, each built for the home it was given. */
export interface FleetRecoverDeps extends Pick<RecoveryPassDeps, "nowMs" | "pause" | "randomBytes"> {
  /**
   * The desktop app.
   *
   * @param options the state home, and whether a directory is inside its scratch
   * @returns the host
   */
  readonly host: (options: { home: string; holds: (options: { directory: string }) => boolean }) => RecoveryHost;
  /**
   * The supervisor chair.
   *
   * @param options the state home, and the app the chair is read through
   * @returns the chair
   */
  readonly chair: (options: { home: string; host: RecoveryHost }) => RecoveryChairDeps;
  /**
   * What routing says about one vendor's plans.
   *
   * @param options the state home and the vendor
   * @returns the evidence
   */
  readonly evidence: (options: { home: string; vendor: RecoveryVendor }) => Promise<RecoveryEvidence>;
  /**
   * The pass's own id.
   *
   * @returns a fresh id, safe as a path segment
   */
  readonly runId: () => string;
}

/** The exit code a result reads as: a pass that left the supervisor down unrestarted is no success. */
function recoverExit({ result }: { result: FleetRecoveryResult }): number {
  switch (result.status) {
    case "passed":
      return result.chair.outcome === "not-restarted" ? EXIT_EXPECTED_EMPTY : EXIT_OK;
    case "partial":
    case "failed":
      return EXIT_EXPECTED_EMPTY;
    case "infrastructure-failed":
      return EXIT_ERROR;
    default: {
      const unreachable: never = result.status;
      return unreachable;
    }
  }
}

/**
 * `fleet recover` over the effects it runs on — the verb's whole body.
 *
 * @param argv the full process argv
 * @param deps the app, the plans and the clock
 * @returns 0 when both vendors answered and the supervisor runs or is starting, 3 when one or neither did or a down
 *   supervisor was not restarted, 1 when the check itself could not run or clean up, and 4 when another check is running
 */
export async function fleetRecover({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: FleetRecoverDeps;
}): Promise<number> {
  const parsed = fleetFlagsOnly({ argv, verb: "recover" });
  if (typeof parsed === "number") {
    return parsed;
  }
  // Absolute, so the scratch root and every session directory compared against it resolve the same way whatever
  // directory the verb was started in.
  const home = resolve(resolveHome({ named: stringFlag({ name: "home", parsed }) }));
  const lock = acquireFleetRecoverLock({ home, nowIso: new Date(deps.nowMs()).toISOString() });
  if (lock.isErr()) {
    logger.error({ msg: `fleet recover: ${lock.error.message}` });
    return lock.error.code === "LOCK_HELD" ? EXIT_DEFERRED : EXIT_ERROR;
  }
  const root = recoveryScratchRoot({ home });
  const holds = ({ directory }: { directory: string }): boolean => isContained({ candidate: directory, root });
  try {
    const host = deps.host({ holds, home });
    const result = await runRecoveryPass({
      deps: {
        chair: deps.chair({ home, host }),
        evidence: async ({ vendor }) => deps.evidence({ home, vendor }),
        host,
        lockHeld: lock.value.stillHeld,
        nowMs: deps.nowMs,
        pause: deps.pause,
        randomBytes: deps.randomBytes,
        scratch: {
          clear: () => clearRecoveryScratch({ home }),
          holds,
          make: ({ attemptId }) => makeRecoveryScratch({ attemptId, home }),
        },
      },
      runId: deps.runId(),
    });
    logger.out({ line: JSON.stringify(result) });
    return recoverExit({ result });
  } finally {
    lock.value.release();
  }
}

/** One vendor's plans, read from the real register and probes. */
async function realEvidence({ home, vendor }: { home: string; vendor: RecoveryVendor }): Promise<RecoveryEvidence> {
  if (vendor === "claude") {
    return readClaudeRecoveryEvidence({
      deps: undefined,
      home,
      port: planRegisterPort(),
      probesPort: claudePlanProbesPort(),
      storeExists: existsSync,
    });
  }
  return readCodexRecoveryEvidence({
    fleetCap: codexFleetCapPort(),
    home,
    nowIso: new Date().toISOString(),
    port: planRegisterPort(),
    readLive: readCodexAccountsLive,
    signInPort: codexSignInPort(),
  });
}

/** The installed desktop app, over its socket. */
function realHost({ holds, home }: { holds: (options: { directory: string }) => boolean; home: string }): RecoveryHost {
  const repoRoot = installedTreeRoot({ importMetaUrl: import.meta.url });
  return appRecoveryHost({
    deps: {
      holds,
      home,
      launch: recoveryLaunchDeps({
        home,
        inherited: process.env,
        pluginDir: repoRoot,
        port: planRegisterPort(),
        probesPort: claudePlanProbesPort(),
      }),
      ledger: sessionLedgerDeps({ home }),
      repoRoot,
      transport: socketAppTransport({ root: APP_SOCKET_ROOT }),
    },
  });
}

/**
 * `fleet recover` — one visible throwaway session per vendor, closed again, and what each said.
 *
 * @param argv the full process argv
 * @returns the exit code {@link fleetRecover} answers
 */
export async function runFleetRecover(argv: readonly string[]): Promise<number> {
  return fleetRecover({
    argv,
    deps: {
      chair: realRecoveryChair,
      evidence: realEvidence,
      host: realHost,
      nowMs: () => Date.now(),
      pause: async () => sleep(LOOK_EVERY_MS),
      randomBytes,
      runId: randomUUID,
    },
  });
}

export const fleetRecoverCommand = defineCommand({ run: runFleetRecover });
