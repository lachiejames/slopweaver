/**
 * The console child's wait for a rebuild in flight: one fixed deadline, a manifest judged only when its text changes,
 * and a stale replacement waited past — driven by a fake clock and a scripted manifest, so no real time passes.
 */
import { describe, expect, it } from "vitest";

import {
  CONSOLE_REBUILD_POLL_MS,
  CONSOLE_REBUILD_WAIT_MS,
  type RebuildWaitSeams,
  rebuildPollStep,
  waitForFreshBuild,
} from "../../../builtCli/consoleRebuildWait.js";

/**
 * Seams over a fake clock: each pause advances it, and the manifest read returns the script's entry for that poll
 * (its last entry thereafter). The texts judged are recorded, so a test can see what was and was not judged.
 */
function scripted({ manifests, fresh }: { manifests: readonly (string | undefined)[]; fresh: ReadonlySet<string> }): {
  seams: RebuildWaitSeams;
  judged: string[];
  pauses: number[];
} {
  let now = 1_000;
  let poll = 0;
  const judged: string[] = [];
  const pauses: number[] = [];
  const seams: RebuildWaitSeams = {
    isFresh: ({ text }) => {
      judged.push(text);
      return fresh.has(text);
    },
    nowMs: () => now,
    pause: ({ ms }) => {
      pauses.push(ms);
      now += ms;
      return Promise.resolve();
    },
    readManifest: () => {
      const index = Math.min(poll, manifests.length - 1);
      poll += 1;
      return manifests[index];
    },
  };
  return { judged, pauses, seams };
}

describe("rebuildPollStep", () => {
  it("pauses one poll interval while the deadline is far", () => {
    expect(rebuildPollStep({ elapsedMs: 0 })).toEqual({ delayMs: CONSOLE_REBUILD_POLL_MS, kind: "poll" });
  });

  it("clamps the last pause to the time left, so the deadline never moves", () => {
    expect(rebuildPollStep({ elapsedMs: CONSOLE_REBUILD_WAIT_MS - 40 })).toEqual({ delayMs: 40, kind: "poll" });
  });

  it("stops at the deadline exactly, and past it", () => {
    expect(rebuildPollStep({ elapsedMs: CONSOLE_REBUILD_WAIT_MS })).toEqual({ kind: "timed-out" });
    expect(rebuildPollStep({ elapsedMs: CONSOLE_REBUILD_WAIT_MS + 1 })).toEqual({ kind: "timed-out" });
  });

  it("is a 30-second bound polled every 250 ms", () => {
    expect(CONSOLE_REBUILD_WAIT_MS).toBe(30_000);
    expect(CONSOLE_REBUILD_POLL_MS).toBe(250);
  });
});

describe("waitForFreshBuild", () => {
  it("reads through the emit's missing manifest, and restarts on the fresh one the build writes last", async () => {
    const { seams, judged } = scripted({ fresh: new Set(["new"]), manifests: ["stale", undefined, undefined, "new"] });

    const outcome = await waitForFreshBuild({ judgedText: "stale", seams });

    expect(outcome).toEqual({ kind: "fresh", waitedMs: 4 * CONSOLE_REBUILD_POLL_MS });
    expect(judged).toEqual(["new"]);
  });

  it("never judges the text the guard already judged, however many polls see it", async () => {
    const { seams, judged } = scripted({ fresh: new Set(["stale"]), manifests: ["stale"] });

    const outcome = await waitForFreshBuild({ judgedText: "stale", seams });

    expect(outcome).toEqual({ kind: "timed-out", waitedMs: CONSOLE_REBUILD_WAIT_MS });
    expect(judged).toEqual([]);
  });

  it("waits past a replacement that is itself stale, to the SAME deadline", async () => {
    const { seams, judged } = scripted({ fresh: new Set(["third"]), manifests: ["second", "second", "third"] });

    const outcome = await waitForFreshBuild({ judgedText: "first", seams });

    expect(outcome).toEqual({ kind: "fresh", waitedMs: 3 * CONSOLE_REBUILD_POLL_MS });
    expect(judged).toEqual(["second", "third"]);
  });

  it("times out at the bound when no manifest ever lands, every pause inside it", async () => {
    const { seams, pauses } = scripted({ fresh: new Set(), manifests: [undefined] });

    const outcome = await waitForFreshBuild({ judgedText: "stale", seams });

    expect(outcome).toEqual({ kind: "timed-out", waitedMs: CONSOLE_REBUILD_WAIT_MS });
    expect(pauses.reduce((sum, ms) => sum + ms, 0)).toBe(CONSOLE_REBUILD_WAIT_MS);
  });

  it("starts no read once a late timer has carried the clock past the deadline", async () => {
    let now = 0;
    let reads = 0;
    const seams: RebuildWaitSeams = {
      isFresh: () => true,
      nowMs: () => now,
      // A blocked event loop: the timer asked for one interval fires five seconds past the whole bound.
      pause: () => {
        now += CONSOLE_REBUILD_WAIT_MS + 5_000;
        return Promise.resolve();
      },
      readManifest: () => {
        reads += 1;
        return "fresh";
      },
    };

    const outcome = await waitForFreshBuild({ judgedText: "stale", seams });

    expect(outcome).toEqual({ kind: "timed-out", waitedMs: CONSOLE_REBUILD_WAIT_MS + 5_000 });
    expect(reads).toBe(0);
  });

  it("starts no judgement once a read that began inside the bound has carried the clock past it", async () => {
    let now = 0;
    let judgements = 0;
    const seams: RebuildWaitSeams = {
      isFresh: () => {
        judgements += 1;
        return true;
      },
      nowMs: () => now,
      pause: ({ ms }) => {
        now += ms;
        return Promise.resolve();
      },
      // The first read starts at one poll interval and ends a whole bound later.
      readManifest: () => {
        now += CONSOLE_REBUILD_WAIT_MS;
        return "fresh";
      },
    };

    const outcome = await waitForFreshBuild({ judgedText: "stale", seams });

    expect(outcome).toEqual({ kind: "timed-out", waitedMs: CONSOLE_REBUILD_POLL_MS + CONSOLE_REBUILD_WAIT_MS });
    expect(judgements).toBe(0);
  });
});
