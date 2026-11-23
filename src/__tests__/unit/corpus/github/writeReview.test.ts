/**
 * The self-review round operations through a real Octokit whose transport is a plain fake `fetch` recording
 * each request: the review mutation's variables and its read-back validation, the bounded thread snapshot,
 * the five-page changed-file walk, and the introduced-path filter, which past GitHub's 3,000-file list ceiling
 * answers from the merge-base and head trees and refuses a truncated one.
 */
import { Octokit } from "@octokit/rest";
import { describe, expect, it } from "vitest";

import { introducedFilesVia, introducedPathsFromTrees } from "../../../../corpus/github/introducedFiles.js";
import type { WriteCtx } from "../../../../corpus/github/writeCtx.js";
import { diffFilesVia, reviewThreadsVia, submitReviewRoundVia } from "../../../../corpus/github/writeReview.js";
import { isRecord } from "../../../../lib/parsers.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

/** One request as the fake transport saw it. */
interface SentRequest {
  readonly method: string;
  readonly url: string;
  readonly body: unknown;
}

/** Decides the fake transport's 200 JSON answer to one recorded request. */
type Responder = (request: SentRequest) => unknown;

/** Contexts minted so far — each gets its own rate scope, so one test's paced write never delays the next. */
let contextsMinted = 0;

/** A write context whose transport records every request and answers it 200 with `respond`'s JSON. */
function routedCtx({ sent, respond }: { sent: SentRequest[]; respond: Responder }): WriteCtx {
  contextsMinted += 1;
  const fetch: typeof globalThis.fetch = async (url, init) => {
    const body = init?.body;
    const request: SentRequest = {
      body: typeof body === "string" ? JSON.parse(body) : undefined,
      method: String(init?.method),
      url: url instanceof Request ? url.url : url.toString(),
    };
    sent.push(request);
    return new Response(JSON.stringify(respond(request)), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  };
  return {
    client: new Octokit({ auth: "test-token", request: { fetch } }),
    scopeId: `review-${String(contextsMinted)}`,
  };
}

/** The page number a list request asked for. */
function pageOf({ request }: { request: SentRequest }): number {
  return Number(new URL(request.url).searchParams.get("page"));
}

/** The GraphQL variables one recorded request carried. */
function variablesOf({ request }: { request: SentRequest }): unknown {
  return isRecord(request.body) ? request.body["variables"] : undefined;
}

/** The URL GitHub's pull read names for pull 42 of acme/widgets, the request every test makes. */
const PULL_URL = "https://api.github.com/repos/acme/widgets/pulls/42";

/**
 * Answers the pull request read with the next of `tips` (the last one repeating) and every file-list page
 * with `files`, the shape an introduced-file listing reads.
 */
function listResponder({
  files,
  pullUrl = PULL_URL,
  tips = [{ base: "base-tip", head: "head-sha" }],
}: {
  files: Responder;
  /** The URL the pull read answers as its own; anything but {@link PULL_URL} is another pull request. */
  pullUrl?: string;
  tips?: readonly { base: string; head: string }[];
}): Responder {
  let pullReads = 0;
  return (request) => {
    if (new URL(request.url).pathname.endsWith("/pulls/42")) {
      const tip = tips[Math.min(pullReads, tips.length - 1)]!;
      pullReads += 1;
      return { base: { sha: tip.base }, head: { sha: tip.head }, url: pullUrl };
    }
    return files(request);
  };
}

/** `count` raw changed files for one page, named from `first`. */
function rawFiles({ first, count, status }: { first: number; count: number; status: string }): unknown[] {
  return Array.from({ length: count }, (_unused, index) => ({
    filename: `f${String(first + index)}.ts`,
    patch: "@@ -1 +1 @@",
    status,
  }));
}

const PR = { number: 42, owner: "acme", repo: "widgets" };
const ROUND = {
  comments: [
    { body: "first", line: 3, path: "src/a.ts" },
    { body: "second", line: 9, path: "src/b.ts" },
  ],
  commitOid: "abc123",
  pullRequestId: "PR_9",
  resolveThreadIds: ["PRRT_a", "PRRT_b"],
};

describe("submitReviewRoundVia", () => {
  it("sends each draft on the RIGHT side, one variable per thread, the review field first, and returns its ids", async () => {
    const sent: SentRequest[] = [];
    const ctx = routedCtx({
      respond: () => ({
        data: {
          resolve0: { thread: { id: "PRRT_a", isResolved: true } },
          resolve1: { thread: { id: "PRRT_b", isResolved: true } },
          review: { pullRequestReview: { comments: { nodes: [{ id: "C_1" }, { id: "C_2" }] }, id: "PRR_1" } },
        },
      }),
      sent,
    });

    expect(unwrap(await submitReviewRoundVia({ ctx, input: ROUND }))).toEqual({
      commentIds: ["C_1", "C_2"],
      reviewId: "PRR_1",
    });
    expect(sent.length).toBe(1);
    expect(variablesOf({ request: sent[0]! })).toEqual({
      review: {
        commitOID: "abc123",
        event: "COMMENT",
        pullRequestId: "PR_9",
        threads: [
          { body: "first", line: 3, path: "src/a.ts", side: "RIGHT" },
          { body: "second", line: 9, path: "src/b.ts", side: "RIGHT" },
        ],
      },
      thread0: "PRRT_a",
      thread1: "PRRT_b",
    });
    const body = sent[0]!.body;
    const query = isRecord(body) && typeof body["query"] === "string" ? body["query"] : "";
    expect(query.indexOf("review: addPullRequestReview")).toBeGreaterThan(0);
    expect(query.indexOf("resolve0: resolveReviewThread")).toBeGreaterThan(
      query.indexOf("review: addPullRequestReview"),
    );
    expect(query.indexOf("resolve1: resolveReviewThread")).toBeGreaterThan(
      query.indexOf("resolve0: resolveReviewThread"),
    );
  });

  it("refuses a review whose comment count differs from the threads submitted", async () => {
    const ctx = routedCtx({
      respond: () => ({
        data: {
          resolve0: { thread: { id: "PRRT_a", isResolved: true } },
          resolve1: { thread: { id: "PRRT_b", isResolved: true } },
          review: { pullRequestReview: { comments: { nodes: [{ id: "C_1" }] }, id: "PRR_1" } },
        },
      }),
      sent: [],
    });

    const error = unwrapErr(await submitReviewRoundVia({ ctx, input: ROUND }));

    expect(error.message).toBe("GitHub returned 1 comment ids for 2 submitted threads");
    expect(error.operation).toBe("github.addPullRequestReview+resolveReviewThread");
  });

  it("refuses a resolution GitHub reports for a different thread, naming the one requested", async () => {
    const ctx = routedCtx({
      respond: () => ({
        data: {
          resolve0: { thread: { id: "PRRT_a", isResolved: true } },
          resolve1: { thread: { id: "PRRT_other", isResolved: true } },
          review: { pullRequestReview: { comments: { nodes: [{ id: "C_1" }, { id: "C_2" }] }, id: "PRR_1" } },
        },
      }),
      sent: [],
    });

    expect(unwrapErr(await submitReviewRoundVia({ ctx, input: ROUND })).message).toBe(
      "GitHub resolved a different thread than PRRT_b",
    );
  });
});

describe("reviewThreadsVia", () => {
  it("returns each thread's id, state and comment ids in the order GitHub sent them", async () => {
    const sent: SentRequest[] = [];
    const ctx = routedCtx({
      respond: () => ({
        data: {
          node: {
            reviewThreads: {
              nodes: [
                { comments: { nodes: [{ id: "C_1" }, { id: "C_2" }] }, id: "PRRT_a", isResolved: false },
                { comments: { nodes: [] }, id: "PRRT_b", isResolved: true },
              ],
            },
          },
        },
      }),
      sent,
    });

    expect(unwrap(await reviewThreadsVia({ ctx, input: { pullRequestId: "PR_9" } }))).toEqual([
      { commentIds: ["C_1", "C_2"], id: "PRRT_a", isResolved: false },
      { commentIds: [], id: "PRRT_b", isResolved: true },
    ]);
    expect(variablesOf({ request: sent[0]! })).toEqual({ pullRequestId: "PR_9" });
  });
});

describe("diffFilesVia", () => {
  it("maps filename and patch and stops after a short first page", async () => {
    const sent: SentRequest[] = [];
    const ctx = routedCtx({
      respond: () => [
        { filename: "src/a.ts", patch: "@@ -1 +1 @@", status: "modified" },
        { filename: "assets/logo.png", status: "added" },
      ],
      sent,
    });

    expect(unwrap(await diffFilesVia({ ctx, input: PR }))).toEqual([
      { patch: "@@ -1 +1 @@", path: "src/a.ts" },
      { patch: undefined, path: "assets/logo.png" },
    ]);
    expect(sent.map((request) => request.url)).toEqual([
      "https://api.github.com/repos/acme/widgets/pulls/42/files?page=1&per_page=100",
    ]);
  });

  it("returns the first 500 files and requests no sixth page when five pages are full", async () => {
    const sent: SentRequest[] = [];
    const ctx = routedCtx({
      respond: (request) => rawFiles({ count: 100, first: (pageOf({ request }) - 1) * 100 + 1, status: "modified" }),
      sent,
    });

    const files = unwrap(await diffFilesVia({ ctx, input: PR }));

    expect(files.map((file) => file.path)).toEqual(
      Array.from({ length: 500 }, (_u, index) => `f${String(index + 1)}.ts`),
    );
    expect(sent.map((request) => pageOf({ request }))).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("introducedFilesVia", () => {
  it("keeps added, renamed and copied paths across all seven GitHub file statuses", async () => {
    const statuses = ["added", "removed", "modified", "renamed", "copied", "changed", "unchanged"];
    const ctx = routedCtx({
      respond: listResponder({ files: () => statuses.map((status) => ({ filename: `${status}.ts`, status })) }),
      sent: [],
    });

    expect(unwrap(await introducedFilesVia({ ctx, input: PR }))).toEqual(["added.ts", "renamed.ts", "copied.ts"]);
  });

  it("reads a short thirtieth page to completion from the list alone, never reaching for the trees", async () => {
    const sent: SentRequest[] = [];
    const ctx = routedCtx({
      respond: listResponder({
        files: (request) =>
          rawFiles({
            count: pageOf({ request }) === 30 ? 99 : 100,
            first: (pageOf({ request }) - 1) * 100 + 1,
            status: "added",
          }),
      }),
      sent,
    });

    const paths = unwrap(await introducedFilesVia({ ctx, input: PR }));

    expect(paths.length).toBe(2999);
    expect(sent.map((request) => new URL(request.url).pathname)).toEqual([
      "/repos/acme/widgets/pulls/42",
      ...Array.from({ length: 30 }, () => "/repos/acme/widgets/pulls/42/files"),
      "/repos/acme/widgets/pulls/42",
    ]);
  });

  it("past a full thirtieth page, answers from the merge-base and head trees, never the base tip", async () => {
    const sent: SentRequest[] = [];
    const ctx = routedCtx({ respond: treeFallbackResponder({}), sent });

    const paths = unwrap(await introducedFilesVia({ ctx, input: PR }));

    expect(paths).toEqual(["pr-only.ts", "renamed-to.ts", "vendor/new-submodule"]);
    expect(sent.slice(31).map((request) => new URL(request.url).pathname)).toEqual([
      "/repos/acme/widgets/pulls/42",
      "/repos/acme/widgets/compare/base-tip...head-sha",
      "/repos/acme/widgets/git/commits/head-sha",
      "/repos/acme/widgets/git/trees/merge-base-tree",
      "/repos/acme/widgets/git/trees/head-tree",
      "/repos/acme/widgets/pulls/42",
    ]);
    expect(sent.slice(34, 36).map((request) => new URL(request.url).searchParams.get("recursive"))).toEqual([
      "true",
      "true",
    ]);
  });

  it.each(["merge base", "head"] as const)(
    "refuses a truncated %s tree rather than return its partial entries",
    async (subject) => {
      const ctx = routedCtx({ respond: treeFallbackResponder({ truncated: subject }), sent: [] });

      const error = unwrapErr(await introducedFilesVia({ ctx, input: PR }));

      expect(error.message).toBe(
        `GitHub returned a truncated recursive ${subject} tree for pull request #42, so its introduced paths cannot all be read`,
      );
      expect(error.operation).toBe("github.pullRequest.introducedFilesFromTrees");
    },
  );

  it("refuses a changed file the list names without a filename, rather than return it", async () => {
    const ctx = routedCtx({ respond: listResponder({ files: () => [{ status: "added" }] }), sent: [] });

    const error = unwrapErr(await introducedFilesVia({ ctx, input: PR }));

    expect(error.message).toBe("GitHub returned no filename for a changed file on page 1 of pull request #42");
    expect(error.operation).toBe("github.pulls.listFiles");
  });

  it("refuses a changed file under a status GitHub does not document, rather than skip it", async () => {
    const ctx = routedCtx({
      respond: listResponder({ files: () => [{ filename: "new.ts", status: "adedd" }] }),
      sent: [],
    });

    const error = unwrapErr(await introducedFilesVia({ ctx, input: PR }));

    expect(error.message).toBe(
      "GitHub listed adedd as the status of a changed file on page 1 of pull request #42, a status it does not document, so its introduced paths cannot be trusted",
    );
    expect(error.operation).toBe("github.pulls.listFiles");
  });

  it.each(["added", "modified"])(
    "refuses a path the list names twice, once as %s, rather than trust either",
    async (first) => {
      const ctx = routedCtx({
        respond: listResponder({
          files: () => [
            { filename: "dup.ts", status: first },
            { filename: "dup.ts", status: "added" },
          ],
        }),
        sent: [],
      });

      const error = unwrapErr(await introducedFilesVia({ ctx, input: PR }));

      expect(error.message).toBe(
        "GitHub listed dup.ts twice on pull request #42, so its introduced paths cannot be trusted",
      );
      expect(error.operation).toBe("github.pulls.listFiles");
    },
  );

  it.each([
    { moved: { base: "base-tip", head: "moved-sha" }, side: "head" },
    { moved: { base: "moved-base", head: "head-sha" }, side: "base" },
  ])("refuses a list read while the pull request's $side moved, rather than splice the two", async ({ moved }) => {
    const ctx = routedCtx({
      respond: listResponder({
        files: () => [{ filename: "new.ts", status: "added" }],
        tips: [{ base: "base-tip", head: "head-sha" }, moved],
      }),
      sent: [],
    });

    const error = unwrapErr(await introducedFilesVia({ ctx, input: PR }));

    expect(error.message).toBe(
      `pull request #42 moved from base-tip...head-sha to ${moved.base}...${moved.head} while its file list was read, so its introduced paths cannot be trusted`,
    );
    expect(error.operation).toBe("github.pulls.listFiles");
  });

  it.each([
    { pullUrl: "https://api.github.com/repos/other/project/pulls/42", side: "repository" },
    { pullUrl: "https://api.github.com/repos/acme/widgets/pulls/99", side: "number" },
    { pullUrl: "https://evil.example/repos/acme/widgets/pulls/42", side: "host" },
  ])("refuses a pull read GitHub answered for another $side, rather than trust its tips", async ({ pullUrl }) => {
    const ctx = routedCtx({
      respond: listResponder({ files: () => [{ filename: "foreign.ts", status: "added" }], pullUrl }),
      sent: [],
    });

    const error = unwrapErr(await introducedFilesVia({ ctx, input: PR }));

    expect(error.message).toBe(
      `GitHub answered the request for pull request #42 of acme/widgets with ${pullUrl}, so its introduced paths cannot be trusted`,
    );
    expect(error.operation).toBe("github.pulls.listFiles");
  });

  it.each([
    { answer: { compareAnswersBase: "other-base" }, side: "base" },
    { answer: { compareAnswersHead: "other-head" }, side: "head" },
    { answer: { compareAnswersRepo: "other/project" }, side: "repository" },
  ])("refuses a comparison GitHub answered for another $side, rather than trust its merge base", async ({ answer }) => {
    const ctx = routedCtx({ respond: treeFallbackResponder(answer), sent: [] });

    const error = unwrapErr(await introducedFilesVia({ ctx, input: PR }));

    expect(error.message).toBe(
      "GitHub answered the comparison for pull request #42 for a different range than base-tip...head-sha, so its introduced paths cannot be trusted",
    );
    expect(error.operation).toBe("github.pullRequest.introducedFilesFromTrees");
  });

  it("refuses a tree answer when the pull request moved while its trees were read", async () => {
    const ctx = routedCtx({ respond: treeFallbackResponder({ headAfterTrees: "moved-sha" }), sent: [] });

    const error = unwrapErr(await introducedFilesVia({ ctx, input: PR }));

    expect(error.message).toBe(
      "pull request #42 moved from base-tip...head-sha to base-tip...moved-sha while its trees were read, so its introduced paths cannot be trusted",
    );
    expect(error.operation).toBe("github.pullRequest.introducedFilesFromTrees");
  });

  it("refuses a tree answer when the pull request moved between its file list and its trees", async () => {
    const ctx = routedCtx({ respond: treeFallbackResponder({ headBeforeList: "listed-sha" }), sent: [] });

    const error = unwrapErr(await introducedFilesVia({ ctx, input: PR }));

    expect(error.message).toBe(
      "pull request #42 moved from base-tip...listed-sha to base-tip...head-sha while its file list was read, so its introduced paths cannot be trusted",
    );
    expect(error.operation).toBe("github.pullRequest.introducedFilesFromTrees");
  });

  it("refuses a changed file the list names without a status, rather than drop it from the list", async () => {
    const ctx = routedCtx({ respond: listResponder({ files: () => [{ filename: "new.ts" }] }), sent: [] });

    const error = unwrapErr(await introducedFilesVia({ ctx, input: PR }));

    expect(error.message).toBe("GitHub returned no status for a changed file on page 1 of pull request #42");
    expect(error.operation).toBe("github.pulls.listFiles");
  });

  it("refuses a tree that does not say whether it is truncated, rather than read the absence as complete", async () => {
    const ctx = routedCtx({ respond: treeFallbackResponder({ headOmitsTruncated: true }), sent: [] });

    const error = unwrapErr(await introducedFilesVia({ ctx, input: PR }));

    expect(error.message).toBe(
      "GitHub returned a head tree for pull request #42 with no entry list or no word on whether it is truncated, so its introduced paths cannot all be read",
    );
    expect(error.operation).toBe("github.pullRequest.introducedFilesFromTrees");
  });

  it("refuses a well-formed tree answered for a different SHA than the one requested", async () => {
    const ctx = routedCtx({ respond: treeFallbackResponder({ headAnswersSha: "different-tree" }), sent: [] });

    const error = unwrapErr(await introducedFilesVia({ ctx, input: PR }));

    expect(error.message).toBe(
      "GitHub answered the head tree request for pull request #42 with a different tree than head-tree, so its introduced paths cannot be trusted",
    );
    expect(error.operation).toBe("github.pullRequest.introducedFilesFromTrees");
  });

  it("refuses a head commit answered for a different SHA than the pull request's head", async () => {
    const ctx = routedCtx({ respond: treeFallbackResponder({ headCommitAnswersSha: "other-sha" }), sent: [] });

    const error = unwrapErr(await introducedFilesVia({ ctx, input: PR }));

    expect(error.message).toBe(
      "GitHub answered the head commit request for pull request #42 with a different commit than head-sha, so its introduced paths cannot be trusted",
    );
    expect(error.operation).toBe("github.pullRequest.introducedFilesFromTrees");
  });

  it.each([
    { entry: { path: 7, type: "blob" }, name: "a numeric path" },
    { entry: { path: "", type: "blob" }, name: "an empty path" },
    { entry: { path: "x.ts", type: "symlink" }, name: "an unknown type" },
    { entry: "x.ts", name: "a bare string" },
    { entry: { path: "pr-only.ts", type: "tree" }, name: "a path already listed" },
  ])("refuses a head tree entry with $name rather than return it", async ({ entry }) => {
    const ctx = routedCtx({ respond: treeFallbackResponder({ headEntry: entry }), sent: [] });

    const error = unwrapErr(await introducedFilesVia({ ctx, input: PR }));

    expect(error.message).toBe("GitHub returned a malformed entry 5 in the head tree for pull request #42");
    expect(error.operation).toBe("github.pullRequest.introducedFilesFromTrees");
  });
});

describe("introducedPathsFromTrees", () => {
  it("keeps head content paths absent at the merge base: new, renamed-to, copied-to and submodule, never a directory", () => {
    const paths = introducedPathsFromTrees({
      headTree: [
        { path: "kept.ts", type: "blob" },
        { path: "new.ts", type: "blob" },
        { path: "renamed-to.ts", type: "blob" },
        { path: "copy-of-kept.ts", type: "blob" },
        { path: "newdir", type: "tree" },
        { path: "newdir/inner.ts", type: "blob" },
        { path: "vendor/sub", type: "commit" },
      ],
      mergeBaseTree: [
        { path: "kept.ts", type: "blob" },
        { path: "renamed-from.ts", type: "blob" },
        { path: "vendor", type: "tree" },
      ],
    });

    expect(paths).toEqual(["new.ts", "renamed-to.ts", "copy-of-kept.ts", "newdir/inner.ts", "vendor/sub"]);
  });

  it("introduces nothing when the head tree holds only what the merge base did", () => {
    const tree = [{ path: "kept.ts", type: "blob" } as const];

    expect(introducedPathsFromTrees({ headTree: tree, mergeBaseTree: tree })).toEqual([]);
  });
});

/**
 * A transport for the tree fallback: every list page full, the pull request on `base-tip`/`head-sha`, a merge
 * base distinct from the base tip, and two recursive trees — one optionally truncated, carrying plausible
 * partial entries so a test proves they are not returned. Any other request throws, so a reader that read the
 * base tip's tree instead of the merge base's fails rather than passing.
 */
function treeFallbackResponder({
  truncated,
  headOmitsTruncated = false,
  headEntry,
  headAnswersSha = "head-tree",
  headCommitAnswersSha = "head-sha",
  headAfterTrees = "head-sha",
  headBeforeList = "head-sha",
  compareAnswersBase = "base-tip",
  compareAnswersHead = "head-sha",
  compareAnswersRepo = "acme/widgets",
}: {
  /** The repository the comparison response's URL names; anything but `acme/widgets` is another repository. */
  compareAnswersRepo?: string;
  /** The head the comparison response's URL names; anything but `head-sha` answers a different comparison. */
  compareAnswersHead?: string;
  /** The base SHA the comparison response names; anything but `base-tip` answers a different comparison. */
  compareAnswersBase?: string;
  /** The head a pull read answers once the listing and the fallback have each read it once. */
  headAfterTrees?: string;
  /** The head the listing's own first pull read answers, before the fallback reads it. */
  headBeforeList?: string;
  /** The SHA the head-commit response names as its own; anything but `head-sha` is a different commit. */
  headCommitAnswersSha?: string;
  truncated?: "merge base" | "head";
  headOmitsTruncated?: boolean;
  /** The SHA the head-tree response names as its own; anything but `head-tree` is a different tree. */
  headAnswersSha?: string;
  /** One more head-tree entry appended after the five valid ones, at index 5. */
  headEntry?: unknown;
}): Responder {
  const mergeBaseEntries = [
    { path: "kept.ts", sha: "1", type: "blob" },
    { path: "renamed-from.ts", sha: "2", type: "blob" },
    { path: "vendor", sha: "3", type: "tree" },
  ];
  const validHeadEntries: unknown[] = [
    { path: "kept.ts", sha: "1", type: "blob" },
    { path: "pr-only.ts", sha: "4", type: "blob" },
    { path: "renamed-to.ts", sha: "2", type: "blob" },
    { path: "vendor", sha: "5", type: "tree" },
    { path: "vendor/new-submodule", sha: "6", type: "commit" },
  ];
  const headEntries = headEntry === undefined ? validHeadEntries : [...validHeadEntries, headEntry];
  let pullReads = 0;
  return (request) => {
    const path = new URL(request.url).pathname;
    if (path.endsWith("/pulls/42/files")) {
      return rawFiles({ count: 100, first: (pageOf({ request }) - 1) * 100 + 1, status: "added" });
    }
    if (path.endsWith("/pulls/42")) {
      pullReads += 1;
      if (pullReads === 1) {
        return { base: { sha: "base-tip" }, head: { sha: headBeforeList }, url: PULL_URL };
      }
      return { base: { sha: "base-tip" }, head: { sha: pullReads > 2 ? headAfterTrees : "head-sha" }, url: PULL_URL };
    }
    if (path.endsWith("/compare/base-tip...head-sha")) {
      return {
        base_commit: { sha: compareAnswersBase },
        url: `https://api.github.com/repos/${compareAnswersRepo}/compare/base-tip...${compareAnswersHead}`,
        merge_base_commit: { commit: { tree: { sha: "merge-base-tree" } }, sha: "merge-base" },
      };
    }
    if (path.endsWith("/git/commits/head-sha")) {
      return { sha: headCommitAnswersSha, tree: { sha: "head-tree" } };
    }
    if (path.endsWith("/git/trees/merge-base-tree")) {
      return { sha: "merge-base-tree", tree: mergeBaseEntries, truncated: truncated === "merge base" };
    }
    if (path.endsWith("/git/trees/head-tree") && headOmitsTruncated) {
      return { sha: "head-tree", tree: headEntries };
    }
    if (path.endsWith("/git/trees/head-tree")) {
      return { sha: headAnswersSha, tree: headEntries, truncated: truncated === "head" };
    }
    throw new Error(`unrouted request ${path}`);
  };
}
