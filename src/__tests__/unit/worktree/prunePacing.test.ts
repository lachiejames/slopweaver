import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { FseventsdCpu } from "../../../worktree/fseventsdGauge.js";
import {
  deleteGently,
  fseventsdHolding,
  holdForDrain,
  loadStop,
  lowPriorityArgv,
  pacingStop,
  removalDeadlineStop,
  removalGateDecision,
} from "../../../worktree/prunePacing.js";

const dirs: string[] = [];

/** fseventsd read at `cpu`, under the pid a storm ran under. */
const fseventsdAt = ({ cpu }: { cpu: number }): FseventsdCpu => ({ cpu, kind: "read", pids: [97860] });

const QUIET: FseventsdCpu = fseventsdAt({ cpu: 0.1 });

/** A gauge that would hold every chunk, so a delete that reads it at all never finishes inside its timeout. */
const STORMING = (): FseventsdCpu => fseventsdAt({ cpu: 113 });

/**
 * The OS every real delete here runs as: one whose `rm` is not wrapped in darwin's `taskpolicy -b`, whose
 * background QoS starves behind a saturated unit shard. `lowPriorityArgv`'s own cases pin both wrappers.
 */
const PLAIN_RM_OS: NodeJS.Platform = "linux";

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("lowPriorityArgv", () => {
  it("runs the command at background QoS on darwin", () => {
    expect(lowPriorityArgv({ argv: ["rm", "-rf", "/t"], platform: "darwin" })).toEqual([
      "taskpolicy",
      "-b",
      "rm",
      "-rf",
      "/t",
    ]);
  });

  it("leaves the command as it is where no priority tool exists", () => {
    expect(lowPriorityArgv({ argv: ["rm", "-rf", "/t"], platform: "linux" })).toEqual(["rm", "-rf", "/t"]);
  });
});

describe("pacingStop", () => {
  const routine = { cap: 4, diskPressure: false, hold: 22 };
  const pressure = { cap: 4, diskPressure: true, hold: 22 };
  const unreadable: FseventsdCpu = { kind: "unreadable", why: "no process runs at fseventsd's binary path" };

  it("carries on under the hold, under the cap and with fseventsd quiet", () => {
    expect(pacingStop({ ...routine, done: 3, fseventsd: QUIET, load1: 21.9 })).toBe(null);
  });

  it("stops at the hold itself, naming the load and the hold", () => {
    expect(pacingStop({ ...routine, done: 0, fseventsd: QUIET, load1: 22 })).toBe(
      "the 1-minute load is 22.0, at or above the 22 hold — the rest wait for the next run",
    );
  });

  it("stops at the cap before it reads the load", () => {
    expect(pacingStop({ ...routine, done: 4, fseventsd: QUIET, load1: 119.8 })).toBe(
      "acted on 4 tree(s), this run's cap — the rest wait for the next run",
    );
  });

  it("stops on the storm reading, where load1 was under the hold and fseventsd was not", () => {
    expect(pacingStop({ ...routine, done: 1, fseventsd: fseventsdAt({ cpu: 47 }), load1: 11 })).toBe(
      "fseventsd (pid 97860) is at 47.0% CPU, at or above the 20% bar — the rest wait for the next run",
    );
  });

  it("names the load first when both are over", () => {
    expect(pacingStop({ ...routine, done: 1, fseventsd: fseventsdAt({ cpu: 113 }), load1: 119.8 })).toBe(
      "the 1-minute load is 119.8, at or above the 22 hold — the rest wait for the next run",
    );
  });

  it("stops on an fseventsd read it could not make", () => {
    expect(pacingStop({ ...routine, done: 0, fseventsd: unreadable, load1: 3 })).toBe(
      "fseventsd's CPU could not be read (no process runs at fseventsd's binary path) — the rest wait for the next run",
    );
  });

  it("carries on under disk pressure past the cap at a load of 60.3, fseventsd quiet", () => {
    expect(pacingStop({ ...pressure, done: 9, fseventsd: QUIET, load1: 60.3 })).toBe(null);
  });

  it("still stops under disk pressure on a hot fseventsd", () => {
    expect(pacingStop({ ...pressure, done: 9, fseventsd: fseventsdAt({ cpu: 20 }), load1: 60.3 })).toBe(
      "fseventsd (pid 97860) is at 20.0% CPU, at or above the 20% bar — the rest wait for the next run",
    );
  });

  it("still stops under disk pressure on an fseventsd read it could not make", () => {
    expect(pacingStop({ ...pressure, done: 0, fseventsd: unreadable, load1: 3 })).toBe(
      "fseventsd's CPU could not be read (no process runs at fseventsd's binary path) — the rest wait for the next run",
    );
  });
});

describe("fseventsdHolding — fseventsd's own hysteresis, tracked apart from the load", () => {
  /**
   * Walk two readings through the gate the way the pacer does, carrying only fseventsd's own state.
   *
   * @param first the first reading's load and fseventsd CPU
   * @param second the second reading's load and fseventsd CPU
   * @returns what the gate answers for the second reading
   */
  const twoReadings = ({
    first,
    second,
  }: {
    first: { load1: number; cpu: number };
    second: { load1: number; cpu: number };
  }): ReturnType<typeof removalGateDecision> => {
    const holding = fseventsdHolding({ fseventsd: fseventsdAt({ cpu: first.cpu }), holding: false });
    return removalGateDecision({ fseventsd: fseventsdAt({ cpu: second.cpu }), hold: 45, holding, load1: second.load1 });
  };

  it("a load spike over a 15% daemon does not start the hysteresis, so load 3 then proceeds", () => {
    expect(twoReadings({ first: { cpu: 15, load1: 45 }, second: { cpu: 15, load1: 3 } })).toEqual({ kind: "proceed" });
  });

  it("a load spike over a 25% daemon does not hide it, so 15% next still holds", () => {
    expect(twoReadings({ first: { cpu: 25, load1: 45 }, second: { cpu: 15, load1: 3 } })).toEqual({
      kind: "hold",
      reason: "fseventsd (pid 97860) is at 15.0% CPU",
    });
  });

  it("releases once the daemon falls under the lower bar", () => {
    expect(fseventsdHolding({ fseventsd: fseventsdAt({ cpu: 9.9 }), holding: true })).toBe(false);
  });

  it("carries the state across an unreadable reading, which says nothing about the daemon", () => {
    const unreadable: FseventsdCpu = { kind: "unreadable", why: "ps timed out" };
    expect([
      fseventsdHolding({ fseventsd: unreadable, holding: true }),
      fseventsdHolding({ fseventsd: unreadable, holding: false }),
    ]).toEqual([true, false]);
  });
});

describe("removalGateDecision", () => {
  const gate = { hold: 45, holding: false };

  it("proceeds on a quiet machine, whatever it already removed — only its deadline bounds it", () => {
    expect(removalGateDecision({ ...gate, fseventsd: QUIET, load1: 3 })).toEqual({ kind: "proceed" });
  });

  it("holds — never stops — at the load hold itself, naming the load and the hold", () => {
    expect(removalGateDecision({ ...gate, fseventsd: QUIET, load1: 45 })).toEqual({
      kind: "hold",
      reason: "the 1-minute load is 45.0, at or above the 45 hold",
    });
  });

  it("holds on the reading that ended a run with nothing removed", () => {
    expect(removalGateDecision({ ...gate, fseventsd: fseventsdAt({ cpu: 35.9 }), load1: 17 })).toEqual({
      kind: "hold",
      reason: "fseventsd (pid 97860) is at 35.9% CPU",
    });
  });

  it("holds from the upper bar itself", () => {
    expect(removalGateDecision({ ...gate, fseventsd: fseventsdAt({ cpu: 20 }), load1: 17 })).toEqual({
      kind: "hold",
      reason: "fseventsd (pid 97860) is at 20.0% CPU",
    });
  });

  it("proceeds just under the upper bar when not already holding", () => {
    expect(removalGateDecision({ ...gate, fseventsd: fseventsdAt({ cpu: 19.9 }), load1: 17 })).toEqual({
      kind: "proceed",
    });
  });

  it("keeps holding between the two bars once held, so one quieter read does not release it", () => {
    expect(removalGateDecision({ ...gate, fseventsd: fseventsdAt({ cpu: 15 }), holding: true, load1: 17 })).toEqual({
      kind: "hold",
      reason: "fseventsd (pid 97860) is at 15.0% CPU",
    });
  });

  it("releases under the lower bar", () => {
    expect(removalGateDecision({ ...gate, fseventsd: fseventsdAt({ cpu: 9.9 }), holding: true, load1: 17 })).toEqual({
      kind: "proceed",
    });
  });

  it("holds on an fseventsd read it could not make — 8 of the 21 measured stops were exactly this", () => {
    expect(removalGateDecision({ ...gate, fseventsd: { kind: "unreadable", why: "ps timed out" }, load1: 3 })).toEqual({
      kind: "hold",
      reason: "fseventsd's CPU could not be read (ps timed out)",
    });
  });

  it("proceeds when fseventsd is not running at all", () => {
    expect(removalGateDecision({ ...gate, fseventsd: { kind: "not-running" }, load1: 3 })).toEqual({
      kind: "proceed",
    });
  });

  it("names the load first when both are over", () => {
    expect(removalGateDecision({ ...gate, fseventsd: fseventsdAt({ cpu: 113 }), load1: 119.8 })).toEqual({
      kind: "hold",
      reason: "the 1-minute load is 119.8, at or above the 45 hold",
    });
  });
});

describe("removalDeadlineStop", () => {
  it("names what it was backing off from when the deadline passed", () => {
    expect(removalDeadlineStop({ reason: "fseventsd (pid 97860) is at 35.9% CPU" })).toBe(
      "the removal deadline passed while backing off (fseventsd (pid 97860) is at 35.9% CPU) — the rest wait for the next run",
    );
  });
});

describe("loadStop", () => {
  it("names the storm reading as a stop", () => {
    expect(loadStop({ diskPressure: false, hold: 22, load1: 119.8 })).toBe(
      "the 1-minute load is 119.8, at or above the 22 hold — the rest wait for the next run",
    );
  });

  it("lets the same reading through under disk pressure", () => {
    expect(loadStop({ diskPressure: true, hold: 22, load1: 119.8 })).toBe(null);
  });
});

describe("holdForDrain", () => {
  it("keeps holding between the two bars, so a pause waits for a real drain", () => {
    expect(holdForDrain({ fseventsd: fseventsdAt({ cpu: 15 }), heldMs: 165_000, maxMs: 180_000 })).toBe(true);
  });

  it("lets go once fseventsd falls under the lower bar", () => {
    expect(holdForDrain({ fseventsd: fseventsdAt({ cpu: 9.9 }), heldMs: 0, maxMs: 180_000 })).toBe(false);
  });

  it("lets go at the hold's limit, so the gate decides instead", () => {
    expect(holdForDrain({ fseventsd: fseventsdAt({ cpu: 47 }), heldMs: 180_000, maxMs: 180_000 })).toBe(false);
  });

  it("does not hold on a read it could not make, which the gate then stops on", () => {
    expect(holdForDrain({ fseventsd: { kind: "unreadable", why: "x" }, heldMs: 0, maxMs: 180_000 })).toBe(false);
  });
});

describe("deleteGently", () => {
  it("deletes a nested directory tree and says it is gone", () => {
    const root = mkdtempSync(join(tmpdir(), "sw-gentle-"));
    dirs.push(root);
    const target = join(root, "node_modules");
    mkdirSync(join(target, "pkg", "lib"), { recursive: true });
    writeFileSync(join(target, "pkg", "lib", "index.js"), "module.exports = 1;\n");

    expect(deleteGently({ dir: target, gauge: () => QUIET, os: PLAIN_RM_OS, timeoutMs: 60_000 })).toBe(true);
    expect(existsSync(target)).toBe(false);
  });

  it("deletes a tree holding a read-only directory, which a bare rm -rf leaves behind", () => {
    const root = mkdtempSync(join(tmpdir(), "sw-gentle-"));
    dirs.push(root);
    const target = join(root, "batch");
    mkdirSync(join(target, "locked"), { recursive: true });
    writeFileSync(join(target, "locked", "f.js"), "x\n");
    chmodSync(join(target, "locked"), 0o555);

    expect(deleteGently({ dir: target, gauge: () => QUIET, os: PLAIN_RM_OS, timeoutMs: 60_000 })).toBe(true);
    expect(existsSync(target)).toBe(false);
  });

  it("holds even a small tree while fseventsd storms, until its timeout", () => {
    const root = mkdtempSync(join(tmpdir(), "sw-gentle-"));
    dirs.push(root);
    const target = join(root, "node_modules");
    mkdirSync(join(target, "pkg"), { recursive: true });
    writeFileSync(join(target, "pkg", "index.js"), "x\n");

    expect(deleteGently({ dir: target, gauge: STORMING, os: PLAIN_RM_OS, timeoutMs: 50 })).toBe(false);
    expect(existsSync(join(target, "pkg", "index.js"))).toBe(true);
  });

  it("leaves a tree big enough to storm in place while fseventsd storms, until its timeout", () => {
    const root = mkdtempSync(join(tmpdir(), "sw-gentle-"));
    dirs.push(root);
    const target = join(root, "node_modules");
    for (let index = 0; index < 70; index += 1) {
      mkdirSync(join(target, `pkg-${String(index)}`), { recursive: true });
    }

    expect(deleteGently({ dir: target, gauge: STORMING, os: PLAIN_RM_OS, timeoutMs: 50 })).toBe(false);
    expect(existsSync(join(target, "pkg-0"))).toBe(true);
  });

  it("governs the read-only retry too, so a big leftover is never removed past the gauge", () => {
    const root = mkdtempSync(join(tmpdir(), "sw-gentle-"));
    dirs.push(root);
    const target = join(root, "node_modules");
    for (let index = 0; index < 70; index += 1) {
      const pkg = join(target, `pkg-${String(index)}`);
      mkdirSync(pkg, { recursive: true });
      writeFileSync(join(pkg, "f.js"), "x\n");
      chmodSync(pkg, 0o555);
    }
    // Quiet while the packages are still read-only; unreadable once the retry's chmod has made them writable.
    const probe = join(target, "pkg-0");
    const gauge = (): FseventsdCpu =>
      (statSync(probe).mode & 0o200) === 0 ? QUIET : { kind: "unreadable", why: "the retry read it" };

    expect(deleteGently({ dir: target, gauge, os: PLAIN_RM_OS, timeoutMs: 60_000 })).toBe(false);
    expect(existsSync(join(probe, "f.js"))).toBe(true);
  });
});
