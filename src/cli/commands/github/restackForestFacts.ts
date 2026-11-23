/**
 * `slopweaver github stack restack`'s measuring half: one staleness fact per open pull request, read from refs
 * the run has just fetched. It reads Git and moves nothing.
 *
 * Split out of `./restackForestRun.ts` when that shell crossed the file-size cap. The verb's shell fetches and
 * reads the pull requests, `./restackForestCore.ts` plans from these facts, and `./restackForestExecute.ts`
 * performs the moves.
 */
import { isAncestor } from "./gitAncestry.js";
import type { RestackPullRequest } from "./restackForestCore.js";
import type { StackVerbDeps } from "./stackVerbDeps.js";

/** One branch's tip as this run first measured it, before the run moved anything. */
function remoteTrackingTip({
  branch,
  deps,
  remote,
  repoRoot,
}: {
  branch: string;
  deps: StackVerbDeps;
  remote: string;
  repoRoot: string;
}): string | undefined {
  try {
    return deps.git.readGit({ args: ["rev-parse", `refs/remotes/${remote}/${branch}`], cwd: repoRoot });
  } catch {
    return undefined;
  }
}

/** Whether this repository has the named object at all — a head GitHub reports but the fetch did not bring. */
function hasObject({ deps, repoRoot, sha }: { deps: StackVerbDeps; repoRoot: string; sha: string }): boolean {
  try {
    deps.git.readGit({ args: ["cat-file", "-e", `${sha}^{commit}`], cwd: repoRoot });
    return true;
  } catch {
    return false;
  }
}

/** One open pull request as the GitHub read gives it, narrowed to what the planner reads. */
interface OpenPrFact {
  readonly number: number;
  readonly headRef: string;
  readonly baseRef: string;
  readonly headSha: string;
}

/** The facts the planner needs, plus the base tips and residue the shell measured to build them. */
interface GatheredRestackFacts {
  readonly pullRequests: readonly RestackPullRequest[];
  readonly baseTips: ReadonlyMap<string, string>;
  readonly residue: readonly string[];
}

/**
 * Measure one staleness fact per open pull request, from refs this run has just fetched.
 *
 * Every base tip comes from the remote-tracking ref rather than a local branch, so a base branch this
 * checkout has never had — the ordinary case for somebody else's stack, and for a trunk-based pull request
 * whose worktree is elsewhere — is measured exactly like any other.
 *
 * @returns the pull requests the planner reads, the base tips measured for them, and every one left out with why
 */
export function gatherFacts({
  deps,
  openPrs,
  remote,
  repoRoot,
}: {
  deps: StackVerbDeps;
  openPrs: readonly OpenPrFact[];
  remote: string;
  repoRoot: string;
}): GatheredRestackFacts {
  const pullRequests: RestackPullRequest[] = [];
  const baseTips = new Map<string, string>();
  const residue: string[] = [];
  for (const pr of openPrs) {
    const baseTip = remoteTrackingTip({ branch: pr.baseRef, deps, remote, repoRoot });
    if (baseTip === undefined) {
      residue.push(`#${String(pr.number)} (${pr.headRef}) is based on ${pr.baseRef}, which ${remote} does not have`);
      continue;
    }
    if (!hasObject({ deps, repoRoot, sha: pr.headSha })) {
      residue.push(
        `#${String(pr.number)} (${pr.headRef}) reports head ${pr.headSha}, which this checkout does not have ` +
          "even after fetching — it may have moved mid-run",
      );
      continue;
    }
    baseTips.set(pr.baseRef, baseTip);
    pullRequests.push({
      baseIsAncestorOfHead: baseStillAncestor({ ancestor: baseTip, descendant: pr.headSha, repoRoot }),
      baseRef: pr.baseRef,
      headRef: pr.headRef,
      headSha: pr.headSha,
      number: pr.number,
    });
  }
  return { baseTips, pullRequests, residue };
}

/**
 * Whether one commit is a git ancestor of another, answering `false` only when git says so.
 *
 * A check that could not RUN is not an answer, and treating it as "not an ancestor" would plan a replay onto
 * a base nothing verified — so a failed measurement reads as "already based", leaving the branch alone.
 */
function baseStillAncestor({
  ancestor,
  descendant,
  repoRoot,
}: {
  ancestor: string;
  descendant: string;
  repoRoot: string;
}): boolean {
  const measured = isAncestor({ ancestor, cwd: repoRoot, descendant });
  return measured.isErr() ? true : measured.value;
}
