/**
 * `slopweaver github push`'s base-freshness gate: measure, print and gate whether the default branch moved
 * past the head being pushed, before anything is written.
 *
 * Split out of `./pushRun.ts` when that file reached the size ratchet. The gate is a self-contained seam: the
 * push only ever needs its verdict and the base SHA it measured.
 */
import type { GithubPushPlan } from "../../../admit/githubPush.js";
import { printBaseFreshnessPermit } from "./baseFreshnessCore.js";
import {
  type BaseFreshnessRunDeps,
  measureRequiredBaseFreshness,
  productionBaseFreshnessRunDeps,
} from "./baseFreshnessRun.js";
import { type MergeHoldDeps, productionMergeHoldDeps, readBaseMovedLane } from "./holdDeps.js";
import type { GithubPushArgs } from "./pushCore.js";
import type { GithubPushDeps } from "./pushPrimitives.js";

/** The freshness edges a push measures through: the driver's own, else the real ones built from its Git edges. */
function freshnessDepsOf({ deps }: { deps: GithubPushDeps }): BaseFreshnessRunDeps {
  const supplied = deps.baseFreshness;
  if (supplied === undefined) {
    return productionBaseFreshnessRunDeps({ git: deps });
  }
  return supplied;
}

/** The merge hold's edges a refusal reads: the driver's own, else the real hold document. */
function holdDepsOf({ deps }: { deps: GithubPushDeps }): MergeHoldDeps {
  const supplied = deps.hold;
  if (supplied === undefined) {
    return productionMergeHoldDeps();
  }
  return supplied;
}

/**
 * Measure, print and gate base freshness before anything in `plan` is written — including in `--dry-run`, so
 * its own printed lines disclose what a real invocation would decide.
 *
 * A `base-moved` here is the moment a session learns it is in a serial landing, so the hold record is read
 * before the verdict is printed and the refusal prescribes the lap that LANDS — the merge queue normally, or
 * the standing hold on the bases that still have one. See `baseMovedRemedy` in
 * `../../../outbound/github/mergeHold.js` for the measurement behind that. Reading it is also a LOOK at the
 * hold, so a stale one warns here exactly as it does at `merge` and `hold --status`.
 *
 * The base branch's merge queue is read on that same arm, and ONLY on it: a fresh push reaches no network
 * here at all, and a moved one asks the two questions that decide whether the queue already tests what this
 * push would land — see `queueGatedBaseMoved` in `./baseFreshnessCore.js` for what is done with the answer.
 *
 * @param plan the safe push plan already built
 * @param acknowledgement what the caller accepted
 * @param deps injectable Git and output edges
 * @param home the state home holding the hold document and the GitHub credential
 * @returns whether the caller must refuse
 */
export async function pushBaseFreshness({
  plan,
  acknowledgement,
  deps,
  home,
}: {
  plan: GithubPushPlan;
  acknowledgement: GithubPushArgs["baseFreshnessAcknowledgement"];
  deps: GithubPushDeps;
  home: string;
}): Promise<{ readonly refused: boolean; readonly baseSha: string | undefined }> {
  const freshness = measureRequiredBaseFreshness({
    cwd: plan.repoRoot,
    defaultBranch: plan.defaultBranch,
    deps: freshnessDepsOf({ deps }),
    headSha: plan.localSha,
    remote: plan.remote,
  });
  const moved = freshness.isOk() && freshness.value.kind === "base-moved";
  const queueGate =
    moved && deps.readQueueGate !== undefined
      ? await deps.readQueueGate({ branch: plan.defaultBranch, home, repo: plan.repo })
      : undefined;
  const lane = readBaseMovedLane({ deps: holdDepsOf({ deps }), home, repo: plan.repo });
  return {
    baseSha: freshness.isOk() ? freshness.value.baseSha : undefined,
    refused: printBaseFreshnessPermit({ acknowledgement, lane, measurement: freshness, out: deps.out, queueGate }),
  };
}
