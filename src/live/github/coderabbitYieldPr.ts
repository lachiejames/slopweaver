/**
 * One pull request's facts for `github coderabbit-yield`, built from its search node and completed by
 * following every connection the inline page could not hold.
 */

import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { YieldPrFacts, YieldThread } from "../../review/coderabbitYield.js";
import { isCoderabbit } from "../../review/coderabbitYieldEvidence.js";
import {
  COMMENTS_QUERY,
  commentsOf,
  pageOf,
  prOf,
  REVIEWS_QUERY,
  reviewOf,
  THREADS_QUERY,
  threadOf,
} from "./coderabbitYieldQueries.js";
import { callWalk, fieldOf, type Walk } from "./coderabbitYieldWalk.js";
import type { GithubLiveError } from "./errors.js";

/** Which PR-level connection a follow-up reads. */
type Connection = "reviewThreads" | "reviews";

/** The follow-up query for each connection. */
const FOLLOW_QUERY: Readonly<Record<Connection, string>> = { reviewThreads: THREADS_QUERY, reviews: REVIEWS_QUERY };

/** Follow one PR-level connection past its inline page. */
async function followNode({
  walk,
  id,
  after,
  field,
}: {
  walk: Walk;
  id: string;
  after: string;
  field: Connection;
}): Promise<Result<unknown[], GithubLiveError>> {
  const nodes: unknown[] = [];
  let cursor: string | undefined = after;
  while (cursor !== undefined) {
    const response = await callWalk({ query: FOLLOW_QUERY[field], variables: { after: cursor, id }, walk });
    if (response.isErr()) {
      return err(response.error);
    }
    const node = fieldOf({ key: "node", value: response.value });
    const page = pageOf({ connection: fieldOf({ key: field, value: node }), what: field });
    if (page.isErr()) {
      return err(page.error);
    }
    nodes.push(...page.value.nodes);
    if (page.value.next === cursor) {
      walk.gaps.push(`${id}: GitHub repeated the ${field} cursor instead of advancing`);
      return ok(nodes);
    }
    cursor = page.value.next;
  }
  return ok(nodes);
}

/** Every node of one connection: the inline page, then whatever a follow-up reads past it. */
async function allNodes({
  walk,
  id,
  value,
  field,
}: {
  walk: Walk;
  id: string;
  value: unknown;
  field: Connection;
}): Promise<Result<unknown[], GithubLiveError>> {
  const page = pageOf({ connection: fieldOf({ key: field, value }), what: field });
  if (page.isErr()) {
    return err(page.error);
  }
  if (page.value.next === undefined) {
    return ok([...page.value.nodes]);
  }
  const more = await followNode({ after: page.value.next, field, id, walk });
  return more.isErr() ? err(more.error) : ok([...page.value.nodes, ...more.value]);
}

/** Re-read a CodeRabbit thread whose comments ran past the inline page. */
async function completeThread({
  walk,
  thread,
}: {
  walk: Walk;
  thread: YieldThread;
}): Promise<Result<YieldThread, GithubLiveError>> {
  const response = await callWalk({ query: COMMENTS_QUERY, variables: { id: thread.id }, walk });
  if (response.isErr()) {
    return err(response.error);
  }
  const node = fieldOf({ key: "node", value: response.value });
  const parsed = commentsOf({ connection: fieldOf({ key: "comments", value: node }) });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const complete = parsed.value.comments.length >= parsed.value.total;
  if (!complete) {
    walk.gaps.push(
      `${thread.id}: read ${String(parsed.value.comments.length)} of ${String(parsed.value.total)} comments`,
    );
  }
  return ok({ ...thread, comments: parsed.value.comments, commentsComplete: complete });
}

/** Whether a parsed thread is CodeRabbit's and has comments the inline page did not carry. */
function needsReRead({ thread }: { thread: YieldThread }): boolean {
  const login = thread.comments[0]?.authorLogin;
  // An opener unread or unattributed might be CodeRabbit, so that thread is re-read too.
  const maybeCoderabbit = login == null || isCoderabbit({ login });
  // Any shortfall, not only a full inline page: a short page with a larger totalCount is still unread.
  return maybeCoderabbit && !thread.commentsComplete;
}

/** Keep a thread's later snapshot, unless it lost the opener's author an earlier one carried. */
function keepLater({ threads, thread }: { threads: Map<string, YieldThread>; thread: YieldThread }): void {
  const earlier = threads.get(thread.id);
  const lostAuthor = earlier?.comments[0]?.authorLogin != null && thread.comments[0]?.authorLogin == null;
  if (!lostAuthor) {
    threads.set(thread.id, thread);
  }
}

/**
 * Parse every raw thread, re-reading a CodeRabbit one the inline page cut short. One thread GitHub returns on
 * two pages is one thread, its later snapshot kept, so it can never land on two outcome rungs.
 */
async function threadsOf({
  walk,
  nodes,
}: {
  walk: Walk;
  nodes: readonly unknown[];
}): Promise<Result<YieldThread[], GithubLiveError>> {
  const threads = new Map<string, YieldThread>();
  for (const node of nodes) {
    const thread = threadOf({ value: node });
    if (thread.isErr()) {
      return err(thread.error);
    }
    if (!needsReRead({ thread: thread.value })) {
      keepLater({ thread: thread.value, threads });
      continue;
    }
    const whole = await completeThread({ thread: thread.value, walk });
    if (whole.isErr()) {
      return err(whole.error);
    }
    keepLater({ thread: whole.value, threads });
  }
  return ok([...threads.values()]);
}

/** The bodies of every CodeRabbit review among the raw review nodes. */
function coderabbitBodies({ nodes }: { nodes: readonly unknown[] }): Result<string[], GithubLiveError> {
  const bodies: string[] = [];
  for (const node of nodes) {
    const review = reviewOf({ value: node });
    if (review.isErr()) {
      return err(review.error);
    }
    if (isCoderabbit({ login: review.value.authorLogin })) {
      bodies.push(review.value.body);
    }
  }
  return ok(bodies);
}

/**
 * Turn one search node into a pull request's facts, following every connection that has more.
 *
 * @param value one raw pull-request node from a search page
 * @returns the pull request, its threads and its CodeRabbit review bodies, or the first read failure
 */
export async function prFacts({
  walk,
  value,
}: {
  walk: Walk;
  value: unknown;
}): Promise<Result<YieldPrFacts, GithubLiveError>> {
  const identity = prOf({ value });
  if (identity.isErr()) {
    return err(identity.error);
  }
  const raw = isRecord(value) ? value : {};
  const rawThreads = await allNodes({ field: "reviewThreads", id: identity.value.id, value: raw, walk });
  if (rawThreads.isErr()) {
    return err(rawThreads.error);
  }
  const rawReviews = await allNodes({ field: "reviews", id: identity.value.id, value: raw, walk });
  if (rawReviews.isErr()) {
    return err(rawReviews.error);
  }
  const threads = await threadsOf({ nodes: rawThreads.value, walk });
  if (threads.isErr()) {
    return err(threads.error);
  }
  const bodies = coderabbitBodies({ nodes: rawReviews.value });
  if (bodies.isErr()) {
    return err(bodies.error);
  }
  return ok({ coderabbitReviewBodies: bodies.value, pr: identity.value.pr, threads: threads.value });
}
