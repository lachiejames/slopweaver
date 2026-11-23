/**
 * The effectful half of base-freshness measurement — fetches the remote default branch into a private ref,
 * compares it against the checked head, and always cleans that ref up, on every success and failure path.
 *
 * Two entry points, because `push` and the creation door have different structural guarantees. Push
 * always has a checkout — any failure to measure is a genuine `Err`. Create can run from a GitHub token
 * alone, with no local checkout and no Git transport credentials at all, which is the explicitly supported
 * token-only path — so `measureAvailableBaseFreshness` treats a missing prerequisite as `skipped`, never a
 * refusal, and only turns to `Err` once it has proven a compatible checkout and remote actually exist.
 */
import { err, ok } from "../../../lib/result.js";
import { measureMergeFacts } from "../../../outbound/github/mergeFacts.js";
import type { RevertedPath } from "../../../outbound/github/mergeGuard.js";
import type { PrTarget } from "../../../outbound/github/types.js";
import { type BaseFreshness, sameRepoLocalHeadBranch } from "./baseFreshnessCore.js";
import type { GithubVerbResult } from "./errors.js";
import {
  type CountCommitsAhead,
  deletePrivateRef,
  fetchBranchIntoPrivateRef,
  type IsAncestor,
  newPrivateFetchRef,
  countCommitsAhead as productionCountCommitsAhead,
  isAncestor as productionIsAncestor,
} from "./gitAncestry.js";
import { githubRepoFromRemote, parseRemoteSnapshot } from "./pushCore.js";
import type { GithubPushDeps } from "./pushRun.js";

/** The injectable edges a base-freshness measurement needs. */
export interface BaseFreshnessRunDeps {
  readonly git: GithubPushDeps;
  readonly isAncestor: IsAncestor;
  /** How far the base has advanced past the head — the drift the queue relaxation is bounded by. */
  readonly countCommitsAhead: CountCommitsAhead;
  readonly newPrivateRef: () => string;
  /** Paths whose content on `head` is one `base`'s own history once held, each with that commit. */
  readonly measureReverted: (args: { cwd: string; base: string; head: string }) => readonly RevertedPath[];
}

/**
 * The production edges.
 *
 * @param git the injectable Git primitives to measure with
 * @returns the real ancestry check and private-ref minter, wired to the supplied Git primitives
 */
export function productionBaseFreshnessRunDeps({ git }: { git: GithubPushDeps }): BaseFreshnessRunDeps {
  return {
    countCommitsAhead: productionCountCommitsAhead,
    git,
    isAncestor: productionIsAncestor,
    measureReverted: ({ cwd, base, head }) => measureMergeFacts({ base, cwd, head }).reverted,
    newPrivateRef: newPrivateFetchRef,
  };
}

/** Fetch the remote's live default-branch tip into a private ref, compare it, and always clean the ref up. */
function measureAgainstFetchedDefault({
  cwd,
  remote,
  defaultBranch,
  headSha,
  deps,
}: {
  cwd: string;
  remote: string;
  defaultBranch: string;
  headSha: string;
  deps: BaseFreshnessRunDeps;
}): GithubVerbResult<Exclude<BaseFreshness, { readonly kind: "skipped" }>> {
  const ref = deps.newPrivateRef();
  try {
    const fetched = fetchBranchIntoPrivateRef({ branch: defaultBranch, cwd, git: deps.git, ref, remote });
    if (fetched.isErr()) {
      return err(fetched.error);
    }
    const { sha: baseSha } = fetched.value;
    const ancestry = deps.isAncestor({ ancestor: baseSha, cwd, descendant: headSha });
    if (ancestry.isErr()) {
      return err(ancestry.error);
    }
    let reverted: readonly RevertedPath[] = [];
    try {
      reverted = deps.measureReverted({ base: baseSha, cwd, head: headSha });
    } catch (error: unknown) {
      deps.git.out({
        line: `warning: could not measure reverted files against ${baseSha}: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
    if (ancestry.value) {
      return ok({ baseBranch: defaultBranch, baseSha, headSha, kind: "fresh", remote, reverted });
    }
    // Counted only on the moved arm, and a failure to count is carried as `undefined` rather than raised:
    // the drift bounds the queue relaxation and fills the staleness advisory, so an unmeasurable one leaves
    // the ordinary refusal exactly where it was instead of turning a measurable base-moved into an
    // unmeasurable error. The `fresh` arm needs no count at all — a base tip that IS an ancestor of the head
    // leaves `head..base` empty by definition, so its drift is zero without asking git a second time.
    const drift = deps.countCommitsAhead({ cwd, from: headSha, to: baseSha });
    return ok({
      baseBranch: defaultBranch,
      baseSha,
      behindBy: drift.isOk() ? drift.value : undefined,
      headSha,
      kind: "base-moved",
      remote,
      reverted,
    });
  } finally {
    const deleted = deletePrivateRef({ cwd, git: deps.git, ref });
    if (deleted.isErr()) {
      deps.git.out({ line: `warning: could not delete private ref ${ref}: ${deleted.error.message}` });
    }
  }
}

/**
 * Required base-freshness measurement for plain `github push` — a checkout always exists here, so any
 * failure to measure is a genuine, unescapable-without-acknowledgement `Err`.
 *
 * @param cwd the repository root
 * @param remote the configured Git remote
 * @param defaultBranch the remote's default branch, already resolved by the caller
 * @param headSha the exact local commit about to be pushed
 * @param deps the injectable edges
 * @returns the measurement, or why it could not be taken
 */
export function measureRequiredBaseFreshness({
  cwd,
  remote,
  defaultBranch,
  headSha,
  deps,
}: {
  cwd: string;
  remote: string;
  defaultBranch: string;
  headSha: string;
  deps: BaseFreshnessRunDeps;
}): GithubVerbResult<Exclude<BaseFreshness, { readonly kind: "skipped" }>> {
  return measureAgainstFetchedDefault({ cwd, defaultBranch, deps, headSha, remote });
}

/**
 * A remote's current URL, or `undefined` when there is no checkout or no such remote.
 *
 * Exported for `./alreadyLandedRun.js`, which resolves the SAME `<remote>` before comparing against the pull
 * request's own base rather than the default branch this module measures against.
 *
 * @param cwd the repository to read
 * @param git the injectable Git primitives
 * @param remote the configured Git remote
 * @returns the remote's URL, or `undefined` when it cannot be read
 */
export function remoteUrl({
  cwd,
  git,
  remote,
}: {
  cwd: string;
  git: GithubPushDeps;
  remote: string;
}): string | undefined {
  try {
    return git.readGit({ args: ["remote", "get-url", remote], cwd });
  } catch {
    return undefined;
  }
}

/**
 * The local commit a branch resolves to, or `undefined` when it does not exist in this checkout.
 *
 * Exported for `./alreadyLandedRun.js` — see {@link remoteUrl}'s own note.
 *
 * @param cwd the repository to read
 * @param git the injectable Git primitives
 * @param branch the local branch name to resolve
 * @returns the branch's commit SHA, or `undefined` when it does not exist locally
 */
export function localBranchSha({
  cwd,
  git,
  branch,
}: {
  cwd: string;
  git: GithubPushDeps;
  branch: string;
}): string | undefined {
  try {
    return git.readGit({ args: ["rev-parse", `refs/heads/${branch}`], cwd });
  } catch {
    return undefined;
  }
}

/**
 * Opportunistic base-freshness measurement for the creation door — measured only when a compatible
 * checkout, remote and Git transport actually exist; skipped (never refused) otherwise, because that is the
 * currently-supported token-only creation path.
 *
 * @param cwd the caller's working directory
 * @param remote the configured Git remote to check against (default: origin)
 * @param target the pull request's routing fields
 * @param deps the injectable edges
 * @returns the measurement, `skipped` with why when a structural prerequisite is absent, or why an actual
 *   attempt failed
 */
export function measureAvailableBaseFreshness({
  cwd,
  remote,
  target,
  deps,
}: {
  cwd: string;
  remote: string;
  target: PrTarget;
  deps: BaseFreshnessRunDeps;
}): GithubVerbResult<BaseFreshness> {
  const head = sameRepoLocalHeadBranch({ head: target.head, owner: target.owner });
  if (!head.isOk()) {
    return ok({ kind: "skipped", why: `${head.error.message} — base freshness is not checked for a fork head` });
  }
  const url = remoteUrl({ cwd, git: deps.git, remote });
  if (url === undefined) {
    return ok({
      kind: "skipped",
      why: `${cwd} has no readable \`${remote}\` remote — not a local checkout of this repository`,
    });
  }
  const repo = githubRepoFromRemote({ url });
  if (repo === undefined || repo.toLowerCase() !== `${target.owner}/${target.repo}`.toLowerCase()) {
    return ok({ kind: "skipped", why: `${remote} (${url}) does not point at ${target.owner}/${target.repo}` });
  }
  const headSha = localBranchSha({ branch: head.value, cwd, git: deps.git });
  if (headSha === undefined) {
    return ok({ kind: "skipped", why: `local branch ${head.value} was not found in this checkout` });
  }
  let defaultBranch: string;
  try {
    const text = deps.git.readGit({ args: ["ls-remote", "--symref", remote, "HEAD"], cwd });
    const snapshot = parseRemoteSnapshot({ branch: head.value, text });
    if (!snapshot.isOk()) {
      return ok({ kind: "skipped", why: snapshot.error.message });
    }
    defaultBranch = snapshot.value.defaultBranch;
  } catch (error: unknown) {
    return ok({
      kind: "skipped",
      why: `could not reach ${remote} over the available Git transport: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
  return measureAgainstFetchedDefault({ cwd, defaultBranch, deps, headSha, remote });
}
