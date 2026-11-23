import { describe, expect, it } from "vitest";
import { buildMachineCapacityReport } from "../../../../../live/machine/capacity.js";
import { machineCapacityJson, renderMachineCapacityLines } from "../../../../../live/machine/capacityRender.js";
import { HEALTHY_GAUGES, NO_DISPATCH, OVERLOADED_TOP_TEXT } from "./fixtures.js";

/**
 * Six sessions booted inside the window on a machine whose 1-minute load has not moved yet — the
 * reading every spawn in that pass took (the hold is six).
 * Six young, one old, one whose pid `ps` did not list.
 */
const BURST = {
  ...HEALTHY_GAUGES,
  comms: [],
  elapsedRows: [
    { pid: 501, seconds: 20 },
    { pid: 502, seconds: 40 },
    { pid: 503, seconds: 60 },
    { pid: 504, seconds: 75 },
    { pid: 505, seconds: 120 },
    { pid: 506, seconds: 150 },
    { pid: 507, seconds: 7200 },
  ],
  processes: [],
  sessions: [501, 502, 503, 504, 505, 506, 507, 508].map((pid) => ({
    cwd: `/wt/${String(pid)}`,
    pid,
    sessionId: `s${String(pid)}`,
  })),
  swapText: "vm.swapusage: total = 4096.00M  used = 512.00M  free = 3584.00M",
  topText: "Load Avg: 4.0, 4.0, 4.0 \nPID    MEM  \n",
} as const;

describe("the recent-boots hold", () => {
  it("HOLDs on boots when six sessions booted inside the window, while load reads 4", () => {
    const report = buildMachineCapacityReport(BURST);

    expect(report.hold).toBe(true);
    expect(report.holdSubjects).toEqual(["boots"]);
    expect(report.recentBoots.boots.map((boot) => boot.pid)).toEqual([501, 502, 503, 504, 505, 506]);
    expect(report.verdict).toBe(
      "machine capacity: HOLD on boots (6 sessions booted in the last 3m, hold at 6 — the 1-min load cannot see them yet) — 1-min load 4 · idle unmeasured · no foreign process observed · swap 0.5/4 GB · compressor 15% of segments limit · 3 swapfiles",
    );
  });

  it("grades memory and cpu exactly as before and blames nobody, because a boot burst is not a state or a fault", () => {
    const report = buildMachineCapacityReport(BURST);

    expect(report.graded).toEqual(["memory", "cpu"]);
    expect(report.ungraded).toEqual([]);
    expect(report.culprit).toBeUndefined();
  });

  it("does not hold on five boots — the threshold, not any boot at all", () => {
    const report = buildMachineCapacityReport({ ...BURST, elapsedRows: BURST.elapsedRows.slice(1) });

    expect(report.hold).toBe(false);
    expect(report.recentBoots.boots.length).toBe(5);
    expect(report.verdict).toBe(
      "machine capacity: ok on memory and cpu — 1-min load 4 · idle unmeasured · no foreign process observed · swap 0.5/4 GB · compressor 15% of segments limit · 3 swapfiles",
    );
  });

  it("names boots after cpu when the load also holds", () => {
    const report = buildMachineCapacityReport({ ...BURST, topText: OVERLOADED_TOP_TEXT });

    expect(report.holdSubjects).toEqual(["cpu", "boots"]);
  });

  it("carries the reading onto --json and prints one line naming each boot", () => {
    const report = buildMachineCapacityReport(BURST);

    expect(machineCapacityJson({ dispatch: NO_DISPATCH, report }).recentBoots).toEqual({
      boots: [
        { cwd: "/wt/501", pid: 501, seconds: 20, sessionId: "s501" },
        { cwd: "/wt/502", pid: 502, seconds: 40, sessionId: "s502" },
        { cwd: "/wt/503", pid: 503, seconds: 60, sessionId: "s503" },
        { cwd: "/wt/504", pid: 504, seconds: 75, sessionId: "s504" },
        { cwd: "/wt/505", pid: 505, seconds: 120, sessionId: "s505" },
        { cwd: "/wt/506", pid: 506, seconds: 150, sessionId: "s506" },
      ],
      hold: 6,
      windowSeconds: 180,
    });
    expect(renderMachineCapacityLines({ full: false, report })[1]).toBe(
      "recent boots: 6 in the last 180s, hold at 6 — s501 20s, s502 40s, s503 60s, s504 75s, s505 120s, s506 150s",
    );
  });
});
