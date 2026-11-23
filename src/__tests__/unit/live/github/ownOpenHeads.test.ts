/**
 * The list of the owner's open pull requests `worktree prune` holds trees on — and, above all, that a list which does
 * not add up is a FAILED read rather than a short one, because a branch missing from it is a tree removed.
 */
import { describe, expect, it } from "vitest";

import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import { GithubLiveErrors } from "../../../../live/github/errors.js";
import {
  joinOwnOpenHeads,
  OWN_OPEN_HEADS_PAGE_CAP,
  parseOwnOpenHeadsPage,
  readOwnOpenHeads,
} from "../../../../live/github/ownOpenHeads.js";
import type { GithubReadGraphql } from "../../../../live/github/read.js";

const node = ({ number, branch = `branch-${String(number)}` }: { number: number; branch?: string }): unknown => ({
  headRefName: branch,
  number,
  repository: { nameWithOwner: "lachiejames/slopweaver" },
});

const page = ({
  nodes,
  totalCount,
  endCursor,
}: {
  nodes: readonly unknown[];
  totalCount: number;
  endCursor?: string;
}): unknown => {
  // GitHub answers a null cursor on the last page, never an absent one.
  let cursor: string | null = null;
  if (endCursor !== undefined) {
    cursor = endCursor;
  }
  return {
    viewer: {
      pullRequests: { nodes, pageInfo: { endCursor: cursor, hasNextPage: endCursor !== undefined }, totalCount },
    },
  };
};

/** A GraphQL seam answering from a list of pages in order, recording every `after` it was asked with. */
function pagedGraphql({ pages }: { pages: readonly unknown[] }): { graphql: GithubReadGraphql; afters: unknown[] } {
  const afters: unknown[] = [];
  const graphql: GithubReadGraphql = ({ variables }) => {
    afters.push(variables["after"]);
    return Promise.resolve(ok(pages[afters.length - 1]));
  };
  return { afters, graphql };
}

describe("parseOwnOpenHeadsPage", () => {
  it("reads each pull request's repository, number and bare head branch", () => {
    const parsed = unwrap(
      parseOwnOpenHeadsPage({ data: page({ nodes: [node({ branch: "fix-x", number: 1697 })], totalCount: 1 }) }),
    );
    expect(parsed).toEqual({
      heads: [{ branch: "fix-x", number: 1697, repo: "lachiejames/slopweaver" }],
      nextCursor: undefined,
      totalCount: 1,
    });
  });

  it("carries the cursor to the next page", () => {
    const parsed = unwrap(parseOwnOpenHeadsPage({ data: page({ endCursor: "c1", nodes: [], totalCount: 3 }) }));
    expect(parsed.nextCursor).toBe("c1");
  });

  it("refuses a node with no head branch rather than dropping it", () => {
    const data = page({ nodes: [{ number: 5, repository: { nameWithOwner: "o/r" } }], totalCount: 1 });
    expect(unwrapErr(parseOwnOpenHeadsPage({ data })).message).toBe(
      "GitHub's list of the owner's open pull requests carried a node with no number, head branch or repository",
    );
  });

  it("refuses a node with no repository", () => {
    const data = page({ nodes: [{ headRefName: "x", number: 5 }], totalCount: 1 });
    expect(unwrapErr(parseOwnOpenHeadsPage({ data })).message).toContain("no number, head branch or repository");
  });

  it("refuses a response with no viewer", () => {
    expect(unwrapErr(parseOwnOpenHeadsPage({ data: { viewer: null } })).message).toBe(
      "GitHub's list of the owner's open pull requests came back without a viewer or its pull requests",
    );
  });

  it("refuses a next page that has no cursor to it", () => {
    const data = {
      viewer: { pullRequests: { nodes: [], pageInfo: { endCursor: null, hasNextPage: true }, totalCount: 2 } },
    };
    expect(unwrapErr(parseOwnOpenHeadsPage({ data })).message).toContain("gave no cursor to it");
  });
});

describe("joinOwnOpenHeads", () => {
  const head = ({ number }: { number: number }) => ({ branch: `b${String(number)}`, number, repo: "o/r" });

  it("joins pages into one list, each pull request once", () => {
    const joined = unwrap(
      joinOwnOpenHeads({
        pages: [
          { heads: [head({ number: 1 })], nextCursor: "c", totalCount: 2 },
          { heads: [head({ number: 1 }), head({ number: 2 })], nextCursor: undefined, totalCount: 2 },
        ],
      }),
    );
    expect(joined.map((entry) => entry.number)).toEqual([1, 2]);
  });

  it("refuses a list short of GitHub's own count, which would read a missing branch as having none open", () => {
    const joined = joinOwnOpenHeads({
      pages: [{ heads: [head({ number: 1 })], nextCursor: undefined, totalCount: 2 }],
    });
    expect(unwrapErr(joined).message).toBe(
      "GitHub's list of the owner's open pull requests listed 1 pull request(s) against GitHub's count of 2",
    );
  });

  it("refuses pages whose count moved while they were read", () => {
    const joined = joinOwnOpenHeads({
      pages: [
        { heads: [head({ number: 1 })], nextCursor: "c", totalCount: 2 },
        { heads: [head({ number: 2 })], nextCursor: undefined, totalCount: 3 },
      ],
    });
    expect(unwrapErr(joined).message).toContain("changed its count between pages");
  });

  it("refuses no pages at all", () => {
    expect(unwrapErr(joinOwnOpenHeads({ pages: [] })).message).toBe(
      "GitHub's list of the owner's open pull requests read no page",
    );
  });

  it("answers an empty list when the owner has no open pull request and GitHub counts none", () => {
    expect(unwrap(joinOwnOpenHeads({ pages: [{ heads: [], nextCursor: undefined, totalCount: 0 }] }))).toEqual([]);
  });
});

describe("readOwnOpenHeads", () => {
  it("pages to the end, asking each page after the last one's cursor", async () => {
    const { graphql, afters } = pagedGraphql({
      pages: [
        page({ endCursor: "c1", nodes: [node({ number: 1 })], totalCount: 2 }),
        page({ nodes: [node({ number: 2 })], totalCount: 2 }),
      ],
    });
    const heads = unwrap(await readOwnOpenHeads({ graphql }));
    expect(heads.map((entry) => entry.branch)).toEqual(["branch-1", "branch-2"]);
    expect(afters).toEqual([undefined, "c1"]);
  });

  it("passes a transport failure through as the failure, never as an empty list", async () => {
    const graphql: GithubReadGraphql = () =>
      Promise.resolve(err(GithubLiveErrors.readFailed({ message: "Bad credentials" })));
    expect(unwrapErr(await readOwnOpenHeads({ graphql })).message).toBe("Bad credentials");
  });

  it("refuses a list that runs past the page cap", async () => {
    const graphql: GithubReadGraphql = () =>
      Promise.resolve(ok(page({ endCursor: "again", nodes: [node({ number: 1 })], totalCount: 5000 })));
    expect(unwrapErr(await readOwnOpenHeads({ graphql })).message).toBe(
      `GitHub's list of the owner's open pull requests ran past ${String(OWN_OPEN_HEADS_PAGE_CAP * 100)} entries`,
    );
  });
});
