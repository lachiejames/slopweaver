/**
 * The snapshot `github stack restack` publishes about every open pull request of the operator's.
 *
 * Split out of `./restackForestRun.ts` when that shell crossed the file-size ratchet: building the rows is
 * a distinct job from planning and replaying them, and it is the half `github stack submit` reads back.
 */
import {
  PR_STATE_VERSION,
  type PrPreparation,
  type PrState,
  type PrStateEntry,
} from "../../../outbound/github/prStateCore.js";
import type { RestackOutcome } from "./restackExec.js";
import { restackStagingRef } from "./restackExec.js";
import type { RestackForest, RestackPullRequest } from "./restackForestCore.js";
import type { StackVerbDeps } from "./stackVerbDeps.js";

/**
 * Build the snapshot one restack publishes: one row per open pull request of the operator's, whether or not
 * this run moved it.
 *
 * Every in-scope pull request gets a row even when nothing about it changed, because the snapshot's value is
 * that it is COMPLETE — a merged pull request disappears by being absent from the next one, and `stack
 * submit` refuses on any inventory it cannot fully account for.
 *
 * @param outcomes what each attempted replay produced, keyed later by branch
 * @returns the snapshot to write
 */
export function restackSnapshot({
  baseTips,
  deps,
  forest,
  generationId,
  inScope,
  nowIso,
  outcomes,
  repo,
  repoRoot,
}: {
  baseTips: ReadonlyMap<string, string>;
  deps: StackVerbDeps;
  forest: RestackForest;
  generationId: string;
  inScope: readonly RestackPullRequest[];
  nowIso: string;
  outcomes: readonly RestackOutcome[];
  repo: string;
  repoRoot: string;
}): PrState {
  const byBranch = new Map(outcomes.map((outcome) => [outcome.branch, outcome]));
  const planned = new Set(
    forest.trees.flatMap((tree) => tree.nodes.filter((node) => node.reason !== undefined).map((node) => node.branch)),
  );
  const entries: PrStateEntry[] = inScope.map((pullRequest) => ({
    baseRef: pullRequest.baseRef,
    headRef: pullRequest.headRef,
    kind: "pull-request",
    localBranchSha: localBranchShaOf({ branch: pullRequest.headRef, deps, repoRoot }),
    number: pullRequest.number,
    observedBaseSha: observedBaseShaOf({ baseRef: pullRequest.baseRef, baseTips }),
    preparation: preparationFor({ branch: pullRequest.headRef, byBranch, generationId, planned }),
    remoteHeadSha: pullRequest.headSha,
  }));
  return {
    entries,
    header: {
      generationId,
      kind: "header",
      recordedAtIso: nowIso,
      repo: repo.toLowerCase(),
      version: PR_STATE_VERSION,
    },
  };
}

/** The base tip a row records: the one this run measured, or JSON `null` for a base it measured no tip for. */
function observedBaseShaOf({
  baseRef,
  baseTips,
}: {
  baseRef: string;
  baseTips: ReadonlyMap<string, string>;
}): string | null {
  const tip = baseTips.get(baseRef);
  if (tip === undefined) {
    return null;
  }
  return tip;
}

/** One branch's preparation: ready when it replayed, blocked when it did not, unchanged when it never moved. */
function preparationFor({
  branch,
  byBranch,
  generationId,
  planned,
}: {
  branch: string;
  byBranch: ReadonlyMap<string, RestackOutcome>;
  generationId: string;
  planned: ReadonlySet<string>;
}): PrPreparation {
  const outcome = byBranch.get(branch);
  if (outcome?.kind === "restacked") {
    return { kind: "ready", preparedRef: restackStagingRef({ branch, generationId }), preparedSha: outcome.toSha };
  }
  if (outcome !== undefined) {
    return { kind: "blocked", reason: outcome.reason };
  }
  if (planned.has(branch)) {
    return { kind: "blocked", reason: "its tree stopped below it, so this run never attempted its replay" };
  }
  return { kind: "unchanged" };
}

/**
 * What the local branch points at now, or `null` when the `rev-parse` read throws for ANY reason — an absent
 * branch is the expected case, but a git failure unrelated to absence also reads as `null` here.
 */
function localBranchShaOf({
  branch,
  deps,
  repoRoot,
}: {
  branch: string;
  deps: StackVerbDeps;
  repoRoot: string;
}): string | null {
  try {
    return deps.git.readGit({ args: ["rev-parse", `refs/heads/${branch}`], cwd: repoRoot });
  } catch {
    return null;
  }
}
