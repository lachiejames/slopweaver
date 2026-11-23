import { describe, expect, it } from "vitest";
import {
  buildMachineCapacityReport,
  DEFAULT_FOREIGN_FOOTPRINT_ALERT_GB,
  DEFAULT_SWAPFILE_HOLD_COUNT,
} from "../../../../../live/machine/capacity.js";
import { renderMachineCapacityLines } from "../../../../../live/machine/capacityRender.js";
import { HEALTHY_GAUGES, INCIDENT_COMMS, INCIDENT_PROCESSES, INCIDENT_SESSION, INCIDENT_TOP_TEXT } from "./fixtures.js";

describe("a session's spawned child in the report", () => {
  const incident = (): ReturnType<typeof buildMachineCapacityReport> =>
    buildMachineCapacityReport({
      ...HEALTHY_GAUGES,
      comms: INCIDENT_COMMS,
      processes: INCIDENT_PROCESSES,
      sessions: [INCIDENT_SESSION],
      swapText: undefined,
      swapfileCount: 12,
      topText: INCIDENT_TOP_TEXT,
    });

  it("classifies the heredoc fleet, names its session, and never lets it stand as the top foreign hog", () => {
    const report = incident();
    expect(report.processes[0]).toEqual({
      classification: "fleet",
      footprintBytes: 22_548_578_304,
      footprintGb: 21,
      label: "Python",
      pid: 98_575,
      session: INCIDENT_SESSION,
    });
    expect(report.topForeign?.label).toBe("mds");
    expect(report.topFleetChild?.pid).toBe(98_575);
    expect(report.fleetChildAlert).toBe(true);
  });

  it("alerts on the child in a clause naming the session, beside the swapfile hold that already fired", () => {
    expect(incident().verdict).toBe(
      `machine capacity: HOLD on memory (12 swapfiles, hold at ${String(DEFAULT_SWAPFILE_HOLD_COUNT)}) · ALERT on memory ('Python' (pid 98575) at 21 GB, over ${String(DEFAULT_FOREIGN_FOOTPRINT_ALERT_GB)} GB, spawned by session d5546c00-0000-4000-8000-000000000000 in live-bot-loop-a) — 1-min load 9 · idle unmeasured · top foreign hog 'mds' at 4.6 GB · swap unmeasured · compressor 15% of segments limit · 12 swapfiles`,
    );
  });

  it("names the owning session on each attributed process line, and on no other", () => {
    const lines = renderMachineCapacityLines({ full: true, report: incident() });
    expect(lines.filter((line) => line.startsWith("  "))).toEqual([
      "      21 GB  fleet    Python (pid 98575) · session d5546c00-0000-4000-8000-000000000000 in live-bot-loop-a",
      "     4.6 GB  foreign  mds (pid 371)",
      "     0.4 GB  fleet    claude (pid 88556) · session d5546c00-0000-4000-8000-000000000000 in live-bot-loop-a",
    ]);
  });

  it("names EVERY session's child over the threshold, not only the largest", () => {
    const sessionA = { cwd: "/opt/synthetic/worktrees/a", pid: 200, sessionId: "aaaa" };
    const sessionB = { cwd: "/opt/synthetic/worktrees/b", pid: 400, sessionId: "bbbb" };
    const report = buildMachineCapacityReport({
      ...HEALTHY_GAUGES,
      comms: [
        { comm: "/usr/bin/Python", pid: 300 },
        { comm: "/usr/bin/Python", pid: 500 },
      ],
      processes: [
        { argv: "/opt/synthetic/bin/claude", pid: 200, ppid: 1 },
        { argv: "Python -", pid: 300, ppid: 200 },
        { argv: "/opt/synthetic/bin/claude", pid: 400, ppid: 1 },
        { argv: "Python -", pid: 500, ppid: 400 },
      ],
      sessions: [sessionA, sessionB],
      swapText: undefined,
      swapfileCount: 12,
      topText: "Load Avg: 1.0, 1.0, 1.0 \nPID    MEM  \n300    12288M\n500    10240M\n",
    });
    expect(report.hold).toBe(true);
    expect(report.topFleetChild?.pid).toBe(300);
    expect(report.verdict).toBe(
      `machine capacity: HOLD on memory (12 swapfiles, hold at ${String(DEFAULT_SWAPFILE_HOLD_COUNT)}) · ALERT on memory ('Python' (pid 300) at 12 GB, over 8 GB, spawned by session aaaa in a, 'Python' (pid 500) at 10 GB, over 8 GB, spawned by session bbbb in b) — 1-min load 1 · idle unmeasured · no foreign process observed · swap unmeasured · compressor 15% of segments limit · 12 swapfiles`,
    );
  });

  it("alerts on a child just over the threshold whose rounded display reads exactly 8 GB", () => {
    const report = buildMachineCapacityReport({
      ...HEALTHY_GAUGES,
      comms: INCIDENT_COMMS,
      processes: INCIDENT_PROCESSES,
      sessions: [INCIDENT_SESSION],
      swapText: undefined,
      topText: "Load Avg: 1.0, 1.0, 1.0 \nPID    MEM  \n98575  8200M\n",
    });
    expect(report.topFleetChild?.footprintGb).toBe(8);
    expect(report.fleetChildAlert).toBe(true);
    expect(report.alert).toBe(true);
  });

  it("does not alert on a child at exactly the threshold", () => {
    const report = buildMachineCapacityReport({
      ...HEALTHY_GAUGES,
      comms: INCIDENT_COMMS,
      processes: INCIDENT_PROCESSES,
      sessions: [INCIDENT_SESSION],
      swapText: undefined,
      topText: "Load Avg: 1.0, 1.0, 1.0 \nPID    MEM  \n98575  8192M\n",
    });
    expect(report.fleetChildAlert).toBe(false);
  });

  it("never counts the session's own claude process as its child", () => {
    const report = buildMachineCapacityReport({
      ...HEALTHY_GAUGES,
      comms: INCIDENT_COMMS,
      processes: INCIDENT_PROCESSES,
      sessions: [INCIDENT_SESSION],
      swapText: undefined,
      topText: "Load Avg: 1.0, 1.0, 1.0 \nPID    MEM  \n88556  9000M\n",
    });
    expect(report.topFleetChild).toBeUndefined();
    expect(report.alert).toBe(false);
  });

  it("carries a child under the threshold without alerting on it", () => {
    const report = buildMachineCapacityReport({
      ...HEALTHY_GAUGES,
      comms: INCIDENT_COMMS,
      processes: INCIDENT_PROCESSES,
      sessions: [INCIDENT_SESSION],
      swapText: undefined,
      topText: "Load Avg: 1.0, 1.0, 1.0 \nPID    MEM  \n98575  2048M\n",
    });
    expect(report.topFleetChild?.label).toBe("Python");
    expect(report.fleetChildAlert).toBe(false);
    expect(report.alert).toBe(false);
  });

  it("reads the heredoc as the foreign hog it always was when no session is registered", () => {
    const report = buildMachineCapacityReport({
      ...HEALTHY_GAUGES,
      comms: INCIDENT_COMMS,
      processes: INCIDENT_PROCESSES,
      swapText: undefined,
      topText: INCIDENT_TOP_TEXT,
    });
    expect(report.processes[0]?.classification).toBe("foreign");
    expect(report.topForeign?.label).toBe("Python");
    expect(report.topFleetChild).toBeUndefined();
  });
});
