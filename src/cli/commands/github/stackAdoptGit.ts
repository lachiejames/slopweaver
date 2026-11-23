/**
 * `slopweaver github stack adopt`'s local Git half: the facts read from the checkout before any network call,
 * and the exact-lease push of the just-rebased head. Split from `./stackAdoptRun.ts`, which owns the plan,
 * the door and the registration.
 */
import { type GithubPushFacts, pushAndVerify } from "../../../admit/githubPush.js";
import {
  githubPushPlan,
  githubRepoFromRemote,
  NO_BASE_FRESHNESS_ACKNOWLEDGEMENT,
  NO_ORPHANS_ACCEPTED,
  parseRemoteSnapshot,
} from "./pushCore.js";
import { type GithubPushDeps } from "./pushPrimitives.js";

/** Every local Git fact `stack adopt` needs, read without touching the network. */
export interface LocalAdoptFacts {
  readonly repoRoot: string;
  readonly checkedOutBranch: string;
  readonly owner: string;
  readonly repo: string;
  readonly defaultBranch: string;
  readonly localHeadSha: string;
  readonly dirty: boolean;
}

/**
 * Every local Git fact this verb needs, without touching the network.
 *
 * Throws on a Git failure or an unparseable remote; the caller turns that into one refusal line.
 *
 * @param cwd the directory the invocation runs from, resolved to its repository root first
 * @param remote the remote whose URL names the repository and whose `HEAD` names the default branch
 * @returns the checkout's root, branch, repository, default branch, head and whether the tree is dirty
 */
export function localAdoptFacts({
  cwd,
  remote,
  git,
}: {
  cwd: string;
  remote: string;
  git: GithubPushDeps;
}): LocalAdoptFacts {
  const repoRoot = git.readGit({ args: ["rev-parse", "--show-toplevel"], cwd });
  const checkedOutBranch = git.readGit({ args: ["symbolic-ref", "--quiet", "--short", "HEAD"], cwd: repoRoot });
  const remoteUrl = git.readGit({ args: ["remote", "get-url", remote], cwd: repoRoot });
  const repoSlug = githubRepoFromRemote({ url: remoteUrl });
  if (repoSlug === undefined) {
    throw new Error(`remote ${remote} is not an owner/name Git repository URL`);
  }
  const text = git.readGit({
    args: ["ls-remote", "--symref", remote, "HEAD", `refs/heads/${checkedOutBranch}`],
    cwd: repoRoot,
  });
  const snapshot = parseRemoteSnapshot({ branch: checkedOutBranch, text });
  if (!snapshot.isOk()) {
    throw new Error(snapshot.error.message);
  }
  const localHeadSha = git.readGit({ args: ["rev-parse", "HEAD"], cwd: repoRoot });
  const statusText = git.readGit({ args: ["status", "--porcelain"], cwd: repoRoot });
  const [owner, name] = repoSlug.split("/");
  return {
    checkedOutBranch,
    defaultBranch: snapshot.value.defaultBranch,
    dirty: statusText.length > 0,
    localHeadSha,
    owner: owner!,
    repo: name!,
    repoRoot,
  };
}

/**
 * Push the just-rebased branch with an exact lease against `expectedRemoteSha`, and confirm the remote SHA
 * matches afterward.
 *
 * The lease is built from `expectedRemoteSha` — the head SHA `reconfirmFreshness` already confirmed GitHub
 * still reports, immediately before the rebase ran — never from an `ls-remote` read taken here, right before
 * the push. Leasing against a value read THIS close to the write is not a safety check at all: it just
 * legitimises whatever the remote happens to be at that instant, including a push that landed in the window
 * between the freshness re-check and this call — the exact race a lease exists to refuse, not launder.
 *
 * @param expectedRemoteSha the head GitHub was last confirmed to report, which the lease refuses to move past
 * @param home the state home whose push-root register the push is judged against
 * @returns `pushed` once the remote reads back as the local head, else why it failed or could not be confirmed
 */
export function pushRebasedHead({
  repoRoot,
  branch,
  remote,
  expectedRemoteSha,
  git,
  home,
}: {
  repoRoot: string;
  branch: string;
  remote: string;
  expectedRemoteSha: string;
  git: GithubPushDeps;
  home: string;
}): { readonly kind: "pushed" } | { readonly kind: "failed" | "unconfirmed"; readonly reason: string } {
  const localSha = git.readGit({ args: ["rev-parse", "HEAD"], cwd: repoRoot });
  const facts: GithubPushFacts = {
    branch,
    defaultBranch: "",
    localSha,
    remoteBranchSha: expectedRemoteSha,
    repo: "",
    repoRoot,
  };
  const planned = githubPushPlan({
    args: {
      baseFreshnessAcknowledgement: NO_BASE_FRESHNESS_ACKNOWLEDGEMENT,
      cwd: repoRoot,
      dryRun: false,
      forceWithLease: true,
      home: undefined,
      orphanAbove: NO_ORPHANS_ACCEPTED,
      remote,
      selfReviewSource: undefined,
    },
    facts,
  });
  if (!planned.isOk()) {
    return { kind: "failed", reason: planned.error.message };
  }
  return pushAndVerify({ deps: git, home, plan: planned.value });
}
