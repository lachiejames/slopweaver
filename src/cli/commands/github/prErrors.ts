/**
 * The pull-request and provider half of {@link GithubVerbErrors}: a credential that is not configured, a
 * provider read that did not return the fact a verb needs, a write GitHub accepted whose read-back disagrees,
 * a live fact that refuses the act, and a self-review comment that did not map to exactly one thread. Composed
 * into the one factory by `./errors.ts`; import that, not this.
 */
import type {
  GithubAuthorizationFailedError,
  GithubFactRefusedError,
  GithubProtectionPermissionDeniedError,
  GithubReadFailedError,
  GithubSelfReviewInvalidError,
  GithubStateChangedError,
  GithubTokenMissingError,
  GithubWriteUnconfirmedError,
} from "./errors.js";

/** The factory methods for pull-request and provider facts, composed into `GithubVerbErrors`. */
export const githubPrErrorFactories = {
  accountUnestablished: ({ cause }: { cause: string }): GithubAuthorizationFailedError => ({
    code: "AUTHORIZATION_FAILED",
    message: `could not establish the authenticated GitHub account: ${cause}`,
    subject: "authenticated account",
  }),
  adminUnestablished: ({
    owner,
    repo,
    cause,
  }: {
    owner: string;
    repo: string;
    cause: string;
  }): GithubAuthorizationFailedError => ({
    code: "AUTHORIZATION_FAILED",
    message: `could not establish whether this token holds admin on ${owner}/${repo}: ${cause}`,
    subject: `${owner}/${repo}`,
  }),
  baseDistancesShort: ({ expected, received }: { expected: number; received: number }): GithubReadFailedError => ({
    code: "READ_FAILED",
    message:
      `the base-distance read answered ${String(received)} of ${String(expected)} pull requests, ` +
      "so no row can be matched to its distance",
    subject: "base distance",
  }),
  closeRefused: ({ reason }: { reason: string }): GithubFactRefusedError => ({
    code: "FACT_REFUSED",
    message: `refused: ${reason}`,
    subject: "close",
  }),
  cycleLeftClosed: ({ url, cause }: { url: string; cause: string }): GithubWriteUnconfirmedError => ({
    code: "WRITE_UNCONFIRMED",
    message:
      `${url} may be CLOSED NOW: the cycle sent a close and GitHub confirmed neither reopen attempt (${cause}). ` +
      "Reopening it is the next act, before anything else; `github cycle` refuses a closed pull request, so " +
      "send this line to the supervisor",
    subject: url,
  }),
  cycleCloseUnconfirmed: ({ url, cause }: { url: string; cause: string }): GithubWriteUnconfirmedError => ({
    code: "WRITE_UNCONFIRMED",
    message:
      `GitHub answered the reopen of ${url} as open, but the close's answer was lost (${cause}) and no read ` +
      "showed it closed, so whether CI re-ran is unknown — and a close that lands late could still leave it " +
      "closed. Read its state and `github checks` before anything else",
    subject: url,
  }),
  cycleRefused: ({ reason }: { reason: string }): GithubFactRefusedError => ({
    code: "FACT_REFUSED",
    message: `refused: ${reason}`,
    subject: "cycle",
  }),
  mergeRefComputing: ({ number, reason }: { number: number; reason: string }): GithubFactRefusedError => ({
    code: "FACT_REFUSED",
    message:
      `not yet: ${reason}. GitHub is still computing the test merge, and a cycle now would re-run CI on the ` +
      "old one — run the same command again shortly",
    subject: `refs/pull/${String(number)}/merge`,
  }),
  mergeRefMovedBeforeClose: ({ number, reason }: { number: number; reason: string }): GithubStateChangedError => ({
    code: "STATE_CHANGED",
    message:
      `not yet: ${reason}, as read just before the close. The merge this run judged is no longer the one a ` +
      "cycle would re-run, so nothing was written — run the same command again shortly",
    subject: `refs/pull/${String(number)}/merge`,
  }),
  mergeRefSettled: ({ number, reason }: { number: number; reason: string }): GithubFactRefusedError => ({
    code: "FACT_REFUSED",
    message:
      `refused: ${reason}. GitHub has FINISHED this test merge, and reading again does not recompute it ` +
      "(a pull request can sit 45 minutes on " +
      "staging's previous tip). A cycle re-runs CI on that old merge. " +
      "When the recompute follows a reopen, `--prime` cycles once to trigger it — that run is " +
      "on the old merge — then run without --prime once the ref is fresh. If this pull request was JUST " +
      "primed, the recompute may not have started yet: run again later rather than priming twice",
    subject: `refs/pull/${String(number)}/merge`,
  }),
  descriptionUnconfirmed: ({ owner, repo }: { owner: string; repo: string }): GithubWriteUnconfirmedError => ({
    code: "WRITE_UNCONFIRMED",
    message: `GitHub accepted the description for ${owner}/${repo} but the read-back does not match what was sent`,
    subject: `${owner}/${repo}`,
  }),
  actionsDisableUnconfirmed: ({ owner, repo }: { owner: string; repo: string }): GithubWriteUnconfirmedError => ({
    code: "WRITE_UNCONFIRMED",
    message:
      `GitHub acknowledged switching Actions off for ${owner}/${repo} but the read-back still says enabled — ` +
      "an organisation or enterprise policy this token cannot see may be holding it on",
    subject: `${owner}/${repo}`,
  }),
  githubTokenMissing: (): GithubTokenMissingError => ({
    code: "TOKEN_MISSING",
    message: "no GitHub token configured; run `slopweaver connect github`",
    provider: "github",
  }),
  labelsUndefined: ({
    owner,
    repo,
    labels,
  }: {
    owner: string;
    repo: string;
    labels: readonly string[];
  }): GithubFactRefusedError => ({
    code: "FACT_REFUSED",
    message:
      `${owner}/${repo} does not define ${labels.join(", ")}; ` +
      "create the label in the repository first rather than letting this call invent it",
    subject: `${owner}/${repo}`,
  }),
  labelsUnconfirmed: ({
    number,
    missing,
  }: {
    number: number;
    missing: readonly string[];
  }): GithubWriteUnconfirmedError => ({
    code: "WRITE_UNCONFIRMED",
    message: `GitHub accepted the labels for #${String(number)} but the read-back is missing ${missing.join(", ")}`,
    subject: `#${String(number)}`,
  }),
  labelsUnverifiable: ({ owner, repo }: { owner: string; repo: string }): GithubReadFailedError => ({
    code: "READ_FAILED",
    message: `${owner}/${repo} defines more labels than this read covers; cannot verify --add`,
    subject: `${owner}/${repo}`,
  }),
  mutationUnconfirmed: ({ number, state }: { number: number; state: string }): GithubWriteUnconfirmedError => ({
    code: "WRITE_UNCONFIRMED",
    message: `GitHub accepted the mutation but #${String(number)} still reads back as ${state}`,
    subject: `#${String(number)}`,
  }),
  openPrMissing: ({ repo, branch }: { repo: string; branch: string }): GithubFactRefusedError => ({
    code: "FACT_REFUSED",
    message: `no open pull request has head ${repo}:${branch}`,
    subject: `${repo}:${branch}`,
  }),
  openPrUnread: ({ repo, branch, cause }: { repo: string; branch: string; cause: string }): GithubReadFailedError => ({
    code: "READ_FAILED",
    message: `could not find the open pull request for ${repo}:${branch}: ${cause}`,
    subject: `${repo}:${branch}`,
  }),
  rerunUnconfirmed: ({ run, attempt }: { run: string; attempt: string }): GithubWriteUnconfirmedError => ({
    code: "WRITE_UNCONFIRMED",
    message: `GitHub accepted the re-run of ${run} but it still reads back as attempt ${attempt}`,
    subject: run,
  }),
  runsUnverifiable: ({ sha }: { sha: string }): GithubReadFailedError => ({
    code: "READ_FAILED",
    message: `${sha} started more workflow runs than one read covers; name the run with --run-id instead`,
    subject: sha,
  }),
  protectionPermissionDenied: ({
    branch,
    denial,
  }: {
    branch: string;
    denial: string;
  }): GithubProtectionPermissionDeniedError => ({
    code: "PROTECTION_PERMISSION_DENIED",
    message: denial,
    subject: branch,
  }),
  protectionUnread: ({ branch, cause }: { branch: string; cause: string }): GithubReadFailedError => ({
    code: "READ_FAILED",
    message: `could not read branch protection for ${branch}: ${cause}`,
    subject: branch,
  }),
  prUnread: ({
    owner,
    repo,
    number,
    cause,
  }: {
    owner: string;
    repo: string;
    number: number;
    cause: string;
  }): GithubReadFailedError => ({
    code: "READ_FAILED",
    message: `could not read ${owner}/${repo}#${String(number)}: ${cause}`,
    subject: `${owner}/${repo}#${String(number)}`,
  }),
  retargetUnconfirmed: ({
    number,
    observed,
    expected,
  }: {
    number: number;
    observed: string;
    expected: string;
  }): GithubWriteUnconfirmedError => ({
    code: "WRITE_UNCONFIRMED",
    message:
      `GitHub accepted the retarget for #${String(number)} but the read-back still reports the base as ` +
      `${observed}, not ${expected}`,
    subject: `#${String(number)}`,
  }),
  reviewRequestUnconfirmed: ({
    number,
    missing,
  }: {
    number: number;
    missing: readonly string[];
  }): GithubWriteUnconfirmedError => ({
    code: "WRITE_UNCONFIRMED",
    message: `GitHub accepted the review request for #${String(number)} but the read-back is missing ${missing.join(", ")}`,
    subject: `#${String(number)}`,
  }),
  selfReviewNotOwnPr: (): GithubAuthorizationFailedError => ({
    code: "AUTHORIZATION_FAILED",
    message: "inline self-review comments may only be posted on the authenticated account's own PR",
    subject: "pull request author",
  }),
  slackMessageMissing: ({ ts }: { ts: string }): GithubReadFailedError => ({
    code: "READ_FAILED",
    message: `the read returned no message at ${ts}`,
    subject: ts,
  }),
  slackTokenMissing: (): GithubTokenMissingError => ({
    code: "TOKEN_MISSING",
    message: "no Slack token configured; run `slopweaver connect slack`",
    provider: "slack",
  }),
  threadMappedTwice: ({ threadId }: { threadId: string }): GithubSelfReviewInvalidError => ({
    code: "SELF_REVIEW_INVALID",
    message: `multiple submitted comments mapped to review thread ${threadId}`,
    subject: threadId,
  }),
  threadMappingNotOne: ({ commentId, count }: { commentId: string; count: number }): GithubSelfReviewInvalidError => ({
    code: "SELF_REVIEW_INVALID",
    message: `comment ${commentId} mapped to ${String(count)} review threads instead of exactly one`,
    subject: commentId,
  }),
} as const;
