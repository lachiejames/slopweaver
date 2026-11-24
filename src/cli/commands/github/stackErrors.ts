/**
 * The stack and Git half of {@link GithubVerbErrors}: a Git command that failed or answered something
 * unreadable, a branch with no single usable worktree, a branch or head that moved between measuring and
 * acting, a stack whose topology or target this verb will not act on, and a registration the read-back does not
 * confirm. Composed into the one factory by `./errors.ts`; import that, not this.
 */
import type {
  GithubFactRefusedError,
  GithubGitFailedError,
  GithubReadFailedError,
  GithubStackInvalidError,
  GithubStackPushOpenPrUnreadError,
  GithubStateChangedError,
  GithubWorktreeRefusedError,
  GithubWriteUnconfirmedError,
} from "./errors.js";

/** What a stack registration's read-back observed, named in the refusal when it does not confirm the write. */
interface RegistrationObserved {
  readonly failures: readonly string[];
  readonly expectedStackNumber: number;
  readonly childNumber: number;
  readonly childStack: string;
  readonly parentNumber: number;
  readonly parentStack: string;
  readonly stackNumber: number;
  readonly entryNumbers: readonly number[];
  readonly childBase: string;
  readonly parentHead: string;
}

/** The factory methods for stacks, worktrees and Git, composed into `GithubVerbErrors`. */
export const githubStackErrorFactories = {
  ancestryFailed: ({ cause }: { cause: string }): GithubGitFailedError => ({
    code: "GIT_FAILED",
    message: `git merge-base --is-ancestor failed: ${cause}`,
    operation: "merge-base --is-ancestor",
  }),
  baseTipUnmeasured: ({ label }: { label: string }): GithubStackInvalidError => ({
    code: "STACK_INVALID",
    message: `${label}: its base tip was never measured`,
    subject: label,
  }),
  baseUnfetched: ({
    remote,
    baseBranch,
    cause,
  }: {
    remote: string;
    baseBranch: string;
    cause: string;
  }): GithubGitFailedError => ({
    code: "GIT_FAILED",
    message: `could not fetch ${remote}/${baseBranch}: ${cause}`,
    operation: "fetch",
  }),
  basePrUnread: ({ baseRef, cause }: { baseRef: string; cause: string }): GithubReadFailedError => ({
    code: "READ_FAILED",
    message: `could not read the open pull request for base branch ${baseRef}: ${cause}`,
    subject: baseRef,
  }),
  branchCheckedOut: ({
    branch,
    holders,
    stagedRef,
  }: {
    branch: string;
    holders: readonly string[];
    stagedRef: string;
  }): GithubWorktreeRefusedError => ({
    branch,
    code: "WORKTREE_REFUSED",
    message:
      `${branch} is checked out in ${holders.join(", ")} — its restacked commits are staged at ` +
      `${stagedRef}, and moving a checked-out branch under a working tree is not this verb's to do`,
  }),
  branchMoved: ({
    branch,
    current,
    expected,
    stagedRef,
  }: {
    branch: string;
    current: string;
    expected: string;
    stagedRef: string;
  }): GithubStateChangedError => ({
    code: "STATE_CHANGED",
    message:
      `${branch} is at ${current}, not the ${expected} this run measured — something else moved it, ` +
      `so its restacked commits are staged at ${stagedRef} and the branch is left alone`,
    subject: branch,
  }),
  branchUnmoved: ({
    branch,
    from,
    to,
    cause,
  }: {
    branch: string;
    from: string;
    to: string;
    cause: string;
  }): GithubGitFailedError => ({
    code: "GIT_FAILED",
    message: `could not move ${branch} from ${from} to ${to}: ${cause}`,
    operation: "update-ref",
  }),
  childPrUnread: ({ number, cause }: { number: number; cause: string }): GithubReadFailedError => ({
    code: "READ_FAILED",
    message: `could not read PR #${String(number)}: ${cause}`,
    subject: `#${String(number)}`,
  }),
  commitsUncounted: ({
    from,
    to,
    cwd,
    cause,
  }: {
    from: string;
    to: string;
    cwd: string;
    cause: string;
  }): GithubGitFailedError => ({
    code: "GIT_FAILED",
    message: `could not count commits ${from}..${to} in ${cwd}: ${cause}`,
    operation: "rev-list --count",
  }),
  emptyRefspecSignature: ({ ref, sha, base }: { ref: string; sha: string; base: string }): GithubFactRefusedError => ({
    code: "FACT_REFUSED",
    message:
      `${ref} resolved to ${sha}, identical to ${base} — this is the empty-refspec ` +
      "fail-open's own signature (an empty or misresolved head makes `git fetch` accept a refspec with " +
      `no source and resolve the destination to the remote's own HEAD), refusing rather than reporting ` +
      "a false clean",
    subject: ref,
  }),
  factRefused: ({ subject, reason }: { subject: string; reason: string }): GithubFactRefusedError => ({
    code: "FACT_REFUSED",
    message: reason,
    subject,
  }),
  fetchedUnresolved: ({ ref, cause }: { ref: string; cause: string }): GithubGitFailedError => ({
    code: "GIT_FAILED",
    message: `fetched ${ref} but could not resolve it: ${cause}`,
    operation: "rev-parse",
  }),
  headRefNameBlank: (): GithubFactRefusedError => ({
    code: "FACT_REFUSED",
    message: "headRefName is empty or whitespace — refusing before it reaches a refspec",
    subject: "headRefName",
  }),
  noMergeBase: ({ label, baseBranch }: { label: string; baseBranch: string }): GithubStackInvalidError => ({
    code: "STACK_INVALID",
    message: `${label}: no merge-base with ${baseBranch} — refusing to guess what it was forked from`,
    subject: label,
  }),
  noWorktree: ({ branch }: { branch: string }): GithubWorktreeRefusedError => ({
    branch,
    code: "WORKTREE_REFUSED",
    message: `no worktree has ${branch} checked out`,
  }),
  privateRefUndeleted: ({ ref, cause }: { ref: string; cause: string }): GithubGitFailedError => ({
    code: "GIT_FAILED",
    message: `could not delete private ref ${ref}: ${cause}`,
    operation: "update-ref -d",
  }),
  prRereadFailed: ({ number, cause }: { number: number; cause: string }): GithubReadFailedError => ({
    code: "READ_FAILED",
    message: `could not re-read PR #${String(number)} before writing: ${cause}`,
    subject: `#${String(number)}`,
  }),
  refUnresolved: ({ ref, cwd, cause }: { ref: string; cwd: string; cause: string }): GithubGitFailedError => ({
    code: "GIT_FAILED",
    message: `"${ref}" does not resolve to a commit in ${cwd}: ${cause}`,
    operation: "rev-parse --verify",
  }),
  registrationUnconfirmed: ({ observed }: { observed: RegistrationObserved }): GithubWriteUnconfirmedError => ({
    code: "WRITE_UNCONFIRMED",
    message:
      `${observed.failures.join("; ")}. Observed: expected stack #${String(observed.expectedStackNumber)}; child ` +
      `#${String(observed.childNumber)} stack ${observed.childStack}; parent #${String(observed.parentNumber)} ` +
      `stack ${observed.parentStack}; fetched stack #${String(observed.stackNumber)} entries ` +
      `[${observed.entryNumbers.map((number) => `#${String(number)}`).join(", ")}]; child base ${observed.childBase}; ` +
      `parent head ${observed.parentHead}. No local enrolment was written.`,
    subject: `#${String(observed.childNumber)}`,
  }),
  remoteNotRepository: ({ remote }: { remote: string }): GithubFactRefusedError => ({
    code: "FACT_REFUSED",
    message: `remote ${remote} is not an owner/name Git repository URL`,
    subject: remote,
  }),
  revListUnparsed: ({ text, cwd }: { text: string; cwd: string }): GithubGitFailedError => ({
    code: "GIT_FAILED",
    message: `git rev-list --count answered "${text}" in ${cwd}`,
    operation: "rev-list --count",
  }),
  squashHeadMismatch: ({ localHead, headSha }: { localHead: string; headSha: string }): GithubStateChangedError => ({
    code: "STATE_CHANGED",
    message:
      `the checked-out HEAD (${localHead}) does not match GitHub's reported head SHA for this PR ` +
      `(${headSha}) — refusing to rebase a branch that does not match what was measured`,
    subject: "HEAD",
  }),
  squashHeadMoved: ({ was, now }: { was: string; now: string }): GithubStateChangedError => ({
    code: "STATE_CHANGED",
    message:
      `the checked-out branch moved during the fetch (was ${was}, is now ${now}) — ` +
      "refusing to rebase a commit that is no longer checked out",
    subject: "HEAD",
  }),
  squashMergeCommit: ({ headSha, parents }: { headSha: string; parents: number }): GithubStackInvalidError => ({
    code: "STACK_INVALID",
    message: `PR head ${headSha} is a merge commit (${String(parents)} parents) — this primitive only replays a plain single commit`,
    subject: headSha,
  }),
  squashParentless: ({ headSha }: { headSha: string }): GithubStackInvalidError => ({
    code: "STACK_INVALID",
    message: `could not resolve the parent of ${headSha} — it has no parent at all`,
    subject: headSha,
  }),
  stackBaseEqualsHead: (): GithubStackInvalidError => ({
    code: "STACK_INVALID",
    message: "the form's target.base and target.head must differ",
    subject: "target",
  }),
  stackHeadNotCheckedOut: ({ head, branch }: { head: string; branch: string }): GithubStackInvalidError => ({
    code: "STACK_INVALID",
    message: `the form's target.head (${head}) must be the checked-out branch (${branch})`,
    subject: head,
  }),
  stackPushDefaultBranch: ({ defaultBranch }: { defaultBranch: string }): GithubFactRefusedError => ({
    code: "FACT_REFUSED",
    message: `the checked-out branch is the remote default (${defaultBranch}); stack push raises pull-request branches only`,
    subject: defaultBranch,
  }),
  stackPushOpenPrBaseMismatch: ({
    head,
    number,
    expectedBase,
    actualBase,
  }: {
    head: string;
    number: number;
    expectedBase: string;
    actualBase: string;
  }): GithubFactRefusedError => ({
    code: "FACT_REFUSED",
    message:
      `${head} already has open pull request #${String(number)} onto ${actualBase}, but the form targets ` +
      `${expectedBase}; nothing was pushed. Retarget that pull request, or name its base in the form.`,
    subject: head,
  }),
  stackPushOpenPrUnread: ({
    repo,
    head,
    cause,
  }: {
    repo: string;
    head: string;
    cause: string;
  }): GithubStackPushOpenPrUnreadError => ({
    code: "STACK_PUSH_OPEN_PR_UNREAD",
    message:
      `could not read whether ${repo}:${head} already has an open pull request, so neither description review ` +
      `can name it; nothing was pushed: ${cause}`,
    subject: `${repo}:${head}`,
  }),
  stackRepoMismatch: ({
    owner,
    repo,
    remoteRepo,
  }: {
    owner: string;
    repo: string;
    remoteRepo: string;
  }): GithubStackInvalidError => ({
    code: "STACK_INVALID",
    message: `the form's target repository (${owner}/${repo}) does not match the checked-out remote (${remoteRepo})`,
    subject: `${owner}/${repo}`,
  }),
  worktreeAmbiguous: ({ branch, paths }: { branch: string; paths: readonly string[] }): GithubWorktreeRefusedError => ({
    branch,
    code: "WORKTREE_REFUSED",
    message: `${branch} is checked out in more than one worktree: ${paths.join(", ")}`,
  }),
  worktreeBareOrDetached: ({ branch, path }: { branch: string; path: string }): GithubWorktreeRefusedError => ({
    branch,
    code: "WORKTREE_REFUSED",
    message: `${branch}'s worktree (${path}) is bare or detached`,
  }),
  worktreeLocked: ({ branch, path }: { branch: string; path: string }): GithubWorktreeRefusedError => ({
    branch,
    code: "WORKTREE_REFUSED",
    message: `${branch}'s worktree (${path}) is locked`,
  }),
} as const;
