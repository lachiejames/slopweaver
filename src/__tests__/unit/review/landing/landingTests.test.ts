import { describe, expect, it } from "vitest";
import { githubMergeStatus } from "../../../../review/githubMergeStatus.js";
import { landingRow } from "../../../../review/landing.js";
import { AWAITING_HUMAN_REVIEW, landingTests } from "../../../../review/landingTests.js";
import { BLOCKED, HAS_QUEUE, NO_ROW, owners, state, thread } from "./fixtures.js";

describe("landingTests", () => {
  it("passes all six on a pull request nothing is holding", () => {
    const tests = landingTests({ queueAvailability: HAS_QUEUE, state: state() });
    expect(tests.map((test) => test.id)).toEqual([
      "undrafted",
      "ci-green",
      "mergeable",
      "threads-clear",
      "codeowners-satisfied",
      "queue-available",
    ]);
    expect(tests.every((test) => test.verdict === "pass")).toBe(true);
  });

  it("fails ci-green when a context the base REQUIRES never ran, even with every present check green", () => {
    const tests = landingTests({
      queueAvailability: HAS_QUEUE,
      state: state({
        requiredContexts: {
          branch: "staging",
          kind: "read",
          mergeable: undefined,
          missing: ["integration"],
          required: ["build", "integration"],
          unproven: [],
        },
      }),
    });
    const ci = tests.find((test) => test.id === "ci-green")!;
    expect(ci.verdict).toBe("fail");
    expect(ci.why).toContain("integration");
  });

  it("answers ci-green unknown, never pass, when the required set could not be read", () => {
    const tests = landingTests({
      queueAvailability: HAS_QUEUE,
      state: state({ requiredContexts: { kind: "unreadable", reason: "the token cannot read protection" } }),
    });
    expect(tests.find((test) => test.id === "ci-green")!.verdict).toBe("unknown");
  });

  it("answers ci-green unknown while CI is still running", () => {
    const tests = landingTests({ queueAvailability: HAS_QUEUE, state: state({ ci: "running" }) });
    expect(tests.find((test) => test.id === "ci-green")!.verdict).toBe("unknown");
  });

  it("fails codeowners-satisfied on GitHub's own open asCodeOwner request GitHub reports the merge BLOCKED over", () => {
    const tests = landingTests({
      queueAvailability: HAS_QUEUE,
      state: state({
        githubMergeStatus: BLOCKED,
        githubCodeowners: owners({
          requests: [{ asCodeOwner: true, kind: "team", name: "acme/eng" }],
        }),
      }),
    });
    const test = tests.find((check) => check.id === "codeowners-satisfied")!;
    expect(test.verdict).toBe("fail");
    expect(test.why).toBe(
      `${AWAITING_HUMAN_REVIEW} — GitHub still holds a code-owner request out to @acme/eng, and ` +
        "GitHub reports the merge BLOCKED, without saying by what",
    );
  });

  // GitHub asking somebody for a review
  // is not the same claim as the base branch requiring them, and a pull request GitHub itself offers
  // "Merge when ready" on is pressed. The three mergeable statuses are the only ones that clear it.
  it.each(["CLEAN", "UNSTABLE", "HAS_HOOKS"])(
    "passes codeowners-satisfied over a pending request when GitHub answers %s",
    (status) => {
      const tests = landingTests({
        queueAvailability: HAS_QUEUE,
        state: state({
          githubMergeStatus: githubMergeStatus({ value: status }),
          githubCodeowners: owners({ requests: [{ asCodeOwner: true, kind: "user", name: "quinn" }] }),
        }),
      });
      const test = tests.find((check) => check.id === "codeowners-satisfied")!;
      expect(test.verdict).toBe("pass");
      expect(test.why).toBe(
        `GitHub reports ${status}, so it would merge this now — its open request to @quinn is not a ` +
          "review staging requires",
      );
    },
  );

  it.each(["BEHIND", "DIRTY", "DRAFT", "UNKNOWN", "SOMETHING_NEW"])(
    "keeps the hold over a pending request when GitHub answers %s, which settles nothing about review",
    (status) => {
      const tests = landingTests({
        queueAvailability: HAS_QUEUE,
        state: state({
          githubMergeStatus: githubMergeStatus({ value: status }),
          githubCodeowners: owners({ requests: [{ asCodeOwner: true, kind: "user", name: "quinn" }] }),
        }),
      });
      expect(tests.find((check) => check.id === "codeowners-satisfied")!.verdict).toBe("fail");
    },
  );

  it("never clears a pending request off a TRUNCATED request read, however green the merge status", () => {
    // A capped request page LOSES a pending owner, so the register this exception argues about is not even
    // fully known. Relaxing incomplete evidence is a second policy change, and it is not this one.
    const tests = landingTests({
      queueAvailability: HAS_QUEUE,
      state: state({
        githubCodeowners: owners({
          requests: [{ asCodeOwner: true, kind: "user", name: "quinn" }],
          requestsTruncated: true,
        }),
      }),
    });
    expect(tests.find((check) => check.id === "codeowners-satisfied")!.verdict).toBe("fail");
  });

  it("opens that sentence with the OWNER's words, which is what `blocked-on` then prints on every surface", () => {
    expect(AWAITING_HUMAN_REVIEW).toBe("waiting on a human review");

    const built = landingRow({
      inputs: {
        authoredByOwner: true,
        boardRow: NO_ROW,
        nowIso: "2026-09-24T17:00:00.000Z",
        optOutLabels: [],
        press: undefined,
        queueAvailability: HAS_QUEUE,
        state: state({
          githubMergeStatus: BLOCKED,
          githubCodeowners: owners({ requests: [{ asCodeOwner: true, kind: "team", name: "acme/eng" }] }),
        }),
      },
    });

    expect(built.action).toBe("blocked-on");
    expect(built.actionDetail).toBe(
      `${AWAITING_HUMAN_REVIEW} — GitHub still holds a code-owner request out to @acme/eng, and ` +
        "GitHub reports the merge BLOCKED, without saying by what",
    );
  });

  it("passes codeowners-satisfied once GitHub records the approval on behalf of the team", () => {
    const tests = landingTests({
      queueAvailability: HAS_QUEUE,
      state: state({
        githubCodeowners: owners({
          reviews: [{ login: "a-colleague", onBehalfOf: ["acme/eng"], state: "APPROVED" }],
        }),
      }),
    });
    expect(tests.find((test) => test.id === "codeowners-satisfied")!.verdict).toBe("pass");
  });

  it("answers codeowners-satisfied UNKNOWN when the REQUEST read was capped, never pass", () => {
    // Found by an adversarial pass: a capped request read loses a PENDING owner, so an empty owner list
    // would otherwise read as no requirement at all and every other test could pass over it.
    const tests = landingTests({
      queueAvailability: HAS_QUEUE,
      state: state({ githubCodeowners: owners({ requestsTruncated: true }) }),
    });
    expect(tests.find((test) => test.id === "codeowners-satisfied")!.verdict).toBe("unknown");
  });

  it("still passes codeowners-satisfied when only the REVIEWS read was capped, which errs toward holding back", () => {
    const tests = landingTests({
      queueAvailability: HAS_QUEUE,
      state: state({ githubCodeowners: owners({ reviewsTruncated: true }) }),
    });
    expect(tests.find((test) => test.id === "codeowners-satisfied")!.verdict).toBe("pass");
  });

  it("fails threads-clear on a reviewer thread waiting on us", () => {
    const tests = landingTests({
      queueAvailability: HAS_QUEUE,
      state: state({ threads: [thread()], waitingOn: [{ login: "a-reviewer", open: 1 }] }),
    });
    const test = tests.find((check) => check.id === "threads-clear")!;
    expect(test.verdict).toBe("fail");
    expect(test.why).toContain("a-reviewer (1)");
  });

  it("passes threads-clear on the author's own self-review walkthrough, which waitingOn excludes", () => {
    const tests = landingTests({
      queueAvailability: HAS_QUEUE,
      state: state({ threads: [thread({ disposition: "ours-open", openedByLogin: "the-owner" })], waitingOn: [] }),
    });
    expect(tests.find((test) => test.id === "threads-clear")!.verdict).toBe("pass");
  });

  it("answers threads-clear unknown on a capped thread read, because a cap can only LOSE one", () => {
    const tests = landingTests({ queueAvailability: HAS_QUEUE, state: state({ threadsTruncated: true }) });
    expect(tests.find((test) => test.id === "threads-clear")!.verdict).toBe("unknown");
  });

  it("answers ci-green unknown, never pass, when the check rollup carried more contexts than it asked for", () => {
    const tests = landingTests({ queueAvailability: HAS_QUEUE, state: state({ checksTruncated: true }) });
    const ci = tests.find((test) => test.id === "ci-green")!;
    expect(ci.verdict).toBe("unknown");
    expect(ci.why).toContain("a capped read can only LOSE a failing one");
  });

  it("still FAILS ci-green on a red rollup that was also truncated, rather than softening it to unknown", () => {
    const tests = landingTests({
      queueAvailability: HAS_QUEUE,
      state: state({ checksTruncated: true, ci: "red", ciDetail: "5/6 passed, 1 failed, 0 pending" }),
    });
    expect(tests.find((test) => test.id === "ci-green")!.verdict).toBe("fail");
  });

  it("answers ci-green unknown when the head's checks could not be read at all", () => {
    const tests = landingTests({
      queueAvailability: HAS_QUEUE,
      state: state({ checksRead: { kind: "unread", why: "GitHub returned no head commit" } }),
    });
    expect(tests.find((test) => test.id === "ci-green")!.verdict).toBe("unknown");
  });

  it("answers mergeable UNKNOWN, never pass, when GitHub has not computed it", () => {
    const tests = landingTests({
      queueAvailability: HAS_QUEUE,
      state: state({ conflict: { local: { kind: "not-requested" }, mergeable: "UNKNOWN" } }),
    });
    const mergeable = tests.find((test) => test.id === "mergeable")!;
    expect(mergeable.verdict).toBe("unknown");
    expect(mergeable.why).toContain("it computes that lazily");
  });

  it("passes mergeable only on GitHub's own MERGEABLE", () => {
    const tests = landingTests({ queueAvailability: HAS_QUEUE, state: state() });
    expect(tests.find((test) => test.id === "mergeable")!.verdict).toBe("pass");
  });

  it("fails queue-available when the base is not the default branch", () => {
    const tests = landingTests({
      queueAvailability: HAS_QUEUE,
      state: state({
        baseRefName: "feature/widget-6",
        stack: {
          baseRefName: "feature/widget-6",
          chain: [16377, 16378],
          defaultBranch: "staging",
          grounded: true,
          position: 2,
          size: 2,
          stacked: true,
        },
      }),
    });
    expect(tests.find((test) => test.id === "queue-available")!.verdict).toBe("fail");
  });

  it("fails queue-available when the base branch has no merge queue at all", () => {
    const tests = landingTests({ queueAvailability: { kind: "none" }, state: state() });
    expect(tests.find((test) => test.id === "queue-available")!.verdict).toBe("fail");
  });

  it("answers queue-available unknown when the queue read failed", () => {
    const tests = landingTests({ queueAvailability: { kind: "unread", why: "GitHub answered 502" }, state: state() });
    expect(tests.find((test) => test.id === "queue-available")!.verdict).toBe("unknown");
  });
});
