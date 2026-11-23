import { describe, expect, it } from "vitest";
import { ownershipAnswer } from "../../../../../cli/commands/github/reviewStateOwnership.js";
import { DISTANCE_NOT_REQUESTED } from "../../../../../live/github/baseDistance.js";
import type { PrLiveState } from "../../../../../live/github/reviewState.js";
import { parseCodeowners } from "../../../../../review/codeowners.js";

const CODEOWNERS = { path: ".github/CODEOWNERS", rules: parseCodeowners({ content: "* @org/eng\n" }) };

/** A live pull-request state touching one file only the `*` rule owns, with overrides. */
const pr = (over: Partial<PrLiveState> = {}): PrLiveState => ({
  authorLogin: "author-login",
  baseDistance: DISTANCE_NOT_REQUESTED,
  baseRefName: "staging",
  changedPaths: ["README.md"],
  changedPathsTruncated: false,
  checks: {
    baseRef: undefined,
    checks: [],
    headSha: "abc",
    mergeable: undefined,
    residue: [],
    rollupState: "SUCCESS",
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
  headRepoSlug: "o/r",
  isDraft: false,
  labels: [],
  labelsTruncated: false,
  mergeable: "MERGEABLE",
  number: 1,
  queueEntry: undefined,
  repoSlug: "o/r",
  requestedReviewers: [],
  reviewDecision: "",
  reviews: [],
  reviewsTruncated: false,
  threadCount: 0,
  threads: [],
  threadsTruncated: false,
  title: "a title",
  updatedAtIso: "2026-08-28T01:00:00Z",
  url: "https://github.com/o/r/pull/1",
  ...over,
});

const TEAM_APPROVAL = {
  commitOid: "abc",
  login: "a-member",
  onBehalfOf: ["org/eng"],
  state: "APPROVED",
  submittedAtIso: "2026-08-28T02:00:00Z",
};

describe("ownershipAnswer", () => {
  it("counts an approval GitHub recorded on a team's behalf, leaving no residue", () => {
    const answer = ownershipAnswer({ codeowners: CODEOWNERS, pr: pr({ reviews: [TEAM_APPROVAL] }) });
    expect(answer.owners.verdict).toBe("satisfied");
    expect(answer.owners.rules[0]!.satisfiedBy).toBe("org/eng");
    expect([...answer.approvedBy]).toEqual(["a-member"]);
    expect(answer.residue).toEqual([]);
  });

  it("says a repository with no CODEOWNERS requires nobody by ownership", () => {
    const answer = ownershipAnswer({ codeowners: undefined, pr: pr() });
    expect(answer.owners.verdict).toBe("none");
    expect(answer.residue).toEqual(["o/r declares no CODEOWNERS, so no approver is required by ownership"]);
  });

  it("names both a truncated path list and an unproven enforcement on an owed rule", () => {
    const answer = ownershipAnswer({ codeowners: CODEOWNERS, pr: pr({ changedPathsTruncated: true }) });
    expect(answer.owners.verdict).toBe("unknown");
    expect(answer.residue.length).toBe(2);
    expect(answer.residue[0]).toBe(
      "more files changed than --file-limit requested; the owner list may be missing a rule",
    );
    expect(answer.residue[1]).toContain("branch-protection setting this read does not fetch");
  });

  it("carries GitHub's own truncated code-owner requests into its requirement", () => {
    const answer = ownershipAnswer({ codeowners: CODEOWNERS, pr: pr({ codeownerRequestsTruncated: true }) });
    expect(answer.github.requestsTruncated).toBe(true);
  });
});
