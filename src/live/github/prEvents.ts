/**
 * A pull request's ACTIVITY as one poll sees it — head, state, reviews and comments — and the pure diff
 * that turns two consecutive polls into event lines. This is the review/comment leg `slopweaver github
 * checks --wait --until …` adds beside its CI leg, so a session parked on a pull request is woken by the
 * event rather than by a timer, through the door.
 *
 * ## Why this exists — measured
 *
 * The private work repository's ship skills armed a checked-in shell watcher (`while :` over `gh api
 * graphql`, 20-second ticks) to be woken by CodeRabbit and reviewer comments within seconds, because an
 * audit there measured 223 timer-driven wakes at ~590k tokens of context each to learn nothing. That script
 * reached GitHub outside the door, and the door now refuses it (`src/admit/scriptWrapper.ts`). A verb that
 * only watched CI would have forced those sessions back onto the timer the audit condemned — so the door's
 * own watch verb carries the same three signals the script did, and the skills can point at it without
 * losing the wake.
 *
 * ## The contract, kept from the script where it was right
 *
 * - **A review counts only on the CURRENT head.** A stale pre-push `CHANGES_REQUESTED` must not re-fire on
 *   every wake, and a `COMMENTED` on the new head is a real verdict.
 * - **Nothing the viewer wrote is an event.** A session posts nudges and status comments on the pull
 *   request it is watching; reporting those back to it is a self-sustaining wake loop (measured: seven
 *   self-wakes on one pull request). An app's comments (`author.__typename === "Bot"`) are excluded too.
 * - **The cursor is an ISO-8601 `Z` instant compared as a string.** GitHub's own timestamps are that form, so
 *   the comparison is chronological; any other spelling is refused at the flag rather than silently
 *   sorting after every event of the day.
 * - **The first poll is a baseline.** It emits the armed line and nothing else — anything worth knowing is
 *   reported by the next poll, against a previous state it can be compared with.
 */

import { optStr } from "../../corpus/slack/shape.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type GithubLiveError, GithubLiveErrors } from "./errors.js";
import type { GithubReadGraphql } from "./read.js";

/** One review as the poll sees it. `commitSha` is the head it judged; `submittedAt` is GitHub's `Z` instant. */
interface GithubPrReview {
  readonly id: string;
  readonly author: string;
  readonly state: string;
  readonly submittedAt: string;
  readonly commitSha: string;
}

/**
 * One top-level comment as the poll sees it. `bot` is GitHub's own `author.__typename === "Bot"` — measured
 * live, an app's comment login carries NO `[bot]` suffix on GraphQL (a review summary and a CI
 * pipeline notice both arrived as bare logins and fired as human comments), so the suffix alone is not enough.
 */
interface GithubPrComment {
  readonly id: string;
  readonly author: string;
  readonly bot: boolean;
  readonly createdAt: string;
  readonly body: string;
}

/** A pull request's activity, as of one read. */
export interface GithubPrActivity {
  readonly state: "OPEN" | "MERGED" | "CLOSED";
  readonly mergedAt: string | undefined;
  readonly headSha: string;
  readonly viewer: string;
  readonly reviews: readonly GithubPrReview[];
  readonly comments: readonly GithubPrComment[];
}

/** The injected activity seam, beside `FetchGithubChecks`. Production wraps the same safe GraphQL transport. */
type FetchGithubPrActivity = (args: {
  owner: string;
  repo: string;
  number: number;
}) => Promise<Result<GithubPrActivity, GithubLiveError>>;

/** How many recent reviews and comments one poll asks for — far more than a poll interval can miss. */
const ACTIVITY_WINDOW = 30;

const PR_ACTIVITY_QUERY = `query SlopweaverPrActivity($owner: String!, $repo: String!, $number: Int!, $window: Int!) {
  viewer { login }
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      state
      mergedAt
      headRefOid
      reviews(last: $window) { nodes { id author { login } state submittedAt commit { oid } } }
      comments(last: $window) { nodes { id author { login __typename } createdAt body } }
    }
  }
}`;

/** The `login` of an `author` object, or `undefined` for a deleted account. */
function loginOf({ node }: { node: Record<string, unknown> }): string | undefined {
  const author = node["author"];
  return isRecord(author) ? optStr({ value: author["login"] }) : undefined;
}

/** Shape one raw review node; a node missing any field it needs is dropped rather than half-reported. */
function toReview({ node }: { node: Record<string, unknown> }): GithubPrReview | undefined {
  const id = optStr({ value: node["id"] });
  const author = loginOf({ node });
  const state = optStr({ value: node["state"] });
  const submittedAt = optStr({ value: node["submittedAt"] });
  const commit = node["commit"];
  const commitSha = isRecord(commit) ? optStr({ value: commit["oid"] }) : undefined;
  if (
    id === undefined ||
    author === undefined ||
    state === undefined ||
    submittedAt === undefined ||
    commitSha === undefined
  ) {
    return undefined;
  }
  return { author, commitSha, id, state, submittedAt };
}

/** Shape one raw comment node; a node missing any field it needs is dropped rather than half-reported. */
function toComment({ node }: { node: Record<string, unknown> }): GithubPrComment | undefined {
  const id = optStr({ value: node["id"] });
  const author = loginOf({ node });
  const createdAt = optStr({ value: node["createdAt"] });
  const body = optStr({ value: node["body"] });
  if (id === undefined || author === undefined || createdAt === undefined || body === undefined) {
    return undefined;
  }
  const authorNode = node["author"];
  const bot = (isRecord(authorNode) && authorNode["__typename"] === "Bot") || author.endsWith("[bot]");
  return { author, body, bot, createdAt, id };
}

/** The record nodes of a GraphQL connection field, or none when the field is absent or malformed. */
function nodesOf({
  parent,
  field,
}: {
  parent: Record<string, unknown>;
  field: string;
}): readonly Record<string, unknown>[] {
  const connection = parent[field];
  if (!isRecord(connection) || !Array.isArray(connection["nodes"])) {
    return [];
  }
  return connection["nodes"].filter(isRecord);
}

/**
 * Parse one raw activity response into a typed {@link GithubPrActivity}.
 *
 * @param data the raw GraphQL response
 * @param identity the `owner/repo#number` this read was for, folded into a `NOT_FOUND` message
 * @returns the typed activity, or a named read failure
 */
export function parsePrActivity({
  data,
  identity,
}: {
  data: unknown;
  identity: string;
}): Result<GithubPrActivity, GithubLiveError> {
  const root = isRecord(data) ? data : {};
  const repository = root["repository"];
  const pullRequest = isRecord(repository) ? repository["pullRequest"] : undefined;
  if (!isRecord(pullRequest)) {
    return err(GithubLiveErrors.notFound({ identity, kind: "pull request" }));
  }
  const viewerNode = root["viewer"];
  const viewer = isRecord(viewerNode) ? optStr({ value: viewerNode["login"] }) : undefined;
  const headSha = optStr({ value: pullRequest["headRefOid"] });
  const state = optStr({ value: pullRequest["state"] });
  if (viewer === undefined || headSha === undefined || (state !== "OPEN" && state !== "MERGED" && state !== "CLOSED")) {
    return err(
      GithubLiveErrors.readFailed({ message: "GitHub returned pull-request activity with no viewer, head or state" }),
    );
  }
  return ok({
    comments: nodesOf({ field: "comments", parent: pullRequest })
      .map((node) => toComment({ node }))
      .filter((comment): comment is GithubPrComment => comment !== undefined),
    headSha,
    mergedAt: optStr({ value: pullRequest["mergedAt"] }),
    reviews: nodesOf({ field: "reviews", parent: pullRequest })
      .map((node) => toReview({ node }))
      .filter((review): review is GithubPrReview => review !== undefined),
    state,
    viewer,
  });
}

/**
 * Build the live activity seam over an already-safe-wrapped GraphQL transport.
 *
 * @param graphql the safe-wrapped GraphQL seam — the same one `github read` and `github checks` use
 * @returns an activity fetcher, injectable so a test never touches Octokit
 */
export function makeFetchGithubPrActivity({ graphql }: { graphql: GithubReadGraphql }): FetchGithubPrActivity {
  return async ({ owner, repo, number }) => {
    const response = await graphql({
      query: PR_ACTIVITY_QUERY,
      variables: { number, owner, repo, window: ACTIVITY_WINDOW },
    });
    if (response.isErr()) {
      return err(response.error);
    }
    return parsePrActivity({ data: response.value, identity: `${owner}/${repo}#${String(number)}` });
  };
}

/** The strict cursor form: an ISO-8601 instant in UTC, ending in `Z`, comparable as a string. */
const ISO_Z_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

/**
 * Whether a cursor is the one spelling this module compares safely.
 *
 * @param value the candidate cursor
 * @returns true only for an ISO-8601 UTC instant ending in `Z`
 */
export function isIsoZInstant({ value }: { value: string }): boolean {
  return ISO_Z_INSTANT.test(value);
}

/** What the reader has already been told, carried between polls so nothing is reported twice. */
export interface PrEventCursor {
  readonly since: string;
  readonly seenReviewIds: ReadonlySet<string>;
  readonly seenCommentIds: ReadonlySet<string>;
}

/** One poll's new events, plus the cursor the next poll starts from. */
interface PrEventDiff {
  readonly lines: readonly string[];
  readonly cursor: PrEventCursor;
  readonly reviewed: boolean;
  readonly commented: boolean;
  readonly terminal: "MERGED" | "CLOSED" | undefined;
}

/** How much of a comment body one event line carries. */
const COMMENT_EXCERPT_CHARS = 160;

/** A short SHA for an event line. */
function short({ sha }: { sha: string }): string {
  return sha.slice(0, 8);
}

/**
 * The reviews on the current head, after the cursor, by someone other than the viewer, not yet reported —
 * oldest first so a `COMMENTED` then `APPROVED` pair reads in the order it happened.
 */
function newReviews({
  activity,
  cursor,
}: {
  activity: GithubPrActivity;
  cursor: PrEventCursor;
}): readonly GithubPrReview[] {
  return activity.reviews
    .filter((review) => review.commitSha === activity.headSha)
    .filter((review) => review.submittedAt > cursor.since)
    .filter((review) => review.author !== activity.viewer)
    .filter((review) => !cursor.seenReviewIds.has(review.id))
    .toSorted((a, b) => a.submittedAt.localeCompare(b.submittedAt));
}

/** The comments after the cursor by a human other than the viewer, not yet reported, oldest first. */
function newComments({
  activity,
  cursor,
}: {
  activity: GithubPrActivity;
  cursor: PrEventCursor;
}): readonly GithubPrComment[] {
  return activity.comments
    .filter((comment) => comment.createdAt > cursor.since)
    .filter((comment) => comment.author !== activity.viewer && !comment.bot)
    .filter((comment) => !cursor.seenCommentIds.has(comment.id))
    .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** The one line a terminal pull-request state produces. */
function terminalLine({ activity }: { activity: GithubPrActivity }): string | undefined {
  if (activity.state === "MERGED") {
    return activity.mergedAt === undefined ? "MERGED" : `MERGED ${activity.mergedAt}`;
  }
  return activity.state === "CLOSED" ? "CLOSED" : undefined;
}

/**
 * Diff one poll's activity against what the reader has already been told, producing event lines.
 *
 * Pure: the same activity and cursor always yield the same lines. A head change is reported as its own line
 * and resets nothing in the cursor — reviews are already pinned to the head, so a review on the old head
 * simply stops qualifying.
 *
 * @param activity this poll's activity
 * @param cursor what has already been reported
 * @param previousHead the head the last poll saw, or `undefined` on the first poll
 * @returns the new lines, the advanced cursor, and which kinds of event fired
 */
export function diffPrEvents({
  activity,
  cursor,
  previousHead,
}: {
  activity: GithubPrActivity;
  cursor: PrEventCursor;
  previousHead: string | undefined;
}): PrEventDiff {
  const lines: string[] = [];
  if (previousHead !== undefined && previousHead !== activity.headSha) {
    lines.push(
      `HEAD ${short({ sha: activity.headSha })} pushed (was ${short({ sha: previousHead })}) — CI and reviews restart`,
    );
  }
  const reviews = newReviews({ activity, cursor });
  for (const review of reviews) {
    lines.push(
      `REVIEW ${review.author} ${review.state} on ${short({ sha: activity.headSha })} at ${review.submittedAt}`,
    );
  }
  const comments = newComments({ activity, cursor });
  for (const comment of comments) {
    const excerpt = comment.body.replace(/\s+/g, " ").trim().slice(0, COMMENT_EXCERPT_CHARS);
    lines.push(`COMMENT ${comment.author} at ${comment.createdAt}: ${excerpt}`);
  }
  const terminal = terminalLine({ activity });
  if (terminal !== undefined) {
    lines.push(terminal);
  }
  return {
    commented: comments.length > 0,
    cursor: {
      seenCommentIds: new Set([...cursor.seenCommentIds, ...comments.map((comment) => comment.id)]),
      seenReviewIds: new Set([...cursor.seenReviewIds, ...reviews.map((review) => review.id)]),
      since: cursor.since,
    },
    lines,
    reviewed: reviews.length > 0,
    terminal: activity.state === "OPEN" ? undefined : activity.state,
  };
}
