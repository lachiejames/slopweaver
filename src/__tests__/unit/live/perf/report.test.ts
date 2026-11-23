import { describe, expect, it } from "vitest";
import { DEFAULT_HOOK_STALL_HOLD_SECONDS } from "../../../../live/machine/fleetLoad.js";
import { perfReport } from "../../../../live/perf/report.js";
import { fleetReading, LOAD, seatStream, sessionLoad, streamReading } from "./perfFixtures.js";

const QUIET = sessionLoad({ cpuPct: 4, pid: 200, sessionId: "quiet" });
const STALLED = sessionLoad({
  bootsInFlight: 6,
  cpuPct: 1,
  hookStallScript: "pretooluse-poll-gate",
  hookStallSeconds: 2580,
  parallelToolCalls: 3,
  pid: 100,
  sessionId: "stalled",
});

describe("perfReport", () => {
  it("grades a hook over the borrowed stall line as stalled, and one under it as not", () => {
    const under = sessionLoad({
      hookStallScript: "pretooluse-admit",
      hookStallSeconds: DEFAULT_HOOK_STALL_HOLD_SECONDS - 1,
      pid: 300,
      sessionId: "under",
    });
    const report = perfReport({
      fleet: fleetReading({ sessions: [STALLED, under] }),
      hookOverruns: undefined,
      load: LOAD,
      strayDevServers: undefined,
      stream: streamReading({ seats: [] }),
    });
    expect(report.stallHoldSeconds).toBe(DEFAULT_HOOK_STALL_HOLD_SECONDS);
    expect(report.stalledCount).toBe(1);
    expect(report.seats.find((seat) => seat.sessionId === "under")!.stalled).toBe(false);
    expect(report.seats.find((seat) => seat.sessionId === "stalled")!.stalled).toBe(true);
  });

  it("grades a hook exactly ON the line as stalled — the line is the hold, not an exclusive bound", () => {
    const onTheLine = sessionLoad({
      hookStallScript: "pretooluse-admit",
      hookStallSeconds: DEFAULT_HOOK_STALL_HOLD_SECONDS,
      pid: 300,
      sessionId: "on-the-line",
    });
    const report = perfReport({
      fleet: fleetReading({ sessions: [onTheLine] }),
      hookOverruns: undefined,
      load: LOAD,
      strayDevServers: undefined,
      stream: streamReading({ seats: [] }),
    });
    expect(report.seats[0]!.stalled).toBe(true);
  });

  it("puts a stalled seat above a busier healthy one, whatever the cpu says", () => {
    const busy = sessionLoad({ cpuPct: 300, pid: 400, sessionId: "busy" });
    const report = perfReport({
      fleet: fleetReading({ sessions: [busy, QUIET, STALLED] }),
      hookOverruns: undefined,
      load: LOAD,
      strayDevServers: undefined,
      stream: streamReading({ seats: [] }),
    });
    expect(report.seats.map((seat) => seat.sessionId)).toEqual(["stalled", "busy", "quiet"]);
  });

  it("joins the stream half onto the ps half on the bare session id", () => {
    const report = perfReport({
      fleet: fleetReading({ sessions: [STALLED] }),
      hookOverruns: undefined,
      load: LOAD,
      strayDevServers: undefined,
      stream: streamReading({
        seats: [
          seatStream({
            cwd: "/w/stalled",
            firings: 44,
            sessionId: "stalled",
            turnaroundSamples: [5, 9, 40],
            workspaceId: "workspace-7",
          }),
        ],
      }),
    });
    const seat = report.seats[0]!;
    expect(seat.workspaceId).toBe("workspace-7");
    expect(seat.cwd).toBe("/w/stalled");
    expect(seat.firings).toBe(44);
    expect(seat.turnaround!.max).toBe(40);
  });

  it("leaves a seat the stream never saw with no workspace, no cwd and zero firings", () => {
    const report = perfReport({
      fleet: fleetReading({ sessions: [QUIET] }),
      hookOverruns: undefined,
      load: LOAD,
      strayDevServers: undefined,
      stream: streamReading({ seats: [seatStream({ firings: 9, sessionId: "somebody-else" })] }),
    });
    const seat = report.seats[0]!;
    expect(seat.workspaceId).toBeUndefined();
    expect(seat.cwd).toBeUndefined();
    expect(seat.firings).toBe(0);
    expect(seat.turnaround).toBeUndefined();
  });

  it("sums hook boots across the whole fleet — the number that moves the load average", () => {
    const other = sessionLoad({ bootsInFlight: 4, pid: 500, sessionId: "other" });
    const report = perfReport({
      fleet: fleetReading({ sessions: [STALLED, other] }),
      hookOverruns: undefined,
      load: LOAD,
      strayDevServers: undefined,
      stream: streamReading({ seats: [] }),
    });
    expect(report.bootsInFlight).toBe(10);
  });

  it("emits one REACT line per stalled seat, naming the hook and carrying the command that ends it", () => {
    const report = perfReport({
      fleet: fleetReading({ sessions: [STALLED, QUIET] }),
      hookOverruns: undefined,
      load: LOAD,
      strayDevServers: undefined,
      stream: streamReading({ seats: [seatStream({ sessionId: "stalled", workspaceId: "workspace-7" })] }),
    });
    expect(report.react.length).toBe(1);
    const line = report.react[0]!;
    expect(line).toContain("REACT — seat stalled");
    expect(line).toContain("poll-gate hook stalled 43m");
    expect(line).toContain("(line 5m)");
    expect(line).toContain("6 hook boots live");
    expect(line).toContain('slopweaver cmux stop workspace-7 --why "<what it is costing>"');
    expect(line).toContain("slopweaver cmux spawn");
  });

  it("addresses a REACT line by pid when the stream never named the seat's workspace", () => {
    const report = perfReport({
      fleet: fleetReading({ sessions: [STALLED] }),
      hookOverruns: undefined,
      load: LOAD,
      strayDevServers: undefined,
      stream: streamReading({ seats: [] }),
    });
    expect(report.react[0]!).toContain("slopweaver cmux stop pid 100 --why");
  });

  it("emits no REACT line at all when nothing crossed the line", () => {
    const report = perfReport({
      fleet: fleetReading({ sessions: [QUIET] }),
      hookOverruns: undefined,
      load: LOAD,
      strayDevServers: undefined,
      stream: streamReading({ seats: [] }),
    });
    expect(report.react).toEqual([]);
    expect(report.stalledCount).toBe(0);
  });

  it("pools each seat's own p50 into the fleet distribution rather than weighting by call count", () => {
    const busy = sessionLoad({ pid: 600, sessionId: "busy" });
    const report = perfReport({
      fleet: fleetReading({ sessions: [QUIET, busy] }),
      hookOverruns: undefined,
      load: LOAD,
      strayDevServers: undefined,
      stream: streamReading({
        seats: [
          seatStream({ firings: 500, sessionId: "busy", turnaroundSamples: [30, 30, 30] }),
          seatStream({ firings: 2, sessionId: "quiet", turnaroundSamples: [2, 2, 2] }),
        ],
      }),
    });
    expect(report.fleetTurnaround!.count).toBe(2);
    expect(report.fleetTurnaround!.p50).toBe(2);
    expect(report.fleetTurnaround!.max).toBe(30);
  });

  it("reports an empty fleet as zero seats with no fleet distribution, never as zero seconds", () => {
    const report = perfReport({
      fleet: fleetReading({ sessions: [] }),
      hookOverruns: undefined,
      load: LOAD,
      strayDevServers: undefined,
      stream: streamReading({ frames: 0, seats: [] }),
    });
    expect(report.seats).toEqual([]);
    expect(report.fleetTurnaround).toBeUndefined();
    expect(report.bootsInFlight).toBe(0);
    expect(report.frames).toBe(0);
  });

  it("takes a caller's own stall line when one is passed, so a test never depends on the shipped number", () => {
    const report = perfReport({
      fleet: fleetReading({ sessions: [STALLED] }),
      hookOverruns: undefined,
      load: LOAD,
      stallHoldSeconds: 3600,
      strayDevServers: undefined,
      stream: streamReading({ seats: [] }),
    });
    expect(report.stalledCount).toBe(0);
    expect(report.stallHoldSeconds).toBe(3600);
  });
});
