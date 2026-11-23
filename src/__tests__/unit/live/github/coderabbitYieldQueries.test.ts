import { describe, expect, it } from "vitest";
import { ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import { prFacts } from "../../../../live/github/coderabbitYieldPr.js";
import { pageOf, rateOf, threadOf } from "../../../../live/github/coderabbitYieldQueries.js";
import { callWalk, fieldOf, type Walk } from "../../../../live/github/coderabbitYieldWalk.js";

describe("pageOf", () => {
  it("answers the cursor only when GitHub says there is a next page", () => {
    const more = { nodes: [1], pageInfo: { endCursor: "c1", hasNextPage: true } };
    const done = { nodes: [2], pageInfo: { endCursor: "c2", hasNextPage: false } };
    expect([unwrap(pageOf({ connection: more, what: "x" })), unwrap(pageOf({ connection: done, what: "x" }))]).toEqual([
      { next: "c1", nodes: [1] },
      { next: undefined, nodes: [2] },
    ]);
  });

  it("refuses a next page with no cursor, a page with no pageInfo, and a connection with no nodes", () => {
    const cursorless = { nodes: [], pageInfo: { endCursor: null, hasNextPage: true } };
    expect([
      unwrapErr(pageOf({ connection: cursorless, what: "reviews" })).message,
      unwrapErr(pageOf({ connection: { nodes: [] }, what: "search" })).message,
      unwrapErr(pageOf({ connection: {}, what: "search" })).message,
    ]).toEqual([
      "GitHub returned a malformed reviews page (hasNextPage without a cursor) for the coderabbit-yield read",
      "GitHub returned a malformed search page (no pageInfo.hasNextPage) for the coderabbit-yield read",
      "GitHub returned a malformed search connection for the coderabbit-yield read",
    ]);
  });
});

describe("threadOf", () => {
  it("marks a thread incomplete when GitHub counts more comments than the page carried", () => {
    const thread = unwrap(
      threadOf({
        value: {
          comments: { nodes: [{ author: null, body: "b", url: "u" }], totalCount: 3 },
          id: "PRRT_1",
          isOutdated: false,
          isResolved: false,
          path: "a.ts",
          resolvedBy: null,
        },
      }),
    );
    expect([thread.commentsComplete, thread.resolvedByLogin, thread.comments[0]!.authorLogin]).toEqual([
      false,
      null,
      null,
    ]);
  });
});

describe("rateOf", () => {
  it("reads cost and remaining, and answers undefined when the block is missing", () => {
    expect([rateOf({ data: { rateLimit: { cost: 2, remaining: 900 } } }), rateOf({ data: {} })]).toEqual([
      { cost: 2, remaining: 900 },
      undefined,
    ]);
  });
});

describe("callWalk", () => {
  it("books each request's cost on the walk, and fieldOf reads through a non-object as undefined", async () => {
    const walk: Walk = {
      cost: 0,
      gaps: [],
      graphql: async () => ok({ rateLimit: { cost: 3, remaining: 700 }, viewer: { login: "x" } }),
      progress: () => undefined,
      remaining: undefined,
      requests: 0,
    };
    const response = unwrap(await callWalk({ query: "q", variables: {}, walk }));
    expect([walk.requests, walk.cost, walk.remaining, fieldOf({ key: "viewer", value: response })]).toEqual([
      1,
      3,
      700,
      { login: "x" },
    ]);
    expect(fieldOf({ key: "k", value: "not an object" })).toBe(undefined);
  });
});

describe("prFacts", () => {
  it("keeps only CodeRabbit's review bodies and reads the threads off the inline page with no follow-up", async () => {
    const walk: Walk = {
      cost: 0,
      gaps: [],
      graphql: async () => ok({}),
      progress: () => undefined,
      remaining: undefined,
      requests: 0,
    };
    const done = { endCursor: null, hasNextPage: false };
    const facts = unwrap(
      await prFacts({
        value: {
          author: { login: "octocat" },
          createdAt: "2026-09-20T00:00:00Z",
          id: "PR_1",
          number: 1,
          repository: { nameWithOwner: "acme/acme-admin" },
          reviewThreads: {
            nodes: [
              {
                comments: { nodes: [{ author: { login: "coderabbitai" }, body: "b", url: "u" }], totalCount: 1 },
                id: "PRRT_1",
                isOutdated: false,
                isResolved: true,
                path: "a.ts",
                resolvedBy: { login: "coderabbitai" },
              },
            ],
            pageInfo: done,
          },
          reviews: {
            nodes: [
              { author: { login: "coderabbitai" }, body: "cr" },
              { author: { login: "colleague" }, body: "human" },
            ],
            pageInfo: done,
          },
          state: "MERGED",
          url: "https://github.com/acme/acme-admin/pull/1",
        },
        walk,
      }),
    );
    expect([facts.coderabbitReviewBodies, facts.threads.map((one) => one.resolvedByLogin), walk.requests]).toEqual([
      ["cr"],
      ["coderabbitai"],
      0,
    ]);
  });

  it("re-reads a short CodeRabbit thread GitHub counts more comments on, and records a gap when it stays short", async () => {
    const opener = { author: { login: "coderabbitai" }, body: "b", url: "u" };
    const reply = { author: { login: "alice" }, body: "Fixed in 98ad962724.", url: "u2" };
    const done = { endCursor: null, hasNextPage: false };
    const reread = ({ nodes }: { nodes: unknown[] }): Walk => ({
      cost: 0,
      gaps: [],
      graphql: async () => ok({ node: { comments: { nodes, totalCount: 3 } } }),
      progress: () => undefined,
      remaining: undefined,
      requests: 0,
    });
    const value = {
      author: { login: "alice" },
      createdAt: "2026-09-20T00:00:00Z",
      id: "PR_1",
      number: 1,
      repository: { nameWithOwner: "a/b" },
      reviewThreads: {
        nodes: [
          {
            comments: { nodes: [opener], totalCount: 3 },
            id: "PRRT_1",
            isOutdated: false,
            isResolved: false,
            path: "a.ts",
            resolvedBy: null,
          },
        ],
        pageInfo: done,
      },
      reviews: { nodes: [], pageInfo: done },
      state: "OPEN",
      url: "https://github.com/a/b/pull/1",
    };
    const whole = reread({ nodes: [opener, reply, reply] });
    const short = reread({ nodes: [opener, reply] });
    const wholeFacts = unwrap(await prFacts({ value, walk: whole }));
    const shortFacts = unwrap(await prFacts({ value, walk: short }));
    expect([whole.requests, wholeFacts.threads[0]!.commentsComplete, whole.gaps]).toEqual([1, true, []]);
    expect([short.requests, shortFacts.threads[0]!.commentsComplete, short.gaps]).toEqual([
      1,
      false,
      ["PRRT_1: read 2 of 3 comments"],
    ]);
  });

  it("keeps one thread GitHub returns on two pages once, at its later snapshot unless that lost the author", async () => {
    const comments = { nodes: [{ author: { login: "coderabbitai" }, body: "b", url: "u" }], totalCount: 1 };
    const open = { comments, id: "PRRT_1", isOutdated: false, isResolved: false, path: "a.ts", resolvedBy: null };
    const resolved = { ...open, isResolved: true, resolvedBy: { login: "alice" } };
    const ghosted = { ...resolved, comments: { ...comments, nodes: [{ ...comments.nodes[0]!, author: null }] } };
    const done = { endCursor: null, hasNextPage: false };
    const walk: Walk = {
      cost: 0,
      gaps: [],
      graphql: async () => ok({ node: { reviewThreads: { nodes: [resolved, ghosted], pageInfo: done } } }),
      progress: () => undefined,
      remaining: undefined,
      requests: 0,
    };
    const facts = unwrap(
      await prFacts({
        value: {
          author: { login: "alice" },
          createdAt: "2026-09-20T00:00:00Z",
          id: "PR_1",
          number: 1,
          repository: { nameWithOwner: "a/b" },
          reviewThreads: { nodes: [open], pageInfo: { endCursor: "c1", hasNextPage: true } },
          reviews: { nodes: [], pageInfo: done },
          state: "OPEN",
          url: "https://github.com/a/b/pull/1",
        },
        walk,
      }),
    );
    expect(
      facts.threads.map((thread) => [
        thread.id,
        thread.isResolved,
        thread.resolvedByLogin,
        thread.comments[0]!.authorLogin,
      ]),
    ).toEqual([["PRRT_1", true, "alice", "coderabbitai"]]);
  });

  it("re-reads a thread whose inline page carried no opener, or an opener with no author", async () => {
    const done = { endCursor: null, hasNextPage: false };
    const opener = { author: { login: "coderabbitai" }, body: "b", url: "u" };
    const walk: Walk = {
      cost: 0,
      gaps: [],
      graphql: async () => ok({ node: { comments: { nodes: [opener], totalCount: 1 } } }),
      progress: () => undefined,
      remaining: undefined,
      requests: 0,
    };
    const thread = { id: "PRRT_1", isOutdated: false, isResolved: false, path: "a.ts", resolvedBy: null };
    const facts = unwrap(
      await prFacts({
        value: {
          author: { login: "alice" },
          createdAt: "2026-09-20T00:00:00Z",
          id: "PR_1",
          number: 1,
          repository: { nameWithOwner: "a/b" },
          reviewThreads: { nodes: [{ ...thread, comments: { nodes: [], totalCount: 1 } }], pageInfo: done },
          reviews: { nodes: [], pageInfo: done },
          state: "OPEN",
          url: "https://github.com/a/b/pull/1",
        },
        walk,
      }),
    );
    expect([walk.requests, facts.threads[0]!.comments[0]!.authorLogin, walk.gaps]).toEqual([1, "coderabbitai", []]);
    const ghost = { ...walk, requests: 0 };
    const ghostFacts = unwrap(
      await prFacts({
        value: {
          author: { login: "alice" },
          createdAt: "2026-09-20T00:00:00Z",
          id: "PR_1",
          number: 1,
          repository: { nameWithOwner: "a/b" },
          reviewThreads: {
            nodes: [{ ...thread, comments: { nodes: [{ ...opener, author: null }], totalCount: 2 } }],
            pageInfo: done,
          },
          reviews: { nodes: [], pageInfo: done },
          state: "OPEN",
          url: "https://github.com/a/b/pull/1",
        },
        walk: ghost,
      }),
    );
    expect([ghost.requests, ghostFacts.threads[0]!.comments[0]!.authorLogin, ghost.gaps]).toEqual([
      1,
      "coderabbitai",
      [],
    ]);
  });
});
