/**
 * The two reads `github bump-drive`'s close act decides from — and, as with `ownOpenHeads`, that a list which does
 * not add up is a FAILED read rather than a short one. A short open list hides a superseded bump; a short merged
 * list hides the merge that superseded it.
 *
 * The App login's search spelling is built and tested in `organisation/dependencyBots.ts`.
 */
import { describe, expect, it } from "vitest";

import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import { GithubLiveErrors } from "../../../../live/github/errors.js";
import type { GithubReadGraphql } from "../../../../live/github/read.js";
import { mergedPrOf, ownOpenPrOf } from "../../../../live/github/supersedeNodes.js";
import {
  mergedSearchTerm,
  readMergedRenovatePrs,
  readOwnOpenPrs,
  SUPERSEDE_READ_PAGE_CAP,
} from "../../../../live/github/supersedeReads.js";

const openNode = ({
  number,
  repo = "acme/acme-admin",
  labels = { nodes: [], totalCount: 0 },
}: {
  number: number;
  repo?: string;
  labels?: unknown;
}): Record<string, unknown> => ({
  baseRef: { target: { oid: "b".repeat(40), tree: { oid: "d".repeat(40) } } },
  baseRefName: "staging",
  createdAt: "2026-10-05T23:00:00Z",
  files: { nodes: [{ path: "yarn.lock" }], totalCount: 1 },
  headRefOid: "c".repeat(40),
  labels,
  mergeable: "MERGEABLE",
  number,
  potentialMergeCommit: {
    parents: { nodes: [{ oid: "b".repeat(40) }, { oid: "c".repeat(40) }], totalCount: 2 },
    tree: { oid: "e".repeat(40) },
  },
  repository: { nameWithOwner: repo },
  title: "chore(deps): update dependency @ai-sdk/openai to v3.0.119",
  url: `https://github.com/${repo}/pull/${String(number)}`,
});

const mergedNode = ({
  number,
  login = "acme-renovate",
}: {
  number: number;
  login?: string;
}): Record<string, unknown> => ({
  author: { __typename: "Bot", login },
  baseRefName: "staging",
  mergedAt: "2026-10-06T02:04:26Z",
  number,
  repository: { nameWithOwner: "acme/acme-admin" },
  title: "chore(deps): update dependency @ai-sdk/openai to v3.0.124",
  url: `https://github.com/acme/acme-admin/pull/${String(number)}`,
});

/** What the acme-admin search for the organisation's own Renovate App's merges since the window start asked. */
const ASKED = {
  author: "app/acme-renovate",
  repoSlug: "acme/acme-admin",
  sinceIso: "2026-10-05T23:00:00.000Z",
};

/** One page of a connection, wrapped the way the viewer read or the search read sees it. */
const page = ({
  nodes,
  count,
  endCursor,
  viewer,
}: {
  nodes: readonly unknown[];
  count: number;
  endCursor?: string;
  viewer: boolean;
}): unknown => {
  let cursor: string | null = null;
  if (endCursor !== undefined) {
    cursor = endCursor;
  }
  const pageInfo = { endCursor: cursor, hasNextPage: endCursor !== undefined };
  if (viewer) {
    return { viewer: { pullRequests: { nodes, pageInfo, totalCount: count } } };
  }
  return { search: { issueCount: count, nodes, pageInfo } };
};

/** A GraphQL seam answering from a list of pages in order, recording every variables bag it was asked with. */
function pagedGraphql({ pages }: { pages: readonly unknown[] }): {
  graphql: GithubReadGraphql;
  asked: Readonly<Record<string, unknown>>[];
} {
  const asked: Readonly<Record<string, unknown>>[] = [];
  const graphql: GithubReadGraphql = ({ variables }) => {
    asked.push(variables);
    return Promise.resolve(ok(pages[asked.length - 1]));
  };
  return { asked, graphql };
}

describe("ownOpenPrOf", () => {
  it("reads the pull request and its test merge", () => {
    expect(ownOpenPrOf({ node: openNode({ number: 18243 }) })).toEqual({
      baseRefName: "staging",
      changedPaths: ["yarn.lock"],
      createdAtIso: "2026-10-05T23:00:00Z",
      headOid: "c".repeat(40),
      labels: [],
      number: 18243,
      repoSlug: "acme/acme-admin",
      testMerge: {
        baseTipOid: "b".repeat(40),
        baseTipTreeOid: "d".repeat(40),
        mergeTreeOid: "e".repeat(40),
        mergeable: "MERGEABLE",
        parentOids: ["b".repeat(40), "c".repeat(40)],
      },
      title: "chore(deps): update dependency @ai-sdk/openai to v3.0.119",
      url: "https://github.com/acme/acme-admin/pull/18243",
    });
  });

  it("carries an absent test merge as absent, for the judge to call unanswerable", () => {
    const parsed = ownOpenPrOf({ node: { ...openNode({ number: 1 }), baseRef: null, potentialMergeCommit: null } });
    expect(parsed!.testMerge).toEqual({
      baseTipOid: undefined,
      baseTipTreeOid: undefined,
      mergeTreeOid: undefined,
      mergeable: "MERGEABLE",
      parentOids: [],
    });
  });

  it("refuses a node whose labels were truncated, since an opt-out label could be the one missing", () => {
    expect(ownOpenPrOf({ node: openNode({ labels: { nodes: [{ name: "a" }], totalCount: 2 }, number: 1 }) })).toBe(
      undefined,
    );
  });

  it("refuses a test merge whose parents were truncated, since the missing one decides the no-diff arm", () => {
    const parents = { nodes: [{ oid: "b".repeat(40) }, { oid: "c".repeat(40) }], totalCount: 4 };
    const node = { ...openNode({ number: 1 }), potentialMergeCommit: { parents, tree: { oid: "e".repeat(40) } } };
    expect(ownOpenPrOf({ node })).toBe(undefined);
  });

  it("refuses a test merge carrying a parent with no oid rather than dropping that parent", () => {
    const parents = { nodes: [{ oid: "b".repeat(40) }, { oid: null }], totalCount: 2 };
    const node = { ...openNode({ number: 1 }), potentialMergeCommit: { parents, tree: { oid: "e".repeat(40) } } };
    expect(ownOpenPrOf({ node })).toBe(undefined);
  });

  it("carries a file list longer than one page as past-one-page, never as the page it read", () => {
    const files = { nodes: [{ path: "yarn.lock" }], totalCount: 140 };
    expect(ownOpenPrOf({ node: { ...openNode({ number: 1 }), files } })!.changedPaths).toBe("past-one-page");
  });

  it("refuses a file list carrying a path-less entry rather than dropping it", () => {
    const files = { nodes: [{ path: "yarn.lock" }, { path: null }], totalCount: 2 };
    expect(ownOpenPrOf({ node: { ...openNode({ number: 1 }), files } })).toBe(undefined);
  });

  it("refuses a file list with more entries than its own count", () => {
    const files = { nodes: [{ path: "yarn.lock" }, { path: "package.json" }], totalCount: 1 };
    expect(ownOpenPrOf({ node: { ...openNode({ number: 1 }), files } })).toBe(undefined);
  });

  it("refuses a file list naming one path twice, which could stand in for a file the count holds", () => {
    const files = { nodes: [{ path: "yarn.lock" }, { path: "yarn.lock" }], totalCount: 2 };
    expect(ownOpenPrOf({ node: { ...openNode({ number: 1 }), files } })).toBe(undefined);
  });

  it("refuses a node whose url names another pull request than its own repository and number", () => {
    const node = { ...openNode({ number: 18243 }), url: "https://github.com/acme/acme-admin/pull/1" };
    expect(ownOpenPrOf({ node })).toBe(undefined);
  });

  it("refuses a head that is not a full sha, and reads a malformed merge tree as unanswerable", () => {
    expect(ownOpenPrOf({ node: { ...openNode({ number: 1 }), headRefOid: "x" } })).toBe(undefined);
    const merge = { ...(openNode({ number: 1 })["potentialMergeCommit"] as object), tree: { oid: "z" } };
    const pr = ownOpenPrOf({ node: { ...openNode({ number: 1 }), potentialMergeCommit: merge } })!;
    expect(pr.testMerge.mergeTreeOid).toBe(undefined);
  });

  it("refuses a test-merge parent that is not a full sha", () => {
    const parents = { nodes: [{ oid: "x" }, { oid: "c".repeat(40) }], totalCount: 2 };
    const node = { ...openNode({ number: 1 }), potentialMergeCommit: { parents, tree: { oid: "e".repeat(40) } } };
    expect(ownOpenPrOf({ node })).toBe(undefined);
  });

  it("refuses a creation instant that does not parse, or names no real day", () => {
    expect(ownOpenPrOf({ node: { ...openNode({ number: 1 }), createdAt: "not-a-date" } })).toBe(undefined);
    expect(ownOpenPrOf({ node: { ...openNode({ number: 1 }), createdAt: "2026-02-30T00:00:00Z" } })).toBe(undefined);
  });

  it("refuses a node with no head", () => {
    expect(ownOpenPrOf({ node: { ...openNode({ number: 1 }), headRefOid: null } })).toBe(undefined);
  });
});

describe("mergedPrOf", () => {
  it("reads a merged pull request", () => {
    expect(mergedPrOf({ ...ASKED, node: mergedNode({ number: 16761 }) })).toEqual({
      baseRefName: "staging",
      mergedAtIso: "2026-10-06T02:04:26Z",
      number: 16761,
      title: "chore(deps): update dependency @ai-sdk/openai to v3.0.124",
      url: "https://github.com/acme/acme-admin/pull/16761",
    });
  });

  it("refuses a node with no merge instant", () => {
    expect(mergedPrOf({ ...ASKED, node: { ...mergedNode({ number: 1 }), mergedAt: null } })).toBe(undefined);
  });

  it("refuses a merge instant naming no real day, which a lenient parse would normalise", () => {
    const node = { ...mergedNode({ number: 1 }), mergedAt: "2026-02-30T00:00:00Z" };
    expect(mergedPrOf({ ...ASKED, node })).toBe(undefined);
  });

  it("refuses a node whose url names another pull request than its own repository and number", () => {
    const node = { ...mergedNode({ number: 16761 }), url: "https://github.com/other/repo/pull/999" };
    expect(mergedPrOf({ ...ASKED, node })).toBe(undefined);
  });

  it("refuses a node from another repository", () => {
    const node = { ...mergedNode({ number: 1 }), repository: { nameWithOwner: "lachiejames/slopweaver" } };
    expect(mergedPrOf({ ...ASKED, node })).toBe(undefined);
  });

  it("reads the repository case-insensitively", () => {
    const node = { ...mergedNode({ number: 7 }), repository: { nameWithOwner: "Acme/ACME-Admin" } };
    expect(mergedPrOf({ ...ASKED, node })!.number).toBe(7);
  });

  it("refuses a node by another author", () => {
    expect(mergedPrOf({ ...ASKED, node: mergedNode({ login: "dependabot", number: 1 }) })).toBe(undefined);
  });

  it("refuses an author of the same login that is not a bot", () => {
    const node = { ...mergedNode({ number: 1 }), author: { __typename: "User", login: "acme-renovate" } };
    expect(mergedPrOf({ ...ASKED, node })).toBe(undefined);
  });

  it("refuses a node with no author", () => {
    expect(mergedPrOf({ ...ASKED, node: { ...mergedNode({ number: 1 }), author: null } })).toBe(undefined);
  });

  it("refuses a merge before the instant searched, and keeps one at it to the second", () => {
    const early = { ...mergedNode({ number: 1 }), mergedAt: "2026-10-05T22:59:59Z" };
    const atTheSecond = { ...mergedNode({ number: 2 }), mergedAt: "2026-10-05T23:00:00Z" };
    expect(mergedPrOf({ ...ASKED, node: early })).toBe(undefined);
    expect(mergedPrOf({ ...ASKED, node: atTheSecond })!.number).toBe(2);
  });
});

describe("readOwnOpenPrs", () => {
  it("reads the owner's WHOLE open list and keeps the asked repository's, matched without regard to case", async () => {
    const { graphql, asked } = pagedGraphql({
      pages: [
        page({
          count: 3,
          endCursor: "c1",
          nodes: [openNode({ number: 1 }), openNode({ number: 2, repo: "o/other" })],
          viewer: true,
        }),
        page({ count: 3, nodes: [openNode({ number: 3 })], viewer: true }),
      ],
    });
    const prs = unwrap(await readOwnOpenPrs({ graphql, repoSlug: "Acme/acme-admin" }));
    expect(prs.map((pr) => pr.number)).toEqual([1, 3]);
    expect(asked.map((variables) => variables["after"])).toEqual([undefined, "c1"]);
  });

  it("reads an entry repeated across a page boundary once", async () => {
    const { graphql } = pagedGraphql({
      pages: [
        page({ count: 2, endCursor: "c1", nodes: [openNode({ number: 1 })], viewer: true }),
        page({ count: 2, nodes: [openNode({ number: 1 }), openNode({ number: 2 })], viewer: true }),
      ],
    });
    expect(unwrap(await readOwnOpenPrs({ graphql, repoSlug: "acme/acme-admin" })).map((pr) => pr.number)).toEqual([
      1, 2,
    ]);
  });

  it("refuses a list short of GitHub's count, so a missing bump is never read as not open", async () => {
    const { graphql } = pagedGraphql({ pages: [page({ count: 2, nodes: [openNode({ number: 1 })], viewer: true })] });
    expect(unwrapErr(await readOwnOpenPrs({ graphql, repoSlug: "acme/acme-admin" })).message).toBe(
      "GitHub's list of the owner's open pull requests listed 1 against its count of 2",
    );
  });

  it("counts two spellings of one pull request once, so they never stand in for one left out", async () => {
    const twice = openNode({ number: 1, repo: "Acme/acme-admin" });
    const { graphql } = pagedGraphql({
      pages: [page({ count: 2, nodes: [openNode({ number: 1 }), twice], viewer: true })],
    });
    expect(unwrapErr(await readOwnOpenPrs({ graphql, repoSlug: "acme/acme-admin" })).message).toBe(
      "GitHub's list of the owner's open pull requests listed 1 against its count of 2",
    );
  });

  it("refuses pages whose count moved while they were read", async () => {
    const { graphql } = pagedGraphql({
      pages: [
        page({ count: 2, endCursor: "c1", nodes: [openNode({ number: 1 })], viewer: true }),
        page({ count: 3, nodes: [openNode({ number: 2 })], viewer: true }),
      ],
    });
    expect(unwrapErr(await readOwnOpenPrs({ graphql, repoSlug: "acme/acme-admin" })).message).toBe(
      "GitHub's list of the owner's open pull requests changed its count between pages — the list moved while it was paged",
    );
  });

  it("refuses a page carrying a node it cannot parse rather than dropping it", async () => {
    const { graphql } = pagedGraphql({
      pages: [page({ count: 1, nodes: [{ ...openNode({ number: 1 }), title: null }], viewer: true })],
    });
    expect(unwrapErr(await readOwnOpenPrs({ graphql, repoSlug: "acme/acme-admin" })).message).toBe(
      "GitHub's list of the owner's open pull requests carried a node missing a field this decision reads, or one it did not ask for",
    );
  });

  it("refuses a page whose test merge carries a parent with no oid, never reading it as two parents", async () => {
    const parents = { nodes: [{ oid: "b".repeat(40) }, { oid: "c".repeat(40) }, { oid: null }], totalCount: 3 };
    const node = { ...openNode({ number: 1 }), potentialMergeCommit: { parents, tree: { oid: "d".repeat(40) } } };
    const { graphql } = pagedGraphql({ pages: [page({ count: 1, nodes: [node], viewer: true })] });
    expect(unwrapErr(await readOwnOpenPrs({ graphql, repoSlug: "acme/acme-admin" })).message).toBe(
      "GitHub's list of the owner's open pull requests carried a node missing a field this decision reads, or one it did not ask for",
    );
  });

  it("refuses a response with no viewer connection", async () => {
    const { graphql } = pagedGraphql({ pages: [{ viewer: null }] });
    expect(unwrapErr(await readOwnOpenPrs({ graphql, repoSlug: "acme/acme-admin" })).message).toBe(
      "GitHub's list of the owner's open pull requests came back without its connection",
    );
  });

  it("refuses a next page with no cursor to it", async () => {
    const data = {
      viewer: { pullRequests: { nodes: [], pageInfo: { endCursor: null, hasNextPage: true }, totalCount: 1 } },
    };
    const { graphql } = pagedGraphql({ pages: [data] });
    expect(unwrapErr(await readOwnOpenPrs({ graphql, repoSlug: "acme/acme-admin" })).message).toBe(
      "GitHub's list of the owner's open pull requests said there is a next page and gave no cursor to it",
    );
  });

  it("refuses a list that runs past the page cap", async () => {
    const graphql: GithubReadGraphql = () =>
      Promise.resolve(ok(page({ count: 5000, endCursor: "again", nodes: [openNode({ number: 1 })], viewer: true })));
    expect(unwrapErr(await readOwnOpenPrs({ graphql, repoSlug: "acme/acme-admin" })).message).toBe(
      `GitHub's list of the owner's open pull requests ran past ${String(SUPERSEDE_READ_PAGE_CAP * 50)} entries`,
    );
  });

  it("passes a transport failure through as the failure, never as an empty list", async () => {
    const graphql: GithubReadGraphql = () =>
      Promise.resolve(err(GithubLiveErrors.readFailed({ message: "Bad credentials" })));
    expect(unwrapErr(await readOwnOpenPrs({ graphql, repoSlug: "acme/acme-admin" })).message).toBe("Bad credentials");
  });
});

describe("readMergedRenovatePrs", () => {
  it("searches one identity's merges since the instant, to the second, and reads them whole", async () => {
    const { graphql, asked } = pagedGraphql({
      pages: [page({ count: 1, nodes: [mergedNode({ number: 16761 })], viewer: false })],
    });
    const prs = unwrap(
      await readMergedRenovatePrs({
        author: "app/acme-renovate",
        graphql,
        repoSlug: "acme/acme-admin",
        sinceIso: "2026-10-05T23:00:00.000Z",
      }),
    );
    expect(prs.map((pr) => pr.number)).toEqual([16761]);
    expect(asked[0]!["q"]).toBe(
      "repo:acme/acme-admin is:pr is:merged author:app/acme-renovate merged:>=2026-10-05T23:00:00Z",
    );
  });

  it("refuses a search short of its own issueCount", async () => {
    const { graphql } = pagedGraphql({
      pages: [page({ count: 4, nodes: [mergedNode({ login: "renovate", number: 1 })], viewer: false })],
    });
    expect(
      unwrapErr(
        await readMergedRenovatePrs({
          author: "app/renovate",
          graphql,
          repoSlug: "acme/acme-admin",
          sinceIso: "2026-10-05T23:00:00Z",
        }),
      ).message,
    ).toBe("GitHub's list of app/renovate's pull requests merged into acme/acme-admin listed 1 against its count of 4");
  });

  it("refuses a whole-count search answering about another repository rather than reading it as a merge here", async () => {
    const node = { ...mergedNode({ number: 1 }), repository: { nameWithOwner: "lachiejames/slopweaver" } };
    const { graphql } = pagedGraphql({ pages: [page({ count: 1, nodes: [node], viewer: false })] });
    expect(unwrapErr(await readMergedRenovatePrs({ ...ASKED, graphql })).message).toBe(
      "GitHub's list of app/acme-renovate's pull requests merged into acme/acme-admin carried a node missing a field this decision reads, or one it did not ask for",
    );
  });
});

describe("mergedSearchTerm", () => {
  // MEASURED: a bare self-hosted App login is a 422 through REST search and an EMPTY list through
  // GraphQL; only the app/ spelling finds the merge. Repro: slopweaver github search "is:pr is:merged
  // author:app/<login> merged:>=<since>" --repo <owner>/<repo>
  it("builds a term that carries the app spelling verbatim", () => {
    expect(
      mergedSearchTerm({
        author: "app/renovate",
        repoSlug: "lachiejames/slopweaver",
        sinceIso: "2026-10-01T00:00:00Z",
      }),
    ).toBe("repo:lachiejames/slopweaver is:pr is:merged author:app/renovate merged:>=2026-10-01T00:00:00Z");
  });
});
