/**
 * Whether a pull request's own diff ADDED a file — the half of `github landing --pr`'s failing-test line a job
 * log cannot answer.
 *
 * A red row should say a unit test file failed that is also a test
 * file that was added in this PR. A new test failing is the author's own unfinished work; an old one failing
 * is a regression the PR caused or a flake it inherited, and the supervisor acts differently on each.
 *
 * The REST file list (`./pullFiles.ts`'s {@link PULL_FILES_ROUTE}) is the one read that carries a per-file
 * `status`; GraphQL's `files` connection carries a path and a `changeType` but this module stays on the route
 * `github read --files` already proves. It pages, because `not-in-pr` is a claim about the WHOLE list: a path
 * absent from page one of a 300-file pull request is not known to be absent. A list cut short answers
 * `unknown` for any path it did not see, never `not-in-pr`.
 *
 * The list is read by NUMBER, so it describes whatever the branch is now. A push between two pages stitches
 * two heads' lists into one that can look whole, and a base push shifts the pages under an unchanged head, so the
 * read takes the pull request's head and base tips before paging and again after EVERY page, and refuses by name
 * unless each read shows the judged head and the first read's base — so a base that moves and moves back across
 * pages is caught. What no read can see is a move and return wholly inside one page's own request.
 */

import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type GithubLiveError, GithubLiveErrors } from "./errors.js";
import { PULL_FILES_MAX_PAGES, PULL_FILES_PER_PAGE, PULL_FILES_ROUTE } from "./pullFiles.js";
import type { GithubReadRest } from "./read.js";

/** The one pull request read, for the head the file list must still belong to once paging ends. */
const PULL_ROUTE = "GET /repos/{owner}/{repo}/pulls/{pull_number}";

/**
 * The most pages one read walks — GitHub's own ceiling for this list, so this reads every file GitHub will ever list
 * and a longer pull request is cut where GitHub cuts it. One number, owned by `./pullFiles.ts`.
 */
export const MAX_PULL_FILE_PAGES = PULL_FILES_MAX_PAGES;

/** Where a failing test file sits relative to one pull request's diff. */
export type TestFileInPr = "added" | "changed-existing" | "not-in-pr" | "unknown";

/** One pull request's changed paths with GitHub's own status for each, and whether the list was read to its end. */
export interface PullRequestFileStatuses {
  /** Path → GitHub's `status` (`added`, `modified`, `removed`, `renamed`, `copied`, `changed`, `unchanged`). */
  readonly statuses: ReadonlyMap<string, string>;
  /** Whether the last page came back short, so a path absent from {@link statuses} is absent from the diff. */
  readonly complete: boolean;
}

/**
 * Read every changed file of one pull request with its status, one page at a time.
 *
 * @param rest the safe-wrapped REST seam
 * @param number the pull request number
 * @param head the head commit the caller judged, which the list must still describe when paging ends
 * @param maxPages the most pages to walk before reporting the list incomplete
 * @returns the path statuses and whether the list was exhausted, or the failure that stopped the read — a moved
 *   head among them
 */
export async function readPullRequestFileStatuses({
  rest,
  owner,
  repo,
  number,
  head,
  maxPages,
}: {
  rest: GithubReadRest;
  owner: string;
  repo: string;
  number: number;
  head: string;
  maxPages: number;
}): Promise<Result<PullRequestFileStatuses, GithubLiveError>> {
  const before = await readTips({ number, owner, repo, rest });
  if (before.isErr()) {
    return err(before.error);
  }
  const statuses = new Map<string, string>();
  let malformed = false;
  let exhausted = false;
  for (let page = 1; page <= maxPages && !exhausted; page += 1) {
    const items = await readPage({ number, owner, page, repo, rest });
    if (items.isErr()) {
      return err(items.error);
    }
    const whole = items.value.map((item) => recordFileEntry({ item, statuses }));
    malformed = whole.includes(false) || malformed;
    exhausted = items.value.length < PULL_FILES_PER_PAGE;
    // After EVERY page, the last and a page-capped one included: an ADDED status is a positive claim even on a
    // list cut short, and only a tip read between each pair of pages sees a base that moved and moved back.
    const still = await tipsStill({ before: before.value, head, number, owner, repo, rest });
    if (still.isErr()) {
      return err(still.error);
    }
  }
  return ok({ complete: exhausted && !malformed, statuses });
}

/** Whether the tips read now are still `before`, with the judged head — as a failure naming what moved when not. */
async function tipsStill({
  rest,
  owner,
  repo,
  number,
  head,
  before,
}: {
  rest: GithubReadRest;
  owner: string;
  repo: string;
  number: number;
  head: string;
  before: PullTips;
}): Promise<Result<true, GithubLiveError>> {
  const after = await readTips({ number, owner, repo, rest });
  if (after.isErr()) {
    return err(after.error);
  }
  const moved = tipsMoved({ after: after.value, before, head, identity: `${owner}/${repo}#${String(number)}` });
  return moved === undefined ? ok(true) : err(GithubLiveErrors.readFailed({ message: moved }));
}

/** A pull request's head and base tips, the pair its changed-file list is computed between. */
interface PullTips {
  readonly head: string;
  readonly base: string;
}

/**
 * Why a list read between `before` and `after` cannot be one diff's list — the head is not the judged one, or the
 * base moved, which shifts the list's pages under the same head — or `undefined` when it is.
 */
function tipsMoved({
  head,
  before,
  after,
  identity,
}: {
  head: string;
  before: PullTips;
  after: PullTips;
  identity: string;
}): string | undefined {
  const movedTo = [before.head, after.head].find((now) => now !== head);
  if (movedTo !== undefined) {
    return `${identity}'s head moved from ${head} to ${movedTo} while its file list was read`;
  }
  if (before.base !== after.base) {
    return `${identity}'s base moved from ${before.base} to ${after.base} while its file list was read, so its pages may describe two diffs`;
  }
  return undefined;
}

/** One page of the file list, as the raw entries GitHub answered, or a failure when it answered no list. */
async function readPage({
  rest,
  owner,
  repo,
  number,
  page,
}: {
  rest: GithubReadRest;
  owner: string;
  repo: string;
  number: number;
  page: number;
}): Promise<Result<readonly unknown[], GithubLiveError>> {
  const answered = await rest({
    params: { owner, page, per_page: PULL_FILES_PER_PAGE, pull_number: number, repo },
    route: PULL_FILES_ROUTE,
  });
  if (answered.isErr()) {
    return err(answered.error);
  }
  const body = isRecord(answered.value) ? answered.value["data"] : undefined;
  if (!Array.isArray(body)) {
    return err(
      GithubLiveErrors.readFailed({
        message: `GitHub answered page ${String(page)} of ${owner}/${repo}#${String(number)}'s file list without a list`,
      }),
    );
  }
  const items: readonly unknown[] = body;
  return ok(items);
}

/**
 * Record one file-list entry's path and status, and a rename's old path beside it. Answers whether the entry was
 * whole: one this read cannot name may be the very path a log names, and a rename missing its old path hides a
 * touched one, so either leaves no absence provable.
 */
function recordFileEntry({ item, statuses }: { item: unknown; statuses: Map<string, string> }): boolean {
  if (!isRecord(item) || typeof item["filename"] !== "string" || typeof item["status"] !== "string") {
    return false;
  }
  statuses.set(item["filename"], item["status"]);
  if (item["status"] !== "renamed") {
    return true;
  }
  // A rename's OLD path is touched too, and a log run before the rename names that one.
  if (typeof item["previous_filename"] !== "string") {
    return false;
  }
  statuses.set(item["previous_filename"], "renamed-from");
  return true;
}

/** One pull request's current head and base tips, or a failure naming the tip GitHub did not answer. */
async function readTips({
  rest,
  owner,
  repo,
  number,
}: {
  rest: GithubReadRest;
  owner: string;
  repo: string;
  number: number;
}): Promise<Result<PullTips, GithubLiveError>> {
  const answered = await rest({ params: { owner, pull_number: number, repo }, route: PULL_ROUTE });
  if (answered.isErr()) {
    return err(answered.error);
  }
  const data = isRecord(answered.value) ? answered.value["data"] : undefined;
  const head = tipSha({ data, side: "head" });
  const base = tipSha({ data, side: "base" });
  if (head === undefined || base === undefined) {
    const side = head === undefined ? "head" : "base";
    return err(
      GithubLiveErrors.readFailed({
        message: `GitHub answered ${owner}/${repo}#${String(number)} without a ${side} sha`,
      }),
    );
  }
  return ok({ base, head });
}

/** One side's commit sha off a pull request body, when GitHub carried it. */
function tipSha({ data, side }: { data: unknown; side: "head" | "base" }): string | undefined {
  const node = isRecord(data) ? data[side] : undefined;
  const sha = isRecord(node) ? node["sha"] : undefined;
  return typeof sha === "string" ? sha : undefined;
}

/** GitHub's statuses that change an existing path, plus this read's own mark for a rename's old path. */
const CHANGING_STATUSES: ReadonlySet<string> = new Set([
  "changed",
  "copied",
  "modified",
  "removed",
  "renamed",
  "renamed-from",
]);

/**
 * Where one path sits relative to the diff: `added` only on GitHub's own `added` status, `changed-existing` only on a
 * status that changes the file, `not-in-pr` only when the whole list was read and the path is absent from it or
 * listed `unchanged`. A status this read does not know is `unknown`, never a guess either way.
 *
 * @param path the repository-relative path a job log named
 * @param files the pull request's file statuses, or `undefined` when they could not be read
 * @returns the classification, `unknown` whenever the read cannot support a stronger one
 */
export function testFileInPr({
  path,
  files,
}: {
  path: string;
  files: PullRequestFileStatuses | undefined;
}): TestFileInPr {
  if (files === undefined) {
    return "unknown";
  }
  const status = files.statuses.get(path);
  if (status === "added") {
    return "added";
  }
  if (status !== undefined && status !== "unchanged") {
    return CHANGING_STATUSES.has(status) ? "changed-existing" : "unknown";
  }
  return files.complete ? "not-in-pr" : "unknown";
}
