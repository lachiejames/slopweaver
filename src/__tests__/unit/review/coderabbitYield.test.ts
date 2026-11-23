import { describe, expect, it } from "vitest";
import {
  classifyCoderabbitThread,
  coderabbitYieldReport,
  type YieldPr,
  type YieldThread,
} from "../../../review/coderabbitYield.js";

const PR: YieldPr = {
  authorLogin: "octocat",
  createdAtIso: "2026-09-20T00:00:00Z",
  number: 17777,
  repo: "acme/acme-admin",
  state: "MERGED",
  url: "https://github.com/acme/acme-admin/pull/17777",
};

const OPENER = "_🎯 Functional Correctness_ | _🟠 Major_ | _⚡ Quick win_\n\n**Fix it.**";

const thread = (over: Partial<YieldThread> = {}): YieldThread => ({
  comments: [{ authorLogin: "coderabbitai", body: OPENER, url: "https://x/r1" }],
  commentsComplete: true,
  id: "PRRT_1",
  isOutdated: false,
  isResolved: true,
  path: "a.ts",
  resolvedByLogin: "octocat",
  ...over,
});

describe("classifyCoderabbitThread", () => {
  it("skips a thread a person opened", () => {
    const human = thread({ comments: [{ authorLogin: "someone", body: "nit", url: "u" }] });
    expect(classifyCoderabbitThread({ pr: PR, thread: human })).toBe(undefined);
  });

  it("puts CodeRabbit's own marker first, even on an outdated thread", () => {
    const body = `${OPENER}\n\n✅ Addressed in commit c9a58b8`;
    const finding = classifyCoderabbitThread({
      pr: PR,
      thread: thread({ comments: [{ authorLogin: "coderabbitai", body, url: "u" }], isOutdated: true }),
    })!;
    expect([finding.outcome, finding.markerKinds, finding.isOutdated]).toEqual([
      "reported-addressed",
      ["commit-marker"],
      true,
    ]);
  });

  it("reads a reply naming a commit as the second rung", () => {
    const comments = [
      { authorLogin: "coderabbitai", body: OPENER, url: "u" },
      { authorLogin: "octocat", body: "Fixed in `94c5152d9d`.", url: "u2" },
    ];
    const finding = classifyCoderabbitThread({ pr: PR, thread: thread({ comments }) })!;
    expect([finding.outcome, finding.citedCommit, finding.replyState]).toEqual([
      "reply-cites-commit",
      "94c5152d9d",
      "replied",
    ]);
  });

  it("answers unknown when the comments were not all read, rather than calling it unaddressed", () => {
    expect(classifyCoderabbitThread({ pr: PR, thread: thread({ commentsComplete: false }) })!.outcome).toBe("unknown");
  });

  it("separates outdated, self-resolved and still-open threads with no evidence", () => {
    const outcomes = [thread({ isOutdated: true }), thread(), thread({ isResolved: false, resolvedByLogin: null })].map(
      (one) => classifyCoderabbitThread({ pr: PR, thread: one })!.outcome,
    );
    expect(outcomes).toEqual(["outdated-only", "resolved-no-evidence", "open-no-evidence"]);
  });

  it("names who resolved, relative to the author, and a bot follow-up is not a reply", () => {
    const comments = [
      { authorLogin: "coderabbitai", body: OPENER, url: "u" },
      { authorLogin: "coderabbitai", body: "Thanks.", url: "u2" },
    ];
    const byOther = classifyCoderabbitThread({ pr: PR, thread: thread({ comments, resolvedByLogin: "colleague" }) })!;
    expect([
      byOther.resolver,
      byOther.resolvedByLogin,
      byOther.title,
      byOther.replyState,
      byOther.severity,
      byOther.category,
    ]).toEqual(["other", "colleague", "Fix it.", "silent", "major", "Functional Correctness"]);
  });
});

describe("coderabbitYieldReport", () => {
  it("counts every rung, splits the self-resolved, and keeps a repository with no findings", () => {
    const report = coderabbitYieldReport({
      prs: [
        {
          coderabbitReviewBodies: ["<summary>🧹 Nitpick comments (2)</summary>", "no summary here"],
          pr: PR,
          threads: [
            thread({ id: "a" }),
            thread({ id: "b", resolvedByLogin: "colleague" }),
            thread({ id: "c", isResolved: false, resolvedByLogin: null }),
            thread({ comments: [{ authorLogin: "someone", body: "human", url: "u" }], id: "d" }),
          ],
        },
        { coderabbitReviewBodies: [], pr: { ...PR, number: 1, repo: "lachiejames/slopweaver" }, threads: [] },
      ],
      repos: ["ACME/ACME-ADMIN", "lachiejames/slopweaver"],
    });
    expect(report.totals).toEqual({
      "open-no-evidence": 1,
      "outdated-only": 0,
      "reply-cites-commit": 0,
      "reported-addressed": 0,
      "resolved-no-evidence": 2,
      unknown: 0,
    });
    expect([report.prsRead, report.prsWithFindings, report.findings.length]).toEqual([2, 1, 3]);
    expect(report.selfResolved).toEqual({
      byAuthor: 1,
      byOther: 1,
      byUnknown: 0,
      replied: 0,
      replyUnknown: 0,
      silent: 2,
    });
    expect(report.byRepo.map((row) => [row.key, row.prs, row.total])).toEqual([
      ["ACME/ACME-ADMIN", 1, 3],
      ["lachiejames/slopweaver", 1, 0],
    ]);
    expect(report.reviewBodies).toEqual({ nitpicks: 2, outsideDiff: 0, reviews: 2 });
  });

  it("reports an empty cohort as zeros, not as a failure", () => {
    const report = coderabbitYieldReport({ prs: [], repos: ["acme/acme-admin"] });
    expect([report.findings.length, report.prsRead, report.byRepo[0]!.total, report.bySeverity]).toEqual([0, 0, 0, []]);
  });
});
