/**
 * The fixed page sizes `./reviewState.ts`'s two pull-request queries ask GitHub for, one per connection.
 *
 * Its own module because the set is one contract: the fleet query and the by-number query read the same
 * connections, so they spread ONE object, and a connection added to one cannot silently go unsized in the
 * other. The two sizes a caller chooses (`DEFAULT_PAGE_SIZE`, `CHECK_PAGE`) stay beside the read that takes them.
 */

import { REVIEW_REQUEST_EVENT_PAGE } from "./reviewRequestEvents.js";

/** How many of a pull request's newest reviews are read. GraphQL's own per-connection ceiling is 100. */
const REVIEW_PAGE = 100;

/** How many of a pull request's review threads are read, before `PrLiveState.threadsTruncated` fires. */
const THREAD_PAGE = 100;

/**
 * How many `onBehalfOf` teams one submitted review is read for.
 *
 * A review satisfies the code-owner teams the reviewer belongs to that the pull request actually invoked,
 * so this is a handful in practice rather than a page — but it is a variable rather than a literal so the
 * truncation is reportable at all, which is what `../../review/githubCodeowners.ts` states as residue.
 */
const ON_BEHALF_OF_PAGE = 20;

/**
 * How many labels one pull request is read for.
 *
 * A label is one short string, so this page is cheap and the cap generous: the opt-out label
 * `../../review/landing.ts` honours has to be VISIBLE for a row to be held back, and a truncated label list
 * could only ever lose it. MEASURED: the busiest of the owner's 29 open pull requests carries
 * four labels — reproduce with
 * `slopweaver github review-state --repo acme/acme-admin --author octocat --json` and read
 * the longest `labels` array.
 */
const LABEL_PAGE = 50;

/** How many open review requests one pull request is read for — the page `reviewRequests(first:)` asks for. */
const REVIEW_REQUEST_PAGE = 20;

/**
 * How many of a thread's NEWEST comments are read, on top of its opener.
 *
 * Three is what the disposition needs: whether the pull request's author has spoken since the reviewer did
 * is decided by the last comment alone, and two more give a reader the exchange around it. A thread longer
 * than this reports `PrReviewThread.commentCount` so the gap is visible rather than silent.
 */
const THREAD_TAIL_PAGE = 3;

/** The fixed page sizes both pull-request queries share, so a new connection cannot reach one and miss the other. */
export const PAGE_LIMITS = {
  labelLimit: LABEL_PAGE,
  onBehalfOfLimit: ON_BEHALF_OF_PAGE,
  requestEventLimit: REVIEW_REQUEST_EVENT_PAGE,
  requestLimit: REVIEW_REQUEST_PAGE,
  reviewLimit: REVIEW_PAGE,
  threadLimit: THREAD_PAGE,
  threadTailLimit: THREAD_TAIL_PAGE,
} as const;
