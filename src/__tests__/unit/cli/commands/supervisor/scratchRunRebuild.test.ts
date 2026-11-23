/**
 * `supervisor tick-capture` across a rebuild of the built CLI — the measured shape where
 * a landing's fast-forward of the main checkout moved the source mid-capture and 39 of 50 readings refused with
 * `[stale-build]`. The fake world (`./scratchFakes.ts`) turns the tree stale on one launch and refuses every child
 * launched while it stays stale; a wait either lands a fresh build or runs out.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runTickCapture } from "../../../../../cli/commands/supervisor/scratchRun.js";
import { EXIT_OK } from "../../../../../cli/exitCodes.js";
import { captureSummaryLines, type TickCapture } from "../../../../../supervisor/scratch/tickCapture.js";
import { fakeDeps } from "./scratchFakes.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "scratch-rebuild-"));
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

/** Run one capture and read its `capture.json` back. */
async function capture({ fake }: { fake: ReturnType<typeof fakeDeps> }): Promise<TickCapture> {
  const code = await runTickCapture({
    deps: fake.deps,
    rest: ["--dir", root, "--tick", "16", "--loop-session-key", "loop-a"],
  });
  expect(code).toBe(EXIT_OK);
  return JSON.parse(readFileSync(join(root, "tick-16", "capture.json"), "utf8")) as TickCapture;
}

describe("supervisor tick-capture across a rebuild", () => {
  it("waits out a rebuild that moved the source mid-capture, retakes the reading it broke, and loses none", async () => {
    const fake = fakeDeps({ rebuild: { lands: true, staleAtLaunch: 3, waitedMs: 9_000 } });
    const taken = await capture({ fake });
    const third = taken.readings[2]!;
    expect(taken.readings.filter((reading) => !reading.completed).map((reading) => reading.name)).toEqual([]);
    expect(fake.waits).toEqual([3]);
    expect(fake.launched.length).toBe(taken.readings.length + 1);
    expect(third.retriedAfterRebuild).toBe(true);
    expect(third.waitedForRebuildMs).toBe(9_000);
    expect(third.exitCode).toBe(0);
    expect(readFileSync(join(root, "tick-16", third.errFile), "utf8")).toBe("");
    expect(taken.readings.filter((reading) => reading.waitedForRebuildMs !== undefined).length).toBe(1);
    expect(taken.rebuildGaveUpAt).toBeUndefined();
    expect(captureSummaryLines({ capture: taken }).slice(1, 3)).toEqual([
      "  waited 9s for a rebuild of the built CLI to land",
      `  taken again on the fresh build: ${third.name}`,
    ]);
  });

  it("waits once for a rebuild that never lands, then lets every later reading refuse at once", async () => {
    const fake = fakeDeps({ rebuild: { lands: false, staleAtLaunch: 3, waitedMs: 0 } });
    const taken = await capture({ fake });
    const third = taken.readings[2]!;
    expect(fake.waits).toEqual([3]);
    expect(fake.launched.length).toBe(taken.readings.length);
    expect(taken.readings.slice(0, 2).map((reading) => reading.completed)).toEqual([true, true]);
    expect(taken.readings.slice(2).filter((reading) => reading.bytes > 0)).toEqual([]);
    expect(third.waitedForRebuildMs).toBe(30_000);
    expect(third.retriedAfterRebuild).toBeUndefined();
    expect(taken.rebuildGaveUpAt).toBe(third.name);
    expect(captureSummaryLines({ capture: taken })).toContain(
      `  no fresh build landed within the wait on ${third.name}'s turn; later readings did not wait — open the next tick once \`slopweaver dev build\` has run`,
    );
  });

  it("never waits or retakes over a build that stays fresh, so a verb's own failure is taken once", async () => {
    const fake = fakeDeps({ answers: { "velocity --json": { exit: 1, stdout: "" } } });
    const taken = await capture({ fake });
    const velocity = taken.readings.find((reading) => reading.name === "velocity")!;
    expect(fake.waits).toEqual([]);
    expect(fake.launched.filter((line) => line.endsWith("velocity --json")).length).toBe(1);
    expect(velocity.completed).toBe(false);
    expect(velocity.retriedAfterRebuild).toBeUndefined();
    expect(velocity.waitedForRebuildMs).toBeUndefined();
  });
});
