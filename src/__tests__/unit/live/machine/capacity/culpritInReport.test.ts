import { describe, expect, it } from "vitest";
import { buildMachineCapacityReport } from "../../../../../live/machine/capacity.js";
import { machineCapacityJson } from "../../../../../live/machine/capacityRender.js";
import { parseElapsedRows } from "../../../../../live/machine/fleetLoad.js";
import {
  INCIDENT_ETIME_TEXT,
  INCIDENT_TOP_CPU_TEXT,
  INCIDENT_PROCESSES as WEDGED_PROCESSES,
  WEDGED_SESSION_ID,
} from "../fleetLoadFixtures.js";
import { HEALTHY_GAUGES, NO_DISPATCH } from "./fixtures.js";

/**
 * The wedged-session shape: the load is over the hold, one session is wedged on nineteen
 * parallel PreToolUse hooks and a dead seat's orphans are still burning CPU — the reading whose verdict used
 * to say `HOLD on cpu` and name nobody at all.
 */
const WEDGED_READING = {
  ...HEALTHY_GAUGES,
  comms: [],
  cpuSampleText: INCIDENT_TOP_CPU_TEXT,
  elapsedRows: parseElapsedRows({ text: INCIDENT_ETIME_TEXT }),
  processes: WEDGED_PROCESSES,
  swapText: undefined,
  topText: "Load Avg: 146.0, 120.0, 90.0 \nPID    MEM  \n100    400M\n",
} as const;

describe("the fleet culprit in the report", () => {
  it("HOLDS on the stalled session BY NAME, not only on the load average", () => {
    const report = buildMachineCapacityReport(WEDGED_READING);
    expect(report.hold).toBe(true);
    expect(report.holdSubjects).toEqual(["cpu"]);
    expect(report.verdict).toContain(`session ${WEDGED_SESSION_ID} has its poll-gate hook stalled 43m, hold at 5m`);
  });

  it("still HOLDS on the stalled session at 60% idle, while the load clause itself clears on that idle", () => {
    const report = buildMachineCapacityReport({
      ...WEDGED_READING,
      cpuSampleText: INCIDENT_TOP_CPU_TEXT.replace(
        "CPU usage: 60.00% user, 30.00% sys, 10.00% idle ",
        "CPU usage: 20.00% user, 20.00% sys, 60.00% idle ",
      ),
    });
    expect(report.hiddenCpu.idlePct).toBe(60);
    expect(report.hold).toBe(true);
    expect(report.holdSubjects).toEqual(["cpu"]);
    expect(report.verdict).toContain(`session ${WEDGED_SESSION_ID} has its poll-gate hook stalled 43m, hold at 5m`);
    expect(report.verdict).not.toContain("1-min load 146, hold at 45");
  });

  it("names the SUBJECT and the exact command that ends it, in one clause", () => {
    const report = buildMachineCapacityReport(WEDGED_READING);
    expect(report.culprit!.subject).toBe(`session ${WEDGED_SESSION_ID}`);
    expect(report.verdict).toContain(`SUBJECT session ${WEDGED_SESSION_ID}`);
    expect(report.verdict).toContain("end it with `kill 100`");
  });

  it("ALERTS on the dead seat's orphans with the reap command, and never holds on them", () => {
    const report = buildMachineCapacityReport(WEDGED_READING);
    expect(report.alert).toBe(true);
    expect(report.verdict).toContain("2 orphaned fleet shell(s) from 1 dead seat(s) at 43% cpu");
    expect(report.verdict).toContain("slopweaver machine reap");
  });

  it("names NOBODY on a clean reading, so a real signal is never buried under a routine one", () => {
    const report = buildMachineCapacityReport({
      ...HEALTHY_GAUGES,
      comms: [],
      processes: [],
      swapText: undefined,
      topText: "Load Avg: 1.0, 1.0, 1.0 \nPID    MEM  \n",
    });
    expect(report.hold).toBe(false);
    expect(report.culprit).toBeUndefined();
    expect(report.verdict).not.toContain("SUBJECT");
  });

  it("does not hold on a fan-out's parallel calls alone — it alerts, so correct work is never stopped", () => {
    const report = buildMachineCapacityReport({
      ...WEDGED_READING,
      elapsedRows: [],
      topText: "Load Avg: 1.0, 1.0, 1.0 \nPID    MEM  \n100    400M\n",
      parallelCallAlert: 2,
    });
    expect(report.hold).toBe(false);
    expect(report.alert).toBe(true);
    expect(report.verdict).toContain(`session ${WEDGED_SESSION_ID} has 3 tool calls in flight, alert at 2`);
  });

  it("never offers to end the pinned chair, even when it is the stalled, heaviest session", () => {
    const report = buildMachineCapacityReport({ ...WEDGED_READING, chairSessionId: WEDGED_SESSION_ID });
    expect(report.hold).toBe(true);
    expect(report.culprit!.kill).toBe("slopweaver machine reap");
    expect(report.verdict).not.toContain(`SUBJECT session ${WEDGED_SESSION_ID}`);
    expect(report.verdict).not.toContain("kill 100");
  });

  // The hold that named the chair at 0% cpu: the cpu sample was not read, so no session's cpu was measured.
  it("names no live session on cpu when the cpu sample was not read", () => {
    const report = buildMachineCapacityReport({
      ...WEDGED_READING,
      cpuSampleText: undefined,
      elapsedRows: [],
      processes: WEDGED_PROCESSES.filter((row) => row.ppid !== 1 && row.ppid !== 300),
    });
    expect(report.fleet.cpuAttributed).toBe(false);
    expect(report.hold).toBe(true);
    expect(report.holdSubjects).toEqual(["cpu"]);
    expect(report.culprit).toBeUndefined();
    expect(report.verdict).not.toContain("SUBJECT");
  });

  it("carries the fleet reading and both thresholds into --json", () => {
    const json = machineCapacityJson({
      dispatch: NO_DISPATCH,
      report: buildMachineCapacityReport(WEDGED_READING),
    });
    expect(json.hookStallHoldSeconds).toBe(300);
    expect(json.parallelCallAlert).toBe(8);
    expect(json.fleet.orphanCount).toBe(2);
    expect(json.culprit!.kill).toBe("kill 100");
  });
});
