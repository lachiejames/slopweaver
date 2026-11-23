import { describe, expect, it } from "vitest";
import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import { readCoderabbitYield, viewerLogin } from "../../../../live/github/coderabbitYield.js";
import { GithubLiveErrors } from "../../../../live/github/errors.js";
import type { GithubReadGraphql } from "../../../../live/github/read.js";

const RATE = { cost: 1, remaining: 4000, resetAt: "2026-09-23T10:00:00Z" };

const comment = ({ login, body }: { login: string; body: string }) => ({ author: { login }, body, url: `u-${body}` });

const prNode = ({ number, threads }: { number: number; threads: unknown[] }) => ({
  author: { login: "octocat" },
  createdAt: "2026-09-20T00:00:00Z",
  id: `PR_${String(number)}`,
  number,
  repository: { nameWithOwner: "acme/acme-admin" },
  reviewThreads: { nodes: threads, pageInfo: { endCursor: null, hasNextPage: false } },
  reviews: {
    nodes: [{ author: { login: "coderabbitai" }, body: "<summary>🧹 Nitpick comments (1)</summary>" }],
    pageInfo: { endCursor: null, hasNextPage: false },
  },
  state: "MERGED",
  url: `https://github.com/acme/acme-admin/pull/${String(number)}`,
});

const threadNode = ({ id, comments, total }: { id: string; comments: unknown[]; total: number }) => ({
  comments: { nodes: comments, totalCount: total },
  id,
  isOutdated: false,
  isResolved: true,
  path: "a.ts",
  resolvedBy: { login: "octocat" },
});

/** A fake GraphQL seam routed by operation name, recording every query variable it was sent. */
function fakeGraphql({ counts, pages }: { counts: (q: string) => number; pages: Record<string, unknown> }): {
  graphql: GithubReadGraphql;
  sent: string[];
} {
  const sent: string[] = [];
  const graphql: GithubReadGraphql = async ({ query, variables }) => {
    const name = /query (\w+)/u.exec(query)![1]!;
    const subject = name === "SlopweaverYieldComments" ? variables["id"] : variables["q"];
    sent.push(`${name} ${String(subject)}`);
    if (name === "SlopweaverYieldCount") {
      return ok({ rateLimit: RATE, search: { issueCount: counts(String(variables["q"])) } });
    }
    if (name === "SlopweaverYieldViewer") {
      return ok({ rateLimit: RATE, viewer: { login: "octocat" } });
    }
    const page = pages[name];
    return page === undefined ? err(GithubLiveErrors.readFailed({ message: `no fake for ${name}` })) : ok(page);
  };
  return { graphql, sent };
}

const SELECTION = {
  author: "octocat",
  repos: ["acme/acme-admin"],
  sinceIso: "2026-09-01T00:00:00.000Z",
  untilIso: "2026-09-03T00:00:00.000Z",
};

describe("readCoderabbitYield", () => {
  it("reads a window's pull requests with their threads and CodeRabbit review bodies", async () => {
    const opener = comment({ body: "_x_ | _🟡 Minor_ | _y_", login: "coderabbitai" });
    const { graphql } = fakeGraphql({
      counts: () => 1,
      pages: {
        SlopweaverYieldSearch: {
          rateLimit: RATE,
          search: {
            issueCount: 1,
            nodes: [prNode({ number: 7, threads: [threadNode({ comments: [opener], id: "T1", total: 1 })] })],
            pageInfo: { endCursor: null, hasNextPage: false },
          },
        },
      },
    });
    const read = await readCoderabbitYield({ graphql, progress: () => undefined, selection: SELECTION });
    expect(read.isOk()).toBe(true);
    const dataset = unwrap(read);
    expect([
      dataset.prs.length,
      dataset.prs[0]!.threads[0]!.commentsComplete,
      dataset.prs[0]!.coderabbitReviewBodies.length,
    ]).toEqual([1, true, 1]);
    expect([dataset.requests, dataset.cost, dataset.gaps]).toEqual([2, 2, []]);
  });

  it("bisects a window over the 1,000-result ceiling into halves that do not overlap", async () => {
    const { graphql, sent } = fakeGraphql({
      counts: (q) => (q.includes("2026-09-01T00:00:00+00:00..2026-09-03T00:00:00+00:00") ? 1500 : 0),
      pages: {},
    });
    const read = await readCoderabbitYield({ graphql, progress: () => undefined, selection: SELECTION });
    expect(read.isOk()).toBe(true);
    expect(sent).toEqual([
      "SlopweaverYieldCount is:pr repo:acme/acme-admin author:octocat created:2026-09-01T00:00:00+00:00..2026-09-03T00:00:00+00:00",
      "SlopweaverYieldCount is:pr repo:acme/acme-admin author:octocat created:2026-09-01T00:00:00+00:00..2026-09-02T00:00:00+00:00",
      "SlopweaverYieldCount is:pr repo:acme/acme-admin author:octocat created:2026-09-02T00:00:01+00:00..2026-09-03T00:00:00+00:00",
    ]);
  });

  it("re-reads a CodeRabbit thread whose comments ran past the inline page", async () => {
    const inline = Array.from({ length: 10 }, (_, index) =>
      comment({ body: `c${String(index)}`, login: index === 0 ? "coderabbitai" : "x" }),
    );
    const whole = [...inline, comment({ body: "✅ Confirmed as addressed by @x", login: "coderabbitai" })];
    const { graphql, sent } = fakeGraphql({
      counts: () => 1,
      pages: {
        SlopweaverYieldComments: { node: { comments: { nodes: whole, totalCount: 11 } }, rateLimit: RATE },
        SlopweaverYieldSearch: {
          rateLimit: RATE,
          search: {
            issueCount: 1,
            nodes: [prNode({ number: 8, threads: [threadNode({ comments: inline, id: "T2", total: 11 })] })],
            pageInfo: { endCursor: null, hasNextPage: false },
          },
        },
      },
    });
    const dataset = unwrap(await readCoderabbitYield({ graphql, progress: () => undefined, selection: SELECTION }));
    expect(sent).toContain("SlopweaverYieldComments T2");
    expect([dataset.prs[0]!.threads[0]!.comments.length, dataset.prs[0]!.threads[0]!.commentsComplete]).toEqual([
      11,
      true,
    ]);
  });

  it("fails the whole read on a malformed page rather than returning a short dataset", async () => {
    const { graphql } = fakeGraphql({
      counts: () => 1,
      pages: { SlopweaverYieldSearch: { rateLimit: RATE, search: { nodes: "not a list" } } },
    });
    const read = await readCoderabbitYield({ graphql, progress: () => undefined, selection: SELECTION });
    expect(unwrapErr(read).message).toBe("GitHub returned a malformed search connection for the coderabbit-yield read");
  });

  it("records a gap when a range ends short of the count its own search reported", async () => {
    const { graphql } = fakeGraphql({
      counts: () => 1,
      pages: {
        SlopweaverYieldSearch: {
          rateLimit: RATE,
          search: { issueCount: 1, nodes: [], pageInfo: { endCursor: null, hasNextPage: false } },
        },
      },
    });
    const dataset = unwrap(await readCoderabbitYield({ graphql, progress: () => undefined, selection: SELECTION }));
    expect(dataset.gaps).toEqual([
      "is:pr repo:acme/acme-admin author:octocat created:2026-09-01T00:00:00+00:00..2026-09-03T00:00:00+00:00: read 0 of 1 matching pull requests",
    ]);
  });

  it("records a gap for a count that is not a whole, non-negative number", async () => {
    const { graphql } = fakeGraphql({
      counts: () => 1,
      pages: {
        SlopweaverYieldSearch: {
          rateLimit: RATE,
          search: { issueCount: -1, nodes: [], pageInfo: { endCursor: null, hasNextPage: false } },
        },
      },
    });
    const dataset = unwrap(await readCoderabbitYield({ graphql, progress: () => undefined, selection: SELECTION }));
    expect(dataset.gaps).toEqual([
      "is:pr repo:acme/acme-admin author:octocat created:2026-09-01T00:00:00+00:00..2026-09-03T00:00:00+00:00: read 0 of -1 matching pull requests",
    ]);
  });

  it("does not let a pull request repeated across pages stand in for one the search skipped", async () => {
    const pageOne = { endCursor: "c1", hasNextPage: true };
    const pageTwo = { endCursor: null, hasNextPage: false };
    const search = ({ pageInfo }: { pageInfo: unknown }) => ({
      rateLimit: RATE,
      search: { issueCount: 2, nodes: [prNode({ number: 1, threads: [] })], pageInfo },
    });
    const { graphql } = fakeGraphql({ counts: () => 2, pages: {} });
    const paged: GithubReadGraphql = async (args) => {
      if (!args.query.includes("SlopweaverYieldSearch")) {
        return graphql(args);
      }
      return ok(search({ pageInfo: args.variables["after"] === undefined ? pageOne : pageTwo }));
    };
    const dataset = unwrap(
      await readCoderabbitYield({ graphql: paged, progress: () => undefined, selection: SELECTION }),
    );
    expect([dataset.prs.length, dataset.gaps]).toEqual([
      1,
      [
        "is:pr repo:acme/acme-admin author:octocat created:2026-09-01T00:00:00+00:00..2026-09-03T00:00:00+00:00: read 1 of 2 matching pull requests",
      ],
    ]);
  });

  it("stops at the rate reserve and says how many points were left", async () => {
    const { graphql } = fakeGraphql({ counts: () => 1, pages: {} });
    const starved: GithubReadGraphql = async (args) => {
      const response = await graphql(args);
      return response.map((value) => ({ ...(value as object), rateLimit: { cost: 1, remaining: 50 } }));
    };
    const read = await readCoderabbitYield({ graphql: starved, progress: () => undefined, selection: SELECTION });
    expect(unwrapErr(read).message).toBe("stopped with 50 GraphQL points left, the 100 held in reserve");
  });
});

describe("viewerLogin", () => {
  it("answers the token's own login", async () => {
    const { graphql } = fakeGraphql({ counts: () => 0, pages: {} });
    expect(unwrap(await viewerLogin({ graphql }))).toBe("octocat");
  });
});
