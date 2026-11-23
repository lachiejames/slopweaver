/*
 * `parseGithubReadAddress` and `readGithubObject`: which github.com links parse, and what the typed live-reader
 * query selects and reports back, over a GraphQL seam that records each document it was sent.
 */
import { describe, expect, it } from "vitest";

import { ok, unwrap, unwrapErr } from "#lib/result.js";

import { GithubLiveErrors } from "../../../../live/github/errors.js";
import { parseGithubReadAddress, readGithubObject } from "../../../../live/github/read.js";
import { NOW } from "./fixtures.js";

describe("GitHub named-object reads", () => {
  it("parses only supported github.com object links", () => {
    expect(unwrap(parseGithubReadAddress({ address: "https://github.com/acme/widget/pull/15132" }))).toEqual({
      address: "https://github.com/acme/widget/pull/15132",
      identity: "acme/widget#15132",
      kind: "pull-request",
      number: 15132,
      owner: "acme",
      repo: "widget",
    });
    expect(unwrapErr(parseGithubReadAddress({ address: "https://gitlab.com/o/r/issues/1" }))).toEqual(
      GithubLiveErrors.invalidAddress({
        message: "GitHub read accepts only https://github.com links, got https://gitlab.com/o/r/issues/1",
      }),
    );
    expect(
      unwrap(parseGithubReadAddress({ address: "What changed in https://github.com/o/r/issues/7 today?" })),
    ).toMatchObject({ address: "https://github.com/o/r/issues/7", identity: "o/r#7" });
  });

  it("returns the selected live node and names a truncated activity connection", async () => {
    const calls: unknown[] = [];
    const result = await readGithubObject({
      address: "https://github.com/o/r/issues/7",
      graphql: ({ query, variables }) => {
        calls.push({
          hasNamedObjectQuery: query.includes("SlopweaverReadIssueOrPullRequest"),
          hasStatusChecks: query.includes("statusCheckRollup"),
          variables,
        });
        return Promise.resolve(
          ok({
            repository: {
              issueOrPullRequest: {
                comments: { nodes: [{ body: "one" }], pageInfo: { endCursor: "cursor", hasNextPage: true } },
                number: 7,
                title: "Current title",
              },
            },
          }),
        );
      },
      limit: 25,
      nowIso: () => NOW,
    });

    expect(calls).toEqual([
      {
        hasNamedObjectQuery: true,
        hasStatusChecks: true,
        variables: { limit: 25, number: 7, owner: "o", repo: "r" },
      },
    ]);
    expect(unwrap(result)).toEqual({
      coverage: {
        detail: "one named object, with up to 25 items from each selected activity connection",
        kind: "bounded",
        residue: [
          "only fields declared by the typed live-reader query were requested",
          "data.comments has another provider page",
        ],
      },
      data: {
        comments: { nodes: [{ body: "one" }], pageInfo: { endCursor: "cursor", hasNextPage: true } },
        number: 7,
        title: "Current title",
      },
      readAtIso: NOW,
      source: "github",
      target: {
        address: "https://github.com/o/r/issues/7",
        identity: "o/r#7",
        kind: "issue",
        number: 7,
        owner: "o",
        repo: "r",
      },
    });
  });

  it("names the code-owner fields on a PULL REQUEST's coverage and on nothing else", async () => {
    const node = { repository: { issueOrPullRequest: { number: 7, title: "t" } } };
    const issue = await readGithubObject({
      address: "https://github.com/o/r/issues/7",
      graphql: () => Promise.resolve(ok(node)),
      limit: 25,
      nowIso: () => NOW,
    });
    const pull = await readGithubObject({
      address: "https://github.com/o/r/pull/7",
      graphql: () => Promise.resolve(ok(node)),
      limit: 25,
      nowIso: () => NOW,
    });
    expect(unwrap(issue).coverage.detail).toBe(
      "one named object, with up to 25 items from each selected activity connection",
    );
    expect(unwrap(pull).coverage.detail).toContain("`reviewRequests[].asCodeOwner`");
    expect(unwrap(pull).coverage.detail).toContain("never a reading of the CODEOWNERS file");
  });

  it("selects GitHub's own code-owner flags on a pull request, so nothing has to read the file", async () => {
    let asked = "";
    await readGithubObject({
      address: "https://github.com/o/r/pull/7",
      graphql: ({ query }) => {
        asked = query;
        return Promise.resolve(ok({ repository: { issueOrPullRequest: { number: 7 } } }));
      },
      limit: 25,
      nowIso: () => NOW,
    });
    expect(asked).toContain("asCodeOwner");
    expect(asked).toContain("onBehalfOf(first: $limit)");
    expect(asked).toContain("combinedSlug");
  });

  it("selects a pull request's state and CI rollup ahead of the body and every activity connection", async () => {
    let asked = "";
    await readGithubObject({
      address: "https://github.com/o/r/pull/7",
      graphql: ({ query }) => {
        asked = query;
        return Promise.resolve(ok({ repository: { issueOrPullRequest: { number: 7 } } }));
      },
      limit: 25,
      nowIso: () => NOW,
    });
    const pull = asked.slice(asked.indexOf("... on PullRequest {"));
    const at = (needle: string): number => pull.indexOf(needle);
    const order = ["reviewDecision", "statusCheckRollup", "\n        body\n", "comments(first", "reviewThreads("];
    expect(order.map(at).every((index) => index > 0)).toBe(true);
    expect(order.toSorted((a, b) => at(a) - at(b))).toEqual(order);
  });

  it("requests a pull request's native stack and reports it in the raw node with pagination residue", async () => {
    const calls: unknown[] = [];
    const result = await readGithubObject({
      address: "https://github.com/o/r/pull/15148",
      graphql: ({ query, variables }) => {
        calls.push({
          hasStackEntryField: query.includes("stackEntry { position }"),
          hasStackField: query.includes("stack {"),
          variables,
        });
        return Promise.resolve(
          ok({
            repository: {
              issueOrPullRequest: {
                number: 15148,
                stack: {
                  baseRefName: "staging",
                  entries: {
                    nodes: [{ position: 1, pullRequest: { number: 15148, state: "OPEN", title: "Bottom" } }],
                    pageInfo: { endCursor: "cursor-1", hasNextPage: true },
                    totalCount: 3,
                  },
                  number: 15155,
                  size: 3,
                },
                title: "Bottom",
              },
            },
          }),
        );
      },
      limit: 1,
      nowIso: () => NOW,
    });

    expect(calls).toEqual([
      { hasStackEntryField: true, hasStackField: true, variables: { limit: 1, number: 15148, owner: "o", repo: "r" } },
    ]);
    expect(unwrap(result)).toEqual({
      coverage: {
        detail:
          "one named object, with up to 1 items from each selected activity connection; code owners are " +
          "GitHub's own — `reviewRequests[].asCodeOwner` for the ones it is still waiting on, and " +
          "`reviews[].onBehalfOf` for the teams an approval already satisfied — never a reading of the " +
          "CODEOWNERS file",
        kind: "bounded",
        residue: [
          "only fields declared by the typed live-reader query were requested",
          "data.stack.entries has another provider page",
        ],
      },
      data: {
        number: 15148,
        stack: {
          baseRefName: "staging",
          entries: {
            nodes: [{ position: 1, pullRequest: { number: 15148, state: "OPEN", title: "Bottom" } }],
            pageInfo: { endCursor: "cursor-1", hasNextPage: true },
            totalCount: 3,
          },
          number: 15155,
          size: 3,
        },
        title: "Bottom",
      },
      readAtIso: NOW,
      source: "github",
      target: {
        address: "https://github.com/o/r/pull/15148",
        identity: "o/r#15148",
        kind: "pull-request",
        number: 15148,
        owner: "o",
        repo: "r",
      },
    });
  });

  it("requests a pull request's newest reviews, not its oldest, and reports truncation from hasPreviousPage", async () => {
    const calls: unknown[] = [];
    const result = await readGithubObject({
      address: "https://github.com/o/r/pull/14086",
      graphql: ({ query, variables }) => {
        calls.push({ hasReviewsLast: query.includes("reviews(last: $limit)"), variables });
        return Promise.resolve(
          ok({
            repository: {
              issueOrPullRequest: {
                number: 14086,
                reviews: {
                  nodes: [
                    { author: { login: "user2-acme" }, state: "APPROVED" },
                    { author: { login: "octocat" }, state: "APPROVED" },
                  ],
                  pageInfo: { hasPreviousPage: true, startCursor: "cursor-30" },
                  totalCount: 32,
                },
                title: "Newest",
              },
            },
          }),
        );
      },
      limit: 25,
      nowIso: () => NOW,
    });

    expect(calls).toEqual([{ hasReviewsLast: true, variables: { limit: 25, number: 14086, owner: "o", repo: "r" } }]);
    expect(unwrap(result).coverage.residue).toEqual([
      "only fields declared by the typed live-reader query were requested",
      "data.reviews has another provider page",
    ]);
    expect(unwrap(result).data).toMatchObject({
      reviews: {
        nodes: [
          { author: { login: "user2-acme" }, state: "APPROVED" },
          { author: { login: "octocat" }, state: "APPROVED" },
        ],
      },
    });
  });

  it("refuses a pull-request address GitHub answered with an issue, and reads that issue by its own address", async () => {
    // Recorded off `github read <repo>/pull/<number> --json` on an open issue, trimmed to synthetic names.
    const recorded = {
      repository: {
        issueOrPullRequest: {
          __typename: "Issue",
          author: { login: "acme-renovatebot" },
          closedAt: null,
          comments: { nodes: [], pageInfo: { endCursor: null, hasNextPage: false }, totalCount: 0 },
          createdAt: "2026-09-02T05:08:53Z",
          id: "I_FIXTURE",
          number: 238,
          state: "OPEN",
          title: "Dependency Dashboard",
          url: "https://github.com/acme/widget/issues/238",
        },
      },
    };
    const read = ({ address }: { address: string }): ReturnType<typeof readGithubObject> =>
      readGithubObject({ address, graphql: () => Promise.resolve(ok(recorded)), limit: 1, nowIso: () => NOW });
    const pull = "https://github.com/acme/widget/pull/238";

    expect(unwrapErr(await read({ address: pull }))).toEqual(
      GithubLiveErrors.notAPullRequest({
        identity: "acme/widget#238",
        issueUrl: "https://github.com/acme/widget/issues/238",
      }),
    );
    expect(unwrapErr(await read({ address: pull })).message).toBe(
      "no pull request holds acme/widget#238 — GitHub answered that number with an issue; read " +
        "https://github.com/acme/widget/issues/238 for it",
    );
    const asIssue = unwrap(await read({ address: "https://github.com/acme/widget/issues/238" }));
    expect(asIssue.target.kind).toBe("issue");
    expect(asIssue.data).toMatchObject({ __typename: "Issue", number: 238, state: "OPEN" });
  });

  it("reads a pull-request address GitHub answered with a pull request", async () => {
    const node = { __typename: "PullRequest", number: 239, state: "OPEN", title: "t" };
    const result = await readGithubObject({
      address: "https://github.com/acme/widget/pull/239",
      graphql: () => Promise.resolve(ok({ repository: { issueOrPullRequest: node } })),
      limit: 1,
      nowIso: () => NOW,
    });
    expect(unwrap(result).data).toEqual(node);
  });

  it("uses the current discussion schema and applies the caller's connection bound", async () => {
    const calls: unknown[] = [];
    const result = await readGithubObject({
      address: "Read https://github.com/o/r/discussions/8 now",
      graphql: ({ query, variables }) => {
        calls.push({
          hasCurrentAnswerField: query.includes("isAnswered"),
          hasRemovedAnswerField: /\sanswered\s/u.test(query),
          variables,
        });
        return Promise.resolve(ok({ repository: { discussion: { number: 8 } } }));
      },
      limit: 5,
      nowIso: () => NOW,
    });

    expect(unwrap(result).target.kind).toBe("discussion");
    expect(calls).toEqual([
      {
        hasCurrentAnswerField: true,
        hasRemovedAnswerField: false,
        variables: { limit: 5, number: 8, owner: "o", repo: "r" },
      },
    ]);
  });
});
