/**
 * The effectful half of the already-landed measurement — fetch the pull request's real BASE branch into a
 * private ref, ask by verbatim patch id whether the head's work is already there, and always clean that ref up.
 *
 * ## Why this exists beside base freshness rather than inside it
 *
 * They answer opposite questions with opposite tools. Base freshness asks "has the base moved past me", by
 * ANCESTRY, against the remote's DEFAULT branch. This asks "am I already on the base", by PATCH ID, against
 * the pull request's OWN base. Ancestry structurally cannot answer this one: this repository squash-merges,
 * so a branch whose every line is already on `main` has a merge base older than the squash commit and reads
 * as perfectly unmerged. A verbatim patch id matches the same work under a new SHA.
 *
 * The detector itself is `branchAbsorbed` in `../../../worktree/pruneScan.ts`, shared rather
 * than re-implemented — `worktree prune` has asked exactly this question since long before this gate existed,
 * and two implementations of "is this branch's work already in the trunk" would be two that drift.
 *
 * ## Its limit, and why the gate is still worth having
 *
 * `pruneScan.ts`'s own header names it: a branch of SEVERAL commits squash-merged into ONE has no single
 * matching patch, so the branch reads as unlanded. That limit barely bites here,
 * because this repository requires one commit off the base — but it means the gate can MISS, never that it
 * can fire wrongly on a genuinely new branch. Missing is the safe direction for a refusal.
 *
 * Opportunistic exactly like `measureAvailableBaseFreshness`: no checkout, no matching remote, no branch, no
 * Git transport, or a fetch that fails, all read as `skipped`. An answer this check cannot compute is never
 * a refusal — a shallow clone or an unfetched base makes it WRONG rather than absent.
 */
import { ok, type Result } from "../../../lib/result.js";
import type { PrTarget } from "../../../outbound/github/types.js";
import { branchAbsorbed } from "../../../worktree/pruneScan.js";
import type { AlreadyLanded } from "./baseFreshnessCore.js";
import { sameRepoLocalHeadBranch } from "./baseFreshnessCore.js";
import { localBranchSha, remoteUrl } from "./baseFreshnessRun.js";
import { deletePrivateRef, fetchBranchIntoPrivateRef, newPrivateFetchRef } from "./gitAncestry.js";
import { githubRepoFromRemote } from "./pushCore.js";
import type { GithubPushDeps } from "./pushRun.js";

/** The injectable edges an already-landed measurement needs. */
export interface AlreadyLandedRunDeps {
  readonly git: GithubPushDeps;
  readonly newPrivateRef: () => string;
  /** The patch-id detector: `true` absorbed, `false` not, `null` UNANSWERABLE. */
  readonly absorbed: (args: { repoRoot: string; trunk: string; branch: string }) => boolean | null;
}

/**
 * The production edges.
 *
 * @param git the injectable Git primitives to measure with
 * @returns the shared patch-id detector and private-ref minter, wired to the supplied Git primitives
 */
export function productionAlreadyLandedRunDeps({ git }: { git: GithubPushDeps }): AlreadyLandedRunDeps {
  return { absorbed: branchAbsorbed, git, newPrivateRef: newPrivateFetchRef };
}

/** Fetch the target's own base branch into a private ref, ask the detector, and always clean the ref up. */
function measureAgainstFetchedBase({
  cwd,
  remote,
  target,
  headBranch,
  deps,
}: {
  cwd: string;
  remote: string;
  target: PrTarget;
  headBranch: string;
  deps: AlreadyLandedRunDeps;
}): AlreadyLanded {
  const ref = deps.newPrivateRef();
  try {
    const fetched = fetchBranchIntoPrivateRef({ branch: target.base, cwd, git: deps.git, ref, remote });
    if (fetched.isErr()) {
      return { kind: "skipped", why: `could not fetch ${remote}/${target.base}: ${fetched.error.message}` };
    }
    const absorbed = deps.absorbed({ branch: headBranch, repoRoot: cwd, trunk: ref });
    if (absorbed === null) {
      return { kind: "skipped", why: `git could not compare ${headBranch} against ${remote}/${target.base}` };
    }
    if (!absorbed) {
      return { kind: "not-landed" };
    }
    return { baseBranch: `${remote}/${target.base}`, headBranch, kind: "landed" };
  } finally {
    const deleted = deletePrivateRef({ cwd, git: deps.git, ref });
    if (deleted.isErr()) {
      deps.git.out({ line: `warning: could not delete private ref ${ref}: ${deleted.error.message}` });
    }
  }
}

/**
 * Opportunistic already-landed measurement for the creation door, `github stack push`.
 *
 * A `Result` rather than a bare value so it composes with the freshness measurement beside it, and because a
 * caller that stops reading at the happy arm gets nothing silently wrong — every failure here is already
 * folded into `skipped`, so the error arm is currently unreachable and stays available for a caller that
 * needs a genuine one.
 *
 * @param cwd the caller's working directory
 * @param remote the configured Git remote to fetch the base from (default: origin at the call site)
 * @param target the pull request's routing fields, whose `base` is what this measures against
 * @param deps the injectable edges
 * @returns the measurement, `skipped` with why whenever a prerequisite is absent or git could not answer
 */
export function measureAvailableAlreadyLanded({
  cwd,
  remote,
  target,
  deps,
}: {
  cwd: string;
  remote: string;
  target: PrTarget;
  deps: AlreadyLandedRunDeps;
}): Result<AlreadyLanded> {
  const head = sameRepoLocalHeadBranch({ head: target.head, owner: target.owner });
  if (!head.isOk()) {
    return ok({ kind: "skipped", why: `${head.error.message} — a fork head is not measured locally` });
  }
  const url = remoteUrl({ cwd, git: deps.git, remote });
  if (url === undefined) {
    return ok({ kind: "skipped", why: `${cwd} has no readable \`${remote}\` remote` });
  }
  const repo = githubRepoFromRemote({ url });
  if (repo === undefined || repo.toLowerCase() !== `${target.owner}/${target.repo}`.toLowerCase()) {
    return ok({ kind: "skipped", why: `${remote} (${url}) does not point at ${target.owner}/${target.repo}` });
  }
  if (localBranchSha({ branch: head.value, cwd, git: deps.git }) === undefined) {
    return ok({ kind: "skipped", why: `local branch ${head.value} was not found in this checkout` });
  }
  return ok(measureAgainstFetchedBase({ cwd, deps, headBranch: head.value, remote, target }));
}
