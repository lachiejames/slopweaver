/**
 * The fleet read behind `slopweaver github review-state` — every open pull request a search query selects,
 * with the checks rollup, the reviews, the review threads and the changed paths each of the seven questions
 * needs, in one paged GraphQL call per page rather than one call per pull request.
 *
 * ## Why it goes through SEARCH rather than `repository.pullRequests`
 *
 * `repository.pullRequests` has no author filter, so answering "the owner's open pull requests" through it means
 * paging every open pull request in the repository and discarding most of them — 358 of them in the work
 * repository, against 42 of the owner's. GitHub's own search accepts `author:`, `draft:` and repeated
 * `repo:` qualifiers, returns `PullRequest` nodes carrying the identical fields, and spans BOTH repositories
 * in one query. The cost is search's own ceiling (1,000 results, 100 per page), which is stated as residue
 * rather than hidden — a fleet that hits it is reported, never silently truncated.
 *
 * ## Why the page is small, and why that is a measurement rather than a preference
 *
 * The v1 console asked `gh pr list` for `statusCheckRollup` across a whole repository and got a reproducible
 * HTTP 504 (measured, 266 open pull requests, 11.2s to the failure), while the same list without
 * the rollup answered in 2.1s. The rollup is the expensive field and it is one this read cannot do without,
 * so the lever left is the page: {@link DEFAULT_PAGE_SIZE} keeps one request's nested node count in the low
 * thousands, and the pager makes as many of them as the query needs.
 */

import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { GithubReviewRequest } from "../../review/githubCodeowners.js";
import { type GithubMergeStatus, githubMergeStatus } from "../../review/githubMergeStatus.js";
import type { ReviewRequestTimes } from "../../review/humanWait.js";
import { asGithubMergeable, type GithubMergeable } from "../../review/reviewState.js";
import { type BaseDistance, DISTANCE_NOT_REQUESTED } from "./baseDistance.js";
import type { GithubChecksSnapshot } from "./checks.js";
import { type GithubLiveError, GithubLiveErrors } from "./errors.js";
import type { ChecksRead } from "./headChecksRead.js";
import { type MergeQueueEntryState, parseMergeQueueEntry } from "./mergeQueue.js";
import type { GithubReadGraphql } from "./read.js";
import { parseReviewRequestTimes } from "./reviewRequestEvents.js";
import { parseReviewRequests, reviewRequestsTruncated } from "./reviewRequests.js";
import { checksOf } from "./reviewStateChecks.js";
import {
  connectionIntact,
  hasNextPage,
  isBotActor,
  login,
  nodesOf,
  str,
  totalCountOf,
} from "./reviewStateConnection.js";
import { missingSearchClause } from "./reviewStateMissingSearch.js";
import { PAGE_LIMITS } from "./reviewStatePages.js";
import { CODEOWNERS_ALIASES, CODEOWNERS_QUERY, FLEET_QUERY, PR_BY_NUMBER_QUERY } from "./reviewStateQueries.js";
import { threadsOf } from "./reviewStateThreads.js";
import { completedPr } from "./wholeChecks.js";

/**
 * How many pull requests one search page asks for. See this module's own note on the 504.
 *
 * @internal
 */
export const DEFAULT_PAGE_SIZE = 20;

/**
 * How many check contexts one head is read for — GraphQL's own per-connection ceiling, and the page EVERY
 * caller of this api asks for.
 *
 * It was 60, and that single number was what parked a mergeable pull request. `ciTest`
 * (`../../review/landingTests.ts`) answers `unknown` when a context the base REQUIRES was not on the page
 * this read saw, which can never produce a press — correctly, since a capped rollup can only LOSE a failing
 * context. But the page was smaller than the heads it read, so the honest `unknown` became the steady state.
 *
 * MEASURED over the owner's 27 open `acme/acme-admin` pull requests: **15 came back
 * `checksTruncated`, 14 of those read `ci-green: unknown` while `ci` itself read `green`, and NOT ONE row in
 * the whole fleet read `press`.** one pull request's own verdict sentence was _"1 context(s) staging REQUIRES were not
 * on the truncated page this read saw: Required CI — re-read the checks with a larger limit"_, advice
 * addressed to nobody: the only caller that could take it is the one that set the limit. Five of those heads
 * measured 93, 94, 93, 94 and 93 contexts, every one `truncated: false` at 100:
 *
 * ```bash
 * slopweaver github landing --repo acme/acme-admin --author <login> --json | jq '[.rows[]|select(.checksTruncated)]|length'
 * slopweaver github checks --repo acme/acme-admin --number 17480 --limit 100 --json | jq '.checks|length'
 * ```
 *
 * **It lives HERE rather than beside one of its callers, because a check page per caller is the defect one
 * level up.** The fix for the park above was landed on the landing read alone, and a review pass then found
 * the same 60 still standing on `github review-state`'s own flag default and on the session-start GitHub
 * leg — two surfaces reading the same repository and disagreeing with the landing read about the same pull
 * request's checks, each one a lower bound nothing announced. All three now ask for this constant; a fourth
 * caller gets it by importing rather than by choosing.
 *
 * 100 is the ceiling rather than a chosen headroom, so there is no larger PAGE to ask for — and
 * acme-admin heads exceeded it. A head that comes back {@link PrLiveState.checksTruncated} is therefore re-read
 * WHOLE, paged to `DECISION_CHECK_LIMIT` (`./checksRead.ts`), by `review-state`/`landing`
 * (`../../cli/commands/github/reviewStateChecksCompletion.ts`) and by the one-pull-request reads the press
 * and the merge guard judge (`./wholeChecks.ts`); only a head still truncated past that keeps the `unknown`
 * arm. The cost is nodes on a query whose measured `rateLimit.cost` is 1 of an hourly 5,000
 * (`skills/github/reference/dispatch.md`).
 */
export const CHECK_PAGE = 100;

/** One review already submitted on a pull request, reduced to what a verdict needs. */
export interface PrReview {
  readonly login: string;
  /** GitHub's own state: `APPROVED`, `CHANGES_REQUESTED`, `COMMENTED`, `DISMISSED`, `PENDING`. */
  readonly state: string;
  readonly submittedAtIso: string;
  /** The commit the review was submitted against — how a review of an older push is told from a current one. */
  readonly commitOid: string;
  /**
   * The `owner/team` slugs GitHub recorded this review as submitted ON BEHALF OF.
   *
   * This is how a SATISFIED code-owner team stays visible: GitHub retires the `asCodeOwner` review request
   * the moment the requirement clears, and records the team here instead — see
   * `../../review/githubCodeowners.ts` for the half of that which is not recoverable.
   */
  readonly onBehalfOf: readonly string[];
  /**
   * Present when GitHub typed the author a `Bot`. GraphQL spells a bot's login without the REST `[bot]` suffix
   * (`copilot-pull-request-reviewer`, `renovate`), so the login alone cannot say; absent, the author was a user.
   */
  readonly byBot?: true;
}

/**
 * One review thread — who opened it, what it says, and who has spoken most recently.
 *
 * The bodies are read only when the caller asks for them ({@link GithubReviewStateApi.fleetPage}'s
 * `withBodies`), because they are the expensive half by an order of magnitude: a CodeRabbit thread's opening
 * comment runs to several kilobytes of collapsed script output, and a hundred of those across twenty pull
 * requests is a payload the fleet read does not survive. The table never prints a body; the detail view
 * always does, so the field follows the caller rather than the query.
 */
export interface PrReviewThread {
  /**
   * The thread's own GraphQL node id — what `slopweaver github thread resolve --thread <id>` addresses.
   *
   * Read so the fleet can CLEAR its own walkthrough threads rather than only count them
   * (`../../review/prStateDetail.ts`'s `oursResolvable`). Nothing else in the read needs it, and a thread
   * GitHub returned without one is reported as the empty string rather than substituted for.
   */
  readonly id: string;
  readonly openedByLogin: string;
  /** Present when GitHub typed the thread's opener a `Bot` — see {@link PrReview.byBot}. */
  readonly openedByBot?: true;
  readonly isResolved: boolean;
  /** Who resolved the thread; absent while it is open, or when GitHub names nobody. */
  readonly resolvedByLogin?: string;
  readonly isOutdated: boolean;
  readonly path: string;
  /** The line the thread is anchored to, or zero when GitHub reports none (an outdated or file-level thread). */
  readonly line: number;
  readonly openedAtIso: string;
  /** The opening comment's body, or the empty string when this read did not ask for bodies. */
  readonly openerBody: string;
  /** Who wrote the thread's most recent comment — the author of a reply, or the opener on a thread with none. */
  readonly lastCommentLogin: string;
  readonly lastCommentAtIso: string;
  /** The most recent comment's body, or the empty string when this read did not ask for bodies. */
  readonly lastCommentBody: string;
  /** Every comment on the thread, as GitHub counts them, whatever this read's tail page carried. */
  readonly commentCount: number;
}

/** One open pull request, with everything the seven questions are answered from. */
export interface PrLiveState {
  readonly repoSlug: string;
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly authorLogin: string;
  /** Present when GitHub typed the author a `Bot` — see {@link PrReview.byBot} for why the login cannot say. */
  readonly authorIsBot?: true;
  readonly isDraft: boolean;
  readonly createdAtIso: string;
  readonly updatedAtIso: string;
  /** GitHub's own aggregate review decision, or the empty string when it reports none. */
  readonly reviewDecision: string;
  /**
   * GitHub's own mergeability, narrowed to the three values it documents.
   *
   * `UNKNOWN` is what it answers while it is still computing, and the query itself is what starts the job —
   * so a FIRST read is the one most likely to get it, measured at 15 of 20 over a genuinely cold fleet
   * rather than at all of them. `./mergeableRecheck.ts` is what settles it.
   */
  readonly mergeable: GithubMergeable;
  /**
   * GitHub's own answer to whether it would let this merge NOW — a different question from `mergeable`, and
   * the one a pending code-owner request cannot answer.
   *
   * Classified by `../../review/githubMergeStatus.ts` at the parse rather than carried as a bare token, so
   * an absent field is `unread` rather than indistinguishable from GitHub's own `UNKNOWN`.
   */
  readonly githubMergeStatus: GithubMergeStatus;
  readonly baseRefName: string;
  /**
   * The branch the pull request is FROM, so a fleet read can tell which of its siblings target it.
   *
   * A pull request whose `baseRefName` is another open pull request's `headRefName` is stacked on that one,
   * and `../../review/stack.ts` reads the chain off exactly these two fields — nothing here asks GitHub's
   * stack endpoints, because the fleet already carries every link.
   */
  readonly headRefName: string;
  /**
   * The repository the head branch LIVES in, which is not always the base repository.
   *
   * A fork's head branch exists in the fork, so a comparison naming the bare branch resolves it in the BASE
   * repository — against an unrelated same-named branch, or against nothing. `./baseDistance.ts` qualifies
   * the ref as `owner:branch` with this, which GitHub accepts for a same-repository head too. Found by a
   * Codex review; the empty string when GitHub reported none, which leaves the ref unqualified.
   */
  readonly headRepoSlug: string;
  /**
   * The repository's default branch, read beside the pull request rather than remembered per repository.
   *
   * The owner's ruling on a stacked pull request (a stacked pull request is not asked about until it is
   * targeting staging) is a test against THIS branch, so it is a field rather than a constant.
   */
  readonly defaultBranch: string;
  readonly headOid: string;
  readonly checks: GithubChecksSnapshot;
  /**
   * Whether the head's checks were READ, as distinct from there being none — see {@link ChecksRead}.
   */
  readonly checksRead: ChecksRead;
  /**
   * How far the head is from its base, filled in by the run layer only when a caller asks for it.
   *
   * `./baseDistance.ts` cannot ride inside this node's own selection — `compare` takes an argument and a
   * GraphQL argument cannot reference the sibling `headRefName` field — so the node parser sets the
   * not-requested `unread` and the run layer replaces it for the callers that want it.
   */
  readonly baseDistance: BaseDistance;
  /**
   * Whether the head's check rollup carried more contexts than `checkLimit` asked for.
   *
   * `GithubChecksSnapshot.residue` has recorded this all along and nothing consumed it, so a consumer's
   * failing-check list was silently a lower bound. MEASURED at the shipped `checkLimit: 60`:
   * **5 of the owner's 24 open pull requests** carried more contexts than the page did. A truncated rollup
   * can only ever LOSE a failing check, so it produces a false GREEN — the same shape as
   * {@link PrLiveState.threadsTruncated}. Reproduce by counting the rows whose `checksTruncated` is true in
   * `slopweaver github landing --json`.
   */
  readonly checksTruncated: boolean;
  readonly reviews: readonly PrReview[];
  readonly threads: readonly PrReviewThread[];
  readonly changedPaths: readonly string[];
  /** Whether the pull request changes more files than the requested cap could carry. */
  readonly changedPathsTruncated: boolean;
  /**
   * Logins and team slugs GitHub itself currently has a review request out to — read ONLY for the derived
   * CODEOWNERS answer (`../../review/codeownerRules.ts`), never as an ask.
   */
  readonly requestedReviewers: readonly string[];
  /**
   * Every open review request with GitHub's own `asCodeOwner` flag — the AUTHORITATIVE code-owner answer,
   * never a reading of the CODEOWNERS file. `../../review/githubCodeowners.ts` turns these into the
   * owners, and says what they cannot cover.
   */
  readonly codeownerRequests: readonly GithubReviewRequest[];
  /** Whether GitHub reported more review requests than the query's fixed page carried. */
  readonly codeownerRequestsTruncated: boolean;
  /** When each reviewer was last requested, off the timeline. Absent on a read that did not select it. */
  readonly reviewRequestTimes?: ReviewRequestTimes;
  /**
   * Whether GitHub reported more reviews than this read carried.
   *
   * Measured from `totalCount` against the page rather than from `pageInfo`: the `reviews` connection is
   * queried with `last`, so its `hasNextPage` is about the newer end it already has and answers `false` on
   * exactly the truncated read this field exists to catch.
   */
  readonly reviewsTruncated: boolean;
  /**
   * Whether the pull request has more review threads than the query asked for.
   *
   * MEASURED and it is why this is a field rather than an assumption: one of the owner's own pull
   * requests carries 59 review threads and 91 reviews. A capped read of its threads can only ever LOSE an
   * unresolved one, so truncation produces a false GREEN and never a false CHANGES — which is exactly the
   * confident-but-wrong answer the verb exists to prevent, and why the verdict downgrades to `unknown`
   * instead of reporting the visible page as the whole picture.
   */
  readonly threadsTruncated: boolean;
  /** How many review threads GitHub says the pull request has, whatever the page carried. */
  readonly threadCount: number;
  /**
   * The pull request's own merge-queue entry, or `undefined` when GitHub reports none.
   *
   * Selected here rather than fetched per pull request because it is one field on a node the fleet already
   * reads: a boot-time landing read over 29 pull requests would otherwise cost 29 extra round trips to
   * answer "is this one already queued". It is also the eviction signal — a pull request queued earlier
   * that now reports `undefined` was evicted, and nothing else in this read says so.
   */
  readonly queueEntry: MergeQueueEntryState | undefined;
  /**
   * Every label on the pull request, in the order GitHub returned them.
   *
   * Read because a label is the only opt-out a human can attach to a pull request from GitHub's own
   * interface, and `../../review/landing.ts` honours one so a deliberately-open discussion piece is never
   * selected for a press. Sometimes a green pull request is open to start an
   * argument, not to land.
   */
  readonly labels: readonly string[];
  /**
   * Whether GitHub has more labels on the pull request than this read carried.
   *
   * The cap is generous and the busiest measured pull request carried four, but a MEASUREMENT is not a
   * structure: the opt-out label `../../review/landing.ts` honours has to be VISIBLE for a row to be held
   * back, so a truncated label page is a false green on the one control a human attaches by hand. A Codex
   * review pointed out the page had no `pageInfo` at all, which made the gap unknowable rather than merely
   * rare. Reproduce by reading `labels.pageInfo.hasNextPage` over the fleet query.
   */
  readonly labelsTruncated: boolean;
}

/** One page of the fleet read. */
export interface PrLivePage {
  readonly pullRequests: readonly PrLiveState[];
  readonly totalCount: number;
  readonly nextCursor: string | undefined;
}

/** The repository's default branch off a pull-request node, or the empty string when the read has none. */
function defaultBranchOf({ node }: { node: Record<string, unknown> }): string {
  const repository = node["repository"];
  const ref = isRecord(repository) ? repository["defaultBranchRef"] : undefined;
  return isRecord(ref) ? str({ value: ref["name"] }) : "";
}

/** The pull request's own merge-queue entry off a fleet node, through the queue read's own parser. */
function queueEntryOf({ node }: { node: Record<string, unknown> }): MergeQueueEntryState | undefined {
  return parseMergeQueueEntry({ pullRequest: node });
}

/** Every label name on a pull-request node, in GitHub's own order, with unnamed entries dropped. */
function labelsOf({ node }: { node: Record<string, unknown> }): readonly string[] {
  return nodesOf({ connection: node["labels"] })
    .map((label) => str({ value: label["name"] }))
    .filter((name) => name !== "");
}

/** The reviews on a pull-request node, oldest first as GraphQL returns them. */
function reviewsOf({ node }: { node: Record<string, unknown> }): readonly PrReview[] {
  return nodesOf({ connection: node["reviews"] }).map((review) => ({
    ...(isBotActor({ value: review["author"] }) ? { byBot: true as const } : {}),
    commitOid: isRecord(review["commit"]) ? str({ value: review["commit"]["oid"] }) : "",
    login: login({ value: review["author"] }),
    onBehalfOf: nodesOf({ connection: review["onBehalfOf"] })
      .map((team) => str({ value: team["combinedSlug"] }))
      .filter((slug) => slug !== ""),
    state: str({ value: review["state"] }),
    submittedAtIso: str({ value: review["submittedAt"] }),
  }));
}

/** A `requestedReviewer` union's login or team slug, or the empty string when it names neither. */
function reviewerName({ reviewer }: { reviewer: unknown }): string {
  if (!isRecord(reviewer)) {
    return "";
  }
  return str({ value: reviewer["login"] }) === ""
    ? str({ value: reviewer["slug"] })
    : str({ value: reviewer["login"] });
}

/** The logins and team slugs GitHub currently has an open review request out to. */
function requestedOf({ node }: { node: Record<string, unknown> }): readonly string[] {
  return nodesOf({ connection: node["reviewRequests"] })
    .map((request) => reviewerName({ reviewer: request["requestedReviewer"] }))
    .filter((name) => name !== "");
}

/**
 * Every review request on a pull-request node, carrying GitHub's own `asCodeOwner` flag.
 *
 * A team is named by its `combinedSlug` (`owner/team`) rather than its bare `slug`, because that is the
 * token CODEOWNERS itself spells and the one a reader can paste back into GitHub. `requestedOf` above
 * deliberately keeps the bare slug for the derived CODEOWNERS answer, so the two are separate reads of one
 * connection rather than one read both consume.
 */
function codeownerRequestsOf({ node }: { node: Record<string, unknown> }): readonly GithubReviewRequest[] {
  return parseReviewRequests({ node });
}

/**
 * Shape one raw search result node into a typed pull-request state.
 *
 * @param node the raw `PullRequest` node from the fleet query
 * @returns the typed state, or `undefined` when the node is not a pull request at all
 */
export function parsePrNode({ node }: { node: Record<string, unknown> }): PrLiveState | undefined {
  const number = node["number"];
  if (typeof number !== "number") {
    return undefined;
  }
  const { snapshot: checks, read: checksRead } = checksOf({ node });
  const reviews = reviewsOf({ node });
  return {
    authorLogin: login({ value: node["author"] }),
    ...(isBotActor({ value: node["author"] }) ? { authorIsBot: true as const } : {}),
    baseRefName: str({ value: node["baseRefName"] }),
    changedPaths: nodesOf({ connection: node["files"] }).map((file) => str({ value: file["path"] })),
    changedPathsTruncated: hasNextPage({ connection: node["files"] }),
    baseDistance: DISTANCE_NOT_REQUESTED,
    checks,
    checksRead,
    checksTruncated: checks.residue.length > 0,
    codeownerRequests: codeownerRequestsOf({ node }),
    // Asked of `./reviewRequests.ts` rather than derived here: a page boundary is only HALF of what makes this
    // read incomplete, and the door already asks that helper. Two derivations is how the read passed a pull
    // request the door refused.
    codeownerRequestsTruncated: reviewRequestsTruncated({ node }),
    createdAtIso: str({ value: node["createdAt"] }),
    defaultBranch: defaultBranchOf({ node }),
    headOid: checks.headSha,
    headRefName: str({ value: node["headRefName"] }),
    headRepoSlug: isRecord(node["headRepository"]) ? str({ value: node["headRepository"]["nameWithOwner"] }) : "",
    isDraft: node["isDraft"] === true,
    mergeable: asGithubMergeable({ token: str({ value: node["mergeable"] }) }),
    githubMergeStatus: githubMergeStatus({ value: node["mergeStateStatus"] }),
    number,
    repoSlug: isRecord(node["repository"]) ? str({ value: node["repository"]["nameWithOwner"] }) : "",
    requestedReviewers: requestedOf({ node }),
    reviewRequestTimes: parseReviewRequestTimes({ node }),
    reviewDecision: str({ value: node["reviewDecision"] }),
    reviews,
    reviewsTruncated: !connectionIntact({ connection: node["reviews"] }),
    labels: labelsOf({ node }),
    labelsTruncated: hasNextPage({ connection: node["labels"] }),
    queueEntry: queueEntryOf({ node }),
    threadCount: totalCountOf({ connection: node["reviewThreads"] }),
    threads: threadsOf({ node }),
    threadsTruncated:
      hasNextPage({ connection: node["reviewThreads"] }) || !connectionIntact({ connection: node["reviewThreads"] }),
    title: str({ value: node["title"] }),
    updatedAtIso: str({ value: node["updatedAt"] }),
    url: str({ value: node["url"] }),
  };
}

/**
 * Parse one raw fleet-query response into a page of typed pull-request states.
 *
 * @param data the raw GraphQL response
 * @returns the page, or a read failure naming what stood where the `search` connection should have been
 */
export function parseFleetPage({ data }: { data: unknown }): Result<PrLivePage, GithubLiveError> {
  const search = isRecord(data) ? data["search"] : undefined;
  if (!isRecord(search)) {
    return err(
      GithubLiveErrors.readFailed({
        message: `GitHub returned no search connection for the fleet read — ${missingSearchClause({ data })}`,
      }),
    );
  }
  const info = isRecord(search["pageInfo"]) ? search["pageInfo"] : undefined;
  const endCursor = info?.["endCursor"];
  const issueCount = search["issueCount"];
  return ok({
    nextCursor: info?.["hasNextPage"] === true && typeof endCursor === "string" ? endCursor : undefined,
    pullRequests: nodesOf({ connection: search })
      .map((node) => parsePrNode({ node }))
      .filter((state): state is PrLiveState => state !== undefined),
    totalCount: typeof issueCount === "number" ? issueCount : 0,
  });
}

/**
 * Parse one raw CODEOWNERS response into the first location that carries a file.
 *
 * @param data the raw GraphQL response
 * @returns the file's path and text, or `undefined` when the repository declares none
 */
export function parseCodeownersBlob({
  data,
}: {
  data: unknown;
}): { readonly path: string; readonly content: string } | undefined {
  const repository = isRecord(data) ? data["repository"] : undefined;
  if (!isRecord(repository)) {
    return undefined;
  }
  for (const [alias, path] of CODEOWNERS_ALIASES) {
    const blob = repository[alias];
    const text = isRecord(blob) ? blob["text"] : undefined;
    if (typeof text === "string" && text !== "") {
      return { content: text, path };
    }
  }
  return undefined;
}

/**
 * Parse one raw single-pull-request response into the same typed state a fleet page carries.
 *
 * @internal
 * @param data the raw GraphQL response
 * @returns the state, or a named read failure when the repository or pull request is not in the response
 */
export function parsePrByNumber({ data }: { data: unknown }): Result<PrLiveState, GithubLiveError> {
  const repository = isRecord(data) ? data["repository"] : undefined;
  const pullRequest = isRecord(repository) ? repository["pullRequest"] : undefined;
  if (!isRecord(pullRequest)) {
    return err(GithubLiveErrors.readFailed({ message: "GitHub returned no pull request for that repo and number" }));
  }
  const state = parsePrNode({ node: pullRequest });
  return state === undefined
    ? err(GithubLiveErrors.readFailed({ message: "GitHub's pull-request node carried no number" }))
    : ok(state);
}

/** The injected fleet-read seam. Production wraps the same safe GraphQL transport `github read` uses. */
export interface GithubReviewStateApi {
  readonly fleetPage: (args: {
    query: string;
    cursor: string | undefined;
    pageSize: number;
    checkLimit: number;
    fileLimit: number;
    withBodies: boolean;
    /** How long this one request may take before it is aborted — the fleet read's remaining budget, capped. */
    timeoutMs: number;
  }) => Promise<Result<PrLivePage, GithubLiveError>>;
  /** The same selection as {@link GithubReviewStateApi.fleetPage}, for ONE pull request named by number. */
  readonly pr: (args: {
    owner: string;
    repo: string;
    number: number;
    checkLimit: number;
    fileLimit: number;
    withBodies: boolean;
  }) => Promise<Result<PrLiveState, GithubLiveError>>;
  readonly codeowners: (args: {
    owner: string;
    repo: string;
  }) => Promise<Result<{ readonly path: string; readonly content: string } | undefined, GithubLiveError>>;
}

/**
 * Build the live fleet-read seam over an already-safe-wrapped GraphQL transport.
 *
 * @param graphql the safe-wrapped GraphQL seam — the same one `github read` and `github checks` build
 * @returns the fleet-read and CODEOWNERS edges, injectable so a test never touches Octokit
 */
export function makeGithubReviewStateApi({ graphql }: { graphql: GithubReadGraphql }): GithubReviewStateApi {
  return {
    codeowners: async ({ owner, repo }) => {
      const response = await graphql({ query: CODEOWNERS_QUERY, variables: { owner, repo } });
      return response.isErr() ? err(response.error) : ok(parseCodeownersBlob({ data: response.value }));
    },
    // The fleet page is the one request here whose caller owns its retry strategy (halving) and a wall-clock
    // budget, so it switches off the client's own retries and carries the caller's timeout — see
    // `GithubGraphqlRequestOptions` in `./read.ts`.
    fleetPage: async ({ query, cursor, pageSize, checkLimit, fileLimit, withBodies, timeoutMs }) => {
      const response = await graphql({
        query: FLEET_QUERY,
        request: { retries: 0, timeoutMs },
        variables: { after: cursor, checkLimit, fileLimit, pageSize, q: query, ...PAGE_LIMITS, withBodies },
      });
      return response.isErr() ? err(response.error) : parseFleetPage({ data: response.value });
    },
    pr: async ({ owner, repo, number, checkLimit, fileLimit, withBodies }) => {
      const response = await graphql({
        query: PR_BY_NUMBER_QUERY,
        variables: {
          checkLimit,
          fileLimit,
          number,
          owner,
          repo,
          ...PAGE_LIMITS,
          withBodies,
        },
      });
      if (response.isErr()) {
        return err(response.error);
      }
      const parsed = parsePrByNumber({ data: response.value });
      // A head past one page is re-read whole, because the press judges this very read (`./wholeChecks.ts`).
      return parsed.isErr() ? parsed : ok(await completedPr({ graphql, owner, pr: parsed.value, repo }));
    },
  };
}
