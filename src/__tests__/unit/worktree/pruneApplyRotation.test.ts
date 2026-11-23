/**
 * The decision the removal rotation takes before each tree: stop with the tree still owed, keep it, or remove it —
 * and the order the brakes are asked in, which is what keeps nothing slow between the last read and the removal.
 */
import { describe, expect, it } from "vitest";

import {
  type ApplyPass,
  applyInRotation,
  nextRemovalStep,
  type RemovalStep,
} from "../../../cli/commands/worktree/pruneApplyRotation.js";
import type { PruneVerdict } from "../../../worktree/pruneClassify.js";
import type { RepoPlan } from "../../../worktree/pruneOrder.js";

const DEADLINE_MS = 1_800_000_000_000;

/**
 * Ask for one step with every brake open unless a case overrides it, recording which brake was asked in turn.
 *
 * @param stop what the pacer answers, null to carry on
 * @param held what the live registers answer, null when nothing holds the tree
 * @param nowMs the clock the deadline is read against
 * @param ours what each read of the apply lock answers in turn, the last answer repeating
 * @returns the step taken and the order the brakes were asked in
 */
async function step({
  stop = null,
  held = null,
  nowMs = DEADLINE_MS - 1,
  ours = [true],
}: {
  stop?: string | null;
  held?: string | null;
  nowMs?: number;
  ours?: readonly boolean[];
}): Promise<{ readonly step: RemovalStep; readonly asked: readonly string[] }> {
  const asked: string[] = [];
  let lockReads = 0;
  const result = await nextRemovalStep({
    activityFloorMs: null,
    branch: "feat/acme",
    deadlineMs: DEADLINE_MS,
    heldNow: ({ path, branch }) => {
      asked.push(`held:${path}:${String(branch)}`);
      return Promise.resolve(held);
    },
    lockHeld: () => {
      asked.push("lock");
      const answer = ours[Math.min(lockReads, ours.length - 1)]!;
      lockReads += 1;
      return answer;
    },
    nowMs: () => {
      asked.push("clock");
      return nowMs;
    },
    pace: {
      waitUntilReady: ({ deadlineMs }) => {
        asked.push(`pace:${String(deadlineMs)}`);
        return Promise.resolve(stop);
      },
    },
    path: "/dev/acme/.claude/worktrees.noindex/a",
  });
  return { asked, step: result };
}

describe("nextRemovalStep", () => {
  it("removes the tree when every brake is open, asking the lock, pacer, registers, clock, then lock again", async () => {
    const { step: taken, asked } = await step({});
    expect(taken).toEqual({ kind: "remove" });
    expect(asked).toEqual([
      "lock",
      `pace:${String(DEADLINE_MS)}`,
      "held:/dev/acme/.claude/worktrees.noindex/a:feat/acme",
      "clock",
      "lock",
    ]);
  });

  it("stops with the tree still owed once another run took the apply lock over", async () => {
    const { step: taken, asked } = await step({ ours: [true, false] });
    expect(taken).toEqual({ kind: "stop" });
    expect(asked.at(-1)).toBe("lock");
    expect(asked.length).toBe(5);
  });

  it("stops without waiting on the pacer when the lock was lost before the step began", async () => {
    const { step: taken, asked } = await step({ ours: [false] });
    expect(taken).toEqual({ kind: "stop" });
    expect(asked).toEqual(["lock"]);
  });

  it("stops before reading anything else when the pacer says stop", async () => {
    const { step: taken, asked } = await step({ stop: "load 9.1 at the hold of 8" });
    expect(taken).toEqual({ kind: "stop" });
    expect(asked).toEqual(["lock", `pace:${String(DEADLINE_MS)}`]);
  });

  it("keeps a tree the live registers hold, without reading the clock", async () => {
    const { step: taken, asked } = await step({ held: "a session is open in it" });
    expect(taken).toEqual({ kind: "keep" });
    expect(asked).toEqual([
      "lock",
      `pace:${String(DEADLINE_MS)}`,
      "held:/dev/acme/.claude/worktrees.noindex/a:feat/acme",
    ]);
  });

  it("stops with the tree still owed when the deadline passed while the brakes were read", async () => {
    const { step: taken } = await step({ nowMs: DEADLINE_MS });
    expect(taken).toEqual({ kind: "stop" });
  });
});

describe("applyInRotation — what the pass reports it still owes", () => {
  /** One applicable verdict, so the order holds it. */
  const verdict = ({ path, cls }: { path: string; cls: PruneVerdict["cls"] }): PruneVerdict => ({
    branch: null,
    cls,
    deleteBranch: false,
    diskKib: null,
    dropsDeps: false,
    path,
    reason: "fixture",
  });
  const plans: readonly RepoPlan[] = [
    {
      repoRoot: "/dev/acme",
      verdicts: [
        verdict({ cls: "snapshot", path: "/t/slopweaver-snap-aaaaaa/tree" }),
        verdict({ cls: "pushed", path: "/dev/acme/.claude/worktrees.noindex/b" }),
        verdict({ cls: "hold", path: "/dev/acme/.claude/worktrees.noindex/c" }),
      ],
    },
  ];

  /**
   * Run the rotation with no removal ever reached: the pacer stops, or every tree is held.
   *
   * @param stop what the pacer answers
   * @param held what the live registers answer
   * @param ours whether this run still holds the apply lock
   * @returns the pass the rotation reports
   */
  const run = ({
    stop,
    held,
    ours = true,
  }: {
    stop: string | null;
    held: string | null;
    ours?: boolean;
  }): Promise<ApplyPass> =>
    applyInRotation({
      // A deadline no clock reaches, so the result cannot depend on the clock's value.
      deadlineMs: Number.MAX_SAFE_INTEGER,
      heldNow: () => Promise.resolve(held),
      lockHeld: () => ours,
      memory: { kept: [], repos: [] },
      mergedOnly: false,
      pace: { waitUntilReady: () => Promise.resolve(stop) },
      plans,
      remember: () => undefined,
    });

  it("owes every candidate, the snapshot among them, when the pacer stops before the first tree", async () => {
    const pass = await run({ held: null, stop: "the removal deadline passed — the rest wait for the next run" });
    expect({ candidates: pass.candidates, owedAfter: pass.owedAfter, removed: pass.removed }).toEqual({
      candidates: 2,
      owedAfter: 2,
      removed: 0,
    });
  });

  it("removes nothing and owes every candidate when another run holds the lock now", async () => {
    const pass = await run({ held: null, ours: false, stop: null });
    expect({ owedAfter: pass.owedAfter, remaining: pass.remaining.length, removed: pass.removed }).toEqual({
      owedAfter: 2,
      remaining: 2,
      removed: 0,
    });
  });

  it("never waits on the pacer once the lock is lost, so a displaced run cannot back off to its deadline", async () => {
    const waits: number[] = [];
    await applyInRotation({
      deadlineMs: Number.MAX_SAFE_INTEGER,
      heldNow: () => Promise.resolve(null),
      lockHeld: () => false,
      memory: { kept: [], repos: [] },
      mergedOnly: false,
      pace: {
        waitUntilReady: ({ deadlineMs }) => {
          waits.push(deadlineMs);
          return Promise.resolve(null);
        },
      },
      plans,
      remember: () => undefined,
    });
    expect(waits).toEqual([]);
  });

  it("asks the live check each verdict's own activity window, and none of a verdict that carries none", async () => {
    const asked: (number | null)[] = [];
    const floored: readonly RepoPlan[] = [
      {
        repoRoot: "/dev/acme",
        verdicts: [
          { ...verdict({ cls: "pushed", path: "/dev/acme/.claude/worktrees.noindex/d" }), activityFloorMs: 7_200_000 },
          verdict({ cls: "pushed", path: "/dev/acme/.claude/worktrees.noindex/e" }),
        ],
      },
    ];
    await applyInRotation({
      deadlineMs: Number.MAX_SAFE_INTEGER,
      heldNow: ({ activityFloorMs }) => {
        asked.push(activityFloorMs);
        return Promise.resolve("held by the fixture");
      },
      lockHeld: () => true,
      memory: { kept: [], repos: [] },
      mergedOnly: false,
      pace: { waitUntilReady: () => Promise.resolve(null) },
      plans: floored,
      remember: () => undefined,
    });
    expect(asked).toEqual([7_200_000, null]);
  });

  it("still owes a tree a live register held, though the rotation walked past it", async () => {
    const pass = await run({ held: "a live session holds it", stop: null });
    expect({ owedAfter: pass.owedAfter, remaining: pass.remaining.length }).toEqual({ owedAfter: 2, remaining: 0 });
  });
});
