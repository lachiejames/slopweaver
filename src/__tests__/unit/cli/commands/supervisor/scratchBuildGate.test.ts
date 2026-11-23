import { describe, expect, it } from "vitest";

import type { BuiltState } from "../../../../../builtCli/builtState.js";
import type { RebuildWaitOutcome } from "../../../../../builtCli/consoleRebuildWait.js";
import { scratchBuildGate } from "../../../../../cli/commands/supervisor/scratchBuildGate.js";

const FRESH: BuiltState = { kind: "fresh", manifestText: "manifest-1" };
const STALE: BuiltState = { kind: "stale", manifestText: "manifest-1" };
const REBUILT: BuiltState = { kind: "fresh", manifestText: "manifest-2" };

/**
 * A built tree the test moves by hand, and a wait that either lands `landsAs` or runs out.
 *
 * @param start where the tree stands before any wait
 * @param landsAs the state a wait leaves the tree in when it lands; a wait that runs out leaves it where it was
 * @returns the gate's deps, the tree to move, and the manifest text every wait was judged against
 */
function world({ start, landsAs }: { start: BuiltState; landsAs: BuiltState | undefined }): {
  deps: {
    readBuild: () => BuiltState;
    waitForBuild: (args: { judgedText: string }) => Promise<RebuildWaitOutcome>;
  };
  move: (args: { to: BuiltState }) => void;
  judged: string[];
} {
  let state = start;
  const judged: string[] = [];
  return {
    deps: {
      readBuild: () => state,
      waitForBuild: ({ judgedText }) => {
        judged.push(judgedText);
        if (landsAs === undefined) {
          return Promise.resolve({ kind: "timed-out", waitedMs: 30_000 });
        }
        state = landsAs;
        return Promise.resolve({ kind: "fresh", waitedMs: 4_000 });
      },
    },
    judged,
    move: ({ to }) => {
      state = to;
    },
  };
}

describe("scratchBuildGate", () => {
  it("passes a fresh build straight through, waiting nothing", async () => {
    const w = world({ landsAs: undefined, start: FRESH });
    const gate = scratchBuildGate({ bin: "/c/bin/slopweaver", deps: w.deps });

    const settled = await gate.settle({ reading: "board" });

    expect(settled).toEqual({ state: FRESH, waitedMs: 0 });
    expect(w.judged).toEqual([]);
    expect(gate.gaveUpAt()).toBeUndefined();
  });

  it("waits out a stale build, judged against the stale manifest, and reports the fresh one", async () => {
    const w = world({ landsAs: REBUILT, start: STALE });
    const gate = scratchBuildGate({ bin: "/c/bin/slopweaver", deps: w.deps });

    const settled = await gate.settle({ reading: "board" });

    expect(settled).toEqual({ state: REBUILT, waitedMs: 4_000 });
    expect(w.judged).toEqual(["manifest-1"]);
    expect(gate.gaveUpAt()).toBeUndefined();
  });

  it("gives up once: a wait that runs out names its reading, and no later settle waits again", async () => {
    const w = world({ landsAs: undefined, start: STALE });
    const gate = scratchBuildGate({ bin: "/c/bin/slopweaver", deps: w.deps });

    const first = await gate.settle({ reading: "board" });
    const second = await gate.settle({ reading: "velocity" });

    expect(first).toEqual({ state: STALE, waitedMs: 30_000 });
    expect(second).toEqual({ state: STALE, waitedMs: 0 });
    expect(w.judged).toEqual(["manifest-1"]);
    expect(gate.gaveUpAt()).toBe("board");
  });

  it("retakes a failed reading a rebuild crossed, once the fresh build lands", async () => {
    const w = world({ landsAs: REBUILT, start: FRESH });
    const gate = scratchBuildGate({ bin: "/c/bin/slopweaver", deps: w.deps });
    w.move({ to: STALE });

    const retake = await gate.retake({ before: FRESH, failed: true, reading: "board" });

    expect(retake).toEqual({ again: true, waitedMs: 4_000 });
  });

  it("retakes a failed reading when a rebuild already landed under it, waiting nothing", async () => {
    const w = world({ landsAs: undefined, start: FRESH });
    const gate = scratchBuildGate({ bin: "/c/bin/slopweaver", deps: w.deps });
    w.move({ to: REBUILT });

    const retake = await gate.retake({ before: FRESH, failed: true, reading: "board" });

    expect(retake).toEqual({ again: true, waitedMs: 0 });
    expect(w.judged).toEqual([]);
  });

  it("never retakes a failure no rebuild crossed — the verb's own failure stands", async () => {
    const w = world({ landsAs: REBUILT, start: FRESH });
    const gate = scratchBuildGate({ bin: "/c/bin/slopweaver", deps: w.deps });

    const retake = await gate.retake({ before: FRESH, failed: true, reading: "board" });

    expect(retake).toEqual({ again: false, waitedMs: 0 });
  });

  it("never retakes a reading that did not fail, even across a rebuild", async () => {
    const w = world({ landsAs: REBUILT, start: FRESH });
    const gate = scratchBuildGate({ bin: "/c/bin/slopweaver", deps: w.deps });
    w.move({ to: STALE });

    const retake = await gate.retake({ before: FRESH, failed: false, reading: "board" });

    expect(retake).toEqual({ again: false, waitedMs: 0 });
    expect(w.judged).toEqual([]);
  });

  it("does not retake when the rebuild's wait runs out, and records the give-up", async () => {
    const w = world({ landsAs: undefined, start: FRESH });
    const gate = scratchBuildGate({ bin: "/c/bin/slopweaver", deps: w.deps });
    w.move({ to: STALE });

    const retake = await gate.retake({ before: FRESH, failed: true, reading: "board" });

    expect(retake).toEqual({ again: false, waitedMs: 30_000 });
    expect(gate.gaveUpAt()).toBe("board");
  });
});
