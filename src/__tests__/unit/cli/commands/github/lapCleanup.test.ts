/**
 * The lap's cleanup registry and its stop-signal trap, over plain fakes: the drain disposes newest first and once,
 * a failure is named and does not stop the rest, and the first signal drains before it exits `128 + n` while a
 * second exits at once. A step's exit reading is pinned beside them.
 */
import { describe, expect, it } from "vitest";

import { createLapCleanupRegistry } from "../../../../../cli/commands/github/lapCleanup.js";
import {
  installLapSignalCleanup,
  type LapSignalProcess,
  type LapStopSignal,
  lapSignalExitCode,
} from "../../../../../cli/commands/github/lapSignals.js";
import { lapStepExit } from "../../../../../cli/commands/github/lapStepProcess.js";

/** A fake process edge recording what the trap did. */
function fakeProcess(): {
  edge: LapSignalProcess;
  fire: (input: { signal: LapStopSignal }) => void;
  exits: number[];
  lines: string[];
} {
  const handlers = new Map<LapStopSignal, () => void>();
  const exits: number[] = [];
  const lines: string[] = [];
  return {
    edge: {
      exit: ({ code }) => {
        exits.push(code);
      },
      on: ({ signal, handler }) => {
        handlers.set(signal, handler);
      },
      warn: ({ line }) => {
        lines.push(line);
      },
    },
    exits,
    fire: ({ signal }) => {
      handlers.get(signal)!();
    },
    lines,
  };
}

describe("createLapCleanupRegistry", () => {
  it("drains newest first, so a lane's group goes before the tree it writes in", async () => {
    const cleanup = createLapCleanupRegistry();
    const order: string[] = [];
    for (const label of ["lock", "tree", "group"]) {
      cleanup.register({
        dispose: () => {
          order.push(label);
          return Promise.resolve();
        },
        label,
      });
    }
    expect(await cleanup.drain()).toEqual([]);
    expect(order).toEqual(["group", "tree", "lock"]);
    expect(cleanup.stopping()).toBe(true);
  });

  it("runs a cleanup once whether its owner's finally or the drain reaches it first", async () => {
    const cleanup = createLapCleanupRegistry();
    let runs = 0;
    const handle = cleanup.register({
      dispose: () => {
        runs += 1;
        return Promise.resolve();
      },
      label: "tree",
    });
    await handle.dispose();
    await cleanup.drain();
    await handle.dispose();
    expect(runs).toBe(1);
  });

  it("names a cleanup that threw and still disposes the rest", async () => {
    const cleanup = createLapCleanupRegistry();
    const order: string[] = [];
    cleanup.register({
      dispose: () => {
        order.push("lock");
        return Promise.resolve();
      },
      label: "lock",
    });
    cleanup.register({ dispose: () => Promise.reject(new Error("worktree remove failed")), label: "the lap tree /t" });
    expect(await cleanup.drain()).toEqual(["the lap tree /t: worktree remove failed"]);
    expect(order).toEqual(["lock"]);
  });

  it("disposes at once a resource registered after the drain began", async () => {
    const cleanup = createLapCleanupRegistry();
    await cleanup.drain();
    let runs = 0;
    cleanup.register({
      dispose: () => {
        runs += 1;
        return Promise.resolve();
      },
      label: "late tree",
    });
    expect(runs).toBe(1);
  });
});

describe("installLapSignalCleanup", () => {
  it("drains on the first SIGTERM, then exits 143 once", async () => {
    const cleanup = createLapCleanupRegistry();
    const disposed: string[] = [];
    cleanup.register({
      dispose: () => {
        disposed.push("tree");
        return Promise.resolve();
      },
      label: "tree",
    });
    const proc = fakeProcess();
    const trap = installLapSignalCleanup({ cleanup, signalProcess: proc.edge });
    expect(trap.drained()).toBeNull();

    proc.fire({ signal: "SIGTERM" });
    await trap.drained();

    expect(disposed).toEqual(["tree"]);
    expect(proc.exits).toEqual([143]);
    expect(proc.lines).toEqual([
      "github lap: SIGTERM received — starting no further lane and removing what this lap brought up",
    ]);
  });

  it("exits at once on a second signal while the first drain still runs, and never exits twice", async () => {
    const cleanup = createLapCleanupRegistry();
    let release: () => void = () => undefined;
    cleanup.register({
      dispose: () =>
        new Promise<void>((done) => {
          release = done;
        }),
      label: "group",
    });
    const proc = fakeProcess();
    const trap = installLapSignalCleanup({ cleanup, signalProcess: proc.edge });

    proc.fire({ signal: "SIGINT" });
    proc.fire({ signal: "SIGHUP" });
    expect(proc.exits).toEqual([129]);

    release();
    await trap.drained();
    expect(proc.exits).toEqual([129]);
    expect(proc.lines[1]).toBe(
      "github lap: SIGHUP arrived while the lap was still tearing down after an earlier signal — exiting 129 now",
    );
  });

  it("prints each failed teardown before it exits", async () => {
    const cleanup = createLapCleanupRegistry();
    cleanup.register({ dispose: () => Promise.reject(new Error("busy")), label: "the lap's proof store" });
    const proc = fakeProcess();
    const trap = installLapSignalCleanup({ cleanup, signalProcess: proc.edge });

    proc.fire({ signal: "SIGTERM" });
    await trap.drained();

    expect(proc.lines[1]).toBe("github lap: teardown failed — the lap's proof store: busy");
    expect(proc.exits).toEqual([143]);
  });
});

describe("lapSignalExitCode and lapStepExit", () => {
  it("answer the shell's 128 + n, and a signalled lane as red", () => {
    expect(lapSignalExitCode({ signal: "SIGHUP" })).toBe(129);
    expect(lapSignalExitCode({ signal: "SIGINT" })).toBe(130);
    expect(lapSignalExitCode({ signal: "SIGTERM" })).toBe(143);
    expect(lapStepExit({ code: null, timedOut: false })).toBe(128);
    expect(lapStepExit({ code: 0, timedOut: false })).toBe(0);
    expect(lapStepExit({ code: 3, timedOut: false })).toBe(3);
  });
});
