/*
 * Pairing pull requests with their base distances. The property: a requested comparison that answers fewer
 * pull requests than it was asked about fails the whole read and names both counts, rather than letting a row
 * claim "not requested" for a distance that was requested.
 */

import { describe, expect, it } from "vitest";

import { GithubVerbErrors } from "../../../../../cli/commands/github/errors.js";
import { addBaseDistance } from "../../../../../cli/commands/github/reviewStateBaseDistance.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { type BaseDistance, DISTANCE_NOT_REQUESTED } from "../../../../../live/github/baseDistance.js";
import type { PrLiveState } from "../../../../../live/github/reviewState.js";

/** One live pull request, with the fields a test cares about overridden. */
const pr = (over: Partial<PrLiveState> = {}): PrLiveState => ({
  authorLogin: "author-login",
  baseDistance: DISTANCE_NOT_REQUESTED,
  baseRefName: "staging",
  changedPaths: [],
  changedPathsTruncated: false,
  checks: {
    baseRef: undefined,
    checks: [],
    headSha: "abc",
    mergeable: undefined,
    residue: [],
    rollupState: "PENDING",
    supersededChecks: [],
    truncated: false,
  },
  checksRead: { kind: "read" },
  checksTruncated: false,
  codeownerRequests: [],
  codeownerRequestsTruncated: false,
  createdAtIso: "2026-08-28T00:00:00Z",
  defaultBranch: "staging",
  githubMergeStatus: { kind: "mergeable", status: "CLEAN" },
  headOid: "abc",
  headRefName: "feature/one",
  headRepoSlug: "o/target",
  isDraft: false,
  labels: [],
  labelsTruncated: false,
  mergeable: "MERGEABLE",
  number: 1,
  queueEntry: undefined,
  repoSlug: "o/target",
  requestedReviewers: [],
  reviewDecision: "",
  reviews: [],
  reviewsTruncated: false,
  threadCount: 0,
  threads: [],
  threadsTruncated: false,
  title: "a title",
  updatedAtIso: "2026-08-28T01:00:00Z",
  url: "https://github.com/o/target/pull/1",
  ...over,
});

/** A distance read that answered, `behindBy` set so each answer is told apart from the next. */
const read = ({ behindBy }: { behindBy: number }): BaseDistance => ({
  kind: "read",
  value: { aheadBy: 1, behindBy, status: "DIVERGED" },
});

/** The comparison seam, answering `answers` for every read and recording each home it was built for. */
function seam({ answers }: { answers: readonly BaseDistance[] }): {
  readonly asked: (string | undefined)[];
  readonly baseDistances: Parameters<typeof addBaseDistance>[0]["baseDistances"];
} {
  const asked: (string | undefined)[] = [];
  return {
    asked,
    baseDistances:
      ({ home }) =>
      () => {
        asked.push(home);
        return Promise.resolve(answers);
      },
  };
}

describe("addBaseDistance", () => {
  it("leaves every pull request as read, and asks nothing, when the invocation did not ask for a comparison", async () => {
    const edge = seam({ answers: [read({ behindBy: 3 })] });
    const prs = [pr()];
    const result = await addBaseDistance({
      args: { home: "/h", readBaseDistance: false },
      baseDistances: edge.baseDistances,
      prs,
    });
    expect(unwrap(result)).toBe(prs);
    expect(edge.asked).toEqual([]);
  });

  it("asks nothing for an empty fleet even when a comparison was asked for", async () => {
    const edge = seam({ answers: [] });
    const result = await addBaseDistance({
      args: { home: "/h", readBaseDistance: true },
      baseDistances: edge.baseDistances,
      prs: [],
    });
    expect(unwrap(result)).toEqual([]);
    expect(edge.asked).toEqual([]);
  });

  it("gives each pull request the answer at its own position", async () => {
    const edge = seam({ answers: [read({ behindBy: 3 }), read({ behindBy: 7 })] });
    const result = await addBaseDistance({
      args: { home: "/h", readBaseDistance: true },
      baseDistances: edge.baseDistances,
      prs: [pr({ number: 1 }), pr({ number: 2 })],
    });
    expect(unwrap(result).map((one) => [one.number, one.baseDistance])).toEqual([
      [1, read({ behindBy: 3 })],
      [2, read({ behindBy: 7 })],
    ]);
    expect(edge.asked).toEqual(["/h"]);
  });

  it("fails the read, naming both counts, when the comparison answered one pull request fewer than it was asked", async () => {
    const edge = seam({ answers: [read({ behindBy: 3 })] });
    const result = await addBaseDistance({
      args: { home: undefined, readBaseDistance: true },
      baseDistances: edge.baseDistances,
      prs: [pr({ number: 1 }), pr({ number: 2 })],
    });
    const error = unwrapErr(result);
    expect(error).toEqual(GithubVerbErrors.baseDistancesShort({ expected: 2, received: 1 }));
    expect(error.code).toBe("READ_FAILED");
    expect(error.message).toBe(
      "the base-distance read answered 1 of 2 pull requests, so no row can be matched to its distance",
    );
  });
});
