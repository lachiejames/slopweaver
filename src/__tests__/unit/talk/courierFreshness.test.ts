/**
 * Whether the chair's courier re-executes into main: a target restarts only once seen twice, a docs-only landing
 * restarts nothing, and a follower an exec started refuses another for five minutes.
 */
import { describe, expect, it } from "vitest";

import {
  COURIER_CODE_PATHSPECS,
  COURIER_REEXEC_COOLDOWN_MS,
  type CourierGitRead,
  type CourierRestartCandidate,
  courierRestartLine,
  decideCourierFreshness,
  recoversAtStart,
  reexecStampOf,
} from "../../../talk/courierFreshness.js";

const MAIN = "/repo/main";
const WORKTREE = "/repo/.claude/worktrees.noindex/fresh-supervisor-handoff-9356";
const START = "1312704123";
const NEXT = "4054899f08";
const NOW = "2026-10-31T06:30:00.000Z";

const unchanged: CourierGitRead = { changedPaths: [], head: START, kind: "resolved" };
const landed: CourierGitRead = {
  changedPaths: ["src/talk/chairWake.ts", "src/talk/chairBatchLine.ts"],
  head: NEXT,
  kind: "resolved",
};

/** One decision with the fields a case does not name held at their quiet defaults. */
function decide({
  runningRoot = MAIN,
  current = unchanged,
  previousCandidate,
  reexecAtIso,
  startHead = START,
}: {
  runningRoot?: string;
  current?: CourierGitRead;
  previousCandidate?: CourierRestartCandidate;
  reexecAtIso?: string;
  startHead?: string;
}): ReturnType<typeof decideCourierFreshness> {
  return decideCourierFreshness({
    current,
    main: { kind: "resolved", root: MAIN },
    nowIso: NOW,
    previousCandidate,
    reexecAtIso,
    runningRoot,
    startHead,
  });
}

describe("decideCourierFreshness", () => {
  it("carries on silently on main at the head it started at", () => {
    expect(decide({})).toEqual({ candidate: undefined, kind: "continue", notice: undefined });
  });

  it("sees a follower from another tree once, then restarts it into main the second time", () => {
    const first = decide({ runningRoot: WORKTREE });
    expect(first).toEqual({ candidate: { kind: "not-main", mainRoot: MAIN }, kind: "continue", notice: undefined });
    expect(decide({ previousCandidate: { kind: "not-main", mainRoot: MAIN }, runningRoot: WORKTREE })).toEqual({
      candidate: { kind: "not-main", mainRoot: MAIN },
      kind: "restart",
    });
  });

  it("does not restart when main itself moved between the two observations", () => {
    expect(
      decide({ previousCandidate: { kind: "not-main", mainRoot: "/repo/other-main" }, runningRoot: WORKTREE }),
    ).toEqual({ candidate: { kind: "not-main", mainRoot: MAIN }, kind: "continue", notice: undefined });
  });

  it("restarts on main once a code landing is seen at the same head twice, naming the first changed path", () => {
    const candidate = { head: NEXT, kind: "changed", mainRoot: MAIN, path: "src/talk/chairWake.ts" } as const;
    expect(decide({ current: landed })).toEqual({ candidate, kind: "continue", notice: undefined });
    expect(decide({ current: landed, previousCandidate: candidate })).toEqual({ candidate, kind: "restart" });
  });

  it("waits again when main's head moved on between the two observations, as a pull mid-flight does", () => {
    const earlier = { head: "aaaaaaaaaa", kind: "changed", mainRoot: MAIN, path: "src/talk/chairWake.ts" } as const;
    expect(decide({ current: landed, previousCandidate: earlier })).toEqual({
      candidate: { head: NEXT, kind: "changed", mainRoot: MAIN, path: "src/talk/chairWake.ts" },
      kind: "continue",
      notice: undefined,
    });
  });

  it("restarts nothing for a landing that touched no code path", () => {
    const docsOnly: CourierGitRead = { changedPaths: [], head: NEXT, kind: "resolved" };
    const previous = { head: NEXT, kind: "changed", mainRoot: MAIN, path: "src/x.ts" } as const;
    expect(decide({ current: docsOnly, previousCandidate: previous })).toEqual({
      candidate: undefined,
      kind: "continue",
      notice: undefined,
    });
  });

  it("watches the code, the launcher and the dependency pins", () => {
    expect(COURIER_CODE_PATHSPECS).toEqual(["src", "bin", "package.json", "yarn.lock"]);
  });

  it("says why when main cannot be named, and restarts nothing", () => {
    expect(
      decideCourierFreshness({
        current: unchanged,
        main: { kind: "unresolved", why: "no main checkouts are declared" },
        nowIso: NOW,
        previousCandidate: { kind: "not-main", mainRoot: MAIN },
        reexecAtIso: undefined,
        runningRoot: WORKTREE,
        startHead: undefined,
      }),
    ).toEqual({
      candidate: undefined,
      kind: "continue",
      notice: { kind: "unmeasured", why: "no main checkouts are declared" },
    });
  });

  it("says why when git could not read main, and never reads that as unchanged", () => {
    expect(decide({ current: { kind: "unresolved", why: "cannot read the main checkout's HEAD" } })).toEqual({
      candidate: undefined,
      kind: "continue",
      notice: { kind: "unmeasured", why: "cannot read the main checkout's HEAD" },
    });
  });

  it("says why when the follower on main never read its start head", () => {
    expect(
      decideCourierFreshness({
        current: landed,
        main: { kind: "resolved", root: MAIN },
        nowIso: NOW,
        previousCandidate: undefined,
        reexecAtIso: undefined,
        runningRoot: MAIN,
        startHead: undefined,
      }),
    ).toEqual({
      candidate: undefined,
      kind: "continue",
      notice: { kind: "unmeasured", why: "the head this follower started at could not be read" },
    });
  });

  describe("the cooldown after a re-exec", () => {
    const previous = { kind: "not-main", mainRoot: MAIN } as const;
    const ago = ({ ms }: { ms: number }): string => new Date(Date.parse(NOW) - ms).toISOString();

    it("refuses a second exec just inside five minutes of the last", () => {
      const decision = decide({
        previousCandidate: previous,
        reexecAtIso: ago({ ms: COURIER_REEXEC_COOLDOWN_MS - 1 }),
        runningRoot: WORKTREE,
      });
      expect(decision.kind).toBe("continue");
      expect(decision).toEqual({
        candidate: previous,
        kind: "continue",
        notice: {
          kind: "cooldown",
          why: `this follower was itself started by a re-exec at ${ago({ ms: COURIER_REEXEC_COOLDOWN_MS - 1 })}, under 5 minutes ago — not re-executing again yet`,
        },
      });
    });

    it("allows one exactly five minutes on", () => {
      expect(
        decide({
          previousCandidate: previous,
          reexecAtIso: ago({ ms: COURIER_REEXEC_COOLDOWN_MS }),
          runningRoot: WORKTREE,
        }),
      ).toEqual({ candidate: previous, kind: "restart" });
    });

    it("still holds for a stamp a stepped-back clock puts in the future", () => {
      expect(
        decide({ previousCandidate: previous, reexecAtIso: ago({ ms: -60_000 }), runningRoot: WORKTREE }).kind,
      ).toBe("continue");
    });

    it("gives a stamp that is no instant no authority", () => {
      expect(decide({ previousCandidate: previous, reexecAtIso: "yesterday", runningRoot: WORKTREE })).toEqual({
        candidate: previous,
        kind: "restart",
      });
    });
  });
});

describe("recoversAtStart", () => {
  it("recovers at a boot, which is the only start that can follow a stopped courier", () => {
    expect(recoversAtStart({ reexecAtIso: undefined })).toBe(true);
  });

  it("never recovers in an image a re-exec started, which could requeue a live courier's taken request", () => {
    expect(recoversAtStart({ reexecAtIso: "2026-10-31T06:30:00.000Z" })).toBe(false);
  });
});

describe("reexecStampOf", () => {
  const PID = 4242;

  it("reads the stamp a re-exec of this same pid left", () => {
    expect(
      reexecStampOf({
        env: { SLOPWEAVER_COURIER_REEXEC_AT: NOW, SLOPWEAVER_COURIER_REEXEC_PID: "4242" },
        pid: PID,
      }),
    ).toBe(NOW);
  });

  it("reads a boot when the stamp names another pid, as a child or a later boot inheriting it would", () => {
    expect(
      reexecStampOf({
        env: { SLOPWEAVER_COURIER_REEXEC_AT: NOW, SLOPWEAVER_COURIER_REEXEC_PID: "4241" },
        pid: PID,
      }),
    ).toBe(undefined);
  });

  it("reads a boot when the instant has no pid beside it", () => {
    expect(reexecStampOf({ env: { SLOPWEAVER_COURIER_REEXEC_AT: NOW }, pid: PID })).toBe(undefined);
  });

  it("reads a boot when the instant is empty or does not parse, so recovery still runs", () => {
    expect(
      reexecStampOf({ env: { SLOPWEAVER_COURIER_REEXEC_AT: "", SLOPWEAVER_COURIER_REEXEC_PID: "4242" }, pid: PID }),
    ).toBe(undefined);
    expect(
      reexecStampOf({
        env: { SLOPWEAVER_COURIER_REEXEC_AT: "yesterday", SLOPWEAVER_COURIER_REEXEC_PID: "4242" },
        pid: PID,
      }),
    ).toBe(undefined);
  });

  it("reads a boot with no stamp at all", () => {
    expect(reexecStampOf({ env: {}, pid: PID })).toBe(undefined);
  });
});

describe("courierRestartLine", () => {
  it("names the main checkout for a follower from another tree", () => {
    expect(courierRestartLine({ candidate: { kind: "not-main", mainRoot: MAIN } })).toBe(
      "talk courier: re-executing in place from the main checkout /repo/main — this follower runs another tree's code",
    );
  });

  it("names the head and the first changed path for a landing", () => {
    expect(
      courierRestartLine({ candidate: { head: NEXT, kind: "changed", mainRoot: MAIN, path: "src/talk/chairWake.ts" } }),
    ).toBe(
      "talk courier: re-executing in place at 4054899f08 — main changed src/talk/chairWake.ts since this follower started",
    );
  });
});
