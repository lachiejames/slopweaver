/**
 * The one GitHub read the board sweep makes: what each pull request a live ask's QUESTION names reads as now, for
 * the `PR_ENDED` verdict (`../../../sweep/endedPullRequest.ts`).
 *
 * **What it costs.** One small GraphQL query per DISTINCT pull request named by a live, unattended ask's question —
 * never one per row and never one per board doc — in batches of {@link READ_CONCURRENCY}, and `--settle-ended`'s
 * re-classification reuses every successful read ({@link rememberedFetch}). A read that fails leaves that row at the
 * verdict the board alone gives it and is printed, never swallowed: a GitHub outage must not stop the hygiene
 * documents, and an unread pull request is never read as ended.
 */
import { githubToken } from "../../../config.js";
import { type BoardModel } from "../../../handover/boardTypes.js";
import { ok } from "../../../lib/result.js";
import { type FetchPrClosure, makeFetchPrClosure, type PrClosure } from "../../../live/github/prClosure.js";
import { githubReadGraphql } from "../../../live/github/read.js";
import { pullRequestKey, type QuestionPullRequest, questionPullRequests } from "../../../sweep/endedPullRequest.js";

/** How many closure reads are in flight at once — a small pool, so a long board is not a burst. */
const READ_CONCURRENCY = 4;

/** What one pass read: each pull request's state, and a line per read that failed. */
export interface EndedReads {
  readonly closures: ReadonlyMap<string, PrClosure>;
  readonly unread: readonly string[];
  /** How many distinct pull requests were asked for. */
  readonly asked: number;
}

/**
 * Every distinct pull request named by the question of a row this check reads.
 *
 * @param models the live rows the pass classifies
 * @returns the pull requests to read, deduped by {@link pullRequestKey}
 */
function distinctPullRequests({ models }: { models: readonly BoardModel[] }): readonly QuestionPullRequest[] {
  const byKey = new Map<string, QuestionPullRequest>();
  models.forEach((model) => {
    questionPullRequests({ model }).forEach((pr) => {
      byKey.set(pullRequestKey({ pr }), pr);
    });
  });
  return [...byKey.values()];
}

/**
 * Read every pull request a live ask's question names.
 *
 * @param models the live rows the pass classifies
 * @param fetch the closure seam — GitHub in production, a fake in a test
 * @returns the closures keyed by {@link pullRequestKey}, and the reads that failed
 */
export async function readEndedPullRequests({
  models,
  fetch,
}: {
  models: readonly BoardModel[];
  fetch: FetchPrClosure;
}): Promise<EndedReads> {
  const wanted = distinctPullRequests({ models });
  const closures = new Map<string, PrClosure>();
  const unread: string[] = [];
  for (let start = 0; start < wanted.length; start += READ_CONCURRENCY) {
    const batch = wanted.slice(start, start + READ_CONCURRENCY);
    const answers = await Promise.all(batch.map(async (pr) => ({ answer: await fetch(pr), pr })));
    answers.forEach(({ pr, answer }) => {
      const key = pullRequestKey({ pr });
      if (answer.isErr()) {
        unread.push(`${key}: ${answer.error.message}`);
        return;
      }
      closures.set(key, answer.value);
    });
  }
  return { asked: wanted.length, closures, unread };
}

/**
 * The closure seam answering each pull request from its first read — so `--settle-ended`'s re-classification
 * after it acts costs no second GitHub read. A failed read is not kept, so the re-classification asks again.
 *
 * @param fetch the seam to remember
 * @returns the same seam, read at most once per pull request while it succeeds
 */
export function rememberedFetch({ fetch }: { fetch: FetchPrClosure }): FetchPrClosure {
  const seen = new Map<string, PrClosure>();
  return async (pr) => {
    const key = pullRequestKey({ pr });
    const known = seen.get(key);
    if (known !== undefined) {
      return ok(known);
    }
    const answer = await fetch(pr);
    if (answer.isOk()) {
      seen.set(key, answer.value);
    }
    return answer;
  };
}

/**
 * The production closure seam over the home's GitHub token — the same transport `github landing --register`'s
 * closure read uses.
 *
 * @param home the state home whose token is read
 * @returns the closure fetcher
 */
export function productionFetchPrClosure({ home }: { home: string }): FetchPrClosure {
  return makeFetchPrClosure({ graphql: githubReadGraphql({ token: githubToken({ home }) }) });
}
