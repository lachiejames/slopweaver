/**
 * How one lap lane runs: its own process group, its output in its own log file, killed whole at the ceiling.
 * Synchronous on purpose: no lap work runs beside a step, and rule 2 admits no asynchronous child here.
 *
 * The cost of that, stated: a JavaScript signal handler cannot run while `spawnSync` holds the loop, so a stop
 * signal reaching the lap mid-lane is acted on when that lane ends — at most its ceiling later — and the lane,
 * in its own process group, does not see the terminal's signal. `withLapCleanup` (`./lapCleanupDeps.ts`) yields to
 * the loop before every step, so the drain starts there and no further lane runs. A SIGKILL meanwhile skips every
 * cleanup; the tree's provenance marker is what lets `worktree prune` take that one.
 */
import { type SpawnSyncOptions, type SpawnSyncReturns, spawnSync } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { join } from "node:path";

import { LAP_STEP_CEILING_MS, LAP_STEP_TIMEOUT_EXIT, type LapStep } from "./lapCore.js";
import type { LapStepOutcome } from "./lapStatuses.js";

/** The exit a step answers when it never started. */
const NEVER_STARTED_EXIT = 127;

/** The exit a step answers when a signal ended it: no code is a red step, never a green one. */
const SIGNALLED_EXIT = 128;

/**
 * A finished step's exit. PURE.
 *
 * @param timedOut whether the ceiling killed it
 * @param code the leader's own exit code, `null` when a signal ended it
 * @returns the ceiling's own code when it was killed there, 128 when a signal ended it, else its own code
 */
export function lapStepExit({ timedOut, code }: { timedOut: boolean; code: number | null }): number {
  if (timedOut) {
    return LAP_STEP_TIMEOUT_EXIT;
  }
  if (code === null) {
    return SIGNALLED_EXIT;
  }
  return code;
}

/** A synchronous run's exit: 127 when it never started, else {@link lapStepExit}'s reading. */
function runExit({ run }: { run: SpawnSyncReturns<Buffer> }): number {
  if (run.error === undefined) {
    return lapStepExit({ code: run.status, timedOut: false });
  }
  const timedOut = "code" in run.error && run.error.code === "ETIMEDOUT";
  return timedOut ? LAP_STEP_TIMEOUT_EXIT : NEVER_STARTED_EXIT;
}

/**
 * Run one step in its own process group with its output in its own log file, killing the whole group at the
 * ceiling, and answer its exit code and wall time. The ceiling kills only the group's leader, so the rest of the
 * group is killed straight after.
 *
 * @param tree the lap's worktree, the step's directory resolved under it
 * @param env the lane's whole environment, already reduced to the allowlist
 * @param logDir where the step's own `<id>.log` is written
 * @returns the outcome the lap's verdict reads
 */
export async function runLapStep({
  step,
  tree,
  env,
  logDir,
}: {
  step: LapStep;
  tree: string;
  env: Readonly<Record<string, string>>;
  logDir: string;
}): Promise<LapStepOutcome> {
  const fd = openSync(join(logDir, `${step.id}.log`), "w");
  const startedMs = Date.now();
  const cwd = step.directory === undefined ? tree : join(tree, step.directory);
  // Node's `spawnSync` honours `detached` (its own process group) though `@types/node` leaves it off
  // `SpawnSyncOptions`, so the options are a named value rather than a literal. Measured: pid equals
  // pgid: node --input-type=module -e "import { spawnSync } from 'node:child_process';
  // console.log(spawnSync('sh', ['-c', 'ps -o pid=,pgid= -p \$\$'], { detached: true, encoding: 'utf8' }).stdout)"
  const options = {
    cwd,
    detached: true,
    env,
    killSignal: "SIGKILL",
    stdio: ["ignore", fd, fd],
    timeout: LAP_STEP_CEILING_MS,
  } satisfies SpawnSyncOptions & { readonly detached: boolean };
  try {
    const run = spawnSync(step.argv[0]!, step.argv.slice(1), options);
    const exitCode = runExit({ run });
    if (exitCode === LAP_STEP_TIMEOUT_EXIT) {
      try {
        process.kill(-run.pid, "SIGKILL");
      } catch {
        // The whole group had already gone with its leader.
      }
    }
    return { context: step.context, exitCode, id: step.id, wallMs: Date.now() - startedMs };
  } finally {
    closeSync(fd);
  }
}
