import { describe, expect, it } from "vitest";

import { type RowPullRequest, rowBranchCandidates, unmergedRowProblem } from "../../../hand/rowPullRequest.js";

const ROW = "talk-stage-looks";
const OPEN: RowPullRequest = {
  number: 1919,
  state: "OPEN",
  url: "https://github.com/lachiejames/slopweaver/pull/1919",
};
const CLOSED: RowPullRequest = {
  number: 1901,
  state: "CLOSED",
  url: "https://github.com/lachiejames/slopweaver/pull/1901",
};
const MERGED: RowPullRequest = {
  number: 1930,
  state: "MERGED",
  url: "https://github.com/lachiejames/slopweaver/pull/1930",
};

/** A read answer over these pull requests. */
const read = ({ pulls }: { pulls: readonly RowPullRequest[] }): Parameters<typeof unmergedRowProblem>[0]["answer"] => ({
  branches: [ROW],
  kind: "read",
  pulls,
  repo: "lachiejames/slopweaver",
});

describe("rowBranchCandidates", () => {
  it("names the declared branch, the recorded one and the slug, each once, in that order", () => {
    expect(rowBranchCandidates({ declared: "orb-looks", recorded: "orb-looks-2", slug: ROW })).toEqual([
      "orb-looks",
      "orb-looks-2",
      ROW,
    ]);
    expect(rowBranchCandidates({ declared: ROW, recorded: ROW, slug: ROW })).toEqual([ROW]);
  });

  it("drops a branch that is absent or blank", () => {
    expect(rowBranchCandidates({ declared: undefined, recorded: "", slug: ROW })).toEqual([ROW]);
  });
});

describe("unmergedRowProblem", () => {
  it("judges nothing it was not asked", () => {
    expect(unmergedRowProblem({ answer: { kind: "not-asked" }, row: ROW })).toBe(undefined);
  });

  it("passes a row with no pull request, and one with any merged", () => {
    expect(unmergedRowProblem({ answer: read({ pulls: [] }), row: ROW })).toBe(undefined);
    expect(unmergedRowProblem({ answer: read({ pulls: [OPEN, MERGED] }), row: ROW })).toBe(undefined);
  });

  it("refuses a row whose pull requests are only open or closed, naming each", () => {
    expect(unmergedRowProblem({ answer: read({ pulls: [OPEN, CLOSED] }), row: ROW })).toBe(
      `${ROW}'s pull request is not merged, so what the check-in shows the owner is not live yet: ` +
        `${OPEN.url} (open), ${CLOSED.url} (closed)`,
    );
  });

  it("refuses when the read could not run — a check that did not run is not a pass", () => {
    expect(unmergedRowProblem({ answer: { kind: "unread", why: "no github token" }, row: ROW })).toBe(
      `whether ${ROW}'s pull request is merged could not be read — no github token`,
    );
  });
});
