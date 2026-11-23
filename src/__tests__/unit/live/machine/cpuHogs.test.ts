/**
 * The CPU-hog reading — the axis `capacity.ts`'s memory ranking cannot see, which is the whole stale-daemon shape:
 * a `bfs` walking `/` at three cores costs almost no memory and never reaches a footprint ranking.
 *
 * Two properties carry the weight here. The LABEL comes from `comm` and never from an argv, because a hog
 * reaches a finding row and a finding row reaches the briefing; and a process a session owns is FLEET
 * whatever its own argv looks like.
 */
import { describe, expect, it } from "vitest";

import { cpuHogReading, DEFAULT_HOG_LIMIT } from "../../../../live/machine/cpuHogs.js";

const SESSION = "a0000036-0000-4000-8000-000000000039";

/** A `ps -ax -o pid=,ppid=,args=` snapshot: a session, a shell under it, and two processes it never launched. */
const PROCESSES = [
  { argv: `claude --session-id ${SESSION} --model opus`, pid: 100, ppid: 1 },
  { argv: "/bin/zsh -c bfs /", pid: 101, ppid: 100 },
  { argv: "/opt/homebrew/bin/node /usr/local/lib/nx/daemon.js", pid: 200, ppid: 1 },
  { argv: "/usr/libexec/mds_stores", pid: 300, ppid: 1 },
];

const COMMS = [
  { comm: "/Users/x/.local/bin/claude", pid: 100 },
  { comm: "/opt/homebrew/bin/bfs", pid: 101 },
  { comm: "/opt/homebrew/bin/node", pid: 200 },
  { comm: "/usr/libexec/mds_stores", pid: 300 },
];

const CPU_ROWS = [
  { cpuPct: 12.5, pid: 100 },
  { cpuPct: 301.2, pid: 101 },
  { cpuPct: 88.4, pid: 200 },
  { cpuPct: 4.1, pid: 300 },
];

const ELAPSED = [
  { pid: 100, seconds: 3600 },
  { pid: 101, seconds: 900 },
  { pid: 200, seconds: 86400 },
];

describe("cpuHogReading", () => {
  it("ranks by %CPU, largest first", () => {
    const reading = cpuHogReading({ comms: COMMS, cpuRows: CPU_ROWS, elapsedRows: ELAPSED, processes: PROCESSES });

    expect(reading.cpuAttributed).toBe(true);
    expect(reading.hogs.map((hog) => hog.pid)).toStrictEqual([101, 200, 100, 300]);
    expect(reading.hogs[0]!.cpuPct).toBe(301.2);
  });

  it("labels a hog from its comm basename, never from its argv", () => {
    const reading = cpuHogReading({ comms: COMMS, cpuRows: CPU_ROWS, elapsedRows: ELAPSED, processes: PROCESSES });

    expect(reading.hogs[0]!.label).toBe("bfs");
    expect(reading.hogs[1]!.label).toBe("node");
  });

  it("falls back to the argv's binary path only, when no comm row exists", () => {
    const reading = cpuHogReading({ comms: [], cpuRows: CPU_ROWS, elapsedRows: ELAPSED, processes: PROCESSES });

    expect(reading.hogs[0]!.label).toBe("zsh");
    expect(reading.hogs[2]!.label).toBe("claude");
  });

  it("names the pid when neither a comm nor an argv is available", () => {
    const reading = cpuHogReading({ comms: [], cpuRows: [{ cpuPct: 9, pid: 999 }], elapsedRows: [], processes: [] });

    expect(reading.hogs[0]!.label).toBe("pid 999");
  });

  it("attributes a process to the session whose tree it sits in, by climbing the parent chain", () => {
    const reading = cpuHogReading({ comms: COMMS, cpuRows: CPU_ROWS, elapsedRows: ELAPSED, processes: PROCESSES });

    expect(reading.hogs[0]!.sessionId).toBe(SESSION);
    expect(reading.hogs[0]!.classification).toBe("fleet");
  });

  it("calls a process no session owns foreign, which is a stale nx daemon", () => {
    const reading = cpuHogReading({ comms: COMMS, cpuRows: CPU_ROWS, elapsedRows: ELAPSED, processes: PROCESSES });
    const daemon = reading.hogs.find((hog) => hog.pid === 200)!;

    expect(daemon.sessionId).toBe(undefined);
    expect(daemon.classification).toBe("foreign");
    expect(daemon.elapsedSeconds).toBe(86400);
  });

  it("carries an undefined elapsed reading rather than zero when the elapsed read had no row", () => {
    const reading = cpuHogReading({ comms: COMMS, cpuRows: CPU_ROWS, elapsedRows: ELAPSED, processes: PROCESSES });
    const mds = reading.hogs.find((hog) => hog.pid === 300)!;

    expect(mds.elapsedSeconds).toBe(undefined);
  });

  it("reports nothing measured — never a machine at zero — when the cpu sample decoded to nothing", () => {
    const reading = cpuHogReading({ comms: COMMS, cpuRows: [], elapsedRows: ELAPSED, processes: PROCESSES });

    expect(reading.cpuAttributed).toBe(false);
    expect(reading.hogs).toStrictEqual([]);
  });

  it("keeps at most the limit asked for", () => {
    const reading = cpuHogReading({
      comms: COMMS,
      cpuRows: CPU_ROWS,
      elapsedRows: ELAPSED,
      limit: 2,
      processes: PROCESSES,
    });

    expect(reading.hogs.length).toBe(2);
    expect(reading.hogs.map((hog) => hog.pid)).toStrictEqual([101, 200]);
  });

  it("bounds the list by default, because it reaches a JSONL row and a briefing clause", () => {
    const cpuRows = Array.from({ length: 30 }, (_unused, index) => ({ cpuPct: index, pid: 1000 + index }));
    const reading = cpuHogReading({ comms: [], cpuRows, elapsedRows: [], processes: [] });

    expect(DEFAULT_HOG_LIMIT).toBe(8);
    expect(reading.hogs.length).toBe(DEFAULT_HOG_LIMIT);
  });

  it("ends a parent climb at launchd rather than walking forever", () => {
    const processes = [
      { argv: "/sbin/launchd", pid: 1, ppid: 1 },
      { argv: "/usr/libexec/foo", pid: 7, ppid: 1 },
    ];
    const reading = cpuHogReading({ comms: [], cpuRows: [{ cpuPct: 5, pid: 7 }], elapsedRows: [], processes });

    expect(reading.hogs[0]!.sessionId).toBe(undefined);
  });
});
