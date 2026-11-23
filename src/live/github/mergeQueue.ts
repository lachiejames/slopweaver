/**
 * The live read behind `slopweaver github enqueue` — everything GitHub's own "Merge when ready" button
 * knows before it lights up, in two GraphQL calls: the pull request's queue-relevant state, and whether the
 * branch it targets has a merge queue at all.
 *
 * ## Why two calls rather than one
 *
 * `Repository.mergeQueue(branch:)` is addressed by BRANCH NAME, and the branch this pull request targets is
 * something only the first read can tell us. Passing `--base` instead would let a caller name a branch the
 * pull request does not actually target and get a verdict about a queue it will never enter — the same
 * measured-the-wrong-thing class `github merge`'s own base resolution exists to close. So the base comes
 * from GitHub, and the queue read is addressed with it.
 *
 * ## `reviewDecision` folds CODEOWNERS in — except where it answers null, which is measured and real
 *
 * GitHub computes `reviewDecision` from the branch's protection INCLUDING its CODEOWNERS requirement: a pull
 * request whose only missing tick is a codeowner's reads `REVIEW_REQUIRED` even when other humans approved.
 * So the approving logins read alongside it are carried as DETAIL — who has approved so far — and never as
 * a second, independently-computed codeowner verdict.
 *
 * What that reasoning missed is the NULL case. MEASURED on an `acme/acme-admin` pull request: the
 * field is null on that repository while GitHub simultaneously holds an open `asCodeOwner: true` review
 * request out to a team, so an absent decision is not "this base requires no review". That is why this read
 * now also carries {@link MergeQueuePrState.codeownerRequests} — GitHub's own flag, not a second derivation
 * — and why `../../cli/commands/github/enqueueCore.ts` falls back to it rather than reading `undefined` as
 * satisfied.
 *
 * ## The read also carries NATIVE STACK membership, because it decides the transport
 *
 * GitHub's GraphQL `enqueuePullRequest` refuses a stack member outright — *"This pull request is part of a
 * stack and must be enqueued using the asynchronous merge REST API"* — so `slopweaver github enqueue` has
 * to know which path to take BEFORE it sends anything. `stack`/`stackEntry` ride this query for that, and
 * the same fields carry the second fact the guard needs: a member above the bottom targets the branch of
 * the member below it, while the queue and its required contexts live on the STACK's base.
 */

import { optStr } from "../../corpus/slack/shape.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { GithubReviewRequest } from "../../review/githubCodeowners.js";
import { type GithubMergeStatus, githubMergeStatus } from "../../review/githubMergeStatus.js";
import { asGithubMergeable } from "../../review/reviewState.js";
import { PROTECTION_QUERY, parseProtectionContexts, type RequiredCheckContexts } from "./branchProtection.js";
import { parseRequiredCheckContexts, RULES_PAGE } from "./branchRules.js";
import { type GithubChecksSnapshot, headCommitOf, parseChecksForCommit } from "./checks.js";
import { CHECKS_ROLLUP_SELECTION } from "./checksRead.js";
import { type GithubLiveError, GithubLiveErrors } from "./errors.js";
import { parseMergeQueueStack } from "./mergeQueueStack.js";
import type { GithubReadGraphql, GithubReadRest } from "./read.js";
import {
  codeOwnerRequests,
  parseReviewRequests,
  REVIEW_REQUESTS_SELECTION,
  reviewRequestsTruncated,
} from "./reviewRequests.js";
import { wholeMergeQueuePr } from "./wholeChecks.js";

/**
 * How many rollup contexts and opinionated reviews one read asks for.
 *
 * The same ceiling `github checks` uses, and for the same measured reason its own module states: the rollup
 * is the expensive field, so the page stays small rather than unbounded. It is the FIRST page only: a head
 * past it is re-read whole before the guard judges it (`./wholeChecks.ts`).
 */
const READ_LIMIT = 100;

/**
 * How many open review requests this read asks for.
 *
 * The same page `./reviewState.ts` uses, and the same reason: a truncated list can only ever LOSE a code
 * owner, and losing one turns an outstanding requirement into a `clean` verdict — the exact failure the
 * code-owner fallback below exists to close.
 */
const REVIEW_REQUEST_PAGE = 20;

/** One pull request's own entry in a merge queue, as GitHub currently reports it. */
export interface MergeQueueEntryState {
  /** Its place in the queue, 1-based, as GitHub numbers it. */
  readonly position: number;
  /** GitHub's own entry state: `QUEUED`, `AWAITING_CHECKS`, `MERGEABLE`, `UNMERGEABLE` or `LOCKED`. */
  readonly state: string;
  /** GitHub's own estimate in seconds, or `undefined` while it has none. */
  readonly estimatedSecondsToMerge: number | undefined;
}

/**
 * One pull request's membership of a NATIVE GitHub stack, or the absence of it.
 *
 * `baseRefName` here is the STACK's own landing branch, which is not the pull request's `baseRefName`: a
 * member above the bottom targets the branch of the member below it. MEASURED on
 * an `acme/acme-admin` pull request, position 2 of a stack — `baseRefName` reads
 * `mx-2386-onboarding-consent-invariant` while the stack's reads `staging`. Reproduce with
 * `slopweaver github read https://github.com/acme/acme-admin/pull/<number> --json`.
 */
export interface MergeQueueStackMembership {
  /** The stack's own pull-request-like number, as GitHub numbers it. */
  readonly number: number;
  /** The branch the whole stack lands on — where the queue and its required contexts actually live. */
  readonly baseRefName: string;
  /** How many pull requests GitHub currently counts in the stack. */
  readonly size: number;
  /** This pull request's own place in it, bottom-up as GitHub numbers it. */
  readonly position: number;
}

/** Everything the enqueue guard judges, read from GitHub in one call. */
export interface MergeQueuePrState {
  readonly number: number;
  /** The GraphQL node id — what both mutations address, and the one field REST cannot supply. */
  readonly nodeId: string;
  readonly url: string;
  /** GitHub's own `OPEN`/`CLOSED`/`MERGED`. */
  readonly state: string;
  readonly isDraft: boolean;
  readonly baseRefName: string;
  /** The base branch's commit as GitHub reads it — what a ratchet bump is judged against at the landing. */
  readonly baseRefOid: string;
  /** The pull request's HEAD branch — what a local checkout must be on to speak for this pull request. */
  readonly headRefName: string;
  /** The head commit the enqueue is pinned to, so a force-push mid-flight is refused rather than queued. */
  readonly headOid: string;
  /**
   * The pull request's description, read in the SAME call as its head, so a reader of it sees the description
   * that head carried — a body edit moves no head commit.
   */
  readonly body: string;
  /**
   * GitHub's aggregate decision, and `undefined` when it reports none.
   *
   * `undefined` is a real state rather than a default: a base branch requiring no review at all answers
   * `null` here, which is exactly the case where nothing about review should stand in the way.
   */
  readonly reviewDecision: string | undefined;
  /** GitHub's own mergeability: `MERGEABLE`, `CONFLICTING`, or `UNKNOWN` while it is still computing. */
  readonly mergeable: string;
  /**
   * GitHub's own answer to whether it would let this merge NOW, classified by
   * `../../review/githubMergeStatus.ts`.
   *
   * Read SEPARATELY here rather than taken from the fleet read, and that is the point: the door re-asks
   * every question immediately before it writes, so a fleet `CLEAN` followed by a door `BLOCKED` must refuse
   * rather than press. What it clears is exactly one thing — a code-owner REQUEST that is not a
   * REQUIREMENT — and `../../cli/commands/github/enqueueReviewFinding.ts` states the limits.
   */
  readonly githubMergeStatus: GithubMergeStatus;
  /** The logins whose LATEST opinionated review is an approval — detail beneath `reviewDecision`, never a verdict. */
  readonly approvedBy: readonly string[];
  readonly checks: GithubChecksSnapshot;
  /** The pull request's own queue entry, or `undefined` when it is not queued. */
  readonly entry: MergeQueueEntryState | undefined;
  /**
   * This pull request's NATIVE stack membership, or `undefined` when it belongs to no stack.
   *
   * What routes the write: GitHub's GraphQL `enqueuePullRequest` REFUSES a member with *"This pull request
   * is part of a stack and must be enqueued using the asynchronous merge REST API"*, so membership decides
   * the transport before anything is sent rather than being learned from that rejection.
   */
  readonly stack: MergeQueueStackMembership | undefined;
  /**
   * The review requests GitHub itself flagged `asCodeOwner` — the fallback when `reviewDecision` is absent.
   *
   * MEASURED on an `acme/acme-admin` pull request: `reviewDecision: null` while GitHub held an open
   * `asCodeOwner: true` request out to a team, and this verb's dry run still printed
   * *"clean: nothing stands between this pull request and its base branch's merge queue"*. Across a few dozen
   * open pull requests there, most read clean and only a handful were ready. This field is what closes that.
   */
  readonly codeownerRequests: readonly GithubReviewRequest[];
  /**
   * Whether GitHub reported more review requests than this read carried.
   *
   * Carried because the fallback above fails in the DANGEROUS direction on truncation: a capped request read
   * loses a PENDING code owner, so an unsatisfied requirement reads as no requirement at all and the guard
   * reports `clean`. The same asymmetry `../../review/githubCodeowners.ts` states for the fleet read.
   */
  readonly codeownerRequestsTruncated: boolean;
}

/** A branch's merge queue, when it has one. */
export interface MergeQueueState {
  readonly branch: string;
  readonly url: string;
}

/** The injected read seams; production wraps `githubReadGraphql`, tests supply plain fakes. */
export interface GithubMergeQueueReads {
  readonly pr: (args: {
    owner: string;
    repo: string;
    number: number;
  }) => Promise<Result<MergeQueuePrState, GithubLiveError>>;
  readonly queue: (args: {
    owner: string;
    repo: string;
    branch: string;
  }) => Promise<Result<MergeQueueState | undefined, GithubLiveError>>;
  readonly requiredContexts: (args: {
    owner: string;
    repo: string;
    branch: string;
  }) => Promise<Result<RequiredCheckContexts, GithubLiveError>>;
}

const PR_QUERY = `query SlopweaverMergeQueuePr(
  $owner: String!, $repo: String!, $number: Int!, $limit: Int!, $requestLimit: Int!
) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      id number title body url state isDraft baseRefName baseRefOid headRefName reviewDecision mergeable mergeStateStatus
      mergeQueueEntry { position state estimatedTimeToMerge }
      stack { number baseRefName size } stackEntry { position }
      ${REVIEW_REQUESTS_SELECTION}
      latestOpinionatedReviews(first: $limit) { nodes { state author { login } } }
      ${CHECKS_ROLLUP_SELECTION}
    }
  }
}`;

const QUEUE_QUERY = `query SlopweaverMergeQueue($owner: String!, $repo: String!, $branch: String!) {
  repository(owner: $owner, name: $repo) {
    mergeQueue(branch: $branch) { url }
  }
}`;

/** The logins whose latest opinionated review is an approval, in the order GitHub returned them. */
function approvedLoginsOf({ pullRequest }: { pullRequest: Record<string, unknown> }): readonly string[] {
  const reviews = pullRequest["latestOpinionatedReviews"];
  const nodes = isRecord(reviews) ? reviews["nodes"] : undefined;
  if (!Array.isArray(nodes)) {
    return [];
  }
  return nodes
    .filter((node): node is Record<string, unknown> => isRecord(node) && node["state"] === "APPROVED")
    .map((node) => {
      const author = node["author"];
      return isRecord(author) ? optStr({ value: author["login"] }) : undefined;
    })
    .filter((login): login is string => login !== undefined);
}

/**
 * The pull request's own merge-queue entry, or `undefined` when GitHub reports none.
 *
 * Exported because the fleet read selects the same `mergeQueueEntry` field for every pull request at once
 * (`./reviewState.ts`), and two parsers over one GitHub shape is the verbatim-duplication class this repo
 * gates against — there is one place that decides what a queue entry is, and this is it.
 *
 * @param pullRequest one raw `PullRequest` node
 * @returns the entry, or `undefined` when the node carries none
 */
export function parseMergeQueueEntry({
  pullRequest,
}: {
  pullRequest: Record<string, unknown>;
}): MergeQueueEntryState | undefined {
  const entry = pullRequest["mergeQueueEntry"];
  if (!isRecord(entry)) {
    return undefined;
  }
  const position = entry["position"];
  const estimate = entry["estimatedTimeToMerge"];
  return {
    estimatedSecondsToMerge: typeof estimate === "number" ? estimate : undefined,
    position: typeof position === "number" ? position : 0,
    state: optStr({ value: entry["state"] }) ?? "UNKNOWN",
  };
}

/* The fields a pull request read is refused without; one name so the signature below fits on one line. */
type RequiredPrFields = Pick<
  MergeQueuePrState,
  "baseRefName" | "baseRefOid" | "body" | "headRefName" | "mergeable" | "nodeId" | "number" | "state" | "url"
>;

/**
 * The fields a real pull request always carries, or `undefined` when GitHub returned one without them.
 *
 * They are read together rather than defaulted individually so a payload missing any of them fails LOUD.
 * A coalesced empty base branch would send the queue read at `mergeQueue(branch: "")`, which answers null,
 * which the guard would then report as "this branch has no merge queue" — a confident wrong answer built
 * out of a missing field.
 */
function requiredFieldsOf({ pullRequest }: { pullRequest: Record<string, unknown> }): RequiredPrFields | undefined {
  const nodeId = optStr({ value: pullRequest["id"] });
  const url = optStr({ value: pullRequest["url"] });
  const state = optStr({ value: pullRequest["state"] });
  const mergeable = optStr({ value: pullRequest["mergeable"] });
  const baseRefName = optStr({ value: pullRequest["baseRefName"] });
  const baseRefOid = optStr({ value: pullRequest["baseRefOid"] });
  const headRefName = optStr({ value: pullRequest["headRefName"] });
  const number = pullRequest["number"];
  // GitHub's `body` is a non-null String, `""` when empty — so a missing one is a broken read, never "no body".
  const body = pullRequest["body"];
  if (
    typeof body !== "string" ||
    nodeId === undefined ||
    url === undefined ||
    state === undefined ||
    mergeable === undefined ||
    baseRefName === undefined ||
    baseRefOid === undefined ||
    headRefName === undefined ||
    typeof number !== "number"
  ) {
    return undefined;
  }
  return { baseRefName, baseRefOid, body, headRefName, mergeable, nodeId, number, state, url };
}

/**
 * Shape one raw pull-request payload into the state the guard judges.
 *
 * @param data the raw GraphQL response
 * @param identity the `owner/name#number` address, named in a not-found error
 * @returns the shaped state, or the typed read failure
 */
export function parseMergeQueuePr({
  data,
  identity,
}: {
  data: unknown;
  identity: string;
}): Result<MergeQueuePrState, GithubLiveError> {
  const repository = isRecord(data) ? data["repository"] : undefined;
  const pullRequest = isRecord(repository) ? repository["pullRequest"] : undefined;
  if (!isRecord(pullRequest)) {
    return err(GithubLiveErrors.notFound({ identity, kind: "pull request" }));
  }
  const required = requiredFieldsOf({ pullRequest });
  if (required === undefined) {
    return err(
      GithubLiveErrors.readFailed({
        message: `GitHub returned ${identity} without one of id, number, body, url, state, mergeable, baseRefName, baseRefOid or headRefName`,
      }),
    );
  }
  const commit = headCommitOf({ pullRequest });
  if (commit === undefined) {
    return err(GithubLiveErrors.readFailed({ message: `GitHub returned ${identity} with no head commit` }));
  }
  const checks = parseChecksForCommit({ commit });
  if (checks.isErr()) {
    return err(checks.error);
  }
  const stack = parseMergeQueueStack({ identity, pullRequest });
  if (stack.isErr()) {
    return err(stack.error);
  }
  return ok({
    ...required,
    approvedBy: approvedLoginsOf({ pullRequest }),
    // `parseChecksForCommit` sees only the commit node, so it cannot know the pull request's mergeability —
    // and that is the one field telling a required context which NEVER RAN apart from one that ran and
    // failed, since GitHub creates no `pull_request` run at all while it cannot build the merge ref. This
    // read already selects `mergeable` for `required`, so folding it onto the snapshot here is what lets
    // every consumer of a PR-addressed snapshot name the cause instead of listing candidates.
    checks: { ...checks.value, mergeable: asGithubMergeable({ token: required.mergeable }) },
    codeownerRequests: codeOwnerRequests({ requests: parseReviewRequests({ node: pullRequest }) }),
    codeownerRequestsTruncated: reviewRequestsTruncated({ node: pullRequest }),
    entry: parseMergeQueueEntry({ pullRequest }),
    githubMergeStatus: githubMergeStatus({ value: pullRequest["mergeStateStatus"] }),
    headOid: checks.value.headSha,
    isDraft: pullRequest["isDraft"] === true,
    reviewDecision: optStr({ value: pullRequest["reviewDecision"] }),
    stack: stack.value,
  });
}

/**
 * Shape one raw merge-queue payload.
 *
 * A `null` `mergeQueue` is a STATE rather than a fault — the branch simply has no queue, which is the whole
 * fact the guard needs — so it becomes `undefined` here instead of a read failure.
 *
 * @param data the raw GraphQL response
 * @param branch the branch the queue was asked for, carried into the shaped value
 * @param identity the `owner/name` slug, named in a not-found error
 * @returns the queue, `undefined` when the branch has none, or the typed read failure
 */
export function parseMergeQueue({
  data,
  branch,
  identity,
}: {
  data: unknown;
  branch: string;
  identity: string;
}): Result<MergeQueueState | undefined, GithubLiveError> {
  const repository = isRecord(data) ? data["repository"] : undefined;
  if (!isRecord(repository)) {
    return err(GithubLiveErrors.notFound({ identity, kind: "repository" }));
  }
  const queue = repository["mergeQueue"];
  if (!isRecord(queue)) {
    return ok(undefined);
  }
  const url = optStr({ value: queue["url"] });
  if (url === undefined) {
    return err(GithubLiveErrors.readFailed({ message: `GitHub returned a merge queue on ${branch} with no url` }));
  }
  return ok({ branch, url });
}

/**
 * The contexts a branch requires, classic protection and rulesets unioned.
 *
 * @param branch the base branch whose requirement is read
 * @returns the required contexts and whether code-owner review is required, or the typed read failure
 */
async function readRequiredContexts({
  graphql,
  rest,
  owner,
  repo,
  branch,
}: {
  graphql: GithubReadGraphql;
  rest: GithubReadRest;
  owner: string;
  repo: string;
  branch: string;
}): ReturnType<GithubMergeQueueReads["requiredContexts"]> {
  // BOTH sources, unioned, because a branch may be governed by either mechanism and they are reported by
  // different APIs. Classic branch protection appears only on `Ref.branchProtectionRule`; a ruleset
  // appears only in REST's rules-for-a-branch. MEASURED: `lachiejames/slopweaver` `main` is
  // CLASSIC, so the REST list carries nothing but inherited org/enterprise repository rules, and reading
  // it alone reported an ungated queue against one gated on `build` and `integration`.
  const identity = `${owner}/${repo}`;
  const protection = await graphql({
    query: PROTECTION_QUERY,
    variables: { owner, qualified: `refs/heads/${branch}`, repo },
  });
  if (protection.isErr()) {
    return err(protection.error);
  }
  const classic = parseProtectionContexts({ data: protection.value, identity });
  if (classic.isErr()) {
    return err(classic.error);
  }
  const answered = await rest({
    params: { branch, owner, per_page: RULES_PAGE, repo },
    route: "GET /repos/{owner}/{repo}/rules/branches/{branch}",
  });
  if (answered.isErr()) {
    return err(answered.error);
  }
  const ruleset = parseRequiredCheckContexts({ branch, data: answered.value, identity });
  if (ruleset.isErr()) {
    return err(ruleset.error);
  }
  return ok({
    branch,
    contexts: [...new Set([...classic.value.contexts, ...ruleset.value.contexts])].toSorted(),
    requiresCodeOwnerReviews: classic.value.requiresCodeOwnerReviews,
  });
}

/**
 * Build the production read seams over one GraphQL transport and one REST transport.
 *
 * @param graphql the injected GraphQL transport
 * @param rest the injected REST transport, which the ruleset half of the required-contexts read needs
 * @returns the pull-request, merge-queue and required-context reads
 */
export function makeGithubMergeQueueReads({
  graphql,
  rest,
}: {
  graphql: GithubReadGraphql;
  rest: GithubReadRest;
}): GithubMergeQueueReads {
  return {
    pr: async ({ owner, repo, number }) => {
      const identity = `${owner}/${repo}#${String(number)}`;
      const answered = await graphql({
        query: PR_QUERY,
        variables: { limit: READ_LIMIT, number, owner, repo, requestLimit: REVIEW_REQUEST_PAGE },
      });
      if (answered.isErr()) {
        return err(answered.error);
      }
      const parsed = parseMergeQueuePr({ data: answered.value, identity });
      return parsed.isErr()
        ? parsed
        : wholeMergeQueuePr({ graphql, identity, number, owner, repo, state: parsed.value });
    },
    queue: async ({ owner, repo, branch }) => {
      const answered = await graphql({ query: QUEUE_QUERY, variables: { branch, owner, repo } });
      return answered.isErr()
        ? err(answered.error)
        : parseMergeQueue({ branch, data: answered.value, identity: `${owner}/${repo}` });
    },
    requiredContexts: ({ owner, repo, branch }) => readRequiredContexts({ branch, graphql, owner, repo, rest }),
  };
}
