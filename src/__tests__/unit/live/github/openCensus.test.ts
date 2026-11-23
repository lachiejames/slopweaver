import { describe, expect, it } from "vitest";

import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import { GithubLiveErrors } from "../../../../live/github/errors.js";
import {
  CENSUS_PAGE_CAP,
  joinCensusPages,
  parseCensusPage,
  type RepoCensus,
  readOpenCensus,
} from "../../../../live/github/openCensus.js";
import type { GithubReadGraphql } from "../../../../live/github/read.js";

const node = ({
  number,
  draft = false,
  login = "ada",
}: {
  number: number;
  draft?: boolean;
  login?: string | null;
}): unknown => ({
  author: login === null ? null : { login },
  isDraft: draft,
  number,
  title: `pull request ${String(number)}`,
  url: `https://github.com/acme/widgets/pull/${String(number)}`,
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
    repository: {
      pullRequests: { nodes, pageInfo: { endCursor: cursor, hasNextPage: endCursor !== undefined }, totalCount },
    },
    viewer: { login: "ada" },
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

describe("parseCensusPage", () => {
  it("reads every node, a deleted author as absent, and the cursor only when GitHub says there is a next page", () => {
    const parsed = unwrap(
      parseCensusPage({
        data: page({
          endCursor: "c1",
          nodes: [node({ draft: true, number: 2 }), node({ login: null, number: 1 })],
          totalCount: 3,
        }),
      }),
    );
    expect(parsed).toStrictEqual({
      nextCursor: "c1",
      pullRequests: [
        {
          author: "ada",
          isDraft: true,
          number: 2,
          title: "pull request 2",
          url: "https://github.com/acme/widgets/pull/2",
        },
        {
          author: undefined,
          isDraft: false,
          number: 1,
          title: "pull request 1",
          url: "https://github.com/acme/widgets/pull/1",
        },
      ],
      totalCount: 3,
      viewer: "ada",
    });
  });

  it("fails the page rather than dropping a node it cannot name", () => {
    const failed = unwrapErr(parseCensusPage({ data: page({ nodes: [{ number: 1 }], totalCount: 1 }) }));
    expect(failed.message).toBe(
      "GitHub's open-pull-request census carried a node with no number, title, url or draft flag",
    );
  });

  it("fails a response with no repository connection", () => {
    const failed = unwrapErr(parseCensusPage({ data: { viewer: { login: "ada" } } }));
    expect(failed.message).toBe("GitHub's open-pull-request census came back without a viewer or a repository");
  });

  it("fails a page that says there is more and gives no cursor to it", () => {
    const data = {
      repository: { pullRequests: { nodes: [], pageInfo: { endCursor: null, hasNextPage: true }, totalCount: 1 } },
      viewer: { login: "ada" },
    };
    expect(unwrapErr(parseCensusPage({ data })).message).toBe(
      "GitHub's open-pull-request census said there is a next page and gave no cursor to it",
    );
  });
});

/** The instant the caller took before the first page — carried, never re-read off a clock. */
const STARTED = "2026-09-26T14:33:19.000Z";

describe("joinCensusPages", () => {
  it("refuses a list that does not number GitHub's own count, so no partial count is ever claimed", () => {
    const one = unwrap(parseCensusPage({ data: page({ nodes: [node({ number: 1 })], totalCount: 2 }) }));
    expect(unwrapErr(joinCensusPages({ pages: [one], repo: "acme/widgets", startedAtIso: STARTED })).message).toBe(
      "GitHub's open-pull-request census listed 1 pull request(s) against GitHub's count of 2 — the open list " +
        "moved while it was paged, so no count is claimed from it",
    );
  });

  it("counts a pull request seen on two pages once", () => {
    const first = unwrap(
      parseCensusPage({ data: page({ endCursor: "c1", nodes: [node({ number: 1 })], totalCount: 2 }) }),
    );
    const second = unwrap(
      parseCensusPage({ data: page({ nodes: [node({ number: 1 }), node({ number: 2 })], totalCount: 2 }) }),
    );
    const joined = unwrap(joinCensusPages({ pages: [first, second], repo: "acme/widgets", startedAtIso: STARTED }));
    expect(joined.pullRequests.map((one) => one.number)).toStrictEqual([1, 2]);
  });

  it("refuses pages whose counts differ, even when the union happens to match the last count", () => {
    const first = unwrap(
      parseCensusPage({
        data: page({ endCursor: "c1", nodes: [node({ number: 1 }), node({ number: 2 })], totalCount: 2 }),
      }),
    );
    const second = unwrap(parseCensusPage({ data: page({ nodes: [node({ number: 3 })], totalCount: 3 }) }));
    expect(
      unwrapErr(joinCensusPages({ pages: [first, second], repo: "acme/widgets", startedAtIso: STARTED })).message,
    ).toBe(
      "GitHub's open-pull-request census changed its count between pages — the open list moved while it was paged",
    );
  });
});

describe("readOpenCensus", () => {
  it("pages to GitHub's last page and keeps GitHub's own totalCount", async () => {
    const { graphql, afters } = pagedGraphql({
      pages: [
        page({ endCursor: "c1", nodes: [node({ number: 1 }), node({ number: 2 })], totalCount: 3 }),
        page({ nodes: [node({ login: "renovate", number: 3 })], totalCount: 3 }),
      ],
    });
    const census = await readOpenCensus({ graphql, repo: "acme/widgets", startedAtIso: STARTED });
    expect(afters).toStrictEqual([undefined, "c1"]);
    expect(census).toMatchObject({
      kind: "read",
      repo: "acme/widgets",
      startedAtIso: STARTED,
      totalCount: 3,
      viewer: "ada",
    });
    const read = census as Extract<RepoCensus, { kind: "read" }>;
    const numbers = read.pullRequests.map((one) => `${String(one.number)} ${String(one.author)}`);
    expect(numbers).toStrictEqual(["1 ada", "2 ada", "3 renovate"]);
  });

  it("stops at the page cap and says so, rather than naming a partial list", async () => {
    const pages = Array.from({ length: CENSUS_PAGE_CAP + 1 }, (_, at) =>
      page({ endCursor: `c${String(at + 1)}`, nodes: [node({ number: at + 1 })], totalCount: 5000 }),
    );
    const { graphql, afters } = pagedGraphql({ pages });
    expect(await readOpenCensus({ graphql, repo: "acme/widgets", startedAtIso: STARTED })).toStrictEqual({
      kind: "unread",
      repo: "acme/widgets",
      why: "more than 1000 open pull requests — past the census's page cap",
    });
    expect(afters.length).toBe(CENSUS_PAGE_CAP);
  });

  it("answers `unread` naming GitHub's failure rather than throwing or counting the repository empty", async () => {
    const graphql: GithubReadGraphql = () =>
      Promise.resolve(err(GithubLiveErrors.readFailed({ message: "GitHub answered 502" })));
    expect(await readOpenCensus({ graphql, repo: "acme/widgets", startedAtIso: STARTED })).toStrictEqual({
      kind: "unread",
      repo: "acme/widgets",
      why: "GitHub answered 502",
    });
  });

  it("answers `unread` for a slug that is not owner/name, before any request", async () => {
    const { graphql, afters } = pagedGraphql({ pages: [] });
    const census = await readOpenCensus({ graphql, repo: "widgets", startedAtIso: STARTED });
    expect(census.kind).toBe("unread");
    expect(afters).toStrictEqual([]);
  });
});
