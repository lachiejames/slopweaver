/**
 * How many commits a pull request will HAVE once it is rebased onto its base's fresh tip — the measurement
 * that stops `stack adopt` refusing precisely the pull requests it exists to repair.
 *
 * ## The class this closes, measured
 *
 * `stack adopt` refuses a pull request GitHub does not report as exactly one commit, with no override, and
 * that refusal is right: `./stackSquash.ts` replays ONE commit and its module doc records two rounds of
 * adversarial testing behind why it will not guess at more. But GitHub's `commits` count is computed against
 * the base AS IT IS NOW, so a branch carrying a stale COPY of something its base has since landed reads as
 * two commits while being one commit of real work.
 *
 * MEASURED adopting a pull request in acme/acme-admin into a native stack: it held a 67-line stale copy of
 * the consent test its base's tip already carried at 78 lines, plus its own real commit. GitHub reported two
 * commits and adopt refused; a human rebased by hand, git dropped the duplicate as already-applied, and the
 * same adopt then succeeded on one commit. A sibling pull request had the same shape, and it is also why
 * both read CONFLICTING — one cause, two symptoms. So the ordering was the defect: the count was
 * taken BEFORE the rebase that would have made it right.
 *
 * ## Why this measures instead of rebasing first
 *
 * "Rebase, then count" is the obvious repair and it is the wrong one here, because the only rebase primitive
 * this repository trusts is the single-commit replay — which cannot run until the count says one. Rebasing
 * a multi-commit branch to find out how many commits it would have is the guess `./stackSquash.ts` refuses
 * to make, on evidence.
 *
 * `git rev-list --cherry-pick --right-only <base>...<head>` answers the same question without touching the
 * worktree at all: it lists the commits on `head` that have NO patch-equivalent commit on `base`. A stale
 * copy of something the base already landed is patch-equivalent by construction, so it drops out of that
 * list, and what remains is exactly what a rebase would keep.
 *
 * ## The second half, which is not optional
 *
 * A count of one is not enough. The replay moves the branch's TIP commit, so this also requires that the one
 * surviving commit IS the head SHA. A branch shaped `[real work, stale duplicate]` — duplicate on top — also
 * survives one commit, and replaying its tip would push the duplicate and silently drop the real work. Both
 * halves are asserted together, and either failing leaves the original refusal standing.
 *
 * Reproduce on any branch:
 *
 * ```
 * git rev-list --cherry-pick --right-only <fresh base tip>...<head sha>
 * ```
 */
import type { WrittenPr } from "../../../corpus/github/write.js";
import { deletePrivateRef, fetchBranchIntoPrivateRef, newPrivateFetchRef } from "./gitAncestry.js";
import type { GithubPushDeps } from "./pushPrimitives.js";

/**
 * What a rebase onto the base's fresh tip would leave behind.
 *
 * `undefined` fields are never inferred: a measurement that could not be taken leaves {@link measured}
 * false, and the caller keeps whatever refusal it already had rather than treating "could not see" as
 * "one commit".
 */
export interface EffectiveCommits {
  /** Whether the measurement itself succeeded. */
  readonly measured: boolean;
  /** How many commits on the head have no patch-equivalent commit on the fresh base. */
  readonly count: number;
  /** Whether the surviving commits are exactly `[headSha]` — the one commit the replay would move. */
  readonly tipSurvives: boolean;
  /** Why the measurement did not happen, when it did not. */
  readonly residue: string | undefined;
}

/** A measurement that did not happen, carrying its reason. */
function unmeasured({ residue }: { residue: string }): EffectiveCommits {
  return { count: 0, measured: false, residue, tipSurvives: false };
}

/**
 * Measure what a rebase onto `baseBranch`'s fresh tip would leave on `headSha`.
 *
 * Fetches the base into a private ref, exactly as `./stackSquash.ts` does and for the same live-reproduced
 * reason: a concurrent `git fetch` anywhere in the repository can overwrite the shared `FETCH_HEAD` between
 * writing and reading it.
 *
 * @param baseBranch the base branch to measure against
 * @param git the injectable Git primitives
 * @param headSha the pull request's head commit
 * @param remote the configured Git remote
 * @internal {@link effectiveCommitsFor} is its only production caller; the real-git test drives it directly.
 * @param worktreePath the worktree to run git in
 * @returns what a rebase would leave, or an unmeasured verdict carrying why
 */
export function measureEffectiveCommits({
  baseBranch,
  git,
  headSha,
  remote,
  worktreePath,
}: {
  baseBranch: string;
  git: GithubPushDeps;
  headSha: string;
  remote: string;
  worktreePath: string;
}): EffectiveCommits {
  const ref = newPrivateFetchRef();
  try {
    const fetched = fetchBranchIntoPrivateRef({ branch: baseBranch, cwd: worktreePath, git, ref, remote });
    if (fetched.isErr()) {
      return unmeasured({ residue: `could not fetch ${remote}/${baseBranch}: ${fetched.error.message}` });
    }
    const listed = git.readGit({
      args: ["rev-list", "--cherry-pick", "--right-only", `${fetched.value.sha}^{commit}...${headSha}^{commit}`],
      cwd: worktreePath,
    });
    const survivors = listed.split("\n").filter((line) => line.length > 0);
    return {
      count: survivors.length,
      measured: true,
      residue: undefined,
      tipSurvives: survivors.length === 1 && survivors[0] === headSha,
    };
  } catch (error: unknown) {
    return unmeasured({ residue: error instanceof Error ? error.message : String(error) });
  } finally {
    const deleted = deletePrivateRef({ cwd: worktreePath, git, ref });
    if (deleted.isErr()) {
      git.out({ line: `warning: could not delete private ref ${ref}: ${deleted.error.message}` });
    }
  }
}

/**
 * What a rebase onto the base's fresh tip would leave, measured ONLY when GitHub's own count already
 * disagrees with one — so an ordinary adopt still reaches no network beyond its own reads and touches no ref.
 *
 * @param deps the injectable Git edges, and the output sink a failed measurement's residue is reported to
 * @param pr the pull request GitHub reports now
 * @param remote the configured Git remote
 * @param repoRoot the worktree to measure in
 * @returns the measurement, or `undefined` when GitHub already reports exactly one commit
 */
export function effectiveCommitsFor({
  deps,
  pr,
  remote,
  repoRoot,
}: {
  deps: { readonly git: GithubPushDeps; readonly out: (input: { readonly line: string }) => void };
  pr: WrittenPr;
  remote: string;
  repoRoot: string;
}): EffectiveCommits | undefined {
  if (pr.commits === 1) {
    return undefined;
  }
  const measured = measureEffectiveCommits({
    baseBranch: pr.baseRef,
    git: deps.git,
    headSha: pr.head.sha,
    remote,
    worktreePath: repoRoot,
  });
  if (measured.residue !== undefined) {
    deps.out({ line: `could not measure what a rebase would leave: ${measured.residue}` });
  }
  return measured;
}

/**
 * Whether a pull request GitHub reports as more than one commit is nonetheless safe to replay, because every
 * extra commit is patch-equivalent to something its base has already landed and the tip is what survives.
 *
 * @param effective the measurement, or `undefined` when the caller never took one
 * @returns whether the single-commit replay may proceed anyway
 */
export function rebaseWouldLeaveOneCommit({ effective }: { effective: EffectiveCommits | undefined }): boolean {
  return effective?.measured === true && effective.count === 1 && effective.tipSurvives;
}
