/**
 * The checks `./introducedFiles.ts` runs on each GitHub answer before trusting it: the answer must name the
 * exact pull request or range that was asked for, and a pull request's tips must not move across a read.
 * Pure, so every GitHub call stays inside the reader's own `safeProviderCall`.
 */
import type { PrRef } from "./write.js";
import { requiredString } from "./writeReview.js";

/**
 * Whether an answer's URL is exactly `path` under the API base URL the request went to: same origin, same base path,
 * then the requested path. A path match alone would accept the same route on another host.
 */
function namesRequest({ apiBaseUrl, path, url }: { apiBaseUrl: string; path: string; url: string }): boolean {
  if (!URL.canParse(url) || !URL.canParse(apiBaseUrl)) {
    return false;
  }
  const answered = new URL(url);
  const base = new URL(apiBaseUrl);
  return answered.origin === base.origin && answered.pathname === `${base.pathname.replace(/\/$/, "")}${path}`;
}

/** What a `pulls.get` answer is read for here: its two tips and the URL naming the pull it answered. */
type PullAnswer = { base: unknown; head: unknown; url?: unknown };

/**
 * A pull request's base and head SHAs, from a `pulls.get` answer whose URL must name the requested pull.
 *
 * @param apiBaseUrl the API base URL the client sent the request to, which the answer's URL must sit under
 * @param pull the `pulls.get` response body
 * @returns the base and head SHAs
 */
export function pullShas({ apiBaseUrl, input, pull }: { apiBaseUrl: string; input: PrRef; pull: PullAnswer }): {
  baseSha: string;
  headSha: string;
} {
  const { owner, repo, number } = input;
  const subject = `pull request #${String(number)}`;
  const pullUrl = requiredString({ context: subject, field: "url", value: pull });
  const requestedPath = `/repos/${owner}/${repo}/pulls/${String(number)}`;
  if (!namesRequest({ apiBaseUrl, path: requestedPath, url: pullUrl })) {
    throw new Error(
      `GitHub answered the request for ${subject} of ${owner}/${repo} with ${pullUrl}, so its introduced paths cannot be trusted`,
    );
  }
  return {
    baseSha: requiredString({ context: `${subject}'s base`, field: "sha", value: pull.base }),
    headSha: requiredString({ context: `${subject}'s head`, field: "sha", value: pull.head }),
  };
}

/** A pull request's two tips, compared side by side: a joined `base...head` string is not one-to-one. */
export type PullTips = { readonly baseSha: string; readonly headSha: string };

/**
 * Refuses when the tips read after `read` differ from `tipsBefore`, comparing base with base and head with head.
 *
 * @param read what was read between the two tip reads, completing "while … read"
 */
export function refuseIfMoved({
  number,
  read,
  tipsAfter,
  tipsBefore,
}: {
  number: number;
  read: string;
  tipsAfter: PullTips;
  tipsBefore: PullTips;
}): void {
  if (tipsAfter.baseSha !== tipsBefore.baseSha || tipsAfter.headSha !== tipsBefore.headSha) {
    const before = `${tipsBefore.baseSha}...${tipsBefore.headSha}`;
    const after = `${tipsAfter.baseSha}...${tipsAfter.headSha}`;
    throw new Error(
      `pull request #${String(number)} moved from ${before} to ${after} while ${read} read, so its introduced paths cannot be trusted`,
    );
  }
}

/**
 * The head commit's tree, from a `git.getCommit` answer that must name the head commit that was requested.
 *
 * @param commit the `git.getCommit` response body
 * @param headSha the pull request's head SHA the commit was requested by
 * @returns the head tree SHA
 */
export function headTreeShaOf({
  commit,
  headSha,
  number,
}: {
  commit: { sha: unknown; tree: unknown };
  headSha: string;
  number: number;
}): string {
  const subject = `pull request #${String(number)}`;
  if (commit.sha !== headSha) {
    throw new Error(
      `GitHub answered the head commit request for ${subject} with a different commit than ${headSha}, so its introduced paths cannot be trusted`,
    );
  }
  return requiredString({ context: `${subject}'s head tree`, field: "sha", value: commit.tree });
}

/**
 * The merge-base tree of `baseSha...headSha`, from a comparison that must answer for that exact base.
 *
 * @param apiBaseUrl the API base URL the client sent the request to, which the answer's URL must sit under
 * @param comparison the `repos.compareCommitsWithBasehead` response body
 * @returns the merge-base tree SHA
 */
export function mergeBaseTreeShaOf({
  apiBaseUrl,
  baseSha,
  comparison,
  headSha,
  input,
}: {
  apiBaseUrl: string;
  baseSha: string;
  comparison: { base_commit: unknown; merge_base_commit: { commit: { tree: unknown } } };
  headSha: string;
  input: PrRef;
}): string {
  const { owner, repo, number } = input;
  const subject = `pull request #${String(number)}`;
  const comparedBase = requiredString({
    context: `${subject}'s comparison base`,
    field: "sha",
    value: comparison.base_commit,
  });
  // The response names no head commit of its own; its URL echoes the exact `base...head` it answered.
  const comparedUrl = requiredString({ context: `${subject}'s comparison`, field: "url", value: comparison });
  const requestedPath = `/repos/${owner}/${repo}/compare/${baseSha}...${headSha}`;
  const answersRequest =
    comparedBase === baseSha && namesRequest({ apiBaseUrl, path: requestedPath, url: comparedUrl });
  if (!answersRequest) {
    throw new Error(
      `GitHub answered the comparison for ${subject} for a different range than ${baseSha}...${headSha}, so its introduced paths cannot be trusted`,
    );
  }
  return requiredString({
    context: `${subject}'s merge-base tree`,
    field: "sha",
    value: comparison.merge_base_commit.commit.tree,
  });
}
