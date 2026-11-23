import { describe, expect, it } from "vitest";
import { githubMergeStatus } from "../../../../review/githubMergeStatus.js";
import { type LandingTest, pressable } from "../../../../review/landing.js";
import { AWAITING_HUMAN_REVIEW, landingTests } from "../../../../review/landingTests.js";
import type { PrReviewState } from "../../../../review/reviewState.js";
import { BLOCKED, HAS_QUEUE, row, state } from "./fixtures.js";

describe("an EMPTY code-owner register is not an approval when GitHub stated a decision", () => {
  // GitHub retires a request the moment its reviewer acts, so a code owner who answered CHANGES_REQUESTED
  // leaves nothing behind. This arm read that absence as satisfaction.
  const emptyRegisterWith = ({ decision }: { decision: string }): PrReviewState =>
    state({ githubMergeStatus: BLOCKED, reviewDecision: decision });

  const codeowners = ({ decision }: { decision: string }): LandingTest =>
    landingTests({ queueAvailability: HAS_QUEUE, state: emptyRegisterWith({ decision }) }).find(
      (test) => test.id === "codeowners-satisfied",
    )!;

  it.each(["CHANGES_REQUESTED", "REVIEW_REQUIRED"])("fails on a stated %s, naming the decision", (decision) => {
    const test = codeowners({ decision });
    expect(test.verdict).toBe("fail");
    expect(test.why).toBe(
      `waiting on a human review — GitHub holds no open code-owner request, but its review decision reads ${decision}`,
    );
  });

  it("still passes on APPROVED, which is GitHub saying the requirement is met, and names the approval", () => {
    expect(codeowners({ decision: "APPROVED" })).toStrictEqual({
      id: "codeowners-satisfied",
      verdict: "pass",
      why: "GitHub states APPROVED and holds no open code-owner request",
    });
  });

  it("passes APPROVED over a merge status GitHub has not computed, since the stated decision outranks it", () => {
    const test = landingTests({
      queueAvailability: HAS_QUEUE,
      state: state({ githubMergeStatus: githubMergeStatus({ value: "UNKNOWN" }), reviewDecision: "APPROVED" }),
    }).find((one) => one.id === "codeowners-satisfied")!;
    expect(test).toStrictEqual({
      id: "codeowners-satisfied",
      verdict: "pass",
      why: "GitHub states APPROVED and holds no open code-owner request",
    });
  });

  it.each(["CLEAN", "UNSTABLE", "HAS_HOOKS"])(
    "still passes an ABSENT decision GitHub reports %s over, naming the status it rested on",
    (token) => {
      const test = landingTests({
        queueAvailability: HAS_QUEUE,
        state: state({ githubMergeStatus: githubMergeStatus({ value: token }), reviewDecision: "" }),
      }).find((one) => one.id === "codeowners-satisfied")!;
      expect(test).toStrictEqual({
        id: "codeowners-satisfied",
        verdict: "pass",
        why: `GitHub reports ${token}, so it would merge this now — GitHub holds no open code-owner request`,
      });
    },
  );
});

describe("an EMPTY register, NO decision and a BLOCKED merge is not an approval either", () => {
  // A pull request as re-read: MERGEABLE, BLOCKED, reviewDecision null, nobody
  // approved, no open request — every test read `pass` and the row read `press` / `merge-now`.
  const PR_18152: Partial<PrReviewState> = {
    githubMergeStatus: BLOCKED,
    number: 18152,
    repoSlug: "acme/acme-admin",
    reviewDecision: "",
    url: "https://github.com/acme/acme-admin/pull/18152",
  };

  it("holds the pull request for a human review once every required check passed, and never presses it", () => {
    const built = row({ over: PR_18152 });
    expect(built.tests.find((test) => test.id === "codeowners-satisfied")).toStrictEqual({
      id: "codeowners-satisfied",
      verdict: "fail",
      why:
        `${AWAITING_HUMAN_REVIEW} — GitHub holds no open code-owner request and states no review decision, but ` +
        "every required check passed and GitHub reports the merge BLOCKED, without saying by what",
    });
    expect(built.ready).toBe(false);
    expect(built.action).toBe("blocked-on");
    expect(built.blockedOn).toStrictEqual([]);
    expect(built.dispatch).toStrictEqual({
      kind: "waiting",
      why:
        `${AWAITING_HUMAN_REVIEW} — GitHub holds no open code-owner request and states no review decision, but ` +
        "every required check passed and GitHub reports the merge BLOCKED, without saying by what, and a chase " +
        "is not due yet (asked recently)",
    });
    expect(pressable({ rows: [built] })).toStrictEqual([]);
  });

  it("holds it the same way when the only red is a PROVEN advisory one, since ci-green passes", () => {
    const advisory: Partial<PrReviewState> = {
      ci: "red",
      ciDetail: "5/6 passed, 1 failed, 0 pending",
      failingChecks: [{ kind: "check-run", name: "Advisory E2E", required: false, state: "failed", url: undefined }],
    };
    const built = row({ over: { ...PR_18152, ...advisory } });
    expect(built.tests.find((test) => test.id === "ci-green")!.verdict).toBe("pass");
    expect(built.tests.find((test) => test.id === "codeowners-satisfied")!.verdict).toBe("fail");
    expect(built.action).toBe("blocked-on");
  });

  it("leaves a RED required check as the action, the review half unknown rather than owed", () => {
    const built = row({
      over: {
        ...PR_18152,
        ci: "red",
        ciDetail: "5/6 passed, 1 failed, 0 pending",
        failingChecks: [{ kind: "check-run", name: "build", required: true, state: "failed", url: undefined }],
      },
    });
    expect(built.tests.find((test) => test.id === "codeowners-satisfied")!.verdict).toBe("unknown");
    expect(built.action).toBe("spawn-ci");
  });

  it.each(["BEHIND", "DIRTY", "DRAFT", "UNKNOWN"])(
    "reads an absent decision GitHub reports %s over as unknown, never a pass",
    (token) => {
      const built = row({ over: { ...PR_18152, githubMergeStatus: githubMergeStatus({ value: token }) } });
      expect(built.tests.find((test) => test.id === "codeowners-satisfied")).toStrictEqual({
        id: "codeowners-satisfied",
        verdict: "unknown",
        why: `GitHub holds no open code-owner request and states no review decision, but GitHub reports ${token}, which settles nothing about review`,
      });
    },
  );

  it("reads an absent decision over an UNREAD merge status as unknown, carrying why it was unread", () => {
    const built = row({ over: { ...PR_18152, githubMergeStatus: githubMergeStatus({ value: undefined }) } });
    expect(built.tests.find((test) => test.id === "codeowners-satisfied")).toStrictEqual({
      id: "codeowners-satisfied",
      verdict: "unknown",
      why: "GitHub holds no open code-owner request and states no review decision, but this read carried no mergeStateStatus for it",
    });
  });

  it("never presses the measured flip: same head, advisory-only red, GitHub answering UNKNOWN instead of BLOCKED", () => {
    // Two stored readings 54 minutes apart, heads unchanged: BLOCKED held six pull requests for a
    // human review, UNKNOWN pressed all six, and the enqueue door's fresh read found BLOCKED and refused each.
    const built = row({
      over: {
        ...PR_18152,
        ci: "red",
        ciDetail: "5/6 passed, 1 failed, 0 pending",
        failingChecks: [{ kind: "check-run", name: "Advisory E2E", required: false, state: "failed", url: undefined }],
        githubMergeStatus: githubMergeStatus({ value: "UNKNOWN" }),
      },
    });
    expect(built.tests.find((test) => test.id === "ci-green")!.verdict).toBe("pass");
    expect(built.tests.find((test) => test.id === "mergeable")!.verdict).toBe("pass");
    expect(built.tests.find((test) => test.id === "codeowners-satisfied")!.verdict).toBe("unknown");
    expect(built.ready).toBe(false);
    expect(built.action).toBe("unknown");
    expect(built.dispatch.kind).toBe("unread");
    expect(pressable({ rows: [built] })).toStrictEqual([]);
  });

  it("keeps a running required check as the action over an UNKNOWN status, and still never presses", () => {
    const built = row({
      over: {
        ...PR_18152,
        ci: "running",
        ciDetail: "4/6 passed, 0 failed, 2 pending",
        githubMergeStatus: githubMergeStatus({ value: "UNKNOWN" }),
      },
    });
    expect(built.action).toBe("unknown");
    expect(built.actionDetail).toBe(
      "ci-green could not be answered: CI reads running — 4/6 passed, 0 failed, 2 pending",
    );
    expect(pressable({ rows: [built] })).toStrictEqual([]);
  });

  it("reads unknown, not a review owed, while a required check is still running — CI is the action", () => {
    const built = row({ over: { ...PR_18152, ci: "running", ciDetail: "4/6 passed, 0 failed, 2 pending" } });
    expect(built.tests.find((test) => test.id === "codeowners-satisfied")!.verdict).toBe("unknown");
    expect(built.action).toBe("unknown");
    expect(built.actionDetail).toBe(
      "ci-green could not be answered: CI reads running — 4/6 passed, 0 failed, 2 pending",
    );
    expect(pressable({ rows: [built] })).toStrictEqual([]);
  });
});
