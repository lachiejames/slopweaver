/**
 * One run of a lap's lanes over one target, and the machine lock a run is held under: post `pending`, bring up
 * the tree, the lane home and the store, run every step (`./lapSteps.ts`), keep the receipt, and tear it all down
 * whatever happened. A single lap's target is its head (`./lapPhases.ts`'s `headTarget`); a batch's is the squash
 * chain it simulated, posted on every member (`./lapBatchPhases.ts`).
 */

import { err, ok, type Result } from "../../../lib/result.js";
import { lapEnvironment, lapPlan } from "./lapCore.js";
import type { LapLockHandle, LapSession } from "./lapDeps.js";
import { type LapError, LapErrors } from "./lapErrors.js";
import { type LapStatus, type LapStepOutcome, lapErrorStatuses, lapPendingStatuses } from "./lapStatuses.js";
import { runSteps } from "./lapSteps.js";
import { type LapReceipt, lapReceipt } from "./lapVerdict.js";

/**
 * What one run of the lanes tests and where it reports: the commit it checks out, the base that commit was built
 * over, how its statuses reach GitHub, and the batch it stands for. A single lap tests the head and posts on it; a
 * batch tests its simulated squash chain and posts on every member's head.
 */
export interface LapTarget {
  readonly baseTip: string;
  /** The commit the lanes check out and run over. */
  readonly tested: string;
  /** The batch note every status carries after its base, absent for a single pull request. */
  readonly note: string | undefined;
  readonly post: (args: { statuses: readonly LapStatus[] }) => Promise<boolean>;
  readonly batch: LapReceipt["batch"];
}

/**
 * Print the plan a dry run would run, one line per step.
 *
 * @param out where each line goes
 */
export function printLapPlan({ out }: { out: (line: string) => void }): void {
  for (const step of lapPlan()) {
    const where = step.directory === undefined ? "" : ` in ${step.directory}/`;
    out(`would run ${step.id} (${step.context}): ${step.argv.join(" ")}${where}`);
  }
}

/** Bring up the tree, the lane home and the store, registering each one's teardown as it comes up. */
async function provision({
  session,
  target,
  disposers,
}: {
  session: LapSession;
  target: LapTarget;
  disposers: (() => Promise<void>)[];
}): Promise<
  Result<
    {
      readonly tree: string;
      readonly env: Readonly<Record<string, string>>;
      readonly store: Readonly<Record<string, string>>;
    },
    LapError
  >
> {
  const { deps } = session;
  const tree = await deps.checkout({ sha: target.tested });
  if (tree.isErr()) {
    return err(tree.error);
  }
  disposers.push(tree.value.dispose);
  const laneHome = deps.laneHome();
  disposers.push(laneHome.dispose);
  const store = await deps.startStore();
  if (store.isErr()) {
    return err(store.error);
  }
  disposers.push(store.value.dispose);
  const extra = { ...deps.toolCaches, SLOPWEAVER_COVERAGE_BASE_SHA: target.baseTip };
  return ok({
    env: lapEnvironment({ ambient: deps.ambientEnv, extra, laneHome: laneHome.value }),
    store: store.value.value,
    tree: tree.value.value,
  });
}

/** Run every disposer, newest first, whatever any of them did. */
async function disposeAll({ disposers }: { disposers: (() => Promise<void>)[] }): Promise<void> {
  for (const dispose of disposers.toReversed()) {
    await dispose();
  }
}

/**
 * Provision and run the lanes over one target, posting `pending` first and `error` when provisioning fails, and
 * tearing the tree, home and store down whatever happened. The caller holds the lock.
 *
 * @param startedIso when this run started, naming its log directory
 * @param subject what the lock and the receipt name this run
 * @returns every step that ran, or every reason none could
 */
export async function lapLanes({
  session,
  target,
  startedIso,
  subject,
}: {
  session: LapSession;
  target: LapTarget;
  startedIso: string;
  subject: string;
}): Promise<Result<readonly LapStepOutcome[], readonly LapError[]>> {
  const { args, deps, home } = session;
  const { baseTip, note } = target;
  if (!(await target.post({ statuses: lapPendingStatuses({ baseTip, note }) }))) {
    return err([LapErrors.postFailed({ what: "the pending statuses could not be posted, so no lane ran" })]);
  }
  const disposers: (() => Promise<void>)[] = [];
  try {
    const ready = await provision({ disposers, session, target });
    if (ready.isErr()) {
      await target.post({ statuses: lapErrorStatuses({ baseTip, note, why: ready.error.message }) });
      return err([ready.error]);
    }
    const plan = lapPlan();
    const { env, store, tree } = ready.value;
    const logDir = deps.logDir({ args, home, startedIso });
    const refs = { baseTip, headSha: target.tested };
    const receiptOf = ({ outcomes }: { outcomes: readonly LapStepOutcome[] }): LapReceipt =>
      lapReceipt({
        batch: target.batch,
        env,
        outcomes,
        phase: outcomes.length === plan.length ? "finished" : "running",
        plan,
        refs,
        startedIso,
        subject,
      });
    const outcomes = await runSteps({ deps, env, logDir, plan, receiptOf, store, tree });
    deps.writeReceipt({ logDir, receipt: { ...receiptOf({ outcomes }), phase: "finished" } });
    return ok(outcomes);
  } finally {
    await disposeAll({ disposers });
  }
}

/**
 * Advance the machine's lap lock, which `runGithubLap` took before the preflight and releases after everything,
 * from `preflight` to `running` under the full subject, then run `run`. It takes and releases nothing itself: a
 * batch keeps the lock through its lap AND every landing after it, so no other lap moves the base between two of
 * its members, and a single lap keeps it through its landing.
 *
 * @param lock the lock this invocation holds
 * @param subject what the lock names as its holder's work from here on
 * @param run the work done under the lock
 * @returns `run`'s own result, or why the lock could not be advanced
 */
export async function underLapLock<T>({
  lock,
  subject,
  startedIso,
  run,
}: {
  lock: LapLockHandle;
  subject: string;
  startedIso: string;
  run: () => Promise<Result<T, readonly LapError[]>>;
}): Promise<Result<T, readonly LapError[]>> {
  const advanced = lock.advance({ startedIso, subject });
  if (advanced.isErr()) {
    return err([advanced.error]);
  }
  return run();
}
