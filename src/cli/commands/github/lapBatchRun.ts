/**
 * `slopweaver github lap --number a,b,c` — one lap over an ordered batch, sequenced under the machine's lap lock
 * `runGithubLap` took first: the batch preflight and its simulated squash chain (`./lapBatchPhases.ts`) in the lock's
 * `preflight` phase, then, advanced to `running` for the rest of the run, the lanes
 * once over the chain's last commit, the verdict posted on every member's head, and with `--land` every member
 * landed in order (`./lapBatchLand.ts`). The lock spans the landings too, so no other lap moves the base between
 * two members. A red lap lands nothing; the next invocation is a shorter list.
 */

import { ok } from "../../../lib/result.js";
import type { GithubLapApi } from "../../../outbound/github/lapApi.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { landBatch } from "./lapBatchLand.js";
import { batchTarget, type LapBatch, preflightBatch } from "./lapBatchPhases.js";
import { type GithubLapArgs, lapPlan } from "./lapCore.js";
import type { GithubLapDeps, LapExecution, LapSession } from "./lapDeps.js";
import { lapLanes, printLapPlan, underLapLock } from "./lapLanes.js";
import { diagnose } from "./lapPhases.js";
import { lapStatuses } from "./lapStatuses.js";

/** Print the simulated chain, one line per member, so a dry run shows what the lap would test. */
function printChain({ deps, batch }: { deps: GithubLapDeps; batch: LapBatch }): void {
  deps.out(
    `github lap: batch of ${String(batch.members.length)} over base ${batch.baseTip.slice(0, 10)}, in landing order`,
  );
  for (const { link } of batch.members) {
    deps.out(
      `github lap: #${String(link.number)} at ${link.headSha.slice(0, 10)} squashes to tree ${link.tree.slice(0, 10)} (simulated ${link.commit.slice(0, 10)})`,
    );
  }
}

/** Under the lock: the lanes over the chain, the verdict on every member, and the landing when asked for. */
async function lapAndLand({
  session,
  batch,
  startedIso,
  subject,
}: {
  session: LapSession;
  batch: LapBatch;
  startedIso: string;
  subject: string;
}): Promise<number> {
  const target = batchTarget({ batch, session });
  const lap = await lapLanes({ session, startedIso, subject, target });
  if (lap.isErr()) {
    diagnose({ deps: session.deps, lines: lap.error.map((error) => `github lap: stopped — ${error.message}`) });
    return EXIT_ERROR;
  }
  const statuses = lapStatuses({ baseTip: batch.baseTip, note: target.note, outcomes: lap.value, plan: lapPlan() });
  const posted = await target.post({ statuses });
  if (!posted || statuses.some((status) => status.state !== "success")) {
    return EXIT_ERROR;
  }
  return session.args.land ? landBatch({ batch, session }) : EXIT_OK;
}

/**
 * Run one lap over an ordered batch.
 *
 * @param numbers the members, in landing order
 * @returns the process exit code: 0 only when the lap was green and, with `--land`, every member landed
 */
export async function runGithubLapBatch({
  api,
  args,
  deps,
  execution,
  home,
  numbers,
}: {
  api: GithubLapApi;
  args: GithubLapArgs;
  deps: GithubLapDeps;
  /** Whether the invocation holds the machine; `runGithubLap` took the lock before this batch's preflight. */
  execution: LapExecution;
  home: string;
  numbers: readonly number[];
}): Promise<number> {
  const ready = await preflightBatch({ api, args, deps, numbers });
  if (ready.isErr()) {
    diagnose({ deps, lines: ready.error.map((error) => `github lap: refused — ${error.message}`) });
    return EXIT_ERROR;
  }
  const batch = ready.value;
  for (const note of batch.notes) {
    deps.out(`github lap: note — ${note}`);
  }
  printChain({ batch, deps });
  if (execution.kind === "dry-run") {
    printLapPlan({ out: deps.out });
    return EXIT_OK;
  }
  const session = {
    api,
    args,
    baseRef: batch.baseRef,
    deps,
    home,
    refs: { baseTip: batch.baseTip, headSha: batch.tested },
  };
  const startedIso = deps.now().toISOString();
  const subject = `${args.owner}/${args.repo}#${numbers.join(",")}@${batch.tested}`;
  const run = await underLapLock({
    lock: execution.lock,
    run: async () => ok(await lapAndLand({ batch, session, startedIso, subject })),
    startedIso,
    subject,
  });
  if (run.isErr()) {
    diagnose({ deps, lines: run.error.map((error) => `github lap: stopped — ${error.message}`) });
    return EXIT_ERROR;
  }
  return run.value;
}
