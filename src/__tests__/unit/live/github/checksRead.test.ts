/**
 * Every `billing` lane or system name in this file is a synthetic one rather than the installation's own.
 */

import { describe, expect, it } from "vitest";

import { ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import { makeFetchGithubChecks } from "../../../../live/github/checksRead.js";

/** One completed Check Run context node, dated by its check suite the way GitHub reports one. */
function runNode({
  conclusion,
  createdAt,
  name,
}: {
  conclusion: string;
  createdAt: string;
  name: string;
}): Record<string, unknown> {
  return { __typename: "CheckRun", checkSuite: { createdAt }, conclusion, name, status: "COMPLETED" };
}

/** One page of a paged rollup read, carrying the cursor the next page starts from. */
function pagedRollupData({
  contexts,
  endCursor,
  hasNextPage,
  oid = "abc123",
}: {
  contexts: readonly Record<string, unknown>[];
  endCursor?: string;
  hasNextPage: boolean;
  oid?: string;
}): unknown {
  return {
    repository: {
      pullRequest: {
        commits: {
          nodes: [
            {
              commit: {
                oid,
                statusCheckRollup: {
                  contexts: { nodes: contexts, pageInfo: { endCursor, hasNextPage } },
                  state: "SUCCESS",
                },
              },
            },
          ],
        },
      },
    },
  };
}

describe("makeFetchGithubChecks across pages", () => {
  it("reads past one page from each page's end cursor, and dedupes a re-run split across the two", async () => {
    const calls: { variables: Record<string, unknown> }[] = [];
    const pages = [
      pagedRollupData({
        contexts: [runNode({ conclusion: "FAILURE", createdAt: "2026-09-28T01:00:00Z", name: "E2E (billing)" })],
        endCursor: "c1",
        hasNextPage: true,
      }),
      pagedRollupData({
        contexts: [
          runNode({ conclusion: "SUCCESS", createdAt: "2026-09-28T02:00:00Z", name: "E2E (billing)" }),
          runNode({ conclusion: "SUCCESS", createdAt: "2026-09-28T02:00:00Z", name: "lint" }),
        ],
        hasNextPage: false,
      }),
    ];
    const fetchChecks = makeFetchGithubChecks({
      graphql: (args) => {
        calls.push(args);
        return Promise.resolve(ok(pages[calls.length - 1]));
      },
    });

    const snapshot = unwrap(await fetchChecks({ limit: 1000, number: 9, owner: "acme", repo: "widget" }));

    expect(calls.map((call) => call.variables)).toEqual([
      { limit: 100, number: 9, owner: "acme", repo: "widget" },
      { after: "c1", limit: 100, number: 9, owner: "acme", repo: "widget" },
    ]);
    expect(snapshot.checks.map((check) => [check.name, check.conclusion])).toEqual([
      ["E2E (billing)", "SUCCESS"],
      ["lint", "SUCCESS"],
    ]);
    expect(snapshot.supersededChecks.map((check) => check.conclusion)).toEqual(["FAILURE"]);
    expect(snapshot.truncated).toBe(false);
    expect(snapshot.residue).toEqual([]);
  });

  it("stops at the limit and stays truncated when GitHub still holds contexts past it", async () => {
    const calls: { variables: Record<string, unknown> }[] = [];
    const fetchChecks = makeFetchGithubChecks({
      graphql: (args) => {
        calls.push(args);
        return Promise.resolve(
          ok(
            pagedRollupData({
              contexts: [
                runNode({ conclusion: "SUCCESS", createdAt: "2026-09-28T01:00:00Z", name: `c${String(calls.length)}` }),
              ],
              endCursor: `c${String(calls.length)}`,
              hasNextPage: true,
            }),
          ),
        );
      },
    });

    const snapshot = unwrap(await fetchChecks({ limit: 2, number: 9, owner: "acme", repo: "widget" }));

    expect(calls.map((call) => call.variables["limit"])).toEqual([2, 1]);
    expect(snapshot.checks).toHaveLength(2);
    expect(snapshot.truncated).toBe(true);
  });

  it("refuses a list stitched across two heads when the head moves between pages", async () => {
    const pages = [
      pagedRollupData({
        contexts: [runNode({ conclusion: "SUCCESS", createdAt: "2026-09-28T01:00:00Z", name: "lint" })],
        endCursor: "c1",
        hasNextPage: true,
      }),
      pagedRollupData({ contexts: [], hasNextPage: false, oid: "def456" }),
    ];
    let call = 0;
    const fetchChecks = makeFetchGithubChecks({
      graphql: () => {
        call += 1;
        return Promise.resolve(ok(pages[call - 1]));
      },
    });

    const result = await fetchChecks({ limit: 1000, number: 9, owner: "acme", repo: "widget" });

    expect(unwrapErr(result).message).toContain("the head moved from abc123 to def456");
  });

  it("ends the read, still truncated, on an empty page that claims more past it", async () => {
    let call = 0;
    const fetchChecks = makeFetchGithubChecks({
      graphql: () => {
        call += 1;
        const contexts =
          call === 1 ? [runNode({ conclusion: "SUCCESS", createdAt: "2026-09-28T01:00:00Z", name: "lint" })] : [];
        return Promise.resolve(ok(pagedRollupData({ contexts, endCursor: `c${String(call)}`, hasNextPage: true })));
      },
    });

    const snapshot = unwrap(await fetchChecks({ limit: 1000, number: 9, owner: "acme", repo: "widget" }));

    expect(call).toBe(2);
    expect(snapshot.truncated).toBe(true);
  });
});
