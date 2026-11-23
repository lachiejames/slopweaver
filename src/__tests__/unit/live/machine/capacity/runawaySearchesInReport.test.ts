import { describe, expect, it } from "vitest";
import { machineAnomaly } from "../../../../../live/machine/anomaly.js";
import { buildMachineCapacityReport } from "../../../../../live/machine/capacity.js";
import { machineCapacityJson } from "../../../../../live/machine/capacityRender.js";
import { parseElapsedRows } from "../../../../../live/machine/fleetLoad.js";
import {
  RUNAWAY_ETIME_TEXT,
  RUNAWAY_PROCESSES,
  RUNAWAY_SESSION_ID,
  RUNAWAY_TOP_CPU_TEXT,
} from "../runawaySearchFixtures.js";
import { HEALTHY_GAUGES, NO_DISPATCH } from "./fixtures.js";

/**
 * The runaway-search shape: one live seat's grep children, 20 to 58 minutes old at half a core each, holding the
 * machine at 0% idle while the culprit named the seat and proposed `kill <session pid>`.
 */
const RUNAWAY_READING = {
  ...HEALTHY_GAUGES,
  comms: [],
  cpuSampleText: RUNAWAY_TOP_CPU_TEXT,
  elapsedRows: parseElapsedRows({ text: RUNAWAY_ETIME_TEXT }),
  processes: RUNAWAY_PROCESSES,
  swapText: undefined,
  topText: "Load Avg: 60.0, 55.0, 50.0 \nPID    MEM  \n511    40M\n",
} as const;

describe("runaway searches in the report", () => {
  const report = buildMachineCapacityReport(RUNAWAY_READING);

  it("blames the searches, with the reap, and never the seat's own pid", () => {
    expect(report.runawaySearches.map((search) => search.pid)).toEqual([511, 521, 900]);
    expect(report.culprit).toEqual({
      endedBy: "seat",
      kill: "slopweaver machine reap",
      subject: `runaway searches in session ${RUNAWAY_SESSION_ID}`,
      why: "3 search(es) at 140.3% cpu, oldest 58m: 511 (ugrep), 521 (ugrep), 900 (grep) — the seat itself is not the subject",
    });
    expect(report.verdict).not.toContain("kill 500");
  });

  it("ALERTS on them by count and cost with the command that ends them", () => {
    expect(report.alert).toBe(true);
    expect(report.verdict).toContain("3 runaway search(es) inside live seats at 140.3% cpu — slopweaver machine reap");
  });

  it("carries each search into --json without its argv", () => {
    const json = machineCapacityJson({ dispatch: NO_DISPATCH, report });
    expect(json.runawaySearches[0]).toEqual({
      binary: "ugrep",
      cpuPct: 52.3,
      elapsedSeconds: 3480,
      pid: 511,
      sessionId: RUNAWAY_SESSION_ID,
      shellPid: 510,
    });
  });

  it("raises an anomaly whose subject is the searches' session, with a dedupe key free of pids", () => {
    const anomaly = machineAnomaly({ report });
    expect(anomaly.kind).toBe("anomalous");
    const subject = (anomaly as Extract<typeof anomaly, { kind: "anomalous" }>).subject;
    expect(subject).toEqual({
      kill: "slopweaver machine reap",
      label: `runaway searches in session ${RUNAWAY_SESSION_ID}`,
      sessionId: RUNAWAY_SESSION_ID,
      tree: [],
      why: report.culprit!.why,
    });
  });
});
