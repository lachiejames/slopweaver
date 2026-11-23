import { describe, expect, it } from "vitest";
import { githubMergeStatus } from "../../../../review/githubMergeStatus.js";
import { landingTally, pressable } from "../../../../review/landing.js";
import type { LandingBoardRow } from "../../../../review/landingBoard.js";
import { FIRST_ASK_BRIEF } from "../../../../review/landingDispatchAsk.js";
import { AWAITING_HUMAN_REVIEW } from "../../../../review/landingTests.js";
import type { PrReviewState } from "../../../../review/reviewState.js";
import { BLOCKED, owners, row } from "./fixtures.js";

/** Only an advisory check red, the base's required set read and satisfied. */
const ADVISORY_RED: Partial<PrReviewState> = {
  ci: "red",
  ciDetail: "5/6 passed, 1 failed, 0 pending",
  failingChecks: [
    {
      kind: "check-run",
      name: "Advisory local browser E2E (billing)",
      required: false,
      state: "failed",
      url: undefined,
    },
  ],
};

/** A code owner still holding it, so the ladder has a later rung to step aside to. */
const OWNER_PENDING: Partial<PrReviewState> = {
  githubMergeStatus: BLOCKED,
  githubCodeowners: owners({ requests: [{ asCodeOwner: true, kind: "team", name: "acme/eng" }] }),
};

/** A done board row about an OLDER head — history, which no longer decides whether a red is advisory. */
const DONE_ELSEWHERE: LandingBoardRow = {
  kind: "row",
  settlementWitness: "rebased to fedcba9876",
  slug: "land-x",
  status: "done",
};

/**
 * A pull request as every landing reading recorded it over several days — approved
 * by both owning teams, mergeable, every context `staging` requires green, three advisory E2E lanes red — and
 * classed `spawn-ci` / `rebase-and-fix` on each one until the owner pressed it themselves.
 */
const PR_18226: Partial<PrReviewState> = {
  approvedBy: ["jaspernolan-acme"],
  authorLogin: "octocat",
  baseRefName: "staging",
  ci: "red",
  ciDetail: "21/24 passed, 3 failed, 0 pending",
  conflict: { local: { kind: "not-requested" }, mergeable: "MERGEABLE" },
  failingChecks: [
    {
      kind: "check-run",
      name: "Advisory local browser E2E (session)",
      required: false,
      state: "failed",
      url: undefined,
    },
    {
      kind: "check-run",
      name: "Advisory local browser E2E (customer)",
      required: false,
      state: "failed",
      url: undefined,
    },
    {
      kind: "check-run",
      name: "Advisory local browser E2E (billing)",
      required: false,
      state: "failed",
      url: undefined,
    },
  ],
  githubCodeowners: owners({
    reviews: [
      {
        login: "jaspernolan-acme",
        onBehalfOf: ["acme/acme-eng", "acme/platform"],
        state: "APPROVED",
      },
    ],
  }),
  githubMergeStatus: githubMergeStatus({ value: "UNSTABLE" }),
  number: 18226,
  repoSlug: "acme/acme-admin",
  requiredContexts: {
    branch: "staging",
    kind: "read",
    mergeable: undefined,
    missing: [],
    required: ["Required CI", "Semgrep (TS/React/Fastify)"],
    unproven: [],
  },
  reviewDecision: "",
  url: "https://github.com/acme/acme-admin/pull/18226",
};

describe("an advisory red", () => {
  it("presses the recorded state: approved, mergeable, required CI green, only advisory lanes red", () => {
    const built = row({ over: PR_18226 });
    expect(built.tests.find((test) => test.id === "ci-green")).toStrictEqual({
      id: "ci-green",
      verdict: "pass",
      why:
        "every context staging requires passed; its only red is advisory — Advisory local browser E2E (session), " +
        "Advisory local browser E2E (customer), Advisory local browser E2E (billing) (21/24 passed, 3 failed, 0 pending)",
    });
    expect(built.ready).toBe(true);
    expect(built.action).toBe("press");
    expect(built.dispatch).toStrictEqual({
      kind: "act",
      verdict: "merge-now",
      why: "every test passed and it is not queued",
    });
    expect(pressable({ rows: [built] }).map((one) => one.number)).toStrictEqual([18226]);
    expect(landingTally({ rows: [built] }).advisoryRedBypassed).toBe(1);
  });

  it("reads the code owner actually holding it, with no board row at all, and keeps the red counted", () => {
    const built = row({ over: { ...ADVISORY_RED, ...OWNER_PENDING } });
    expect(built.action).toBe("blocked-on");
    expect(built.actionDetail).toBe(
      `${AWAITING_HUMAN_REVIEW} — GitHub still holds a code-owner request out to @acme/eng, and ` +
        "GitHub reports the merge BLOCKED, without saying by what",
    );
    expect(built.ciFailure).toStrictEqual({ kind: "red", required: false });
    expect(built.ready).toBe(false);
    expect(landingTally({ rows: [built] }).advisoryRedBypassed).toBe(1);
  });

  it("dispatches the first-ask seat, never a rebase-and-fix, when nobody was ever asked", () => {
    const built = row({
      over: {
        ...ADVISORY_RED,
        ...OWNER_PENDING,
        bump: { kind: "unknown", why: "nobody has been asked, so there is nothing to bump" },
      },
    });
    expect(built.dispatch).toStrictEqual({
      kind: "act",
      verdict: "draft-first-review-ask",
      why:
        `${AWAITING_HUMAN_REVIEW} — GitHub still holds a code-owner request out to @acme/eng, and GitHub reports ` +
        "the merge BLOCKED, without saying by what, and the Slack corpus reaches far enough to say nobody has " +
        `been asked at all — ${FIRST_ASK_BRIEF}`,
    });
  });

  it("holds on the code owner regardless of what the board row says — a done row about another head changes nothing", () => {
    expect(row({ boardRow: DONE_ELSEWHERE, over: { ...ADVISORY_RED, ...OWNER_PENDING } }).action).toBe("blocked-on");
  });

  it("reaches press when nothing else holds it — the four days it sat as spawn-ci", () => {
    const built = row({ over: ADVISORY_RED });
    expect(built.action).toBe("press");
    expect(pressable({ rows: [built] }).map((one) => one.number)).toStrictEqual([16378]);
    expect(landingTally({ rows: [built] }).advisoryRedBypassed).toBe(1);
  });

  it("stays spawn-ci when dev-gate is red, which gates a landing although no branch protection can require it", () => {
    const over: Partial<PrReviewState> = {
      ci: "red",
      failingChecks: [{ kind: "check-run", name: "dev-gate", required: false, state: "failed", url: undefined }],
    };
    const built = row({ over });
    expect(built.action).toBe("spawn-ci");
    expect(built.ciFailure).toStrictEqual({ kind: "red", required: true });
  });

  it("stays spawn-ci on a base that requires nothing, where every red would otherwise read advisory", () => {
    const over: Partial<PrReviewState> = {
      ...ADVISORY_RED,
      requiredContexts: {
        branch: "staging",
        kind: "read",
        mergeable: undefined,
        missing: [],
        required: [],
        unproven: [],
      },
    };
    const built = row({ over });
    expect(built.action).toBe("spawn-ci");
    expect(built.ciFailure).toStrictEqual({ kind: "red", required: undefined });
  });

  it("stays spawn-ci when a required check is still running beside the advisory red", () => {
    const over: Partial<PrReviewState> = {
      ...ADVISORY_RED,
      failingChecks: [
        { kind: "check-run", name: "build", required: true, state: "running", url: undefined },
        {
          kind: "check-run",
          name: "Advisory local browser E2E (billing)",
          required: false,
          state: "failed",
          url: undefined,
        },
      ],
    };
    expect(row({ over }).action).toBe("spawn-ci");
  });

  it("stays spawn-ci when a REQUIRED check is among the reds", () => {
    const over: Partial<PrReviewState> = {
      ...ADVISORY_RED,
      ...OWNER_PENDING,
      failingChecks: [
        {
          kind: "check-run",
          name: "Advisory local browser E2E (billing)",
          required: false,
          state: "failed",
          url: undefined,
        },
        { kind: "check-run", name: "build", required: true, state: "failed", url: undefined },
      ],
    };
    const built = row({ over });
    expect(built.action).toBe("spawn-ci");
    expect(built.ciFailure).toStrictEqual({ kind: "red", required: true });
  });

  it("stays spawn-ci when a failing check's requirement is unknown", () => {
    const over: Partial<PrReviewState> = {
      ...OWNER_PENDING,
      ci: "red",
      failingChecks: [{ kind: "check-run", name: "e2e", required: undefined, state: "failed", url: undefined }],
    };
    const built = row({ over });
    expect(built.action).toBe("spawn-ci");
    expect(built.ciFailure).toStrictEqual({ kind: "red", required: undefined });
  });

  it("stays spawn-ci when the checks page was truncated, which can only lose a failing required context", () => {
    expect(row({ over: { ...ADVISORY_RED, ...OWNER_PENDING, checksTruncated: true } }).action).toBe("spawn-ci");
  });

  it("never counts a red that a rung ABOVE CI holds — its required checks may never have run", () => {
    const requiredNeverRan: Partial<PrReviewState> = {
      ci: "red",
      failingChecks: [{ kind: "check-run", name: "build", required: true, state: "missing", url: undefined }],
    };
    const conflicting = row({
      over: {
        ...requiredNeverRan,
        conflict: { local: { kind: "measured", paths: ["package.json"], why: "" }, mergeable: "CONFLICTING" },
      },
    });
    const drafted = row({ over: { ...requiredNeverRan, undrafted: false } });
    const optedOut = row({ over: { ...requiredNeverRan, labels: ["no-auto-merge"] } });
    expect([conflicting.action, drafted.action, optedOut.action]).toStrictEqual(["conflicting", "draft", "opted-out"]);
    expect(landingTally({ rows: [conflicting, drafted, optedOut] }).advisoryRedBypassed).toBe(0);
  });
});
