import { describe, expect, it } from "vitest";

import {
  BASELINE_FRESH_MS,
  freshBaselineOf,
  type LiveMachineSnapshot,
  liveMachineReadingOf,
} from "../../lib/liveMachine";
import type { LiveProcessStat } from "../../lib/liveMachineParse";
import { argvSessionIdOf } from "../../lib/liveSessionArgv";

const S1 = "a0000006-0000-4000-8000-000000000007";
const S2 = "a0000008-0000-4000-8000-000000000009";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/** One process row. */
const proc = ({
  pid,
  ppid,
  cpuTimeMs,
  residentBytes,
  comm,
}: {
  pid: number;
  ppid: number;
  cpuTimeMs: number;
  residentBytes: number;
  comm: string;
}): LiveProcessStat => ({ comm, cpuTimeMs, pid, ppid, residentBytes });

/** The baseline: a session tree, Chrome, cmux. */
const BEFORE: LiveMachineSnapshot = {
  argvByPid: new Map([
    [100, "claude --resume"],
    [101, "/bin/zsh -c yarn test"],
    [200, "Google Chrome"],
    [300, "/Applications/cmux.app/Contents/MacOS/cmux"],
  ]),
  compressorSegmentsPct: 12,
  cpu: { cores: 10, idleMs: 60_000, totalMs: 100_000 },
  diagnostics: [],
  load1: 12.346,
  monotonicMs: 50_000,
  observedAtIso: "2026-11-09T10:00:00.000Z",
  processes: [
    proc({ comm: "/sbin/launchd", cpuTimeMs: 0, pid: 1, ppid: 0, residentBytes: 0 }),
    proc({ comm: "/usr/local/bin/claude", cpuTimeMs: 10_000, pid: 100, ppid: 1, residentBytes: 1000 }),
    proc({ comm: "/bin/zsh", cpuTimeMs: 0, pid: 101, ppid: 100, residentBytes: 500 }),
    proc({ comm: CHROME, cpuTimeMs: 0, pid: 200, ppid: 1, residentBytes: 3000 }),
    proc({ comm: "/Applications/cmux.app/Contents/MacOS/cmux", cpuTimeMs: 0, pid: 300, ppid: 1, residentBytes: 100 }),
  ],
  registry: [{ pid: 100, sessionId: S1 }],
  swapfileCount: 2,
  totalMemoryBytes: 20_000,
  usedMemoryBytes: 10_000,
};

/** Two seconds on: every pid moved, and a second session started under cmux. */
const NOW: LiveMachineSnapshot = {
  ...BEFORE,
  argvByPid: new Map([...BEFORE.argvByPid, [400, `/usr/local/bin/claude --session-id ${S2}`]]),
  cpu: { cores: 10, idleMs: 64_000, totalMs: 110_000 },
  monotonicMs: 52_000,
  observedAtIso: "2026-11-09T10:00:02.000Z",
  processes: [
    proc({ comm: "/sbin/launchd", cpuTimeMs: 0, pid: 1, ppid: 0, residentBytes: 0 }),
    proc({ comm: "/usr/local/bin/claude", cpuTimeMs: 12_000, pid: 100, ppid: 1, residentBytes: 1000 }),
    proc({ comm: "/bin/zsh", cpuTimeMs: 1000, pid: 101, ppid: 100, residentBytes: 500 }),
    proc({ comm: CHROME, cpuTimeMs: 4000, pid: 200, ppid: 1, residentBytes: 3000 }),
    proc({ comm: "/Applications/cmux.app/Contents/MacOS/cmux", cpuTimeMs: 200, pid: 300, ppid: 1, residentBytes: 100 }),
    proc({ comm: "/usr/local/bin/claude", cpuTimeMs: 900, pid: 400, ppid: 300, residentBytes: 250 }),
  ],
};

describe("liveMachineReadingOf", () => {
  it("splits the kernel's busy cores into fleet and everything else, and totals each session's tree", () => {
    const reading = liveMachineReadingOf({ current: NOW, previous: BEFORE })._unsafeUnwrap();
    expect(reading.cpu).toEqual({ busyCores: 6, fleetCores: 2.05, idlePct: 40, otherCores: 3.95 });
    expect(reading.load1).toBe(12.35);
    expect(reading.memory).toEqual({
      compressorSegmentsPct: 12,
      fleetBytes: 1850,
      swapfileCount: 2,
      totalBytes: 20_000,
      usedBytes: 10_000,
    });
    expect(reading.sessions).toEqual([
      { cpuCores: 1.5, memoryBytes: 1500, processCount: 2, sessionId: S1 },
      // A pid the baseline lacks started inside the interval, so its whole 900 ms of CPU time is the interval's.
      { cpuCores: 0.45, memoryBytes: 250, processCount: 1, sessionId: S2 },
    ]);
    expect(reading.topOtherCpu).toEqual({ cpuCores: 2, label: "Google Chrome", memoryBytes: 3000 });
    expect(reading.topOtherMemory).toEqual({ cpuCores: 2, label: "Google Chrome", memoryBytes: 3000 });
    expect(reading.observedAtIso).toBe("2026-11-09T10:00:02.000Z");
  });

  it("carries no CPU at all on the first read, which has nothing to measure an interval against", () => {
    const reading = liveMachineReadingOf({ current: NOW, previous: undefined })._unsafeUnwrap();
    expect(reading.cpu).toEqual({
      busyCores: undefined,
      fleetCores: undefined,
      idlePct: undefined,
      otherCores: undefined,
    });
    expect(reading.sessions.map((session) => session.cpuCores)).toEqual([undefined, undefined]);
    expect(reading.topOtherCpu).toBe(undefined);
    expect(reading.topOtherMemory).toEqual({ cpuCores: undefined, label: "Google Chrome", memoryBytes: 3000 });
  });

  it("refuses counters that did not move forward", () => {
    const error = liveMachineReadingOf({ current: BEFORE, previous: BEFORE })._unsafeUnwrapErr();
    expect(error.code).toBe("CPU_COUNTERS_INVALID");
  });

  it("refuses an interval past the ten-second bound, as a warming read whose timer fired after a sleep", () => {
    const late: LiveMachineSnapshot = { ...NOW, monotonicMs: BEFORE.monotonicMs + BASELINE_FRESH_MS + 1 };
    const error = liveMachineReadingOf({ current: late, previous: BEFORE })._unsafeUnwrapErr();
    expect(error.code).toBe("INTERVAL_TOO_LONG");
    expect(error.message).toBe("the two snapshots were 10s apart, past the ten-second bound, so CPU was not measured");
    const atBound = liveMachineReadingOf({
      current: { ...NOW, monotonicMs: BEFORE.monotonicMs + BASELINE_FRESH_MS },
      previous: BEFORE,
    })._unsafeUnwrap();
    expect(atBound.cpu.busyCores).toBe(6);
  });

  it("caps the fleet at the kernel's busy count and its memory at memory in use", () => {
    const idle: LiveMachineSnapshot = { ...NOW, cpu: { cores: 10, idleMs: 69_900, totalMs: 110_000 } };
    const reading = liveMachineReadingOf({
      current: { ...idle, usedMemoryBytes: 1000 },
      previous: BEFORE,
    })._unsafeUnwrap();
    expect(reading.cpu.busyCores).toBe(0.1);
    expect(reading.cpu.fleetCores).toBe(0.1);
    expect(reading.cpu.otherCores).toBe(0);
    expect(reading.memory.fleetBytes).toBe(1000);
  });

  it("makes a root whose registry and argv disagree fleet, owned by no session", () => {
    const disputed: LiveMachineSnapshot = {
      ...NOW,
      argvByPid: new Map([...NOW.argvByPid, [100, `claude --session-id ${S2}`]]),
    };
    const reading = liveMachineReadingOf({ current: disputed, previous: BEFORE })._unsafeUnwrap();
    expect(reading.sessions.map((session) => session.sessionId)).toEqual([S2]);
    expect(reading.cpu.fleetCores).toBe(2.05);
  });

  it("charges a reused pid its whole time, as a process that started inside the interval", () => {
    const reused: LiveMachineSnapshot = {
      ...NOW,
      processes: NOW.processes.map((row) => (row.pid === 200 ? { ...row, comm: "/usr/bin/yes", cpuTimeMs: 300 } : row)),
    };
    const reading = liveMachineReadingOf({ current: reused, previous: BEFORE })._unsafeUnwrap();
    expect(reading.topOtherCpu).toEqual({ cpuCores: 0.15, label: "yes", memoryBytes: 3000 });
  });
});

describe("freshBaselineOf", () => {
  it("differences against a baseline up to ten seconds old, inclusive, and never an older one", () => {
    expect(freshBaselineOf({ baseline: BEFORE, nowMs: BEFORE.monotonicMs + 2_000 })).toBe(BEFORE);
    expect(freshBaselineOf({ baseline: BEFORE, nowMs: BEFORE.monotonicMs + BASELINE_FRESH_MS })).toBe(BEFORE);
    expect(freshBaselineOf({ baseline: BEFORE, nowMs: BEFORE.monotonicMs + BASELINE_FRESH_MS + 1 })).toBe(undefined);
    expect(freshBaselineOf({ baseline: undefined, nowMs: 0 })).toBe(undefined);
  });
});

describe("argvSessionIdOf", () => {
  it("reads a whole UUID after the flag, as its own token or after `=`", () => {
    expect(argvSessionIdOf({ argv: `claude --session-id ${S1} -p` })).toBe(S1);
    expect(argvSessionIdOf({ argv: `claude --session-id=${S1}` })).toBe(S1);
  });

  it("reads nothing from a partial value, a missing one or two flags", () => {
    expect(argvSessionIdOf({ argv: "claude --session-id a0000006" })).toBe(undefined);
    expect(argvSessionIdOf({ argv: `claude --session-id ${S1}x` })).toBe(undefined);
    expect(argvSessionIdOf({ argv: "claude --session-id" })).toBe(undefined);
    expect(argvSessionIdOf({ argv: `claude --session-id ${S1} --session-id` })).toBe(undefined);
  });
});
