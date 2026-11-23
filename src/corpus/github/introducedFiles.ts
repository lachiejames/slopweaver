/**
 * The paths a pull request INTRODUCES — added, renamed-to or copied-to — for `github ready`'s new-file checks.
 * Split out of `./writeReview.ts` (file-size ratchet) when the tree fallback past GitHub's 3,000-file list
 * joined the REST listing.
 */
import type { IngestError } from "../../lib/ingestError.js";
import { isRecord } from "../../lib/parsers.js";
import { safeProviderCall } from "../../lib/providerCall.js";
import { okAsync, type ResultAsync } from "../../lib/result.js";
import { headTreeShaOf, mergeBaseTreeShaOf, type PullTips, pullShas, refuseIfMoved } from "./introducedFilesAnswers.js";
import type { PrRef, WriteCtx } from "./write.js";
import { DIFF_FILES_PAGE_SIZE, requiredString } from "./writeReview.js";

/** GitHub's own ceiling on `pulls.listFiles`: 3,000 files, at the largest page size, is thirty pages. */
const INTRODUCED_FILES_MAX_PAGES = 30;

/**
 * Every status GitHub documents for a pull request's changed file. A status outside it refuses, because
 * skipping it would drop a file the pull request may introduce out of a list that still reads complete.
 */
const LISTED_FILE_STATUSES: ReadonlySet<string> = new Set([
  "added",
  "removed",
  "modified",
  "renamed",
  "copied",
  "changed",
  "unchanged",
]);

/** The statuses under which a listed file is a path the pull request introduces. */
const INTRODUCED_STATUSES: ReadonlySet<string> = new Set(["added", "renamed", "copied"]);

/**
 * What the REST file list gave: every introduced path when `complete`, or a prefix when the ceiling was hit, with the
 * base and head tips read before the list, which the tree read that follows a prefix must still find.
 */
interface ListedIntroducedFiles {
  readonly complete: boolean;
  readonly paths: readonly string[];
  readonly tips: PullTips;
}

/** One entry of a recursive git tree, reduced to what the introduced-path subtraction reads. */
interface IntroducedTreeEntry {
  readonly path: string;
  readonly type: "blob" | "commit" | "tree";
}

/** The `git.getTree` response body, as the SDK types it. */
type GitTreeResponse = Awaited<ReturnType<WriteCtx["client"]["rest"]["git"]["getTree"]>>["data"];

/**
 * The content paths present at a pull request's head and absent at its merge base, in head-tree order.
 *
 * Comparing PATHS, not object ids, is what makes this GitHub's `added` + `renamed` + `copied`: a renamed or
 * copied file's filename is a path new at the head, while a modified file keeps its path. Directories are
 * not content; a submodule (`commit`) and a symlink (a blob) are.
 *
 * @param mergeBaseTree the recursive tree of the merge base — never the base branch's tip, which would count
 *   work landed on the base after the fork as removed rather than ignore it
 * @param headTree the recursive tree of the head commit
 * @returns the introduced paths
 * @internal
 */
export function introducedPathsFromTrees({
  mergeBaseTree,
  headTree,
}: {
  mergeBaseTree: readonly IntroducedTreeEntry[];
  headTree: readonly IntroducedTreeEntry[];
}): readonly string[] {
  const atMergeBase = new Set(mergeBaseTree.filter((entry) => entry.type !== "tree").map((entry) => entry.path));
  return headTree.filter((entry) => entry.type !== "tree" && !atMergeBase.has(entry.path)).map((entry) => entry.path);
}

/**
 * A recursive tree's entries, refused whole when GitHub truncated it, answered for a different tree than the
 * one asked for, or carries a malformed entry.
 */
function completeTreeEntries({
  data,
  number,
  requestedSha,
  subject,
}: {
  data: GitTreeResponse;
  number: number;
  /** The tree SHA the request named, which the response must echo back as its own. */
  requestedSha: string;
  subject: "merge base" | "head";
}): readonly IntroducedTreeEntry[] {
  // Read as `unknown`: the SDK's type is a promise about the payload, and a policy over every path cannot
  // trust a promise it did not check.
  const body: unknown = data;
  const truncated = isRecord(body) ? body["truncated"] : undefined;
  const entries = isRecord(body) ? body["tree"] : undefined;
  if (typeof truncated !== "boolean" || !Array.isArray(entries)) {
    throw new Error(
      `GitHub returned a ${subject} tree for pull request #${String(number)} with no entry list or no word on whether it is truncated, so its introduced paths cannot all be read`,
    );
  }
  const answeredSha = isRecord(body) ? body["sha"] : undefined;
  if (answeredSha !== requestedSha) {
    throw new Error(
      `GitHub answered the ${subject} tree request for pull request #${String(number)} with a different tree than ${requestedSha}, so its introduced paths cannot be trusted`,
    );
  }
  if (truncated) {
    throw new Error(
      `GitHub returned a truncated recursive ${subject} tree for pull request #${String(number)}, so its introduced paths cannot all be read`,
    );
  }
  // A git tree names each path once, so a repeated path is a malformed answer, never two facts to pick between.
  const seen = new Set<string>();
  return entries.map((entry: unknown, index): IntroducedTreeEntry => {
    const path = isRecord(entry) ? entry["path"] : undefined;
    const type = isRecord(entry) ? entry["type"] : undefined;
    const wellFormed =
      typeof path === "string" && path.length > 0 && (type === "blob" || type === "commit" || type === "tree");
    if (!wellFormed || seen.has(path)) {
      throw new Error(
        `GitHub returned a malformed entry ${String(index)} in the ${subject} tree for pull request #${String(number)}`,
      );
    }
    seen.add(path);
    return { path, type };
  });
}

/**
 * Checks one page of the REST file list and appends the paths it introduces to `paths`, recording every listed
 * path in `seen`. A missing or undocumented status, a missing filename, or a path already seen refuses.
 */
function collectIntroducedPage({
  files,
  number,
  page,
  paths,
  seen,
}: {
  files: readonly unknown[];
  number: number;
  page: number;
  paths: string[];
  seen: Set<string>;
}): void {
  for (const file of files) {
    // Read through `requiredString`, never trusted from the SDK type: an entry with no status would
    // otherwise fall through every comparison and drop silently out of the list.
    const status = requiredString({
      context: `a changed file on page ${String(page)} of pull request #${String(number)}`,
      field: "status",
      value: file,
    });
    if (!LISTED_FILE_STATUSES.has(status)) {
      throw new Error(
        `GitHub listed ${status} as the status of a changed file on page ${String(page)} of pull request #${String(number)}, a status it does not document, so its introduced paths cannot be trusted`,
      );
    }
    const filename = requiredString({
      context: `a changed file on page ${String(page)} of pull request #${String(number)}`,
      field: "filename",
      value: file,
    });
    // A path listed twice, under any two statuses, is a listing that cannot be trusted.
    if (seen.has(filename)) {
      throw new Error(
        `GitHub listed ${filename} twice on pull request #${String(number)}, so its introduced paths cannot be trusted`,
      );
    }
    seen.add(filename);
    if (INTRODUCED_STATUSES.has(status)) {
      paths.push(filename);
    }
  }
}

/**
 * The REST file list, read to its end or to GitHub's 3,000-file ceiling, whichever comes first.
 *
 * The list pages by number, never by SHA, so a push to either side mid-read would splice two lists into one.
 * Base and head are read on both sides of the list, and a list that straddles a move refuses.
 *
 * The residue, stated: a tip force-pushed away and back to the exact SHA it held, both between the two pull reads,
 * reads as unmoved, because a page carries no revision of its own to check. Only the tree read below, which names
 * every SHA it reads, is immune to it.
 */
function listedIntroducedFilesVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: PrRef;
}): ResultAsync<ListedIntroducedFiles, IngestError> {
  const { owner, repo, number } = input;
  return safeProviderCall({
    execute: async (): Promise<ListedIntroducedFiles> => {
      const apiBaseUrl = ctx.client.request.endpoint.DEFAULTS.baseUrl;
      const before = await ctx.client.rest.pulls.get({ owner, pull_number: number, repo });
      const tipsBefore = pullShas({ apiBaseUrl, input, pull: before.data });
      const paths: string[] = [];
      const seen = new Set<string>();
      for (let page = 1; page <= INTRODUCED_FILES_MAX_PAGES; page += 1) {
        const res = await ctx.client.rest.pulls.listFiles({
          owner,
          page,
          per_page: DIFF_FILES_PAGE_SIZE,
          pull_number: number,
          repo,
        });
        collectIntroducedPage({ files: res.data, number, page, paths, seen });
        if (res.data.length < DIFF_FILES_PAGE_SIZE) {
          const after = await ctx.client.rest.pulls.get({ owner, pull_number: number, repo });
          refuseIfMoved({
            number,
            read: "its file list was",
            tipsAfter: pullShas({ apiBaseUrl, input, pull: after.data }),
            tipsBefore,
          });
          return { complete: true, paths, tips: tipsBefore };
        }
      }
      return { complete: false, paths, tips: tipsBefore };
    },
    operation: "github.pulls.listFiles",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  });
}

/**
 * Every introduced path from git trees: the head's content paths minus the merge base's.
 *
 * Exact SHAs throughout, so a branch moving mid-read cannot mix two states: the pull request's own base and
 * head SHAs, the comparison's merge base, and the head commit's own tree. Its first read must find the tips the
 * file list began from, so a move between the two reads refuses like a move within either.
 *
 * @param listedTips the base and head tips read before the file list this read replaces
 */
function introducedFilesFromTreesVia({
  ctx,
  input,
  listedTips,
}: {
  ctx: WriteCtx;
  input: PrRef;
  listedTips: PullTips;
}): ResultAsync<readonly string[], IngestError> {
  const { owner, repo, number } = input;
  return safeProviderCall({
    execute: async () => {
      const apiBaseUrl = ctx.client.request.endpoint.DEFAULTS.baseUrl;
      const pull = await ctx.client.rest.pulls.get({ owner, pull_number: number, repo });
      const { baseSha, headSha } = pullShas({ apiBaseUrl, input, pull: pull.data });
      refuseIfMoved({
        number,
        read: "its file list was",
        tipsAfter: { baseSha, headSha },
        tipsBefore: listedTips,
      });
      const comparison = await ctx.client.rest.repos.compareCommitsWithBasehead({
        basehead: `${baseSha}...${headSha}`,
        owner,
        repo,
      });
      const mergeBaseTreeSha = mergeBaseTreeShaOf({ apiBaseUrl, baseSha, comparison: comparison.data, headSha, input });
      const headCommit = await ctx.client.rest.git.getCommit({ commit_sha: headSha, owner, repo });
      const headTreeSha = headTreeShaOf({ commit: headCommit.data, headSha, number });
      const [mergeBaseTree, headTree] = await Promise.all([
        ctx.client.rest.git.getTree({ owner, recursive: "true", repo, tree_sha: mergeBaseTreeSha }),
        ctx.client.rest.git.getTree({ owner, recursive: "true", repo, tree_sha: headTreeSha }),
      ]);
      const introduced = introducedPathsFromTrees({
        headTree: completeTreeEntries({ data: headTree.data, number, requestedSha: headTreeSha, subject: "head" }),
        mergeBaseTree: completeTreeEntries({
          data: mergeBaseTree.data,
          number,
          requestedSha: mergeBaseTreeSha,
          subject: "merge base",
        }),
      });
      // Exact SHAs keep the answer consistent, never current: a tip that moved during the read refuses.
      const after = await ctx.client.rest.pulls.get({ owner, pull_number: number, repo });
      refuseIfMoved({
        number,
        read: "its trees were",
        tipsAfter: pullShas({ apiBaseUrl, input, pull: after.data }),
        tipsBefore: { baseSha, headSha },
      });
      return introduced;
    },
    operation: "github.pullRequest.introducedFilesFromTrees",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  });
}

/**
 * Every path a pull request INTRODUCES — GitHub's `added`, `renamed` and `copied` files — read to completion.
 *
 * Unlike {@link diffFilesVia} this is not bounded by what a caller needs: a policy judging whether ANY
 * introduced path is forbidden cannot pass on a partial list. The REST list serves an ordinary pull request
 * in one request; a full thirtieth page, GitHub's 3,000-file ceiling, cannot say whether more follow, so the
 * answer then comes whole from the merge-base and head trees instead, and a truncated tree fails.
 *
 * @returns the introduced paths, or the provider failure
 */
export function introducedFilesVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: PrRef;
}): ResultAsync<readonly string[], IngestError> {
  return listedIntroducedFilesVia({ ctx, input }).andThen((listed) => {
    if (listed.complete) {
      return okAsync(listed.paths);
    }
    return introducedFilesFromTreesVia({ ctx, input, listedTips: listed.tips });
  });
}
