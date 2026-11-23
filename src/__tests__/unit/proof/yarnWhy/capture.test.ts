/**
 * {@link captureYarnWhyPane}'s ORDERING — write the tape, run VHS from the worktree, pick the settled frame.
 *
 * A hand-written recording fake, never `vi.fn`/`vi.mock`: it records every call and lets a test script a
 * VHS failure or a recording that produced no frames, so the ordering is asserted with no `vhs` process
 * ever starting. Mirrors `cmux/spawn/fakeClient.ts`'s fake for the identical reason — a shell called directly
 * from an orchestrator hid ordering defects elsewhere in this repo until the shell became a real seam.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { captureYarnWhyPane } from "../../../../proof/yarnWhy/capture.js";
import { yarnWhyErrorLines } from "../../../../proof/yarnWhy/errors.js";
import type { VhsExec } from "../../../../proof/yarnWhy/vhsExec.js";

/** A fake exec that records its calls, and can be scripted to fail the run or to record no frames. */
function fakeExec({
  runThrows = null,
  frames = ["frame-cursor-00007.png", "frame-text-00006.png", "frame-text-00007.png"],
}: {
  runThrows?: string | null;
  frames?: readonly string[];
} = {}): { calls: string[]; tapes: string[]; exec: VhsExec } {
  const calls: string[] = [];
  const tapes: string[] = [];
  const exec: VhsExec = {
    listFrames: ({ dir }) => {
      calls.push(`listFrames:${dir}`);
      return frames;
    },
    runTape: ({ tapePath, cwd }) => {
      calls.push(`runTape:${tapePath}:${cwd}`);
      if (runThrows !== null) {
        throw new Error(runThrows);
      }
    },
    writeTape: ({ path, source }) => {
      calls.push(`writeTape:${path}`);
      tapes.push(source);
    },
  };
  return { calls, exec, tapes };
}

const REQUEST = {
  dependency: "left-pad",
  framesDir: "/tmp/wd/before-frames",
  tapePath: "/tmp/wd/before.tape",
  worktree: "/repo/wt",
} as const;

describe("captureYarnWhyPane", () => {
  it("writes the tape, runs VHS from the worktree, then reads the frames — in that order", () => {
    const { calls, exec } = fakeExec();

    const result = captureYarnWhyPane({ ...REQUEST, exec });

    expect(unwrap(result)).toBe("/tmp/wd/before-frames/frame-text-00007.png");
    expect(calls).toEqual([
      "writeTape:/tmp/wd/before.tape",
      "runTape:/tmp/wd/before.tape:/repo/wt",
      "listFrames:/tmp/wd/before-frames",
    ]);
  });

  it("writes a tape that records into the requested frames directory", () => {
    const { exec, tapes } = fakeExec();

    captureYarnWhyPane({ ...REQUEST, exec });

    expect(tapes[0]).toContain(`Output "/tmp/wd/before-frames/"`);
  });

  it("reports VHS's own message when the run fails, and never reads a frame", () => {
    const { calls, exec } = fakeExec({ runThrows: `timeout waiting for "Line" to match >$` });

    const result = captureYarnWhyPane({ ...REQUEST, exec });

    expect(unwrapErr(result).code).toBe("CAPTURE_FAILED");
    expect(yarnWhyErrorLines({ error: unwrapErr(result) })).toEqual([
      `vhs failed capturing "yarn why left-pad" in /repo/wt: timeout waiting for "Line" to match >$`,
    ]);
    expect(calls.some((call) => call.startsWith("listFrames"))).toBe(false);
  });

  it("fails when VHS exits clean but recorded no terminal frames", () => {
    const { exec } = fakeExec({ frames: [] });

    const result = captureYarnWhyPane({ ...REQUEST, exec });

    expect(unwrapErr(result).code).toBe("NO_FRAMES");
    expect(yarnWhyErrorLines({ error: unwrapErr(result) })).toEqual([
      `vhs recorded no frames for "yarn why left-pad" in /repo/wt`,
    ]);
  });

  it("refuses before writing anything when the dependency is not a package name", () => {
    const { calls, exec } = fakeExec();

    const result = captureYarnWhyPane({ ...REQUEST, dependency: "left-pad; id", exec });

    expect(unwrapErr(result).code).toBe("INPUT_REFUSED");
    expect(yarnWhyErrorLines({ error: unwrapErr(result) })).toEqual([
      "not a package name, so it will not be typed: left-pad; id",
    ]);
    expect(calls).toEqual([]);
  });
});
