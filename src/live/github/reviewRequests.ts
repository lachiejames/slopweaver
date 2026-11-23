/**
 * GitHub's OPEN review requests on a pull request, with its own `asCodeOwner` flag — one selection and one
 * parser, shared by every read that needs them.
 *
 * ## Why this is its own module rather than a function in either caller
 *
 * Two verbs need the same answer for opposite reasons and neither may reimplement it. `./reviewState.ts`
 * carries it so a row can say who GitHub itself is holding a pull request for; `./mergeQueue.ts` needs it
 * because `github enqueue`'s approval check reads GitHub's aggregate `reviewDecision`, and MEASURED
 * on `acme/acme-admin` that field is **null while GitHub simultaneously holds an open
 * `asCodeOwner: true` request out to a team**. The guard treated an absent decision as satisfied and
 * reported `clean` on 20 of 29 open pull requests, of which three were actually ready.
 *
 * Two parsers over one GitHub shape is the verbatim-duplication class this repo gates against, and it is
 * also how the two verbs would drift into disagreeing about the same pull request. So the selection string
 * and the parser live here, and `../../review/githubCodeowners.ts` turns what they produce into an answer.
 */

import { optStr } from "../../corpus/slack/shape.js";
import { isRecord } from "../../lib/parsers.js";
import type { GithubReviewRequest } from "../../review/githubCodeowners.js";

/**
 * The `reviewRequests` selection, written once.
 *
 * It takes its page size from a `$requestLimit` variable rather than a literal so a caller can size it
 * against whatever else it is asking for; `pageInfo` rides along because a truncated request list can only
 * ever LOSE a code owner, which a consumer has to be able to report rather than silently read as green.
 */
export const REVIEW_REQUESTS_SELECTION = `reviewRequests(first: $requestLimit) {
  nodes {
    asCodeOwner
    requestedReviewer { __typename ... on User { login } ... on Team { slug combinedSlug } }
  }
  pageInfo { hasNextPage }
}`;

/**
 * A requested reviewer's name and kind, or `undefined` when GitHub named neither.
 *
 * `undefined` rather than an empty name: an unnamed reviewer is a node the caller must DROP, and a blank
 * string is a value it could accidentally keep.
 */
function reviewerNameOf({ reviewer }: { reviewer: unknown }): { name: string; isTeam: boolean } | undefined {
  if (!isRecord(reviewer)) {
    return undefined;
  }
  const isTeam = reviewer["__typename"] === "Team";
  const name = optStr({ value: isTeam ? reviewer["combinedSlug"] : reviewer["login"] });
  return name === undefined || name === "" ? undefined : { isTeam, name };
}

/**
 * Every open review request on one pull-request node, unnamed entries dropped.
 *
 * @param node the raw `PullRequest` node, from any query carrying {@link REVIEW_REQUESTS_SELECTION}
 * @returns the requests, each with GitHub's own `asCodeOwner` flag
 */
export function parseReviewRequests({ node }: { node: Record<string, unknown> }): readonly GithubReviewRequest[] {
  const connection = node["reviewRequests"];
  const nodes = isRecord(connection) && Array.isArray(connection["nodes"]) ? connection["nodes"] : [];
  return nodes.filter(isRecord).flatMap((request): readonly GithubReviewRequest[] => {
    const named = reviewerNameOf({ reviewer: request["requestedReviewer"] });
    if (named === undefined) {
      return [];
    }
    return [{ asCodeOwner: request["asCodeOwner"] === true, kind: named.isTeam ? "team" : "user", name: named.name }];
  });
}

/**
 * The requests GitHub itself flagged as a CODE-OWNER requirement.
 *
 * This is the set `github enqueue`'s approval check falls back to when `reviewDecision` is absent: an open
 * `asCodeOwner` request is GitHub saying, in its own words, that the branch's CODEOWNERS rule is not yet
 * satisfied. Its one limit is stated where it belongs — GitHub retires the request the moment the
 * requirement clears, so this set is only ever the OUTSTANDING half, never a roster.
 *
 * @param requests every open review request on the pull request
 * @returns the subset GitHub flagged `asCodeOwner`
 */
export function codeOwnerRequests({
  requests,
}: {
  requests: readonly GithubReviewRequest[];
}): readonly GithubReviewRequest[] {
  return requests.filter((request) => request.asCodeOwner);
}

/**
 * Whether this read of the review requests is INCOMPLETE — a page GitHub said carries more, or a flagged
 * code-owner entry {@link parseReviewRequests} had to drop.
 *
 * An incomplete request list can only ever LOSE a code owner, which turns an outstanding requirement into a
 * clean verdict — so every consumer of {@link parseReviewRequests} has to be able to say `unknown` instead
 * of `satisfied`, and prose in a residue list cannot be branched on.
 *
 * **The dropped-entry half is the second way that happens, and it is not a page boundary.** GitHub declares
 * `ReviewRequest.requestedReviewer` NULLABLE while `asCodeOwner` is `Boolean!`, so a deleted or invisible
 * reviewer arrives as `{ asCodeOwner: true, requestedReviewer: null }`. `parseReviewRequests` drops it,
 * correctly — an unnamed reviewer is nothing a row can print — and the register then reads EMPTY, which is
 * the one input `./githubCodeowners.ts` passes unconditionally. Found by review,
 * where `BLOCKED` plus `REVIEW_REQUIRED` reached `codeowners-satisfied: pass` on exactly that payload.
 *
 * **A NULL NODE is the same hole and was missed on the first swing.** `nodes` is `[ReviewRequest]`, so an
 * element may be null, and a first fix that reached for `.filter(isRecord)` discarded exactly the entry it
 * was looking for — the next r1 pass produced `nodes: [null]` hiding a required owner. A non-record entry
 * says nothing about itself, so it counts as incomplete unconditionally, where a RECORD entry has to claim
 * `asCodeOwner` to count. An unnamed non-owner hides no requirement and is left alone.
 * Folding it in here rather than at each consumer is deliberate: this is the one function that already
 * means *the register is not fully known*, and both the landing test's `unknown` arm and the enqueue door's
 * truncation finding are already wired to it.
 *
 * @param node the raw `PullRequest` node
 * @returns whether anything could be missing from the parsed request register
 */
export function reviewRequestsTruncated({ node }: { node: Record<string, unknown> }): boolean {
  const connection = node["reviewRequests"];
  if (!isRecord(connection)) {
    return true;
  }
  const pageInfo = connection["pageInfo"];
  if (isRecord(pageInfo) && pageInfo["hasNextPage"] === true) {
    return true;
  }
  const nodes = connection["nodes"];
  if (!Array.isArray(nodes)) {
    return true;
  }
  return nodes.some((request) => {
    if (!isRecord(request)) {
      return true;
    }
    return request["asCodeOwner"] === true && reviewerNameOf({ reviewer: request["requestedReviewer"] }) === undefined;
  });
}
