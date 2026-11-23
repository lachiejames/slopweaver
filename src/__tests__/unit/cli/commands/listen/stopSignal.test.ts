import { describe, expect, it } from "vitest";

import {
  guardStopSignals,
  LISTEN_STOP_SIGNALS,
  listenStopExitCode,
  type StopSignalProcess,
} from "../../../../../cli/commands/listen/stopSignal.js";

/** A plain fake process — a recording object, not a mock: `.claude/rules/testing.md` bans the latter. */
function fakeProcess(): {
  readonly target: StopSignalProcess;
  readonly fire: (args: { event: string }) => void;
  readonly registered: () => readonly string[];
  readonly exits: () => readonly number[];
} {
  const handlers = new Map<string, () => void>();
  const exits: number[] = [];
  return {
    exits: () => exits,
    fire: ({ event }) => {
      handlers.get(event)!();
    },
    registered: () => [...handlers.keys()],
    target: {
      exit: ({ code }) => {
        exits.push(code);
      },
      off: ({ event }) => {
        handlers.delete(event);
      },
      on: ({ event, handler }) => {
        handlers.set(event, handler);
      },
    },
  };
}

/** A schedule seam that records what was asked for and fires only when a test says so. */
function fakeSchedule(): {
  readonly schedule: (args: { ms: number; tick: () => void }) => () => void;
  readonly delays: () => readonly number[];
  readonly fire: () => void;
  readonly cancelled: () => number;
} {
  const delays: number[] = [];
  const ticks: (() => void)[] = [];
  let cancelled = 0;
  return {
    cancelled: () => cancelled,
    delays: () => delays,
    fire: () => {
      ticks[ticks.length - 1]!();
    },
    schedule: ({ ms, tick }) => {
      delays.push(ms);
      ticks.push(tick);
      return () => {
        cancelled += 1;
      };
    },
  };
}

describe("listenStopExitCode", () => {
  it("answers the shell's own 128 + signal convention", () => {
    expect(listenStopExitCode({ signal: "SIGINT" })).toBe(130);
    expect(listenStopExitCode({ signal: "SIGTERM" })).toBe(143);
  });

  it("answers undefined for a signal this listener does not trap", () => {
    expect(listenStopExitCode({ signal: "SIGHUP" })).toBe(undefined);
  });

  it("traps exactly the two endings an operator sends", () => {
    expect(LISTEN_STOP_SIGNALS.map((ending) => ending.signal)).toEqual(["SIGINT", "SIGTERM"]);
  });
});

describe("guardStopSignals", () => {
  const lines: string[] = [];
  const log = ({ line }: { line: string }): void => {
    lines.splice(lines.length, 0, line);
  };

  it("registers both endings and starts with nothing fired", () => {
    const proc = fakeProcess();
    const guard = guardStopSignals({
      forceExitAfterMs: 30_000,
      log,
      schedule: fakeSchedule().schedule,
      target: proc.target,
    });

    expect(proc.registered()).toEqual(["SIGINT", "SIGTERM"]);
    expect(guard.firedCode()).toBe(undefined);
    expect(guard.signal.aborted).toBe(false);
  });

  it("ABORTS on the first signal instead of exiting, so the socket's own close gets to run", () => {
    const proc = fakeProcess();
    const guard = guardStopSignals({
      forceExitAfterMs: 30_000,
      log,
      schedule: fakeSchedule().schedule,
      target: proc.target,
    });

    proc.fire({ event: "SIGTERM" });

    expect(guard.signal.aborted).toBe(true);
    expect(guard.firedCode()).toBe(143);
    expect(proc.exits()).toEqual([]);
  });

  it("exits IMMEDIATELY on a second signal, so Ctrl-C twice is never a no-op", () => {
    const proc = fakeProcess();
    guardStopSignals({ forceExitAfterMs: 30_000, log, schedule: fakeSchedule().schedule, target: proc.target });

    proc.fire({ event: "SIGINT" });
    proc.fire({ event: "SIGINT" });

    expect(proc.exits()).toEqual([130]);
  });

  it("keeps the FIRST signal's code when a different second one arrives", () => {
    const proc = fakeProcess();
    const guard = guardStopSignals({
      forceExitAfterMs: 30_000,
      log,
      schedule: fakeSchedule().schedule,
      target: proc.target,
    });

    proc.fire({ event: "SIGINT" });
    proc.fire({ event: "SIGTERM" });

    expect(guard.firedCode()).toBe(130);
    expect(proc.exits()).toEqual([143]);
  });

  it("exits on the ceiling when the close never finishes", () => {
    const proc = fakeProcess();
    const timer = fakeSchedule();
    guardStopSignals({ forceExitAfterMs: 30_000, log, schedule: timer.schedule, target: proc.target });

    proc.fire({ event: "SIGTERM" });
    expect(timer.delays()).toEqual([30_000]);
    timer.fire();

    expect(proc.exits()).toEqual([143]);
  });

  it("schedules NO ceiling before a signal ever arrives", () => {
    const proc = fakeProcess();
    const timer = fakeSchedule();
    guardStopSignals({ forceExitAfterMs: 30_000, log, schedule: timer.schedule, target: proc.target });

    expect(timer.delays()).toEqual([]);
  });

  it("releases every handler and cancels the ceiling, so a clean exit is not held open by this guard", () => {
    const proc = fakeProcess();
    const timer = fakeSchedule();
    const guard = guardStopSignals({ forceExitAfterMs: 30_000, log, schedule: timer.schedule, target: proc.target });

    proc.fire({ event: "SIGTERM" });
    guard.release();

    expect(proc.registered()).toEqual([]);
    expect(timer.cancelled()).toBe(1);
  });

  it("narrates the signal and what it is doing about the socket", () => {
    const proc = fakeProcess();
    const said: string[] = [];
    guardStopSignals({
      forceExitAfterMs: 30_000,
      log: ({ line }) => said.push(line),
      schedule: fakeSchedule().schedule,
      target: proc.target,
    });

    proc.fire({ event: "SIGTERM" });

    expect(said.length).toBe(1);
    expect(said[0]).toContain("SIGTERM — closing the Socket Mode connection");
    expect(said[0]).toContain("per-app cap");
  });
});
