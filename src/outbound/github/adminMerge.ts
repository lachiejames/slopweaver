/**
 * The administrator-bypass squash merge, adapted from the one sanctioned write client — the same shape
 * `./ready.ts` uses for the draft-to-ready transition, and for the same reason: the command keeps a small
 * injectable surface it can fake in a unit test, and the transport stays in one place.
 *
 * ## Why an admin bypass is a first-class path rather than a workaround
 *
 * On a repository whose sole CODEOWNER is also the sole pull-request author, `required_approving_review_count`
 * can never be satisfied: GitHub does not let an author approve their own pull request, so `reviewDecision`
 * stays `REVIEW_REQUIRED` forever and every plain merge is refused. Where protection also carries
 * `enforce_admins: false`, the administrator bypass is not an escape from the rule — it IS the merge path
 * the configuration leaves open. Making it an explicit option is what stops a session parking on a refusal
 * it can never clear.
 *
 * Nothing here decides whether to use it. The preflight facts this surface reads — is the viewer an
 * administrator, does the protection exempt administrators — are judged by the pure core in
 * `../../cli/commands/github/mergeAdminCore.ts`, which refuses with the exact reason when either fails.
 */

import { ResultAsync } from "neverthrow";
import type { GithubProtectionReadError } from "../../corpus/github/protectionRead.js";
import { type BranchProtection, type MergedPr, makeGithubWriteApi } from "../../corpus/github/write.js";
import type { IngestError } from "../../lib/ingestError.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { RequiredCheckContexts } from "../../live/github/branchProtection.js";
import type { GithubChecksSnapshot } from "../../live/github/checks.js";
import { makeFetchGithubChecks } from "../../live/github/checksRead.js";
import type { GithubLiveError } from "../../live/github/errors.js";
import {
  type GithubMergeQueueReads,
  type MergeQueuePrState,
  type MergeQueueStackMembership,
  type MergeQueueState,
  makeGithubMergeQueueReads,
} from "../../live/github/mergeQueue.js";
import { githubReadGraphql, githubReadRest } from "../../live/github/read.js";
import { makeReviewGateRead, type ReviewGate } from "../../live/github/reviewRules.js";
import type { GithubWritePrivacy } from "./writePrivacy.js";

/** The pull-request state an admin merge gates on, and later confirms against. */
export interface AdminMergePr {
  readonly number: number;
  readonly url: string;
  readonly title: string;
  /** GitHub's own `open`/`closed`; a merged pull request reads `closed`. */
  readonly state: string;
  /** When GitHub merged it; absent while it is unmerged, and for a pull request closed WITHOUT merging. */
  readonly mergedAtIso?: string | undefined;
  readonly draft: boolean;
  /** The branch being merged into — the branch whose protection the preflight reads. */
  readonly baseRef: string;
  /** The pull request's HEAD branch — what a local checkout must be on to speak for this pull request. */
  readonly headRef: string;
  /** The head commit the merge is pinned to, so a force-push mid-flight is refused rather than merged. */
  readonly headSha: string;
  /**
   * GitHub's base commit for this pull request (GraphQL `baseRefOid`) — what the ratchet-bump witness lists
   * new bump manifests against. Read beside the head it was paired with, never from a local ref.
   */
  readonly baseSha: string;
  /**
   * The pull request's description, from the same GraphQL read as {@link baseSha}, so a reader of it sees the
   * description that head carried.
   */
  readonly body: string;
  /**
   * This pull request's NATIVE stack membership, from the same GraphQL read as {@link baseSha}, or `undefined` when
   * it belongs to no stack. Carried so the preflight can refuse a member whose landing branch has no merge queue
   * BEFORE GitHub's own merge API does, after a whole local lap has been spent.
   */
  readonly stack: MergeQueueStackMembership | undefined;
  /**
   * The merge queue on the STACK's landing branch (`stack.baseRefName`, never this pull request's immediate base,
   * which for a member above the bottom is the branch of the member below it), or `undefined` when that branch has
   * none — and always `undefined` for a pull request in no stack, whose landing branch is never read for one.
   */
  readonly stackQueue: MergeQueueState | undefined;
}

/** The operation an admin merge's base-commit read reports under. */
const BASE_READ_OPERATION = "github.adminMerge.baseCommit";

/**
 * The base-commit read's failure as the one boundary error this surface speaks.
 *
 * @returns a rate-limit failure for GitHub's rate limit, an HTTP failure for anything else
 */
function baseReadFailure({ error }: { error: GithubLiveError }): IngestError {
  const kind = error.code === "RATE_LIMITED" ? "rate-limit" : "http";
  return { kind, message: error.message, operation: BASE_READ_OPERATION, provider: "github" };
}

/**
 * Pair the REST pull request with GitHub's base commit, refusing when the two reads saw different heads — a
 * push landed between them, so the base may not belong to the head the merge would pin — or different base
 * BRANCHES: a retarget between them would judge a ratchet bump against a branch the merge does not land on.
 *
 * @param pr the pull request as the REST read mapped it, still without its base commit
 * @param state the same pull request as the GraphQL merge-queue read found it
 * @returns the pull request with its base commit, description and stack membership, or the failure naming both heads or both
 *   base branches
 */
export function withBaseCommit({
  pr,
  state,
}: {
  pr: Omit<AdminMergePr, "baseSha" | "body" | "stack" | "stackQueue">;
  state: MergeQueuePrState;
}): Result<Omit<AdminMergePr, "stackQueue">, IngestError> {
  if (state.headOid !== pr.headSha) {
    return err({
      kind: "http",
      message: `the head moved between two reads (${pr.headSha}, then ${state.headOid}); run the merge again`,
      operation: BASE_READ_OPERATION,
      provider: "github",
    });
  }
  if (state.baseRefName !== pr.baseRef) {
    return err({
      kind: "http",
      message: `the base was retargeted between two reads (${pr.baseRef}, then ${state.baseRefName}); run the merge again`,
      operation: BASE_READ_OPERATION,
      provider: "github",
    });
  }
  return ok({ ...pr, baseSha: state.baseRefOid, body: state.body, stack: state.stack });
}

/**
 * Add the merge queue on a stack member's LANDING branch. A pull request in no stack reads nothing more. A failed
 * queue read is a failure, never "no queue": read as none, it would refuse a member that can land.
 *
 * @param pr the pull request with its stack membership already read
 * @param queue the merge-queue read, the same reader the stack membership came through
 * @returns the pull request with its stack's queue, or the queue read's failure
 */
export async function withStackQueue({
  owner,
  pr,
  queue,
  repo,
}: {
  owner: string;
  pr: Omit<AdminMergePr, "stackQueue">;
  queue: GithubMergeQueueReads["queue"];
  repo: string;
}): Promise<Result<AdminMergePr, IngestError>> {
  if (pr.stack === undefined) {
    return ok({ ...pr, stackQueue: undefined });
  }
  const read = await queue({ branch: pr.stack.baseRefName, owner, repo });
  if (read.isErr()) {
    return err(baseReadFailure({ error: read.error }));
  }
  return ok({ ...pr, stackQueue: read.value });
}

/**
 * How many rollup contexts the preflight's checks read asks for — the same ceiling `github checks` uses.
 */
const CHECKS_READ_LIMIT = 100;

/** Injectable read/preflight/merge surface; tests provide plain fakes. */
export interface GithubAdminMergeApi {
  read(args: { owner: string; repo: string; number: number }): ResultAsync<AdminMergePr, IngestError>;
  isAdmin(args: { owner: string; repo: string }): ResultAsync<boolean, IngestError>;
  protection(args: {
    owner: string;
    repo: string;
    branch: string;
  }): ResultAsync<BranchProtection, GithubProtectionReadError>;
  /**
   * The head commit's checks, read for ONE purpose: to see which required contexts are not there at all.
   *
   * This verb deliberately does not gate on a check that FAILED — a red check is visible in `github checks`,
   * in the rollup and in GitHub's own UI, and judging it is the operator's own lap. A required context that
   * never ran is visible in none of those, which is why it is guarded here and a red one is not.
   */
  checks(args: { owner: string; repo: string; number: number }): Promise<Result<GithubChecksSnapshot, GithubLiveError>>;
  /** The contexts the base branch requires — classic protection and rulesets unioned. */
  requiredContexts(args: {
    owner: string;
    repo: string;
    branch: string;
  }): Promise<Result<RequiredCheckContexts, GithubLiveError>>;
  /**
   * The REVIEWS the base branch requires — classic protection and rulesets unioned, the same way the
   * contexts are, because a branch may be governed by either and each API reports only its own.
   *
   * This is the read that decides whether `--admin` has a route at all. See
   * `../../live/github/reviewRules.ts` for the measurement behind it.
   */
  reviewRules(args: { owner: string; repo: string; branch: string }): Promise<ReviewGate>;
  merge(args: {
    owner: string;
    repo: string;
    number: number;
    sha: string;
    commitTitle: string;
  }): ResultAsync<MergedPr, IngestError>;
}

/**
 * Build the production no-SDK-retry admin-merge client.
 *
 * @param token the GitHub token
 * @returns the safe read, preflight and squash-merge seams
 */
export function makeGithubAdminMergeApi({
  privacy,
  token,
}: {
  privacy: GithubWritePrivacy;
  token: string;
}): GithubAdminMergeApi {
  const api = makeGithubWriteApi({ privacy, token });
  const graphql = githubReadGraphql({ token });
  const rest = githubReadRest({ token });
  const queueReads = makeGithubMergeQueueReads({ graphql, rest });
  const readReviewGate = makeReviewGateRead({ rest });
  return {
    checks: ({ owner, repo, number }) =>
      makeFetchGithubChecks({ graphql })({ limit: CHECKS_READ_LIMIT, number, owner, repo }),
    isAdmin: ({ owner, repo }) => api.canAdmin({ owner, repo }),
    merge: ({ owner, repo, number, sha, commitTitle }) => api.mergePr({ commitTitle, number, owner, repo, sha }),
    protection: ({ owner, repo, branch }) => api.branchProtection({ branch, owner, repo }),
    requiredContexts: ({ owner, repo, branch }) => queueReads.requiredContexts({ branch, owner, repo }),
    reviewRules: ({ owner, repo, branch }) => readReviewGate({ branch, owner, repo }),
    read: ({ owner, repo, number }) =>
      api
        .getPr({ number, owner, repo })
        .map((pr) => ({
          baseRef: pr.baseRef,
          draft: pr.draft,
          headRef: pr.head.ref,
          headSha: pr.head.sha,
          mergedAtIso: pr.mergedAtIso,
          number: pr.number,
          state: pr.state,
          title: pr.title,
          url: pr.htmlUrl,
        }))
        .andThen((pr) =>
          new ResultAsync(queueReads.pr({ number, owner, repo }))
            .mapErr((error) => baseReadFailure({ error }))
            .andThen((state) => withBaseCommit({ pr, state })),
        )
        .andThen((pr) => new ResultAsync(withStackQueue({ owner, pr, queue: queueReads.queue, repo }))),
  };
}
