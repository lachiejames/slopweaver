import { describe, expect, it } from "vitest";

import { createRateBlock } from "../../../../lib/rateBlock.js";
import { ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  graphqlCallOptions,
  octokitRequestOptions,
  refuseWhileBlocked,
} from "../../../../live/github/graphqlRequest.js";
import type { GithubReadGraphql } from "../../../../live/github/read.js";
import { makeGithubReviewStateApi } from "../../../../live/github/reviewState.js";

/** Every argument the GraphQL seam was called with, in order. */
type Call = Parameters<GithubReadGraphql>[0];

/**
 * A GraphQL seam that records its calls and answers an empty search, an absent repository or nothing at all —
 * enough for each edge to finish, since only what it SENT is under test here.
 *
 * @returns the seam and the calls it has recorded
 */
function recordingGraphql(): { readonly graphql: GithubReadGraphql; readonly calls: Call[] } {
  const calls: Call[] = [];
  const graphql: GithubReadGraphql = (args) => {
    calls.push(args);
    return Promise.resolve(ok({ search: { issueCount: 0, nodes: [], pageInfo: { hasNextPage: false } } }));
  };
  return { calls, graphql };
}

describe("makeGithubReviewStateApi", () => {
  it("sends a fleet page with the client's retries off and the caller's timeout, outside the variables", async () => {
    const { calls, graphql } = recordingGraphql();

    await makeGithubReviewStateApi({ graphql }).fleetPage({
      checkLimit: 100,
      cursor: undefined,
      fileLimit: 100,
      pageSize: 20,
      query: "is:pr is:open",
      timeoutMs: 24_000,
      withBodies: false,
    });

    expect(calls.map((call) => call.request)).toEqual([{ retries: 0, timeoutMs: 24_000 }]);
    expect(Object.keys(calls[0]!.variables)).not.toContain("timeoutMs");
    expect(Object.keys(calls[0]!.variables)).not.toContain("request");
    expect(calls[0]!.variables["pageSize"]).toBe(20);
  });

  it("leaves the single-pull-request and CODEOWNERS reads on the client's own defaults", async () => {
    const { calls, graphql } = recordingGraphql();
    const api = makeGithubReviewStateApi({ graphql });

    await api.pr({ checkLimit: 100, fileLimit: 100, number: 1, owner: "o", repo: "r", withBodies: false });
    await api.codeowners({ owner: "o", repo: "r" });

    expect(calls.length).toBe(2);
    expect(calls.map((call) => "request" in call)).toEqual([false, false]);
  });

  it("reads a single pull request's head WHOLE when one page could not hold its contexts", async () => {
    const asked: string[] = [];
    const graphql: GithubReadGraphql = ({ query }) => {
      const name = /query (\w+)/.exec(query)![1]!;
      asked.push(name);
      const lastPage = name === "SlopweaverChecksRollupPage";
      return Promise.resolve(
        ok(
          pullRequestData({
            context: lastPage ? "Required CI" : "build",
            pageInfo: lastPage ? { hasNextPage: false } : { endCursor: "c1", hasNextPage: true },
          }),
        ),
      );
    };
    const pr = unwrap(
      await makeGithubReviewStateApi({ graphql }).pr({
        checkLimit: 100,
        fileLimit: 1,
        number: 7,
        owner: "o",
        repo: "r",
        withBodies: false,
      }),
    );
    expect(asked).toStrictEqual(["SlopweaverReviewStatePr", "SlopweaverChecksRollup", "SlopweaverChecksRollupPage"]);
    expect(pr.checksTruncated).toBe(false);
    expect(pr.checks.checks.map((check) => check.name)).toStrictEqual(["build", "Required CI"]);
  });

  it("leaves a single pull request truncated when the whole re-read lands on a moved head", async () => {
    const graphql: GithubReadGraphql = ({ query }) =>
      Promise.resolve(
        ok(
          query.includes("SlopweaverReviewStatePr")
            ? pullRequestData({ context: "build", pageInfo: { endCursor: "c1", hasNextPage: true } })
            : pullRequestData({ context: "build", oid: "moved", pageInfo: { hasNextPage: false } }),
        ),
      );
    const pr = unwrap(
      await makeGithubReviewStateApi({ graphql }).pr({
        checkLimit: 100,
        fileLimit: 1,
        number: 7,
        owner: "o",
        repo: "r",
        withBodies: false,
      }),
    );
    expect(pr.checksTruncated).toBe(true);
    expect(pr.headOid).toBe("head-1");
  });
});

/** A minimal pull request carrying one context on its head, paged as told. */
function pullRequestData({
  context,
  pageInfo,
  oid = "head-1",
}: {
  context: string;
  pageInfo: { hasNextPage: boolean; endCursor?: string };
  oid?: string;
}): unknown {
  return {
    repository: {
      pullRequest: {
        baseRefName: "staging",
        commits: {
          nodes: [
            {
              commit: {
                oid,
                statusCheckRollup: {
                  contexts: {
                    nodes: [{ __typename: "CheckRun", conclusion: "SUCCESS", name: context, status: "COMPLETED" }],
                    pageInfo,
                  },
                  state: "SUCCESS",
                },
              },
            },
          ],
        },
        mergeable: "MERGEABLE",
        number: 7,
        repository: { nameWithOwner: "o/r" },
      },
    },
  };
}

describe("octokitRequestOptions", () => {
  it("passes retries through and turns a timeout into a live abort signal", () => {
    const options = octokitRequestOptions({ request: { retries: 0, timeoutMs: 30_000 } });

    expect(options.retries).toBe(0);
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(options.signal!.aborted).toBe(false);
  });

  it("builds a signal from a fractional or negative timeout, which AbortSignal.timeout itself would throw on", () => {
    expect(() => AbortSignal.timeout(29_999.5)).toThrow(RangeError);

    expect(octokitRequestOptions({ request: { timeoutMs: 29_999.5 } }).signal!.aborted).toBe(false);
    expect(octokitRequestOptions({ request: { timeoutMs: -1 } }).signal).toBeInstanceOf(AbortSignal);
  });

  it("adds nothing the caller did not ask for", () => {
    expect(octokitRequestOptions({ request: {} })).toEqual({});
    expect(Object.keys(octokitRequestOptions({ request: { retries: 0 } }))).toEqual(["retries"]);
  });
});

describe("refuseWhileBlocked", () => {
  const scope = { provider: "github", scopeId: "t" };
  const nowMs = Date.parse("2026-09-28T00:00:00.000Z");

  /**
   * A block whose clock stands still at `nowMs`, closed for `retryAfterMs` by a recorded 429, or open when undefined.
   *
   * @returns the block
   */
  function blockedFor({ retryAfterMs }: { retryAfterMs: number | undefined }): ReturnType<typeof createRateBlock> {
    const block = createRateBlock({ seams: { delay: () => Promise.resolve(), now: () => nowMs } });
    if (retryAfterMs !== undefined) {
      block.recordLimited({ retryAfterMs, scope });
    }
    return block;
  }

  it("refuses a time-bounded request while any block stands, naming the reset, since a block can be extended mid-wait", () => {
    const refused = refuseWhileBlocked({
      block: blockedFor({ retryAfterMs: 600_000 }),
      nowMs,
      request: { retries: 0, timeoutMs: 30_000 },
      scope,
    });

    expect(refused!.code).toBe("RATE_LIMITED");
    expect(refused!.message).toBe(
      "an earlier GitHub rate limit blocks this token for another 600s, and a request bounded to 30s cannot wait inside it, so it was not sent (rate limited until 2026-09-28T00:10:00.000Z)",
    );
    expect(
      refuseWhileBlocked({ block: blockedFor({ retryAfterMs: 5_000 }), nowMs, request: { timeoutMs: 30_000 }, scope })!
        .message,
    ).toBe(
      "an earlier GitHub rate limit blocks this token for another 5s, and a request bounded to 30s cannot wait inside it, so it was not sent (rate limited until 2026-09-28T00:00:05.000Z)",
    );
  });

  it("names no reset, rather than throwing, when a Retry-After runs past the Date range", () => {
    const refused = refuseWhileBlocked({
      block: blockedFor({ retryAfterMs: 9_000_000_000_000_000 }),
      nowMs,
      request: { timeoutMs: 30_000 },
      scope,
    });

    expect(refused!.message).toContain("(rate limited; GitHub named no reset)");
  });

  it("lets a request go when nothing is blocked, and when it names no timeout", () => {
    expect(
      refuseWhileBlocked({
        block: blockedFor({ retryAfterMs: undefined }),
        nowMs,
        request: { timeoutMs: 30_000 },
        scope,
      }),
    ).toBe(undefined);
    expect(
      refuseWhileBlocked({ block: blockedFor({ retryAfterMs: 600_000 }), nowMs, request: { retries: 0 }, scope }),
    ).toBe(undefined);
  });

  it("sends every other caller's variables untouched, and refuses a blocked fleet page before it is sent", () => {
    const variables = { owner: "o" };
    const block = blockedFor({ retryAfterMs: 600_000 });

    expect(unwrap(graphqlCallOptions({ block, nowMs, request: undefined, scopeId: "t", variables }))).toBe(variables);
    expect(
      unwrapErr(
        graphqlCallOptions({ block, nowMs, request: { retries: 0, timeoutMs: 30_000 }, scopeId: "t", variables }),
      ).code,
    ).toBe("RATE_LIMITED");
    expect(
      Object.keys(unwrap(graphqlCallOptions({ block, nowMs, request: { retries: 0 }, scopeId: "t", variables }))),
    ).toEqual(["owner", "request"]);
  });
});
