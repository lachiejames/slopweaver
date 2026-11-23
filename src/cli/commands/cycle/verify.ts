/**
 * The `--verify` leg: read live, through the door, the pull requests the local corpus cannot resolve.
 *
 * Why it exists rather than being the default: measured on the real home, only 15 of the 25
 * pull requests attached to the owner's stale current-cycle tickets are in GitHub bronze — the rest predate
 * the ingest window. Without this the card says "cannot see the state of" for ten tickets, four of which are
 * in fact straight closes. With it the card is true, at the cost of one bounded read per unresolved URL.
 *
 * Bounded on purpose: it reads ONLY the URLs already attached to a ticket this pass selected, never a search
 * and never a crawl, and it stops at {@link VERIFY_MAX} so a corpus that has drifted far cannot turn a daily
 * card into an unbounded fan-out.
 */

import { githubToken } from "../../../config.js";
import type { PullRequestState } from "../../../cycle/classify.js";
import type { CycleIssue } from "../../../cycle/issue.js";
import { isRecord } from "../../../lib/parsers.js";
import { githubReadGraphql, readGithubObject } from "../../../live/github/read.js";

/**
 * How many live reads one verify pass may make. A daily card is not a backfill.
 *
 * @internal — the bound {@link verifyUnresolvedPullRequests} applies; no caller outside this module names it.
 */
export const VERIFY_MAX = 40;

/**
 * What one verify pass resolved, and what it could not.
 *
 * @internal — the shape {@link verifyUnresolvedPullRequests} returns; no caller names it directly.
 */
export interface VerifyOutcome {
  readonly states: ReadonlyMap<string, PullRequestState>;
  /** URLs that were attempted and still could not be resolved, so the card can say so rather than guess. */
  readonly stillUnknown: readonly string[];
  readonly attempted: number;
}

/** Read one GitHub object live — the production reader's own contract, so a substitute cannot drift from it. */
export type VerifyGithubReader = typeof readGithubObject;

/** A GitHub pull-request URL — the only thing this leg will ever read. */
const PULL_REQUEST_URL = /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/;

/** One live document's `state`/`merged` reduced to the same vocabulary bronze uses. */
function stateOf({ data }: { data: unknown }): PullRequestState | undefined {
  if (!isRecord(data)) {
    return undefined;
  }
  if (data["merged"] === true) {
    return "MERGED";
  }
  const state = data["state"];
  if (state === "MERGED" || state === "CLOSED" || state === "OPEN") {
    return state;
  }
  return undefined;
}

/** Every attached pull-request URL the corpus could not resolve, deduped, in first-seen order. */
function unresolvedUrls({
  issues,
  known,
}: {
  issues: readonly CycleIssue[];
  known: ReadonlyMap<string, PullRequestState>;
}): readonly string[] {
  const wanted = new Set<string>();
  for (const issue of issues) {
    const attached = issue.attachmentUrls.filter((url) => PULL_REQUEST_URL.test(url) && !known.has(url));
    for (const url of attached) {
      wanted.add(url);
    }
  }
  return [...wanted];
}

/**
 * Resolve, live, every attached pull request the corpus could not.
 *
 * @param issues the owner's issues this pass is considering
 * @param known what the corpus already resolved, so nothing is read twice
 * @param home the state home whose credential is used
 * @param read how one pull request is read live; omitted, through the GitHub door
 * @returns the newly resolved states, plus every URL that stayed unknown
 */
export async function verifyUnresolvedPullRequests({
  issues,
  known,
  home,
  read: readObject = readGithubObject,
}: {
  issues: readonly CycleIssue[];
  known: ReadonlyMap<string, PullRequestState>;
  home: string;
  read?: VerifyGithubReader;
}): Promise<VerifyOutcome> {
  const wanted = unresolvedUrls({ issues, known });
  const targets = wanted.slice(0, VERIFY_MAX);
  const graphql = githubReadGraphql({ token: githubToken({ home }) });
  const nowIso = (): string => new Date().toISOString();
  const states = new Map<string, PullRequestState>();
  const stillUnknown: string[] = [];
  for (const url of targets) {
    const read = await readObject({ address: url, graphql, limit: 1, nowIso });
    const state = read.isOk() ? stateOf({ data: read.value.data }) : undefined;
    if (state === undefined) {
      stillUnknown.push(url);
      continue;
    }
    states.set(url, state);
  }
  stillUnknown.push(...wanted.slice(VERIFY_MAX));
  return { attempted: targets.length, states, stillUnknown };
}
