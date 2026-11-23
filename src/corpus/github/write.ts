/**
 * The GitHub WRITE lane — a deliberately separate transport from the read client in `./githubClient.ts`.
 *
 * ## Why the read client cannot be reused, with numbers
 *
 * `makeGithubClient` installs `@octokit/plugin-retry` and `@octokit/plugin-throttling`, and both callbacks
 * permit `MAX_RETRIES`. Measured against a local fault server, counting POSTs the server actually RECEIVED
 * for a single `pulls.create`:
 *
 * | server answers | the read client | this client |
 * | --- | --- | --- |
 * | `500` | 4 | **1** |
 * | `421` | 8 | 2 |
 * | `307` + `location` | 2 | **1** |
 *
 * Eight POSTs on one 421 is disqualifying for an irreversible create, which is why this file exists rather
 * than a flag on the existing factory.
 *
 * ## At-most-once, and the one layer that is honestly out of reach
 *
 * Four layers, three of them here:
 *
 * 1. `safeProviderCall({ retryMode: "never" })` — one wrapper attempt.
 * 2. Octokit's own retry and throttle plugins disabled, so a 5xx is not slept off and re-sent inside the SDK.
 * 3. `redirect: "manual"` in a custom `request.fetch`, so a 307 is returned rather than followed. A 307
 *    preserves method and body by specification, so following one re-POSTs, and no Octokit option reaches it
 *    because the redirect is handled below the SDK.
 * 4. The branch-locus reservation in `../../outbound/github/prLedger.ts`, taken before the call.
 *
 * **What is NOT covered, stated rather than buried: a 421 still sends twice.** undici re-dispatches it
 * internally, below `fetch`, and pinning a custom dispatcher to stop that is a bigger change than this lane
 * justifies. It is also the one repeat that is safe by specification — 421 asserts the server was not
 * authoritative and did NOT handle the request — so the second send cannot duplicate a committed create.
 * That is an argument for accepting it, not for claiming it does not happen.
 *
 * ## Why each operation repeats `safeProviderCall` instead of sharing a helper
 *
 * An earlier cut routed every operation through one small `call()` wrapper. It read better and it broke the
 * gate: `boundary-residue` sanctions a raw `client.rest` token only when it is LEXICALLY inside
 * `safeProviderCall(...)`, and the helper moved the token one call away. The scanner was right to complain —
 * that indirection is exactly how a call could later drift out of the wrapper without the diff showing it.
 */
import type { IngestError } from "../../lib/ingestError.js";
import type { ResultAsync } from "../../lib/result.js";
import type {
  CodeScanningAlert,
  CodeScanningAlertPage,
  CodeScanningAlertState,
  CodeScanningDismissedReason,
} from "./codeScanning.js";
import { codeScanningAlertsVia, codeScanningAlertVia, dismissCodeScanningAlertVia } from "./codeScanning.js";
import {
  createIssueCommentVia,
  getIssueCommentVia,
  type IssueCommentSummary,
  listIssueCommentsVia,
  updateIssueCommentVia,
  type WrittenComment,
} from "./comments.js";
import type { DependabotAlert, DependabotAlertPage, DependabotAlertState, DependabotSeverity } from "./dependabot.js";
import { dependabotAlertsVia, dependabotAlertVia } from "./dependabot.js";
import { addIssueLabelsVia, type IssueLabelState, issueLabelsVia, repoLabelsVia } from "./labels.js";
import type { GithubAsyncMergeState } from "./mergeAsync.js";
import type { MergeGroupObservation, RequiredStatusChecks } from "./protection.js";
import { mergeGroupContextsVia, requiredStatusChecksVia, setRequiredStatusChecksVia } from "./protection.js";
import type { GithubProtectionReadError } from "./protectionRead.js";
import { getRepoDescriptionVia, type RepoDescriptionState, setRepoDescriptionVia } from "./repoDescription.js";
import { type RequestedReviewers, requestedReviewersVia, requestReviewersVia } from "./reviewers.js";
import type { GithubStack } from "./stack.js";
import {
  answerReviewThreadVia,
  type ReviewThreadAnswer,
  type ReviewThreadDetail,
  reopenReviewThreadVia,
  reviewThreadDetailsVia,
} from "./threads.js";
import {
  authenticatedUserIdVia,
  canPushVia,
  closeVia,
  createVia,
  findOpenPrByHeadVia,
  getVia,
  listPrsVia,
  listRunsVia,
  markDraftVia,
  markReadyVia,
  updateVia,
} from "./writeCrud.js";
import { makeGithubWriteCtx } from "./writeCtx.js";
import { type BranchProtection, branchProtectionVia, canAdminVia, type MergedPr, mergeVia } from "./writeMerge.js";
import { dequeuePrVia, enqueuePrVia, enqueueStackPrVia } from "./writeQueue.js";
import { diffFilesVia, reviewThreadsVia, submitReviewRoundVia } from "./writeReview.js";
import {
  addToStackVia,
  createStackVia,
  getStackVia,
  listOpenPrsAuthoredByMeVia,
  listOpenPrsVia,
  unstackVia,
} from "./writeStack.js";

export type { WrittenComment } from "./comments.js";
export type { RequestedReviewers } from "./reviewers.js";
export type { WriteCtx } from "./writeCtx.js";
export type { BranchProtection, MergedPr } from "./writeMerge.js";

/** A pull request as GitHub returned it, narrowed to what this lane needs. */
export interface WrittenPr {
  readonly number: number;
  readonly nodeId: string;
  readonly htmlUrl: string;
  /** The body as GitHub STORED it — the digest input for the ledger's conflict signal. */
  readonly body: string | undefined;
  readonly title: string;
  readonly draft: boolean;
  readonly state: string;
  /**
   * When GitHub last touched it, ISO-8601.
   *
   * Carried for one specific reason: it is the only field that can prove a PATCH actually MUTATED the pull
   * request in a recorded test. `title` and `body` are redacted out of a committed cassette, so an assertion
   * on them proves nothing on replay; `updated_at` is on the redactor's keep-list and survives verbatim, so
   * "strictly advanced" is a real assertion rather than a shape check.
   */
  readonly updatedAtIso: string;
  /**
   * The author's IMMUTABLE numeric id, and undefined when GitHub returned none.
   *
   * The id rather than the login, because a login can be changed and reused while an id cannot — so the
   * authorisation check compares something that cannot be impersonated by a rename. Undefined is a real state
   * rather than a default: an App installation token can produce a payload with no user, and the caller fails
   * closed on it instead of treating "unknown" as "not me" or "me".
   */
  readonly authorId: number | undefined;
  /** The branch being merged INTO, and the repository that owns it. */
  readonly baseRef: string;
  readonly baseRepoFullName: string;
  /**
   * The branch being merged FROM.
   *
   * `repoFullName` is undefined when GitHub reports `head.repo` as null, which is what happens once a fork is
   * deleted. It stays a distinct state rather than being coalesced to the base repository, because collapsing
   * it would let a deleted-fork pull request and a same-repository one answer the same branch address.
   *
   * `sha` is carried for one reason that is easy to miss: a description review binds the head it read, so a
   * force-push between reading a pull request and writing to it leaves a description reviewed against a head
   * that is no longer there. Nothing else in this payload can detect that.
   */
  readonly head: {
    readonly ref: string;
    readonly label: string;
    readonly repoFullName: string | undefined;
    readonly sha: string;
  };
  /**
   * The pull request's native GitHub stack membership, inline on every read — `undefined` when it isn't
   * stacked. No generated Octokit type declares this field yet (confirmed against `RawPr`/`RawPrSummary`),
   * so it is read defensively rather than off the typed payload, matching {@link authorIdOf}.
   */
  readonly stack: PrStackMembership | undefined;
  /**
   * GitHub's own authoritative count of commits on this pull request — `undefined` when the read came from
   * `pulls.list` (`RawPrSummary`), which omits it; always present from `getPr`/`createPr`/`updatePr`
   * (`RawPr`). Deliberately GitHub's own server-side count rather than anything derived from local git
   * ancestry: a stale or rewritten local base branch makes "how many commits does this branch have"
   * genuinely ambiguous to compute locally, while GitHub already knows the answer unambiguously.
   */
  readonly commits: number | undefined;
  /**
   * When GitHub merged this pull request, ISO-8601 — `undefined` when it never was.
   *
   * `state` alone cannot tell a merged pull request from one closed without merging: both read back as
   * `"closed"`. This is the one field that distinguishes them, which `github close` refuses on by name.
   */
  readonly mergedAtIso: string | undefined;
}

/** A pull request's compact inline stack membership, as embedded on every PR read (not the full stack object). */
export interface PrStackMembership {
  readonly id: number;
  readonly number: number;
  readonly size: number;
  readonly position: number;
}

/** One Actions run, for resolving the CI badge's link. */
export interface WorkflowRun {
  readonly id: number;
  readonly htmlUrl: string;
  readonly createdAt: string;
}

/** One current-diff thread submitted as part of a pull-request review. */
export interface ReviewThreadDraft {
  readonly body: string;
  readonly line: number;
  readonly path: string;
}

/** GitHub ids returned for a submitted review round. */
export interface WrittenReviewRound {
  readonly reviewId: string;
  readonly commentIds: readonly string[];
}

/** One live review thread, narrowed to the fields exact readback needs. */
export interface ReviewThreadSnapshot {
  readonly id: string;
  readonly isResolved: boolean;
  readonly commentIds: readonly string[];
}

/** One changed file's unified diff patch at a pull request's current head — `undefined` when GitHub reports none. */
export interface PullRequestDiffFile {
  readonly path: string;
  readonly patch: string | undefined;
}

/**
 * Which repository a call addresses. Extracted because every method needs it — the house rule reserves
 * extraction for a type that is genuinely reused, and six call sites is that.
 */
export interface RepoRef {
  readonly owner: string;
  readonly repo: string;
}

/** One pull request in a repository. */
export interface PrRef extends RepoRef {
  readonly number: number;
}

/** The write surface, injectable so a caller can pass a plain fake instead of a client. */
export interface GithubWriteApi {
  readonly createPr: (
    input: RepoRef & { base: string; head: string; title: string; body: string; draft: boolean },
  ) => ResultAsync<WrittenPr, IngestError>;
  readonly updatePr: (
    input: PrRef & { title?: string | undefined; body?: string | undefined; base?: string | undefined },
  ) => ResultAsync<WrittenPr, IngestError>;
  readonly getPr: (input: PrRef) => ResultAsync<WrittenPr, IngestError>;
  /** Read a repository's current description — the pre-write state, and the read-back after `setRepoDescription`. */
  readonly getRepoDescription: (input: RepoRef) => ResultAsync<RepoDescriptionState, IngestError>;
  /** Replace a repository's description. The caller confirms with a separate `getRepoDescription` read-back. */
  readonly setRepoDescription: (
    input: RepoRef & { description: string },
  ) => ResultAsync<RepoDescriptionState, IngestError>;
  /**
   * Every label the repository DEFINES, with whether the paginated read was truncated.
   *
   * The preflight `addIssueLabels` has no substitute for: GitHub CREATES an undefined label rather than
   * refusing it, so without this read a typo is indistinguishable from an intent.
   */
  readonly repoLabels: (
    input: RepoRef,
  ) => ResultAsync<{ readonly names: readonly string[]; readonly truncated: boolean }, IngestError>;
  /** One issue's or pull request's current labels — the pre-write state, and the read-back after `addIssueLabels`. */
  readonly issueLabels: (input: PrRef) => ResultAsync<IssueLabelState, IngestError>;
  /** Add labels to one issue or pull request; the caller confirms them with a separate `issueLabels` read-back. */
  readonly addIssueLabels: (
    input: PrRef & { labels: readonly string[] },
  ) => ResultAsync<readonly string[], IngestError>;
  /** Who a pull request currently has review requested from — the pre-write state, and `requestReviewers`'s read-back. */
  readonly requestedReviewers: (input: PrRef) => ResultAsync<RequestedReviewers, IngestError>;
  /**
   * Request review from the given users and/or teams; the caller confirms with a separate `requestedReviewers`
   * read-back.
   */
  readonly requestReviewers: (
    input: PrRef & { reviewers: readonly string[]; teamReviewers: readonly string[] },
  ) => ResultAsync<RequestedReviewers, IngestError>;
  /**
   * Every code-scanning alert for a repository, optionally scoped to one git ref (a pull request's head,
   * say) and filtered to one state. Paginated client-side; the caller is told when the read was truncated
   * rather than being handed a partial list that reads as complete.
   */
  readonly codeScanningAlerts: (
    input: RepoRef & { ref?: string | undefined; state?: CodeScanningAlertState | undefined },
  ) => ResultAsync<CodeScanningAlertPage, IngestError>;
  /** Read one code-scanning alert by number — the pre-dismissal read `alert dismiss` re-verifies against. */
  readonly codeScanningAlert: (input: RepoRef & { alertNumber: number }) => ResultAsync<CodeScanningAlert, IngestError>;
  /** Dismiss one code-scanning alert with a reason GitHub's own enum accepts; the response IS the read-back. */
  readonly dismissCodeScanningAlert: (
    input: RepoRef & { alertNumber: number; reason: CodeScanningDismissedReason; comment: string },
  ) => ResultAsync<CodeScanningAlert, IngestError>;
  /**
   * Every Dependabot alert on a repository, filtered to GitHub's own state and severity enums.
   *
   * A separate family from `codeScanningAlerts` on purpose: the two share the word "alert" and neither their
   * endpoint, their severity vocabulary nor their remedy. See `./dependabot.ts`.
   */
  readonly dependabotAlerts: (
    input: RepoRef & { state?: DependabotAlertState | undefined; severity?: DependabotSeverity | undefined },
  ) => ResultAsync<DependabotAlertPage, IngestError>;
  /** Read one Dependabot alert by number — everything the alert's own page shows. */
  readonly dependabotAlert: (input: RepoRef & { alertNumber: number }) => ResultAsync<DependabotAlert, IngestError>;
  /** Move one draft pull request into review; the caller confirms the state with a separate `getPr`. */
  readonly markPrReady: (input: { nodeId: string }) => ResultAsync<void, IngestError>;
  /** Return one open pull request to draft; the caller confirms the state with a separate `getPr`. */
  readonly markPrDraft: (input: { nodeId: string }) => ResultAsync<void, IngestError>;
  /**
   * Submit one visible COMMENT review and resolve the supplied prior threads in the same no-retry GraphQL
   * operation. The review field executes first, so a partial failure preserves the old context alongside the
   * new rather than removing the reviewer's only walkthrough.
   */
  readonly submitReviewRound: (input: {
    pullRequestId: string;
    commitOid: string;
    comments: readonly ReviewThreadDraft[];
    resolveThreadIds: readonly string[];
  }) => ResultAsync<WrittenReviewRound, IngestError>;
  /** The newest bounded review-thread window used to map returned comment ids to owning thread ids. */
  readonly reviewThreads: (input: {
    pullRequestId: string;
  }) => ResultAsync<readonly ReviewThreadSnapshot[], IngestError>;
  /**
   * Every review thread on a pull request, with the first comment's author and body.
   *
   * Distinct from `reviewThreads` above, which carries only ids and is the self-review round's own read-back.
   * This one is what a caller reads to FIND somebody else's thread before answering it.
   */
  readonly reviewThreadDetails: (input: {
    pullRequestId: string;
  }) => ResultAsync<readonly ReviewThreadDetail[], IngestError>;
  /**
   * Reply into one review thread and/or resolve it, in one no-retry operation. The reply executes first, so
   * a partial failure leaves the thread open WITH the answer rather than resolved in silence.
   */
  readonly answerReviewThread: (input: {
    threadId: string;
    body: string | undefined;
    resolve: boolean;
  }) => ResultAsync<ReviewThreadAnswer, IngestError>;
  /** Reopen one resolved review thread, confirming GitHub reports it open again. No retry. */
  readonly reopenReviewThread: (input: { threadId: string }) => ResultAsync<void, IngestError>;
  /**
   * Post a new top-level comment on an issue or pull request — the plain activity-feed message, distinct
   * from a review-thread reply. The caller confirms it with a separate `getIssueComment` read-back.
   */
  readonly createIssueComment: (input: PrRef & { body: string }) => ResultAsync<WrittenComment, IngestError>;
  /** Edit a comment already posted, by its id; the caller confirms it with a separate `getIssueComment` read-back. */
  readonly updateIssueComment: (
    input: RepoRef & { commentId: number; body: string },
  ) => ResultAsync<WrittenComment, IngestError>;
  /** Read one top-level comment back by id — the create/edit confirmation. */
  readonly getIssueComment: (input: RepoRef & { commentId: number }) => ResultAsync<WrittenComment, IngestError>;
  /**
   * Every top-level comment posted on or after `sinceIso`, by any author — `github close`'s "did someone
   * already comment" preflight, and the only reader of this shape.
   */
  readonly listIssueComments: (
    input: PrRef & { sinceIso: string },
  ) => ResultAsync<readonly IssueCommentSummary[], IngestError>;
  /**
   * Every changed file's unified diff patch at the pull request's CURRENT head — the live-diff preflight a
   * self-review round validates its comment anchors against before any composite submit-and-resolve mutation.
   */
  readonly diffFiles: (input: PrRef) => ResultAsync<readonly PullRequestDiffFile[], IngestError>;
  /** Whether the viewer can push to the repository — the write preflight. */
  readonly canPush: (input: RepoRef) => ResultAsync<boolean, IngestError>;
  /**
   * Whether the viewer holds ADMIN permission on the repository — half of the admin-merge preflight.
   *
   * `push` is not enough and is not a weaker version of the same thing: bypassing branch protection is an
   * admin-only capability, so a caller holding only `push` is refused rather than allowed to try.
   */
  readonly canAdmin: (input: RepoRef) => ResultAsync<boolean, IngestError>;
  /** One branch's classic protection state — the other half of the admin-merge preflight. */
  readonly branchProtection: (
    input: RepoRef & { branch: string },
  ) => ResultAsync<BranchProtection, GithubProtectionReadError>;
  /** One branch's required status-check contexts — the pre-write state, and the read-back after `setRequiredStatusChecks`. */
  readonly requiredStatusChecks: (
    input: RepoRef & { branch: string },
  ) => ResultAsync<RequiredStatusChecks, GithubProtectionReadError>;
  /**
   * Replace one branch's required status-check contexts.
   *
   * The whole array is sent, because GitHub's endpoint replaces rather than merges — the caller is what
   * decides the final list, and it confirms with its own `requiredStatusChecks` read-back.
   */
  readonly setRequiredStatusChecks: (
    input: RepoRef & { branch: string; contexts: readonly string[]; strict: boolean },
  ) => ResultAsync<RequiredStatusChecks, IngestError>;
  /**
   * Every check-run name observed on a MERGE-GROUP ref over the last `entries` queue entries — the
   * measurement that decides whether requiring a context would stall the queue rather than gate it.
   */
  readonly mergeGroupContexts: (
    input: RepoRef & { entries: number },
  ) => ResultAsync<MergeGroupObservation, IngestError>;
  /**
   * Squash-merge one pull request.
   *
   * `sha` is GitHub's own optimistic-concurrency guard: the server refuses the merge when the head has moved
   * since it was read, so a force-push landing mid-flight can never be merged unseen. The commit BODY is
   * deliberately not a parameter — see `./writeMerge.ts`.
   */
  readonly mergePr: (input: PrRef & { sha: string; commitTitle: string }) => ResultAsync<MergedPr, IngestError>;
  /**
   * Add one pull request to its base branch's merge queue — GitHub's own "Merge when ready".
   *
   * `expectedHeadOid` is the same optimistic-concurrency guard `mergePr`'s `sha` is: GitHub refuses the
   * enqueue when the head has moved since it was read. The caller confirms with its own `mergeQueueEntry`
   * read rather than trusting the mutation's own payload.
   */
  readonly enqueuePr: (input: { nodeId: string; expectedHeadOid: string }) => ResultAsync<void, IngestError>;
  /**
   * Queue one NATIVE-STACK pull request through GitHub's asynchronous merge request.
   *
   * A separate operation rather than a mode of `enqueuePr` because GitHub itself separates them: the
   * GraphQL mutation REFUSES a stack member, and this REST route is the only one that accepts it. Its
   * answer says what GitHub INTENDS — the caller still confirms with its own `mergeQueueEntry` read.
   */
  readonly enqueueStackPr: (
    input: PrRef & { expectedHeadOid: string },
  ) => ResultAsync<GithubAsyncMergeState, IngestError>;
  /** Remove one pull request from its merge queue; confirmed the same way `enqueuePr` is. */
  readonly dequeuePr: (input: { nodeId: string }) => ResultAsync<void, IngestError>;
  readonly listRuns: (input: RepoRef & { branch: string }) => ResultAsync<readonly WorkflowRun[], IngestError>;
  /**
   * Who this token is. The authorisation check's other half — without it there is nothing to compare against.
   */
  readonly authenticatedUserId: () => ResultAsync<number, IngestError>;
  /**
   * Pull requests on a base and head pair, in ANY state.
   *
   * Any state rather than open-only, deliberately: the caller has to be able to see that a branch address is
   * ambiguous, and a merged pull request sharing the pair is exactly what makes it ambiguous.
   */
  readonly listPrs: (input: RepoRef & { base: string; head: string }) => ResultAsync<readonly WrittenPr[], IngestError>;
  /**
   * Close a pull request without merging — `github close`'s mutation, and the recorded integration test's
   * only cleanup, since GitHub cannot delete one.
   */
  readonly closePr: (input: PrRef) => ResultAsync<WrittenPr, IngestError>;
  /**
   * The open pull request whose head is this branch, if exactly one exists — `undefined` otherwise.
   *
   * Resolves "which PR is this branch" directly via GitHub's own `head` filter, rather than paging every
   * open pull request the operator authored — the narrower, single-call way to turn a stack-parent BRANCH
   * name into the PR NUMBER `stack push`'s registration step needs.
   */
  readonly findOpenPrByHead: (input: RepoRef & { head: string }) => ResultAsync<WrittenPr | undefined, IngestError>;
  /** Create a native GitHub stack from an ordered, bottom-to-top list of pull-request numbers. */
  readonly createStack: (
    input: RepoRef & { readonly pullRequests: readonly [number, number, ...number[]] },
  ) => ResultAsync<GithubStack, IngestError>;
  /** Extend an existing native stack by appending pull requests to its top. */
  readonly addToStack: (
    input: RepoRef & { readonly stackNumber: number; readonly pullRequests: readonly [number, ...number[]] },
  ) => ResultAsync<GithubStack, IngestError>;
  /** Read one native stack's full ordered entries — `sync`'s discovery step. */
  readonly getStack: (input: RepoRef & { readonly stackNumber: number }) => ResultAsync<GithubStack, IngestError>;
  /**
   * Remove every unmerged entry from a native stack — the only native removal GitHub's REST API exposes,
   * used by `stack remove` and `stack dissolve`. A locked or already-merged entry survives; `undefined`
   * means the stack is now fully dissolved.
   */
  readonly unstack: (
    input: RepoRef & { readonly stackNumber: number },
  ) => ResultAsync<GithubStack | undefined, IngestError>;
  /**
   * Every OPEN pull request this token's own account authored, in this repository.
   *
   * `sync` needs this to find every stack it might have to walk, since a stack number is not known in
   * advance. Paginated client-side because GitHub's `pulls.list` has no author-id filter; capped at 500 as
   * a sane ceiling rather than an unbounded fetch, with truncation reported in `truncated` rather than
   * silently dropped — a caller claiming completeness (`github stack restack`) must refuse a truncated one.
   */
  readonly listOpenPrsAuthoredByMe: (
    input: RepoRef,
  ) => ResultAsync<{ readonly prs: readonly WrittenPr[]; readonly truncated: boolean }, IngestError>;
  /**
   * Every OPEN pull request in this repository, whoever authored it, plus the viewer's own immutable id.
   *
   * `stack audit` needs the repo-wide set rather than the operator's own, because the chained-not-stacked
   * class is a RELATION between two pull requests and either half of a pair may belong to somebody else.
   * The viewer id rides along so the caller can say which violations are its own to fix without a second
   * round trip, and `undefined` stays a real state exactly as it is on {@link WrittenPr.authorId}.
   */
  readonly listOpenPrs: (
    input: RepoRef,
  ) => ResultAsync<
    { readonly prs: readonly WrittenPr[]; readonly viewerId: number | undefined; readonly truncated: boolean },
    IngestError
  >;
}

/**
 * Build the write API.
 *
 * `baseUrl` exists for one purpose and is documented rather than left to be guessed: the transport test in
 * `src/__tests__/integration/githubWriteTransport.test.ts` points this at a local server so it can assert
 * what the request ACTUALLY carried and count how many times an irreversible POST was sent. A cassette can
 * do neither — it matches with `body: false` and replays one exchange. Production never passes it.
 *
 * The options are `makeGithubWriteCtx`'s own: the token, the API origin override, and the outbound privacy check's
 * policy for the verb's home, judged on every write before it is sent.
 *
 * @returns the injectable write surface
 */
// max-lines-exempt: a flat one-line-per-method wiring table; each method already lives in its own function
export function makeGithubWriteApi(options: Parameters<typeof makeGithubWriteCtx>[0]): GithubWriteApi {
  const ctx = makeGithubWriteCtx(options);
  // Each wrapper DESTRUCTURES rather than forwarding a positional `input`, matching corpus/linear/write.ts.
  // A caller already passes a named object; the shim should not be the one place that stops saying so.
  return {
    addToStack: ({ owner, repo, stackNumber, pullRequests }) =>
      addToStackVia({ ctx, input: { owner, pullRequests, repo, stackNumber } }),
    addIssueLabels: ({ owner, repo, number, labels }) =>
      addIssueLabelsVia({ ctx, input: { labels, number, owner, repo } }),
    answerReviewThread: ({ threadId, body, resolve }) =>
      answerReviewThreadVia({ ctx, input: { body, resolve, threadId } }),
    authenticatedUserId: () => authenticatedUserIdVia({ ctx }),
    branchProtection: ({ owner, repo, branch }) => branchProtectionVia({ ctx, input: { branch, owner, repo } }),
    canAdmin: ({ owner, repo }) => canAdminVia({ ctx, input: { owner, repo } }),
    canPush: ({ owner, repo }) => canPushVia({ ctx, input: { owner, repo } }),
    closePr: ({ owner, repo, number }) => closeVia({ ctx, input: { number, owner, repo } }),
    codeScanningAlert: ({ owner, repo, alertNumber }) =>
      codeScanningAlertVia({ ctx, input: { alertNumber, owner, repo } }),
    codeScanningAlerts: ({ owner, repo, ref, state }) =>
      codeScanningAlertsVia({ ctx, input: { owner, ref, repo, state } }),
    createIssueComment: ({ owner, repo, number, body }) =>
      createIssueCommentVia({ ctx, input: { body, number, owner, repo } }),
    createPr: ({ owner, repo, base, head, title, body, draft }) =>
      createVia({ ctx, input: { base, body, draft, head, owner, repo, title } }),
    createStack: ({ owner, repo, pullRequests }) => createStackVia({ ctx, input: { owner, pullRequests, repo } }),
    dequeuePr: ({ nodeId }) => dequeuePrVia({ ctx, input: { nodeId } }),
    dependabotAlert: ({ owner, repo, alertNumber }) => dependabotAlertVia({ ctx, input: { alertNumber, owner, repo } }),
    dependabotAlerts: ({ owner, repo, state, severity }) =>
      dependabotAlertsVia({ ctx, input: { owner, repo, severity, state } }),
    diffFiles: ({ owner, repo, number }) => diffFilesVia({ ctx, input: { number, owner, repo } }),
    dismissCodeScanningAlert: ({ owner, repo, alertNumber, reason, comment }) =>
      dismissCodeScanningAlertVia({ ctx, input: { alertNumber, comment, owner, reason, repo } }),
    enqueuePr: ({ nodeId, expectedHeadOid }) => enqueuePrVia({ ctx, input: { expectedHeadOid, nodeId } }),
    enqueueStackPr: ({ owner, repo, number, expectedHeadOid }) =>
      enqueueStackPrVia({ ctx, input: { expectedHeadOid, number, owner, repo } }),
    findOpenPrByHead: ({ owner, repo, head }) => findOpenPrByHeadVia({ ctx, input: { head, owner, repo } }),
    getIssueComment: ({ owner, repo, commentId }) => getIssueCommentVia({ ctx, input: { commentId, owner, repo } }),
    getPr: ({ owner, repo, number }) => getVia({ ctx, input: { number, owner, repo } }),
    getRepoDescription: ({ owner, repo }) => getRepoDescriptionVia({ ctx, input: { owner, repo } }),
    getStack: ({ owner, repo, stackNumber }) => getStackVia({ ctx, input: { owner, repo, stackNumber } }),
    issueLabels: ({ owner, repo, number }) => issueLabelsVia({ ctx, input: { number, owner, repo } }),
    listIssueComments: ({ owner, repo, number, sinceIso }) =>
      listIssueCommentsVia({ ctx, input: { number, owner, repo, sinceIso } }),
    listOpenPrs: ({ owner, repo }) => listOpenPrsVia({ ctx, input: { owner, repo } }),
    listOpenPrsAuthoredByMe: ({ owner, repo }) => listOpenPrsAuthoredByMeVia({ ctx, input: { owner, repo } }),
    listPrs: ({ owner, repo, base, head }) => listPrsVia({ ctx, input: { base, head, owner, repo } }),
    listRuns: ({ owner, repo, branch }) => listRunsVia({ ctx, input: { branch, owner, repo } }),
    markPrDraft: ({ nodeId }) => markDraftVia({ ctx, input: { nodeId } }),
    markPrReady: ({ nodeId }) => markReadyVia({ ctx, input: { nodeId } }),
    mergeGroupContexts: ({ owner, repo, entries }) => mergeGroupContextsVia({ ctx, input: { entries, owner, repo } }),
    mergePr: ({ owner, repo, number, sha, commitTitle }) =>
      mergeVia({ ctx, input: { commitTitle, number, owner, repo, sha } }),
    reopenReviewThread: ({ threadId }) => reopenReviewThreadVia({ ctx, input: { threadId } }),
    repoLabels: ({ owner, repo }) => repoLabelsVia({ ctx, input: { owner, repo } }),
    requiredStatusChecks: ({ owner, repo, branch }) => requiredStatusChecksVia({ ctx, input: { branch, owner, repo } }),
    requestedReviewers: ({ owner, repo, number }) => requestedReviewersVia({ ctx, input: { number, owner, repo } }),
    requestReviewers: ({ owner, repo, number, reviewers, teamReviewers }) =>
      requestReviewersVia({ ctx, input: { number, owner, repo, reviewers, teamReviewers } }),
    reviewThreadDetails: ({ pullRequestId }) => reviewThreadDetailsVia({ ctx, input: { pullRequestId } }),
    reviewThreads: ({ pullRequestId }) => reviewThreadsVia({ ctx, input: { pullRequestId } }),
    setRequiredStatusChecks: ({ owner, repo, branch, contexts, strict }) =>
      setRequiredStatusChecksVia({ ctx, input: { branch, contexts, owner, repo, strict } }),
    setRepoDescription: ({ owner, repo, description }) =>
      setRepoDescriptionVia({ ctx, input: { description, owner, repo } }),
    submitReviewRound: ({ pullRequestId, commitOid, comments, resolveThreadIds }) =>
      submitReviewRoundVia({ ctx, input: { comments, commitOid, pullRequestId, resolveThreadIds } }),
    updateIssueComment: ({ owner, repo, commentId, body }) =>
      updateIssueCommentVia({ ctx, input: { body, commentId, owner, repo } }),
    updatePr: ({ owner, repo, number, title, body, base }) =>
      updateVia({ ctx, input: { base, body, number, owner, repo, title } }),
    unstack: ({ owner, repo, stackNumber }) => unstackVia({ ctx, input: { owner, repo, stackNumber } }),
  };
}
