/**
 * Review threads somebody else opened, through a real Octokit whose GraphQL transport is a plain fake `fetch`
 * recording each request: the thread and comment reads parse their bounded connections (a deleted author kept
 * as `undefined`, a blank opening body refused), the answer mutation puts the reply ahead of the resolve, and
 * both the resolve and the reopen check GitHub answered for the exact thread and state asked for.
 */
import { Octokit } from "@octokit/rest";
import { describe, expect, it } from "vitest";

import {
  answerReviewThreadVia,
  reopenReviewThreadVia,
  reviewThreadCommentsVia,
  reviewThreadDetailsVia,
} from "../../../../corpus/github/threads.js";
import type { WriteCtx } from "../../../../corpus/github/writeCtx.js";
import { isRecord } from "../../../../lib/parsers.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

/** One GraphQL request as the fake transport saw it. */
interface SentGraphql {
  readonly query: string;
  readonly variables: unknown;
}

/** Contexts minted so far — each gets its own rate scope, so one test's paced write never delays the next. */
let contextsMinted = 0;

/** A write context whose GraphQL transport answers every request with `data`, recording each. */
function graphqlCtx({ sent, data }: { sent: SentGraphql[]; data: unknown }): WriteCtx {
  contextsMinted += 1;
  const fetch: typeof globalThis.fetch = async (_url, init) => {
    const body = init?.body;
    const parsed: unknown = typeof body === "string" ? JSON.parse(body) : undefined;
    sent.push({
      query: isRecord(parsed) && typeof parsed["query"] === "string" ? parsed["query"] : "",
      variables: isRecord(parsed) ? parsed["variables"] : undefined,
    });
    return new Response(JSON.stringify({ data }), { headers: { "content-type": "application/json" }, status: 200 });
  };
  return {
    client: new Octokit({ auth: "test-token", request: { fetch } }),
    scopeId: `threads-${String(contextsMinted)}`,
  };
}

describe("reviewThreadDetailsVia", () => {
  it("projects each thread's id, state, path, line and opening comment, keeping a deleted author undefined", async () => {
    const sent: SentGraphql[] = [];
    const ctx = graphqlCtx({
      data: {
        node: {
          reviewThreads: {
            nodes: [
              {
                comments: { nodes: [{ author: { login: "coderabbitai" }, body: "Rename this." }] },
                id: "PRRT_1",
                isResolved: false,
                line: 12,
                path: "src/a.ts",
              },
              {
                comments: { nodes: [{ author: null, body: "Why?" }] },
                id: "PRRT_2",
                isResolved: true,
                line: null,
                path: null,
              },
            ],
          },
        },
      },
      sent,
    });

    const threads = unwrap(await reviewThreadDetailsVia({ ctx, input: { pullRequestId: "PR_9" } }));

    expect(threads).toEqual([
      { author: "coderabbitai", body: "Rename this.", id: "PRRT_1", isResolved: false, line: 12, path: "src/a.ts" },
      { author: undefined, body: "Why?", id: "PRRT_2", isResolved: true, line: undefined, path: undefined },
    ]);
    expect(sent.map((request) => request.variables)).toEqual([{ pullRequestId: "PR_9" }]);
  });

  it("fails on a thread whose opening comment has a blank body, naming that comment", async () => {
    const ctx = graphqlCtx({
      data: {
        node: {
          reviewThreads: {
            nodes: [{ comments: { nodes: [{ author: null, body: "" }] }, id: "PRRT_1", isResolved: false }],
          },
        },
      },
      sent: [],
    });

    const error = unwrapErr(await reviewThreadDetailsVia({ ctx, input: { pullRequestId: "PR_9" } }));

    expect(error.message).toBe("GitHub returned no body for a review thread's opening comment");
    expect(error.operation).toBe("github.pullRequest.reviewThreadDetails");
  });
});

describe("reviewThreadCommentsVia", () => {
  it("returns the viewer's login and the thread's comments in the order GitHub sent them", async () => {
    const sent: SentGraphql[] = [];
    const ctx = graphqlCtx({
      data: {
        node: {
          comments: {
            nodes: [
              { author: { login: "colleague" }, createdAt: "2026-10-01T00:00:00Z", url: "https://x/1" },
              { author: null, createdAt: "2026-10-02T00:00:00Z", url: "https://x/2" },
            ],
          },
        },
        viewer: { login: "acme-bot" },
      },
      sent,
    });

    expect(unwrap(await reviewThreadCommentsVia({ ctx, input: { threadId: "PRRT_1" } }))).toEqual({
      comments: [
        { author: "colleague", createdAt: "2026-10-01T00:00:00Z", url: "https://x/1" },
        { author: undefined, createdAt: "2026-10-02T00:00:00Z", url: "https://x/2" },
      ],
      viewer: "acme-bot",
    });
    expect(sent.map((request) => request.variables)).toEqual([{ thread: "PRRT_1" }]);
  });
});

describe("answerReviewThreadVia", () => {
  it("sends the body and thread, places the reply field before the resolve field, and confirms both", async () => {
    const sent: SentGraphql[] = [];
    const ctx = graphqlCtx({
      data: {
        reply: { comment: { id: "C_1", url: "https://github.com/acme/widgets/pull/42#discussion_r1" } },
        resolve: { thread: { id: "PRRT_1", isResolved: true } },
      },
      sent,
    });

    const answer = unwrap(
      await answerReviewThreadVia({ ctx, input: { body: "Done.", resolve: true, threadId: "PRRT_1" } }),
    );

    expect(answer).toEqual({ commentUrl: "https://github.com/acme/widgets/pull/42#discussion_r1", isResolved: true });
    expect(sent.map((request) => request.variables)).toEqual([{ body: "Done.", thread: "PRRT_1" }]);
    const query = sent[0]!.query;
    expect(query.indexOf("reply: addPullRequestReviewThreadReply")).toBeGreaterThan(0);
    expect(query.indexOf("resolve: resolveReviewThread")).toBeGreaterThan(
      query.indexOf("reply: addPullRequestReviewThreadReply"),
    );
  });

  it("resolves without a reply when no body is given, sending the thread id alone", async () => {
    const sent: SentGraphql[] = [];
    const ctx = graphqlCtx({ data: { resolve: { thread: { id: "PRRT_1", isResolved: true } } }, sent });

    const answer = unwrap(
      await answerReviewThreadVia({ ctx, input: { body: undefined, resolve: true, threadId: "PRRT_1" } }),
    );

    expect(answer).toEqual({ commentUrl: undefined, isResolved: true });
    expect(sent.map((request) => request.variables)).toEqual([{ thread: "PRRT_1" }]);
    expect(sent[0]!.query.includes("addPullRequestReviewThreadReply")).toBe(false);
  });

  it("refuses a resolution GitHub reports for a different thread, naming the one requested", async () => {
    const ctx = graphqlCtx({ data: { resolve: { thread: { id: "PRRT_other", isResolved: true } } }, sent: [] });

    const error = unwrapErr(
      await answerReviewThreadVia({ ctx, input: { body: undefined, resolve: true, threadId: "PRRT_1" } }),
    );

    expect(error.message).toBe("GitHub resolved a different thread than PRRT_1");
    expect(error.operation).toBe("github.addPullRequestReviewThreadReply+resolveReviewThread");
  });
});

describe("reopenReviewThreadVia", () => {
  it("confirms a reopen of the same thread reported open", async () => {
    const sent: SentGraphql[] = [];
    const ctx = graphqlCtx({ data: { reopen: { thread: { id: "PRRT_1", isResolved: false } } }, sent });

    expect(unwrap(await reopenReviewThreadVia({ ctx, input: { threadId: "PRRT_1" } }))).toBeUndefined();
    expect(sent.map((request) => request.variables)).toEqual([{ thread: "PRRT_1" }]);
  });

  it("refuses a different thread id, and the same id still reported resolved", async () => {
    const otherThread = graphqlCtx({ data: { reopen: { thread: { id: "PRRT_2", isResolved: false } } }, sent: [] });
    const stillResolved = graphqlCtx({ data: { reopen: { thread: { id: "PRRT_1", isResolved: true } } }, sent: [] });

    const wrongId = unwrapErr(await reopenReviewThreadVia({ ctx: otherThread, input: { threadId: "PRRT_1" } }));
    const notOpen = unwrapErr(await reopenReviewThreadVia({ ctx: stillResolved, input: { threadId: "PRRT_1" } }));

    expect(wrongId.message).toBe("GitHub reopened a different thread than PRRT_1");
    expect(notOpen.message).toBe("GitHub did not report thread PRRT_1 as open");
    expect(notOpen.operation).toBe("github.unresolveReviewThread");
  });
});
