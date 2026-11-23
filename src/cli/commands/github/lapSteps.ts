/**
 * Running a lap's steps over the seams in `./lapDeps.ts`: in plan order, stopping at the first red, each step
 * under its own environment, a red Vitest lane re-run once, whole (`LapStep.retryable` says why), and the
 * receipt rewritten after every step. `./lapPhases.ts` provisions what these run against.
 */

import { cleanBefore, LAP_STEP_TIMEOUT_EXIT, type LapStep, stepEnvironment } from "./lapCore.js";
import type { GithubLapDeps } from "./lapDeps.js";
import type { LapStepOutcome } from "./lapStatuses.js";
import type { LapReceipt } from "./lapVerdict.js";

/**
 * Run one step, and a retryable one's red once more, whole, into its own `<id>.retry.log`; never a step killed at
 * its ceiling, whose retry would be another hang. The retry starts on a tree cleaned back to its job's fresh
 * checkout, as CI's re-run of a failed job does: a first attempt's untracked files never reach it, and every
 * preparation step's output (`node_modules`, `dist-cli`) is ignored, so it stays.
 *
 * @param deps the lap's seams, of which this runs `runStep`, cleans through `cleanTree` and prints through `out`
 * @param env the step's whole environment
 * @param logDir where each attempt's log goes
 * @param step the step to run
 * @param tree the checkout it runs in
 * @returns the step's outcome under its own id, carrying a retried red first attempt's exit
 */
export async function runWithRetry({
  deps,
  env,
  logDir,
  step,
  tree,
}: {
  deps: Pick<GithubLapDeps, "cleanTree" | "out" | "runStep">;
  env: Readonly<Record<string, string>>;
  logDir: string;
  step: LapStep;
  tree: string;
}): Promise<LapStepOutcome> {
  const first = await deps.runStep({ env, logDir, step, tree });
  if (first.exitCode === 0 || !step.retryable || first.exitCode === LAP_STEP_TIMEOUT_EXIT) {
    return first;
  }
  const cleaned = deps.cleanTree({ keep: cleanBefore({ previous: undefined, step })!.keep, tree });
  if (cleaned.isErr()) {
    deps.out(
      `lap: ${step.id} RED (exit ${String(first.exitCode)}) — no retry, the tree could not be cleaned for it: ${cleaned.error.message}`,
    );
    return first;
  }
  deps.out(
    `lap: ${step.id} RED (exit ${String(first.exitCode)}) — log ${logDir}/${step.id}.log; retrying it once, whole`,
  );
  // CI's "re-run failed jobs", once and under its own log, not network resilience: no backoff, no error kind.
  const rerun = await deps.runStep({ env, logDir, step: { ...step, id: `${step.id}.retry` }, tree });
  return { ...rerun, firstExit: first.exitCode, id: step.id, wallMs: first.wallMs + rerun.wallMs };
}

/**
 * Clean the tree for `step` when it opens a new CI job, answering a red outcome when it cannot be cleaned.
 *
 * @param deps the lap's seams, of which this cleans through `cleanTree` and prints through `out`
 * @param previous the step that ran before this one, if any
 * @returns `undefined` when the step may run, else the red outcome that stops the lap
 */
function cleanForJob({
  deps,
  previous,
  step,
  tree,
}: {
  deps: Pick<GithubLapDeps, "cleanTree" | "out">;
  previous: LapStep | undefined;
  step: LapStep;
  tree: string;
}): LapStepOutcome | undefined {
  const clean = cleanBefore({ previous, step });
  if (clean === undefined) {
    return undefined;
  }
  const cleaned = deps.cleanTree({ keep: clean.keep, tree });
  if (cleaned.isOk()) {
    return undefined;
  }
  deps.out(`lap: ${step.id} RED — the tree could not be cleaned for its job: ${cleaned.error.message}`);
  return { context: step.context, exitCode: 1, id: step.id, wallMs: 0 };
}

/** The line a finished step prints: its verdict, whether a retry decided it, its wall time and its log. */
function stepEndLine({ logDir, outcome, step }: { logDir: string; outcome: LapStepOutcome; step: LapStep }): string {
  const verdict = outcome.exitCode === 0 ? "green" : `RED (exit ${String(outcome.exitCode)})`;
  const retried = outcome.firstExit !== undefined;
  const log = retried ? `${step.id}.retry.log` : `${step.id}.log`;
  const onRetry = retried ? " on its retry" : "";
  return `lap: ${step.id} ${verdict}${onRetry} in ${String(Math.round(outcome.wallMs / 1000))}s — log ${logDir}/${log}`;
}

/**
 * Run every step in order, stopping at the first red, rewriting the receipt after each. A step gets the store's
 * variables only where its CI job set them (`stepEnvironment`), and the first step of each new CI job starts on a
 * tree cleaned of the last job's untracked files (`cleanBefore`); a tree that cannot be cleaned is that step's red.
 *
 * @param deps the lap's seams
 * @param plan the steps, in the order they run
 * @param tree the checkout every step runs in
 * @param env the environment every lane shares
 * @param store every variable the throwaway store supplies
 * @param logDir where every step's log and the receipt go
 * @param receiptOf the receipt for the outcomes so far
 * @returns every step that ran, in order, the last one red when the lap stopped early
 */
export async function runSteps({
  deps,
  plan,
  tree,
  env,
  store,
  logDir,
  receiptOf,
}: {
  deps: Pick<GithubLapDeps, "cleanTree" | "out" | "runStep" | "writeReceipt">;
  plan: readonly LapStep[];
  tree: string;
  env: Readonly<Record<string, string>>;
  store: Readonly<Record<string, string>>;
  logDir: string;
  receiptOf: (at: { outcomes: readonly LapStepOutcome[] }) => LapReceipt;
}): Promise<readonly LapStepOutcome[]> {
  const outcomes: LapStepOutcome[] = [];
  deps.writeReceipt({ logDir, receipt: receiptOf({ outcomes }) });
  let previous: LapStep | undefined;
  for (const step of plan) {
    const uncleaned = cleanForJob({ deps, previous, step, tree });
    previous = step;
    if (uncleaned !== undefined) {
      outcomes.push(uncleaned);
      deps.writeReceipt({ logDir, receipt: receiptOf({ outcomes }) });
      break;
    }
    deps.out(`lap: ${step.id} …`);
    const outcome = await runWithRetry({ deps, env: stepEnvironment({ env, step, store }), logDir, step, tree });
    outcomes.push(outcome);
    deps.writeReceipt({ logDir, receipt: receiptOf({ outcomes }) });
    deps.out(stepEndLine({ logDir, outcome, step }));
    if (outcome.exitCode !== 0) {
      break;
    }
  }
  return outcomes;
}
