/**
 * The transport half of `slopweaver github stack submit`: every admitted push sent in order with an exact
 * lease, and each one read back from the remote before the next is attempted. Split from
 * `./stackSubmitRun.ts`, which decides what is admitted and drives this inside the door.
 */
import { stackRemoteTip } from "./stackFacts.js";
import { type PushOutcome, refHolding, type SubmitPlan, type SubmitPush } from "./stackSubmitCore.js";
import type { StackVerbDeps } from "./stackVerbDeps.js";

/** Send one branch with an exact lease, then read the remote back to confirm it holds exactly what was sent. */
function sendOne({
  deps,
  push,
  remote,
  repoRoot,
}: {
  deps: StackVerbDeps;
  push: SubmitPush;
  remote: string;
  repoRoot: string;
}): PushOutcome {
  const sent = deps.git.writeGit({
    args: [
      "push",
      `--force-with-lease=refs/heads/${push.branch}:${push.expectedRemoteSha}`,
      remote,
      // `^{commit}` pins the source to the object id the proof-path check read: a bare hex would resolve a
      // local branch of the same name first, and send a commit nothing checked.
      `${push.toSha}^{commit}:refs/heads/${push.branch}`,
    ],
    cwd: repoRoot,
  });
  if (sent.isErr()) {
    return { kind: "failed", push, reason: sent.error };
  }
  const landed = stackRemoteTip({ branch: push.branch, git: deps.git, remote, repoRoot });
  if (landed !== push.toSha) {
    return {
      kind: "failed",
      push,
      reason: `the remote reports ${refHolding({ sha: landed })} rather than the ${push.toSha} this push sent`,
    };
  }
  return { kind: "pushed", push };
}

/**
 * Send every planned push in order, stopping at the first that does not land.
 *
 * @internal driven by this verb's own shell, inside the door.
 * @param plan what the planner admitted
 * @returns one outcome per ATTEMPTED push — shorter than the plan exactly when one failed
 */
export function sendStackSubmit({
  deps,
  plan,
  remote,
  repoRoot,
}: {
  deps: StackVerbDeps;
  plan: SubmitPlan;
  remote: string;
  repoRoot: string;
}): readonly PushOutcome[] {
  const outcomes: PushOutcome[] = [];
  for (const push of plan.pushes) {
    const outcome = sendOne({ deps, push, remote, repoRoot });
    outcomes.push(outcome);
    if (outcome.kind !== "pushed") {
      break;
    }
  }
  return outcomes;
}
