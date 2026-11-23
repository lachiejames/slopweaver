import { describe, expect, it } from "vitest";

import { unwrap } from "../../../../lib/result.js";
import { reviewRequestsTruncated } from "../../../../live/github/reviewRequests.js";
import { parseCodeownersBlob, parseFleetPage, parsePrNode } from "../../../../live/github/reviewState.js";

/** One raw search node, in the shape the fleet query asks GitHub for. */
const NODE: Record<string, unknown> = {
  author: { login: "author-login" },
  baseRefName: "staging",
  commits: {
    nodes: [
      {
        commit: {
          oid: "4219a284",
          statusCheckRollup: {
            contexts: {
              nodes: [
                {
                  __typename: "CheckRun",
                  checkSuite: { createdAt: "2026-08-30T10:18:00Z" },
                  conclusion: "SUCCESS",
                  name: "core",
                  status: "COMPLETED",
                },
                {
                  __typename: "CheckRun",
                  checkSuite: { createdAt: "2026-08-30T10:00:00Z" },
                  conclusion: "FAILURE",
                  name: "core",
                  status: "COMPLETED",
                },
              ],
              pageInfo: { hasNextPage: false },
              totalCount: 2,
            },
            state: "SUCCESS",
          },
        },
      },
    ],
  },
  createdAt: "2026-08-30T10:16:40Z",
  files: { nodes: [{ path: "apps/etl/main.ts" }], pageInfo: { hasNextPage: true } },
  headRefName: "feature/sixth-of-the-stack",
  isDraft: true,
  number: 16400,
  repository: { defaultBranchRef: { name: "staging" }, nameWithOwner: "owner/repo" },
  reviewDecision: null,
  reviewRequests: {
    nodes: [
      { asCodeOwner: false, requestedReviewer: { __typename: "User", login: "reviewer-one" } },
      {
        asCodeOwner: true,
        requestedReviewer: { __typename: "Team", combinedSlug: "owner/platform", slug: "platform" },
      },
    ],
    pageInfo: { hasNextPage: false },
  },
  reviewThreads: {
    nodes: [
      {
        id: "PRRT_kwDOnode1",
        isOutdated: false,
        isResolved: false,
        line: 12,
        opener: {
          nodes: [
            {
              author: { login: "coderabbitai" },
              body: "**Blocking.** the copy is wrong\n\nmore",
              createdAt: "2026-09-01T00:00:00Z",
            },
          ],
        },
        path: "a.ts",
        tail: {
          nodes: [
            { author: { login: "the-owner" }, body: "answered, leaving it open", createdAt: "2026-09-02T00:00:00Z" },
          ],
          totalCount: 2,
        },
      },
    ],
    pageInfo: { hasNextPage: true },
    totalCount: 59,
  },
  reviews: {
    nodes: [
      {
        author: { login: "coderabbitai" },
        commit: { oid: "4219a284" },
        onBehalfOf: { nodes: [{ combinedSlug: "owner/data" }] },
        state: "APPROVED",
        submittedAt: "2026-08-30T10:30:00Z",
      },
    ],
    totalCount: 1,
  },
  title: "a title",
  updatedAt: "2026-08-30T10:30:00Z",
  url: "https://github.com/owner/repo/pull/16400",
};

describe("parsePrNode", () => {
  it("shapes every field the seven questions read", () => {
    const pr = parsePrNode({ node: NODE })!;
    expect(pr.number).toBe(16400);
    expect(pr.repoSlug).toBe("owner/repo");
    expect(pr.authorLogin).toBe("author-login");
    expect(pr.isDraft).toBe(true);
    expect(pr.headOid).toBe("4219a284");
    expect(pr.changedPaths).toEqual(["apps/etl/main.ts"]);
    expect(pr.changedPathsTruncated).toBe(true);
  });

  it("carries GitHub's own asCodeOwner flag, naming a team by the slug CODEOWNERS itself spells", () => {
    const pr = parsePrNode({ node: NODE })!;
    expect(pr.codeownerRequests).toEqual([
      { asCodeOwner: false, kind: "user", name: "reviewer-one" },
      { asCodeOwner: true, kind: "team", name: "owner/platform" },
    ]);
    expect(pr.codeownerRequestsTruncated).toBe(false);
  });

  it("carries the teams a review was submitted on behalf of, so a satisfied team owner stays visible", () => {
    expect(parsePrNode({ node: NODE })!.reviews[0]!.onBehalfOf).toEqual(["owner/data"]);
  });

  it("reports the reviews page truncated from totalCount, which a `last:`-queried pageInfo cannot say", () => {
    const truncated = { ...NODE, reviews: { ...(NODE["reviews"] as object), totalCount: 91 } };
    expect(parsePrNode({ node: truncated })!.reviewsTruncated).toBe(true);
    expect(parsePrNode({ node: NODE })!.reviewsTruncated).toBe(false);
  });

  it("reads a missing connection, a short page, or a null GitHub could not resolve as truncated — never as whole", () => {
    const whole = { ...NODE, reviewThreads: { nodes: [], pageInfo: { hasNextPage: false }, totalCount: 0 } };
    const read = (node: Record<string, unknown>) => {
      const pr = parsePrNode({ node })!;
      return [pr.reviewsTruncated, pr.threadsTruncated];
    };
    const bare = Object.fromEntries(
      Object.entries(whole).filter(([key]) => key !== "reviews" && key !== "reviewThreads"),
    );
    expect([
      read(whole),
      read(bare),
      read({ ...whole, reviews: { nodes: [null], totalCount: 1 } }),
      read({ ...whole, reviewThreads: { nodes: [null], pageInfo: { hasNextPage: false }, totalCount: 1 } }),
      read({ ...whole, reviewThreads: { nodes: [], pageInfo: { hasNextPage: false }, totalCount: 1 } }),
    ]).toEqual([
      [false, false],
      [true, true],
      [true, false],
      [false, true],
      [false, true],
    ]);
  });

  it("reports more review requests than the page carried", () => {
    const truncated = {
      ...NODE,
      reviewRequests: { ...(NODE["reviewRequests"] as object), pageInfo: { hasNextPage: true } },
    };
    expect(parsePrNode({ node: truncated })!.codeownerRequestsTruncated).toBe(true);
  });

  it("reports a DROPPED code-owner request as incomplete too, the same answer the enqueue door gets", () => {
    // Twice over, a review found this parser deriving truncation itself while the door asked
    // reviewRequestsTruncated — so an unnamed asCodeOwner entry vanished from the read's register and the
    // read passed a pull request the door refused. One derivation, asserted here against the helper's own
    // answer so a second copy cannot come back silently.
    const dropped = {
      ...NODE,
      reviewRequests: { nodes: [{ asCodeOwner: true, requestedReviewer: null }], pageInfo: { hasNextPage: false } },
    };
    const pr = parsePrNode({ node: dropped })!;
    expect(pr.codeownerRequests).toEqual([]);
    expect(pr.codeownerRequestsTruncated).toBe(true);
    expect(pr.codeownerRequestsTruncated).toBe(reviewRequestsTruncated({ node: dropped }));
  });

  it("reads the base branch, so a run journal can be joined to the pull request", () => {
    expect(parsePrNode({ node: NODE })!.baseRefName).toBe("staging");
  });

  it("records a blank head branch when the node carries none, never a guess", () => {
    const { headRefName: _dropped, ...without } = NODE;
    expect(parsePrNode({ node: without })!.headRefName).toBe("");
  });

  it("keeps only the NEWEST check suite for a re-run check name", () => {
    const pr = parsePrNode({ node: NODE })!;
    expect(pr.checks.checks).toEqual([
      { conclusion: "SUCCESS", kind: "check-run", name: "core", state: "passed", url: undefined },
    ]);
  });

  it("carries GitHub's Bot type on a review and a thread opener, whose GraphQL login has no [bot] suffix", () => {
    const bot = { __typename: "Bot", login: "copilot-pull-request-reviewer" };
    const node = {
      ...NODE,
      reviewThreads: {
        nodes: [{ id: "PRRT_bot", opener: { nodes: [{ author: bot, createdAt: "2026-09-01T00:00:00Z" }] } }],
        totalCount: 1,
      },
      reviews: {
        nodes: [
          { author: bot, commit: { oid: "4219a284" }, state: "COMMENTED", submittedAt: "2026-08-30T10:30:00Z" },
          {
            author: { __typename: "User", login: "a-colleague" },
            state: "COMMENTED",
            submittedAt: "2026-08-30T11:00:00Z",
          },
        ],
        totalCount: 2,
      },
    };
    const pr = parsePrNode({ node })!;
    expect(pr.reviews.map((review) => [review.login, review.byBot])).toEqual([
      ["copilot-pull-request-reviewer", true],
      ["a-colleague", undefined],
    ]);
    expect(pr.threads.map((thread) => [thread.openedByLogin, thread.openedByBot])).toEqual([
      ["copilot-pull-request-reviewer", true],
    ]);
  });

  it("carries GitHub's Bot type on the pull request's own author, so the Renovate App is told from a user", () => {
    const authors = [
      { __typename: "Bot", login: "renovate" },
      { __typename: "User", login: "renovate" },
    ];
    const parsed = authors.map((author) => parsePrNode({ node: { ...NODE, author } })!);
    expect(parsed.map((pr) => [pr.authorLogin, pr.authorIsBot])).toEqual([
      ["renovate", true],
      ["renovate", undefined],
    ]);
  });

  it("attributes a review thread to whoever wrote its first comment, and carries the last word", () => {
    expect(parsePrNode({ node: NODE })!.threads).toEqual([
      {
        commentCount: 2,
        id: "PRRT_kwDOnode1",
        isOutdated: false,
        isResolved: false,
        lastCommentAtIso: "2026-09-02T00:00:00Z",
        lastCommentBody: "answered, leaving it open",
        lastCommentLogin: "the-owner",
        line: 12,
        openedAtIso: "2026-09-01T00:00:00Z",
        openedByLogin: "coderabbitai",
        openerBody: "**Blocking.** the copy is wrong\n\nmore",
        path: "a.ts",
      },
    ]);
  });

  // A thread with no replies is not a thread whose last speaker is unknown: the opener IS the last word, and
  // the disposition (`../../../../review/prStateDetail.ts`) turns on exactly that field.
  it("falls back to the opener as the last comment when a thread has no replies", () => {
    const solo = {
      ...NODE,
      reviewThreads: {
        nodes: [
          {
            isOutdated: false,
            isResolved: false,
            line: 4,
            opener: {
              nodes: [{ author: { login: "arlom-acme" }, body: "**Blocking.**", createdAt: "2026-09-03T00:00:00Z" }],
            },
            path: "b.ts",
            tail: { nodes: [], totalCount: 1 },
          },
        ],
        pageInfo: { hasNextPage: false },
        totalCount: 1,
      },
    };
    const only = parsePrNode({ node: solo })!.threads[0]!;
    expect(only.lastCommentLogin).toBe("arlom-acme");
    expect(only.lastCommentAtIso).toBe("2026-09-03T00:00:00Z");
    expect(only.commentCount).toBe(1);
  });

  // The id is the node a `resolveReviewThread` mutation addresses, so a thread that arrived without one must
  // read as blank rather than as some other thread's id — `github landing --press` skips a blank.
  it("records a blank thread id when the node carries none, never a guess", () => {
    const { id: _dropped, ...bare } = (NODE["reviewThreads"] as { nodes: Record<string, unknown>[] }).nodes[0]!;
    const without = { ...NODE, reviewThreads: { nodes: [bare], pageInfo: { hasNextPage: false }, totalCount: 1 } };
    expect(parsePrNode({ node: without })!.threads[0]!.id).toBe("");
  });

  // The bodies are conditional on `withBodies`, so a fleet run returns threads with empty text — the field
  // has to read as "not asked for" rather than as an empty comment.
  it("reads a thread with no body field as empty text, keeping who and when", () => {
    const noBodies = {
      ...NODE,
      reviewThreads: {
        nodes: [
          {
            isOutdated: false,
            isResolved: false,
            line: 7,
            opener: { nodes: [{ author: { login: "jonahy-acme" }, createdAt: "2026-09-04T00:00:00Z" }] },
            path: "c.ts",
            tail: {
              nodes: [{ author: { login: "jonahy-acme" }, createdAt: "2026-09-04T00:00:00Z" }],
              totalCount: 1,
            },
          },
        ],
        pageInfo: { hasNextPage: false },
        totalCount: 1,
      },
    };
    const only = parsePrNode({ node: noBodies })!.threads[0]!;
    expect(only.openerBody).toBe("");
    expect(only.openedByLogin).toBe("jonahy-acme");
  });

  it("reads a requested reviewer's login and a requested team's slug alike", () => {
    expect(parsePrNode({ node: NODE })!.requestedReviewers).toEqual(["reviewer-one", "platform"]);
  });

  it("reports a capped thread read, and how many threads GitHub says there are", () => {
    const pr = parsePrNode({ node: NODE })!;
    expect(pr.threadsTruncated).toBe(true);
    expect(pr.threadCount).toBe(59);
  });

  it("reads a null reviewDecision as the empty string rather than throwing", () => {
    expect(parsePrNode({ node: NODE })!.reviewDecision).toBe("");
  });

  it("classifies GitHub's own mergeStateStatus, so a pending request can be told from a requirement", () => {
    const blocked = { ...NODE, mergeStateStatus: "BLOCKED" };
    expect(parsePrNode({ node: blocked })!.githubMergeStatus).toEqual({ kind: "blocked", status: "BLOCKED" });
    const clean = { ...NODE, mergeStateStatus: "CLEAN" };
    expect(parsePrNode({ node: clean })!.githubMergeStatus).toEqual({ kind: "mergeable", status: "CLEAN" });
  });

  it("reads a MISSING mergeStateStatus as unread, never as a status that would clear anything", () => {
    // The dangerous direction is a dropped query field reading as green, so the absence has its own arm.
    expect(parsePrNode({ node: NODE })!.githubMergeStatus).toEqual({
      kind: "unread",
      why: "this read carried no mergeStateStatus for it",
    });
  });

  it("carries the head branch and the repository's default branch, which the stack placement is read from", () => {
    const pr = parsePrNode({ node: NODE })!;
    expect(pr.headRefName).toBe("feature/sixth-of-the-stack");
    expect(pr.defaultBranch).toBe("staging");
  });

  it("reads an empty default branch, never a guessed one, when the repository node carries none", () => {
    const bare = { ...NODE, repository: { nameWithOwner: "owner/repo" } };
    expect(parsePrNode({ node: bare })!.defaultBranch).toBe("");
  });

  it("rejects a node that is not a pull request at all", () => {
    expect(parsePrNode({ node: { title: "an issue" } })).toBe(undefined);
  });

  it("reads a pull request with no commit node as having no checks", () => {
    const pr = parsePrNode({ node: { ...NODE, commits: { nodes: [] } } })!;
    expect(pr.checks.checks).toEqual([]);
    expect(pr.headOid).toBe("");
  });
});

describe("parseFleetPage", () => {
  it("carries the cursor only when GitHub says another page exists", () => {
    const page = unwrap(
      parseFleetPage({
        data: { search: { issueCount: 42, nodes: [NODE], pageInfo: { endCursor: "c1", hasNextPage: true } } },
      }),
    );
    expect(page.nextCursor).toBe("c1");
    expect(page.totalCount).toBe(42);
    expect(page.pullRequests.length).toBe(1);
  });

  it("carries no cursor on the last page", () => {
    const page = unwrap(
      parseFleetPage({
        data: { search: { issueCount: 1, nodes: [], pageInfo: { endCursor: "c1", hasNextPage: false } } },
      }),
    );
    expect(page.nextCursor).toBe(undefined);
  });

  it("fails by name when the response carries no search connection", () => {
    const parsed = parseFleetPage({ data: { repository: {} } });
    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr().message).toBe(
      "GitHub returned no search connection for the fleet read — the response object carries no `search` key at all (keys: repository)",
    );
  });

  // The four shapes below all used to answer ONE sentence, and they have opposite remedies: a nulled
  // `search` is GitHub declining an expensive query and is answered by a smaller page, while a missing key
  // is a query or transport fault no page size fixes. `github landing` against acme/acme-admin failed
  // once in twenty-two runs and its single diagnostic line said which of the four it was —
  // and the answer was nothing at all.
  it("says GitHub NULLED the search field, since that is the shape a smaller page answers", () => {
    const parsed = parseFleetPage({ data: { search: null } });
    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr().message).toBe(
      "GitHub returned no search connection for the fleet read — GitHub answered `search: null`, which is how it declines a query it could not complete",
    );
  });

  it("says the search field came back as a scalar when it is not a connection at all", () => {
    const parsed = parseFleetPage({ data: { search: 7 } });
    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr().message).toBe(
      "GitHub returned no search connection for the fleet read — `search` came back as number, not a connection",
    );
  });

  it("says the transport answered a non-object, separately from a null one", () => {
    expect(parseFleetPage({ data: undefined })._unsafeUnwrapErr().message).toBe(
      "GitHub returned no search connection for the fleet read — the response was undefined, not an object",
    );
    expect(parseFleetPage({ data: null })._unsafeUnwrapErr().message).toBe(
      "GitHub returned no search connection for the fleet read — the response was null, not an object",
    );
    expect(parseFleetPage({ data: "an html error page" })._unsafeUnwrapErr().message).toBe(
      "GitHub returned no search connection for the fleet read — the response was string, not an object",
    );
  });

  // `typeof null` and `typeof []` are both "object", so a message built straight off `typeof` would read
  // "the response was object, not an object" — self-contradictory in the one sentence a later session gets.
  it("does not describe an array as an object in either position", () => {
    expect(parseFleetPage({ data: [] })._unsafeUnwrapErr().message).toBe(
      "GitHub returned no search connection for the fleet read — the response was an array, not an object",
    );
    expect(parseFleetPage({ data: { search: [] } })._unsafeUnwrapErr().message).toBe(
      "GitHub returned no search connection for the fleet read — `search` came back as an array, not a connection",
    );
  });
});

describe("parseCodeownersBlob", () => {
  it("takes the first location in GitHub's own precedence order", () => {
    const found = parseCodeownersBlob({
      data: { repository: { dotGithub: { text: "* @a" }, docs: null, root: { text: "* @b" } } },
    });
    expect(found).toEqual({ content: "* @a", path: ".github/CODEOWNERS" });
  });

  it("falls through an absent location to the next one", () => {
    const found = parseCodeownersBlob({
      data: { repository: { dotGithub: null, docs: null, root: { text: "* @b" } } },
    });
    expect(found).toEqual({ content: "* @b", path: "CODEOWNERS" });
  });

  it("reports undefined when the repository declares none", () => {
    expect(parseCodeownersBlob({ data: { repository: { dotGithub: null, docs: null, root: null } } })).toBe(undefined);
  });
});
