/**
 * WHEN each open review request was made — GitHub's `ReviewRequestedEvent`s, one selection and one parser.
 *
 * `./reviewRequests.ts` says WHO GitHub is holding a pull request for and carries no instant: a
 * `ReviewRequest` node has no `createdAt`. The instant lives only on the timeline, so a row that says "waiting
 * on @acme/platform" could not say since when, and "is this stale" had no denominator but the pull
 * request's own age. Every row waiting
 * on a human carries when the review was requested.
 *
 * Its own module, not a line in `REVIEW_REQUESTS_SELECTION`, because that selection is shared with
 * `./mergeQueue.ts`'s enqueue check, which needs no instant and should not pay for one.
 *
 * `last:` rather than `first:`, because a re-request RESETS the wait: the newest event per reviewer is the
 * one that answers "since when", and those are the ones a bounded page keeps. A reviewer the page holds no
 * event for, on a page GitHub says has older ones, is `undefined` — never the pull request's opening.
 */

import { optStr } from "../../corpus/slack/shape.js";
import { isRecord } from "../../lib/parsers.js";
import type { ReviewRequestTimes } from "../../review/humanWait.js";

/** How many review-request events one pull request is read for, newest first. */
export const REVIEW_REQUEST_EVENT_PAGE = 20;

/** The `timelineItems` selection, sized by `$requestEventLimit` ({@link REVIEW_REQUEST_EVENT_PAGE}). */
export const REVIEW_REQUEST_EVENTS_SELECTION = `requestEvents: timelineItems(itemTypes: [REVIEW_REQUESTED_EVENT], last: $requestEventLimit) {
  nodes {
    ... on ReviewRequestedEvent {
      createdAt
      requestedReviewer { __typename ... on User { login } ... on Team { combinedSlug } }
    }
  }
  pageInfo { hasPreviousPage }
}`;

/**
 * Every reviewer's newest request instant on one pull-request node.
 *
 * @param node the raw `PullRequest` node, from a query carrying {@link REVIEW_REQUEST_EVENTS_SELECTION}
 * @returns the instants, and whether the page was cut
 */
export function parseReviewRequestTimes({ node }: { node: Record<string, unknown> }): ReviewRequestTimes {
  const connection = node["requestEvents"];
  if (!isRecord(connection) || !Array.isArray(connection["nodes"])) {
    return { latestByReviewer: {}, truncated: true };
  }
  const latest = new Map<string, string>();
  for (const event of connection["nodes"].filter(isRecord)) {
    const at = optStr({ value: event["createdAt"] });
    const name = reviewerOf({ reviewer: event["requestedReviewer"] });
    if (at === undefined || name === undefined) {
      continue;
    }
    const seen = latest.get(name);
    if (seen === undefined || Date.parse(at) > Date.parse(seen)) {
      latest.set(name, at);
    }
  }
  const pageInfo = connection["pageInfo"];
  const truncated = !isRecord(pageInfo) || pageInfo["hasPreviousPage"] !== false;
  return { latestByReviewer: Object.fromEntries(latest), truncated };
}

/** A requested reviewer as `@login` or `@org/team`, or `undefined` when GitHub named neither. */
function reviewerOf({ reviewer }: { reviewer: unknown }): string | undefined {
  if (!isRecord(reviewer)) {
    return undefined;
  }
  let name: string | undefined;
  if (reviewer["__typename"] === "Team") {
    name = optStr({ value: reviewer["combinedSlug"] });
  } else {
    name = optStr({ value: reviewer["login"] });
  }
  if (name === undefined || name === "") {
    return undefined;
  }
  return `@${name}`;
}
