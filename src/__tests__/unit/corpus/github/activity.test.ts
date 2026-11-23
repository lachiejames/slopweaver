import { describe, expect, it } from "vitest";
import { makeFetchGithubActivity, parseActivity, saturatedConnections } from "../../../../corpus/github/activity.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const prNode = {
  comments: { nodes: [{ author: { login: "c1" }, body: "a comment", createdAt: "2024-01-01T11:00:00Z", url: "u2" }] },
  commits: { nodes: [{ commit: { statusCheckRollup: { state: "SUCCESS" } } }] },
  isDraft: false,
  mergeable: "MERGEABLE",
  reviewDecision: "APPROVED",
  reviews: {
    nodes: [
      { author: { login: "rev" }, body: "lgtm", state: "APPROVED", submittedAt: "2024-01-01T10:00:00Z", url: "u1" },
    ],
  },
  reviewThreads: {
    nodes: [
      {
        comments: {
          nodes: [{ author: { login: "c2" }, body: "thread", createdAt: "2024-01-01T12:00:00Z", url: "u3" }],
        },
        isResolved: true,
      },
    ],
  },
  state: "OPEN",
  timelineItems: {
    nodes: [{ __typename: "MergedEvent", actor: { login: "merger" }, createdAt: "2024-01-02T00:00:00Z" }],
  },
  updatedAt: "2024-01-02T00:00:00Z",
};

describe("parseActivity", () => {
  it("parses a PR node — reviews, issue+thread comments, checks, timeline", () => {
    const activity = parseActivity({ isPr: true, node: prNode });
    expect(activity.state).toBe("OPEN");
    expect(activity.checks).toBe("SUCCESS");
    expect(activity.reviews).toHaveLength(1);
    expect(activity.comments).toHaveLength(2);
    expect(activity.comments[1]!.resolved).toBe(true);
    expect(activity.timeline).toEqual([
      {
        actor: "merger",
        raw: { __typename: "MergedEvent", actor: { login: "merger" }, createdAt: "2024-01-02T00:00:00Z" },
        tsIso: "2024-01-02T00:00:00Z",
        type: "Merged",
      },
    ]);
  });

  it("keeps raw GraphQL child nodes on parsed reviews, comments, and timeline events", () => {
    const activity = parseActivity({ isPr: true, node: prNode });
    expect(activity.reviews[0]!.raw).toEqual({
      author: { login: "rev" },
      body: "lgtm",
      state: "APPROVED",
      submittedAt: "2024-01-01T10:00:00Z",
      url: "u1",
    });
    expect(activity.comments[0]!.raw).toEqual({
      author: { login: "c1" },
      body: "a comment",
      createdAt: "2024-01-01T11:00:00Z",
      url: "u2",
    });
    expect(activity.timeline[0]!.raw).toEqual({
      __typename: "MergedEvent",
      actor: { login: "merger" },
      createdAt: "2024-01-02T00:00:00Z",
    });
  });

  it("an issue node carries no reviews and degrades missing fields to empty", () => {
    const activity = parseActivity({ isPr: false, node: { comments: { nodes: [] }, state: "CLOSED" } });
    expect(activity.reviews).toEqual([]);
    expect(activity.checks).toBeUndefined();
    expect(activity.comments).toEqual([]);
  });
});

describe("makeFetchGithubActivity", () => {
  const repo = { owner: "o", repo: "r" };

  it("returns the parsed activity for a present node", async () => {
    const fetch = makeFetchGithubActivity({ graphql: async () => ({ repository: { pullRequest: prNode } }) });
    const result = await fetch({ isPr: true, number: 1, repo });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result).checks).toBe("SUCCESS");
  });

  it("passes the EXACT variables the query declares, for both the PR and the issue lane", async () => {
    // `GraphqlRunner` is positional because it mirrors `@octokit/graphql`, so dropping or reordering the
    // variables bag still typechecks — and every other fake here takes zero arguments, so nothing would
    // notice. Asserted by exact value: the real query declares `$owner`, `$repo` and `$number` as required,
    // so an empty bag fails against GitHub while passing a fake that ignores its arguments.
    const calls: { query: string; variables: Record<string, unknown> }[] = [];
    const fetch = makeFetchGithubActivity({
      graphql: async (query, variables) => {
        calls.push({ query, variables });
        return { repository: { issue: prNode, pullRequest: prNode } };
      },
    });
    await fetch({ isPr: true, number: 7, repo });
    await fetch({ isPr: false, number: 8, repo });
    expect(calls.map((c) => c.variables)).toEqual([
      { number: 7, owner: "o", repo: "r" },
      { number: 8, owner: "o", repo: "r" },
    ]);
    // The two lanes must send DIFFERENT documents — one query for pullRequest, one for issue.
    expect(calls[0]!.query).toContain("pullRequest(number:$number)");
    expect(calls[1]!.query).toContain("issue(number:$number)");
    expect(calls[0]!.query).not.toBe(calls[1]!.query);
  });

  it("errs (not throws) when the item is absent", async () => {
    const fetch = makeFetchGithubActivity({ graphql: async () => ({ repository: { pullRequest: null } }) });
    const result = await fetch({ isPr: true, number: 9, repo });
    expect(unwrapErr(result).code).toBe("ACTIVITY_NODE_NOT_FOUND");
    expect(unwrapErr(result).message).toBe("no pull request #9 in GraphQL response");
  });

  it("errs when the transport throws", async () => {
    const fetch = makeFetchGithubActivity({
      graphql: async () => {
        throw new Error("rate limited");
      },
    });
    const result = await fetch({ isPr: true, number: 1, repo });
    expect(unwrapErr(result).code).toBe("ACTIVITY_FETCH_FAILED");
    expect(unwrapErr(result).message).toBe("rate limited");
  });
});

const widePrNode = {
  additions: 412,
  baseRefName: "main",
  baseRefOid: "b".repeat(40),
  changedFiles: 9,
  comments: { nodes: [] },
  deletions: 87,
  headRefName: "widen-the-selection-set",
  headRefOid: "h".repeat(40),
  headRepository: { nameWithOwner: "o/r" },
  mergeCommit: { oid: "m".repeat(40) },
  mergedAt: "2026-09-12T09:00:00Z",
  mergedBy: { login: "merger" },
  reviews: {
    nodes: [
      {
        author: { login: "rev" },
        body: "lgtm",
        commit: { oid: "c".repeat(40) },
        state: "APPROVED",
        submittedAt: "2026-09-12T08:00:00Z",
        url: "u1",
      },
    ],
  },
  reviewThreads: {
    nodes: [
      {
        comments: {
          nodes: [
            {
              author: { login: "c2" },
              body: "this will break under load",
              commit: { oid: "d".repeat(40) },
              createdAt: "2026-09-12T07:00:00Z",
              diffHunk: "@@ -1,3 +1,4 @@\n+const x = 1;",
              line: 42,
              originalLine: 40,
              outdated: false,
              path: "src/lib/paging.ts",
              url: "u3",
            },
            {
              author: { login: "c3" },
              body: "still true",
              createdAt: "2026-09-12T07:30:00Z",
              line: null,
              originalLine: 17,
              outdated: true,
              path: "src/lib/paging.ts",
              url: "u4",
            },
          ],
        },
        isOutdated: false,
        isResolved: false,
        line: 42,
        path: "src/lib/paging.ts",
      },
    ],
  },
  state: "MERGED",
  timelineItems: { nodes: [] },
  updatedAt: "2026-09-12T09:00:00Z",
};

describe("the widened selection set", () => {
  it("promotes head, base, merged_by and the diff size off a PR node", () => {
    const activity = parseActivity({ isPr: true, node: widePrNode });
    expect(activity.headRefName).toBe("widen-the-selection-set");
    expect(activity.headRefOid).toBe("h".repeat(40));
    expect(activity.baseRefName).toBe("main");
    expect(activity.baseRefOid).toBe("b".repeat(40));
    expect(activity.headRepository).toBe("o/r");
    expect(activity.mergedBy).toBe("merger");
    expect(activity.mergedAtIso).toBe("2026-09-12T09:00:00Z");
    expect(activity.mergeCommitOid).toBe("m".repeat(40));
    expect(activity.additions).toBe(412);
    expect(activity.deletions).toBe(87);
    expect(activity.changedFiles).toBe(9);
  });

  it("gives an issue node none of the PR-only fields", () => {
    const activity = parseActivity({ isPr: false, node: widePrNode });
    expect(activity.headRefName).toBeUndefined();
    expect(activity.mergedBy).toBeUndefined();
    expect(activity.additions).toBeUndefined();
    expect(activity.reviews).toEqual([]);
  });

  it("anchors a review comment to its file and line, with its diff hunk and commit", () => {
    const comment = parseActivity({ isPr: true, node: widePrNode }).comments[0]!;
    expect(comment.path).toBe("src/lib/paging.ts");
    expect(comment.line).toBe(42);
    expect(comment.outdated).toBe(false);
    expect(comment.diffHunk).toBe("@@ -1,3 +1,4 @@\n+const x = 1;");
    expect(comment.commitOid).toBe("d".repeat(40));
  });

  it("falls back to originalLine when an outdated comment's line is null", () => {
    const comment = parseActivity({ isPr: true, node: widePrNode }).comments[1]!;
    expect(comment.line).toBe(17);
    expect(comment.outdated).toBe(true);
    expect(comment.path).toBe("src/lib/paging.ts");
  });

  it("records which commit a review was submitted against", () => {
    expect(parseActivity({ isPr: true, node: widePrNode }).reviews[0]!.commitOid).toBe("c".repeat(40));
  });

  it("keeps the item node's own fields as raw, without a second copy of every child body", () => {
    const raw = parseActivity({ isPr: true, node: widePrNode }).raw!;
    expect(raw["headRefName"]).toBe("widen-the-selection-set");
    expect(raw["mergedBy"]).toEqual({ login: "merger" });
    expect(Object.keys(raw).toSorted()).toEqual([
      "additions",
      "baseRefName",
      "baseRefOid",
      "changedFiles",
      "deletions",
      "headRefName",
      "headRefOid",
      "headRepository",
      "mergeCommit",
      "mergedAt",
      "mergedBy",
      "state",
      "updatedAt",
    ]);
  });

  it("drops a null scalar rather than capturing it as a value", () => {
    const raw = parseActivity({ isPr: true, node: { comments: { nodes: [] }, mergedAt: null, state: "OPEN" } }).raw!;
    expect(Object.keys(raw).toSorted()).toEqual(["state"]);
  });
});

describe("the selection set asks for file and line on every review comment", () => {
  it("names path and line on both the thread and its comments, and originalLine beside it", async () => {
    const calls: string[] = [];
    const fetch = makeFetchGithubActivity({
      graphql: async (query) => {
        calls.push(query);
        return { repository: { pullRequest: widePrNode } };
      },
    });
    await fetch({ isPr: true, number: 1, repo: { owner: "o", repo: "r" } });
    const query = calls[0]!;
    expect(query).toContain("path line originalLine startLine originalStartLine diffHunk outdated");
    expect(query).toContain("headRefName headRefOid baseRefName baseRefOid");
    expect(query).toContain("mergedBy{login __typename ... on User{databaseId}} mergeCommit{oid}");
    expect(query).toContain("additions deletions changedFiles");
  });

  it("stays ONE call per item — a wider set is more bytes on the same call, never a second one", async () => {
    let calls = 0;
    const fetch = makeFetchGithubActivity({
      graphql: async () => {
        calls += 1;
        return { repository: { pullRequest: widePrNode } };
      },
    });
    await fetch({ isPr: true, number: 1, repo: { owner: "o", repo: "r" } });
    await fetch({ isPr: true, number: 2, repo: { owner: "o", repo: "r" } });
    expect(calls).toBe(2);
  });

  it("adds no new connection — every `first:`/`last:` is one the last backfill already paid for", async () => {
    const calls: string[] = [];
    const fetch = makeFetchGithubActivity({
      graphql: async (query) => {
        calls.push(query);
        return { repository: { pullRequest: widePrNode, issue: widePrNode } };
      },
    });
    await fetch({ isPr: true, number: 1, repo: { owner: "o", repo: "r" } });
    await fetch({ isPr: false, number: 2, repo: { owner: "o", repo: "r" } });
    // GitHub scores a GraphQL call off its connections' first/last, so this is the cost property the
    // owner's "same call count as the last backfill" rests on: scalars are free, a connection is not.
    expect(calls[0]!.match(/first:\d+|last:\d+/g)).toEqual([
      "last:1",
      "first:100",
      "first:100",
      "first:100",
      "first:100",
      "first:100",
    ]);
    expect(calls[1]!.match(/first:\d+|last:\d+/g)).toEqual(["first:100", "first:100"]);
  });
});

describe("a connection that came back FULL says so", () => {
  const full = ({ count }: { count: number }): { nodes: Record<string, unknown>[] } => ({
    nodes: Array.from({ length: count }, (_unused, i) => ({
      body: `b${String(i)}`,
      createdAt: "2026-09-12T00:00:00Z",
    })),
  });

  it("names nothing when every connection was short", () => {
    expect(saturatedConnections({ node: widePrNode })).toEqual([]);
  });

  it("names reviews when a hundred came back", () => {
    expect(saturatedConnections({ node: { ...widePrNode, reviews: full({ count: 100 }) } })).toEqual(["reviews"]);
  });

  it("names every saturated connection, sorted", () => {
    const node = {
      ...widePrNode,
      comments: full({ count: 100 }),
      reviews: full({ count: 100 }),
      timelineItems: full({ count: 100 }),
    };
    expect(saturatedConnections({ node })).toEqual(["comments", "reviews", "timelineItems"]);
  });

  it("names a saturated thread's own comments separately from the thread list", () => {
    const node = { ...widePrNode, reviewThreads: { nodes: [{ comments: full({ count: 100 }), isResolved: false }] } };
    expect(saturatedConnections({ node })).toEqual(["reviewThreadComments"]);
  });

  it("never names commits — it asks for last:1, so one node is complete", () => {
    expect(saturatedConnections({ node: { ...widePrNode, commits: full({ count: 1 }) } })).toEqual([]);
  });

  it("ignores a connection one node short of the page", () => {
    expect(saturatedConnections({ node: { ...widePrNode, reviews: full({ count: 99 }) } })).toEqual([]);
  });

  it("reaches parseActivity, so every record can carry the marker", () => {
    expect(parseActivity({ isPr: true, node: { ...widePrNode, reviews: full({ count: 100 }) } }).truncated).toEqual([
      "reviews",
    ]);
  });
});

describe("the stable user id rides beside every mutable login", () => {
  it("asks for User.databaseId on every actor the two documents name", async () => {
    const calls: string[] = [];
    const fetch = makeFetchGithubActivity({
      graphql: async (query) => {
        calls.push(query);
        return { repository: { issue: widePrNode, pullRequest: widePrNode } };
      },
    });
    await fetch({ isPr: true, number: 1, repo: { owner: "o", repo: "r" } });
    await fetch({ isPr: false, number: 2, repo: { owner: "o", repo: "r" } });
    // A login is mutable and the numeric id is not, so the id is what makes a rename recoverable from
    // bronze instead of by re-fetch. Counted, not merely present: a sub-selection missed on one actor is
    // exactly the Linear defect this file's own rule was written after.
    expect(calls[0]!.match(/\.\.\. on User\{databaseId\}/g)).toHaveLength(10);
    expect(calls[1]!.match(/\.\.\. on User\{databaseId\}/g)).toHaveLength(3);
  });
});
