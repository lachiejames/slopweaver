import { describe, expect, it } from "vitest";

import {
  parseGithubPrRequestReviewArgs,
  requestedReviewersLine,
  requestReviewDoorRequest,
  reviewRequestFreshnessFor,
} from "../../../../../cli/commands/github/requestReviewCore.js";
import type { WrittenPr } from "../../../../../corpus/github/write.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const HEAD = {
  label: "o:feature",
  ref: "feature",
  repoFullName: "o/r",
  sha: "1111111111111111111111111111111111111111",
};

function pr({
  authorId = 1,
  number = 7,
  state = "open",
}: {
  authorId?: number;
  number?: number;
  state?: string;
}): WrittenPr {
  return {
    authorId,
    baseRef: "main",
    baseRepoFullName: "o/r",
    body: "b",
    commits: 1,
    draft: false,
    head: HEAD,
    htmlUrl: `https://example.invalid/pr/${String(number)}`,
    mergedAtIso: undefined,
    nodeId: `PR_${String(number)}`,
    number,
    stack: undefined,
    state,
    title: "t",
    updatedAtIso: "2026-08-10T00:00:00Z",
  };
}

describe("requestedReviewersLine", () => {
  it("joins each list with commas", () => {
    expect(
      requestedReviewersLine({ number: 7, outcome: "requested", requested: { teams: ["eng"], users: ["a", "b"] } }),
    ).toBe("requested #7  users: a, b  teams: eng");
  });

  it("prints (none) for an empty list rather than leaving the field blank", () => {
    expect(requestedReviewersLine({ number: 7, outcome: "would request", requested: { teams: [], users: [] } })).toBe(
      "would request #7  users: (none)  teams: (none)",
    );
  });
});

describe("parseGithubPrRequestReviewArgs", () => {
  it("requires one exact repository, number, and at least one reviewer or team", () => {
    expect(
      unwrap(
        parseGithubPrRequestReviewArgs({
          rest: ["--repo", "o/r", "--number", "7", "--reviewer", "ada,bob"],
        }),
      ),
    ).toEqual({
      dryRun: false,
      home: undefined,
      json: false,
      number: 7,
      owner: "o",
      repo: "r",
      reviewers: ["ada", "bob"],
      teams: [],
    });
    expect(unwrapErr(parseGithubPrRequestReviewArgs({ rest: ["--repo", "broken", "--number", "0"] }))).toEqual([
      "--repo owner/name is required",
      "--number must be a positive whole number",
      "give at least one of --reviewer <login,...> or --team <slug,...>",
    ]);
  });

  it("accepts --team alone, with no --reviewer", () => {
    const args = unwrap(
      parseGithubPrRequestReviewArgs({ rest: ["--repo", "o/r", "--number", "7", "--team", "reviewers"] }),
    );

    expect(args.reviewers).toEqual([]);
    expect(args.teams).toEqual(["reviewers"]);
  });

  it("splits both --reviewer and --team on commas, dropping empty fragments", () => {
    const args = unwrap(
      parseGithubPrRequestReviewArgs({
        rest: ["--repo", "o/r", "--number", "7", "--reviewer", " a ,, b,", "--team", "x,,y"],
      }),
    );

    expect(args.reviewers).toEqual(["a", "b"]);
    expect(args.teams).toEqual(["x", "y"]);
  });
});

describe("requestReviewDoorRequest", () => {
  it("addresses the exact pull request as the door artifact and marks the write external", () => {
    expect(
      requestReviewDoorRequest({
        args: {
          dryRun: false,
          home: undefined,
          json: false,
          number: 7,
          owner: "o",
          repo: "r",
          reviewers: ["ada"],
          teams: [],
        },
        home: "/tmp/home",
      }),
    ).toEqual({
      action: { kind: "verb", noun: "github", verb: "pr request-review" },
      artifact: { id: "o/r#7" },
      meta: { createsWorkItem: false, effect: "external-write", home: "/tmp/home", requiresApproval: false },
    });
  });
});

describe("reviewRequestFreshnessFor", () => {
  it("is fresh when the number, author and state have not moved", () => {
    expect(reviewRequestFreshnessFor({ current: pr({}), previewed: pr({}) })).toEqual({ fresh: true });
  });

  it("refuses when the pull request closed between the read and the write", () => {
    const result = reviewRequestFreshnessFor({ current: pr({ state: "closed" }), previewed: pr({ state: "open" }) });

    expect(result).toEqual({ fresh: false, reason: expect.stringContaining("open/closed state") });
  });

  it("refuses when the author changed", () => {
    const result = reviewRequestFreshnessFor({ current: pr({ authorId: 2 }), previewed: pr({ authorId: 1 }) });

    expect(result).toEqual({ fresh: false, reason: expect.stringContaining("the author") });
  });
});
