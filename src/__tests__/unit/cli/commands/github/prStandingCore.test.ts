/**
 * `github pr standing`'s pure projection: who approved (people apart from bots), who is still asked, what the
 * base branch requires, and the sentence the console voice says — pinned on the exact shape of
 * a real pull request, where a CodeRabbit-only APPROVED was spoken as an approval.
 */
import { describe, expect, it } from "vitest";

import {
  githubPrStandingOf,
  parseGithubPrStandingArgs,
  renderGithubPrStandingText,
} from "../../../../../cli/commands/github/prStandingCore.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { DISTANCE_NOT_REQUESTED } from "../../../../../live/github/baseDistance.js";
import type { ReviewGate } from "../../../../../live/github/reviewRules.js";
import type { PrLiveState, PrReview } from "../../../../../live/github/reviewState.js";

const READ_AT = "2026-09-30T12:00:00.000Z";
const HEAD = "a5e2b163";

/** A live pull-request state with no reviews, no requests and green CI; a test overrides what it is about. */
const pr = (over: Partial<PrLiveState> = {}): PrLiveState => ({
  authorLogin: "octocat",
  baseDistance: DISTANCE_NOT_REQUESTED,
  baseRefName: "policy-mirror-dogfood",
  changedPaths: [],
  changedPathsTruncated: false,
  checks: {
    baseRef: undefined,
    checks: [
      { kind: "check-run", name: "core", state: "passed", url: undefined },
      { kind: "check-run", name: "lint", state: "passed", url: undefined },
    ],
    headSha: HEAD,
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
  createdAtIso: "2026-09-30T06:44:30Z",
  defaultBranch: "staging",
  githubMergeStatus: { kind: "mergeable", status: "CLEAN" },
  headOid: HEAD,
  headRefName: "infr-1071-network-segregation-and-test-data-evidence",
  headRepoSlug: "acme/acme-admin",
  isDraft: false,
  labels: [],
  labelsTruncated: false,
  mergeable: "MERGEABLE",
  number: 18158,
  queueEntry: undefined,
  repoSlug: "acme/acme-admin",
  requestedReviewers: [],
  reviewDecision: "",
  reviews: [],
  reviewsTruncated: false,
  threadCount: 0,
  threads: [],
  threadsTruncated: false,
  title: "backup-restore and change-log evidence",
  updatedAtIso: "2026-09-30T09:49:20Z",
  url: "https://github.com/acme/acme-admin/pull/18158",
  ...over,
});

/** A review, submitted against the head unless a test says otherwise. */
const review = (over: Partial<PrReview> & { login: string; state: string }): PrReview => ({
  commitOid: HEAD,
  onBehalfOf: [],
  submittedAtIso: "2026-09-30T09:00:00Z",
  ...over,
});

/** A base branch the read established requires no review. */
const UNPROTECTED: ReviewGate = { branch: "policy-mirror-dogfood", kind: "read", rules: [] };

/** A base branch governed by a ruleset requiring a code owner's approval. */
const PROTECTED: ReviewGate = {
  branch: "staging",
  kind: "read",
  rules: [{ approvals: 0, codeOwners: true, source: "ruleset" }],
};

describe("githubPrStandingOf", () => {
  it("says no approval is needed when nobody has reviewed and the base requires no review", () => {
    const standing = githubPrStandingOf({ baseGate: UNPROTECTED, baseProtected: false, pr: pr(), readAtIso: READ_AT });
    expect(standing.reviews.approvedBy).toEqual([]);
    expect(standing.reviews.botApprovedBy).toEqual([]);
    expect(standing.reviews.requested).toEqual([]);
    expect(standing.base).toEqual({
      defaultBranch: "staging",
      name: "policy-mirror-dogfood",
      protected: false,
      review: { kind: "none" },
    });
    expect(standing.ci).toEqual({ failing: [], residue: [], running: 0, total: 2, verdict: "green" });
    expect(standing.sentence).toBe(
      "Pull request 18158 by octocat. " +
        "It targets policy-mirror-dogfood, which is unprotected and requires no review — so no approval is " +
        "needed to merge it. " +
        "No person has approved it. CI is green (2 checks). " +
        "CodeRabbit: CodeRabbit has not posted on this pull request. " +
        "Merge: GitHub reports CLEAN, so it would merge this now.",
    );
  });

  it("never reads a CodeRabbit-only APPROVED as a person's approval, and names who is still asked", () => {
    const standing = githubPrStandingOf({
      baseGate: UNPROTECTED,
      baseProtected: false,
      pr: pr({
        codeownerRequests: [
          { asCodeOwner: true, kind: "team", name: "acme/acme-eng" },
          { asCodeOwner: false, kind: "team", name: "acme/platform" },
        ],
        reviewDecision: "APPROVED",
        reviews: [
          review({ login: "octocat", state: "COMMENTED" }),
          review({ login: "coderabbitai", state: "COMMENTED" }),
          review({ login: "coderabbitai", state: "APPROVED" }),
        ],
      }),
      readAtIso: READ_AT,
    });
    expect(standing.reviews.approvedBy).toEqual([]);
    expect(standing.reviews.botApprovedBy).toEqual(["coderabbitai"]);
    expect(standing.reviews.reviewDecision).toBe("APPROVED");
    expect(standing.reviews.requested).toEqual([
      { codeOwner: true, kind: "team", name: "acme/acme-eng" },
      { codeOwner: false, kind: "team", name: "acme/platform" },
    ]);
    expect(standing.codeRabbit.verdict).toBe("green");
    expect(standing.sentence).toContain(
      "No person has approved it. Review is still requested from acme/acme-eng (code owner) and " +
        "acme/platform. GitHub's review decision reads APPROVED only because coderabbitai approved — a bot, " +
        "not a person.",
    );
  });

  it("names the person whose latest verdict is an approval, and the one whose latest asks for changes", () => {
    const standing = githubPrStandingOf({
      baseGate: PROTECTED,
      baseProtected: true,
      pr: pr({
        baseRefName: "staging",
        reviewDecision: "CHANGES_REQUESTED",
        reviews: [
          review({ login: "jonahy-acme", state: "CHANGES_REQUESTED" }),
          review({ login: "jonahy-acme", state: "APPROVED" }),
          review({ login: "arlom-acme", state: "APPROVED" }),
          review({ login: "arlom-acme", state: "CHANGES_REQUESTED" }),
          review({ login: "arlom-acme", state: "COMMENTED" }),
        ],
      }),
      readAtIso: READ_AT,
    });
    expect(standing.reviews.approvedBy).toEqual(["jonahy-acme"]);
    expect(standing.reviews.changesRequestedBy).toEqual(["arlom-acme"]);
    expect(standing.sentence).toContain(
      "It targets staging (the default branch), which requires a code owner's approval. " +
        "Approved by jonahy-acme. Changes requested by arlom-acme.",
    );
  });

  it("treats a reviewer GitHub typed a Bot as a bot even when its login carries no [bot] suffix", () => {
    const standing = githubPrStandingOf({
      baseGate: UNPROTECTED,
      baseProtected: false,
      pr: pr({ reviews: [review({ byBot: true, login: "copilot-pull-request-reviewer", state: "APPROVED" })] }),
      readAtIso: READ_AT,
    });
    expect(standing.reviews.approvedBy).toEqual([]);
    expect(standing.reviews.botApprovedBy).toEqual(["copilot-pull-request-reviewer"]);
  });

  it("says the base branch's rules could not be read rather than calling it unprotected", () => {
    const standing = githubPrStandingOf({
      baseGate: { kind: "unreadable", reason: "GitHub answered 403" },
      baseProtected: "unread",
      pr: pr(),
      readAtIso: READ_AT,
    });
    expect(standing.base.review).toEqual({ kind: "unreadable", reason: "GitHub answered 403" });
    expect(standing.sentence).toContain(
      "It targets policy-mirror-dogfood; whether that branch requires a review could not be read (GitHub answered 403).",
    );
  });

  it("never says 'no approval is needed' of a protected branch whose review rule this read could not see", () => {
    const standing = githubPrStandingOf({ baseGate: UNPROTECTED, baseProtected: true, pr: pr(), readAtIso: READ_AT });
    expect(standing.sentence).toContain(
      "It targets policy-mirror-dogfood, a protected branch; no review requirement was found in the rules this " +
        "read could see.",
    );
    expect(standing.sentence).not.toContain("no approval is needed");
  });

  it("says whether the base is protected could not be read when the branch read did not answer", () => {
    const standing = githubPrStandingOf({
      baseGate: UNPROTECTED,
      baseProtected: "unread",
      pr: pr(),
      readAtIso: READ_AT,
    });
    expect(standing.base.protected).toBe("unread");
    expect(standing.sentence).toContain(
      "It targets policy-mirror-dogfood; no review requirement was found, and whether it is protected could not " +
        "be read.",
    );
  });

  it("names every failing check, and says when the rollup was cut", () => {
    const base = pr();
    const standing = githubPrStandingOf({
      baseGate: UNPROTECTED,
      baseProtected: false,
      pr: pr({
        checks: {
          ...base.checks,
          checks: [
            { kind: "check-run", name: "core", state: "failed", url: undefined },
            { kind: "check-run", name: "lint", state: "passed", url: undefined },
          ],
        },
        checksTruncated: true,
      }),
      readAtIso: READ_AT,
    });
    expect(standing.ci.verdict).toBe("red");
    expect(standing.ci.failing).toEqual(["core"]);
    expect(standing.ci.residue).toEqual(["more checks ran than this read carried, so a failing one may be missing"]);
    expect(standing.sentence).toContain("CI is failing: core.");
  });

  it("reports CI unread, never green, when the rollup could not be parsed", () => {
    const standing = githubPrStandingOf({
      baseGate: UNPROTECTED,
      baseProtected: false,
      pr: pr({ checksRead: { kind: "unread", why: "the rollup was not an object" } }),
      readAtIso: READ_AT,
    });
    expect(standing.ci.verdict).toBe("unread");
    expect(standing.ci.residue).toEqual(["the rollup was not an object"]);
    expect(standing.sentence).toContain("CI could not be read.");
  });
});

describe("renderGithubPrStandingText", () => {
  it("prints the heading, the address and the sentence", () => {
    const standing = githubPrStandingOf({ baseGate: UNPROTECTED, baseProtected: false, pr: pr(), readAtIso: READ_AT });
    const lines = renderGithubPrStandingText({ standing });
    expect(lines.slice(0, 2)).toEqual([
      "#18158 backup-restore and change-log evidence",
      "https://github.com/acme/acme-admin/pull/18158",
    ]);
    expect(lines[2]).toBe(standing.sentence);
    expect(lines.length).toBe(3);
  });
});

describe("parseGithubPrStandingArgs", () => {
  it("reads one address, --json and --home", () => {
    const parsed = parseGithubPrStandingArgs({
      rest: ["https://github.com/o/r/pull/1", "--json", "--home", "/tmp/sw"],
    });
    expect(unwrap(parsed)).toEqual({ home: "/tmp/sw", json: true, url: "https://github.com/o/r/pull/1" });
  });

  it("refuses no address by name", () => {
    const parsed = parseGithubPrStandingArgs({ rest: [] });
    expect(unwrapErr(parsed)).toEqual(["exactly one pull-request address is required; got 0"]);
  });
});
