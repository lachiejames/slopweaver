import { describe, expect, it } from "vitest";
import { githubMergeStatus } from "../../../../review/githubMergeStatus.js";
import { landingAction, pressable } from "../../../../review/landing.js";
import { failureLadder } from "../../../../review/landingLadder.js";
import { landingTests } from "../../../../review/landingTests.js";
import { BLOCKED, HAS_QUEUE, HEAD, owners, row, state, thread } from "./fixtures.js";

describe("landingAction", () => {
  it("presses a pull request whose six tests all pass and which is not queued", () => {
    expect(row().action).toBe("press");
    expect(row().ready).toBe(true);
  });

  it("never presses while a test is unknown", () => {
    const built = row({ over: { ci: "running" } });
    expect(built.ready).toBe(false);
    expect(built.action).toBe("unknown");
    expect(built.actionDetail).toContain("ci-green");
  });

  it("reads a stale CodeRabbit as pressable, because staleness holds nothing back", () => {
    expect(row({ over: { codeRabbit: "stale", codeRabbitDetail: "reviewed an earlier push" } }).action).toBe("press");
  });

  it("spawns for CodeRabbit when it asked for changes, even with every test green", () => {
    const built = row({ over: { codeRabbit: "changes-requested", codeRabbitDetail: "2 comments outstanding" } });
    expect(built.action).toBe("spawn-coderabbit");
    expect(built.actionDetail).toBe("2 comments outstanding");
  });

  it("spawns for CI ahead of CodeRabbit, because a red build makes the review moot", () => {
    expect(
      row({ over: { ci: "red", ciDetail: "4/6 passed, 2 failed, 0 pending", codeRabbit: "changes-requested" } }).action,
    ).toBe("spawn-ci");
  });

  it("reports a conflict ahead of everything a session could act on", () => {
    expect(
      row({
        over: {
          ci: "red",
          conflict: { local: { kind: "measured", paths: ["package.json"], why: "" }, mergeable: "CONFLICTING" },
        },
      }).action,
    ).toBe("conflicting");
  });

  it("honours the opt-out label above every other act", () => {
    expect(row({ over: { ci: "red", labels: ["No-Auto-Merge"] } }).action).toBe("opted-out");
  });

  it("reads a queued pull request as queued rather than pressing it again", () => {
    const built = row({ over: { queueEntry: { estimatedSecondsToMerge: undefined, position: 2, state: "QUEUED" } } });
    expect(built.action).toBe("queued");
    expect(built.queue.kind).toBe("queued");
  });

  it("reads a pull request we pressed that GitHub has no entry for, at the same head, as pressed-not-queued", () => {
    const built = row({ press: { atIso: "2026-09-09T12:10:00.000Z", headOid: HEAD } });
    expect(built.action).toBe("pressed-not-queued");
    expect(built.queue.kind).toBe("pressed-not-queued");
    expect(built.actionDetail).toContain("do not re-press until the head moves");
  });

  it("claims no CAUSE for a dropped entry, because the absence establishes none", () => {
    // An adversarial pass called the earlier name `evicted` an unsupported causal claim: a hand-run
    // `github enqueue --dequeue` produces the identical state.
    const built = row({ press: { atIso: "2026-09-09T12:10:00.000Z", headOid: HEAD } });
    expect(built.actionDetail).toContain("or somebody may have dequeued it by hand");
  });

  it("spawns for CI on a STACKED pull request, because that work can start before the stack lands", () => {
    const built = row({
      over: {
        baseRefName: "feature/widget-6",
        ci: "red",
        ciDetail: "4/6 passed, 2 failed, 0 pending",
        stack: {
          baseRefName: "feature/widget-6",
          chain: [16377, 16378],
          defaultBranch: "staging",
          grounded: true,
          position: 2,
          size: 2,
          stacked: true,
        },
      },
    });
    expect(built.action).toBe("spawn-ci");
  });

  it("still reads a GREEN stacked pull request as stacked, which is the owner's own ruling", () => {
    const built = row({
      over: {
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
      },
    });
    expect(built.action).toBe("stacked");
  });

  it("presses again once the head has moved past the press we recorded", () => {
    const built = row({
      press: { atIso: "2026-09-09T12:10:00.000Z", headOid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    });
    expect(built.action).toBe("press");
  });

  it("names who is blocking when only the code-owner test failed", () => {
    const built = row({
      over: {
        githubMergeStatus: BLOCKED,
        githubCodeowners: owners({ requests: [{ asCodeOwner: true, kind: "user", name: "a-colleague" }] }),
      },
    });
    expect(built.action).toBe("blocked-on");
    expect(built.blockedOn).toEqual(["@a-colleague"]);
  });

  it("presses the same row once GitHub offers the merge, which is the whole of owner ruling 291-9x", () => {
    const built = row({
      over: {
        githubMergeStatus: githubMergeStatus({ value: "CLEAN" }),
        githubCodeowners: owners({ requests: [{ asCodeOwner: true, kind: "user", name: "a-colleague" }] }),
      },
    });
    expect(built.action).toBe("press");
    expect(built.blockedOn).toEqual([]);
    expect(pressable({ rows: [built] }).map((one) => one.number)).toEqual([built.number]);
  });

  it("asks for a thread answer ahead of a code-owner wait, because that one is our move", () => {
    const built = row({
      over: {
        githubCodeowners: owners({ requests: [{ asCodeOwner: true, kind: "team", name: "acme/eng" }] }),
        threads: [thread()],
        waitingOn: [{ login: "a-reviewer", open: 1 }],
      },
    });
    expect(built.action).toBe("answer-threads");
  });

  it("spawns for CodeRabbit on a STACKED pull request, for the same reason spawn-ci outranks stacked", () => {
    const built = row({
      over: {
        codeRabbit: "changes-requested",
        codeRabbitDetail: "5 unresolved CodeRabbit comment(s) still open",
        stack: {
          baseRefName: "feature/bottom",
          chain: [16377, 16378],
          defaultBranch: "staging",
          grounded: true,
          position: 2,
          size: 2,
          stacked: true,
        },
      },
      queueAvailability: HAS_QUEUE,
    });
    expect(built.action).toBe("spawn-coderabbit");
  });

  it("still says no-queue when CodeRabbit has nothing outstanding", () => {
    expect(row({ queueAvailability: { kind: "none" } }).action).toBe("no-queue");
  });

  it("says draft when it is one", () => {
    expect(row({ over: { undrafted: false } }).action).toBe("draft");
  });

  it("says no-queue when the base branch has none, separately from stacked", () => {
    expect(row({ queueAvailability: { kind: "none" } }).action).toBe("no-queue");
  });

  it("keeps ready false when a test is unknown even though nothing failed", () => {
    const tests = landingTests({ queueAvailability: { kind: "unread", why: "GitHub answered 502" }, state: state() });
    const decided = landingAction({
      optedOut: false,
      queue: { kind: "unread", why: "GitHub answered 502" },
      state: state(),
      tests,
    });
    expect(decided.action).toBe("unknown");
  });
});

describe("failureLadder", () => {
  it("answers undefined when no test failed", () => {
    const tests = landingTests({ queueAvailability: HAS_QUEUE, state: state() });
    expect(failureLadder({ state: state(), tests })).toBe(undefined);
  });
});
