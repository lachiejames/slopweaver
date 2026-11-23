import { describe, expect, it } from "vitest";
import {
  hiddenCpuClause,
  hiddenCpuLines,
  hiddenCpuReading,
  hiddenFromTopLabels,
  parseProcessStatRows,
  parseTopCpuSample,
} from "../../../../live/machine/hiddenCpu.js";
import { ENDPOINT_PS_STAT_TEXT, TWO_SAMPLE_TOP_CPU_TEXT } from "./hiddenCpuFixtures.js";

/** The first sample of the fixture, cut before the second `Processes:` line. */
const FIRST_SAMPLE = TWO_SAMPLE_TOP_CPU_TEXT.split("Processes: 4 total")[0]!;

describe("parseTopCpuSample", () => {
  it("reads the final sample's header, rows and pids, never the first sample's zeros", () => {
    const sample = parseTopCpuSample({ text: TWO_SAMPLE_TOP_CPU_TEXT })!;
    expect(sample.busyPct).toBeCloseTo(35.64, 6);
    expect(sample.idlePct).toBe(64.35);
    expect(sample.visiblePct).toBeCloseTo(258.3, 6);
    expect(sample.visiblePids).toEqual([56_035, 540, 371, 4242]);
  });

  it("refuses a one-sample report, whose per-process column is all zero", () => {
    expect(parseTopCpuSample({ text: FIRST_SAMPLE })).toBeUndefined();
  });

  it("refuses a truncated final sample rather than falling back to the first sample's table", () => {
    const text = `${FIRST_SAMPLE}Processes: 975 total\nCPU usage: 25.0% user, 25.0% sys, 50.0% idle \n`;
    expect(parseTopCpuSample({ text })).toBeUndefined();
  });

  it("refuses a final sample whose table is empty", () => {
    const text = `${FIRST_SAMPLE}Processes: 975 total\nCPU usage: 25.0% user, 25.0% sys, 50.0% idle \nPID    %CPU\n\n`;
    expect(parseTopCpuSample({ text })).toBeUndefined();
  });

  it("refuses a final sample with a malformed row rather than undercounting it", () => {
    const text = `${FIRST_SAMPLE}Processes: 2 total\nCPU usage: 25.0% user, 25.0% sys, 50.0% idle \nPID    %CPU\n100    12.0\n101    n/a\n`;
    expect(parseTopCpuSample({ text })).toBeUndefined();
  });

  it("refuses a final table cut off at a row boundary, since its rows fall short of its own process total", () => {
    const text = TWO_SAMPLE_TOP_CPU_TEXT.slice(0, TWO_SAMPLE_TOP_CPU_TEXT.lastIndexOf("4242   0.0"));
    expect(parseTopCpuSample({ text })).toBeUndefined();
  });

  it("reads a CRLF report and a single process above 100%", () => {
    const text = `${FIRST_SAMPLE}Processes: 1 total\r\nCPU usage: 50.0% user, 10.0% sys, 40.0% idle \r\nPID    %CPU\r\n100    312.5\r\n`;
    expect(parseTopCpuSample({ text })).toEqual({ busyPct: 60, idlePct: 40, visiblePct: 312.5, visiblePids: [100] });
  });
});

describe("parseTopCpuSample's completeness guards", () => {
  it("refuses a report cut off mid-row, since top always ends its report with a newline", () => {
    const text = `${FIRST_SAMPLE}Processes: 1 total\nCPU usage: 25.0% user, 25.0% sys, 50.0% idle \nPID    %CPU\n100    3`;
    expect(parseTopCpuSample({ text })).toBeUndefined();
  });

  it("reads the same report once its final row is whole", () => {
    const text = `${FIRST_SAMPLE}Processes: 1 total\nCPU usage: 25.0% user, 25.0% sys, 50.0% idle \nPID    %CPU\n100    312.5\n`;
    expect(parseTopCpuSample({ text })).toEqual({ busyPct: 50, idlePct: 50, visiblePct: 312.5, visiblePids: [100] });
  });

  it("refuses a header whose user, sys and idle percentages do not sum to 100", () => {
    const text = TWO_SAMPLE_TOP_CPU_TEXT.replace("25.47% user", "999% user");
    expect(parseTopCpuSample({ text })).toBeUndefined();
  });
});

describe("parseProcessStatRows", () => {
  it("keeps embedded spaces in comm, since comm is the last field", () => {
    const rows = parseProcessStatRows({ text: ENDPOINT_PS_STAT_TEXT });
    expect(rows.find((row) => row.pid === 1416)).toEqual({
      comm: "/Applications/Endpoint.app/Contents/Library/LaunchServices/Endpoint Notifications.app/Contents/MacOS/Endpoint Notifications",
      pid: 1416,
      rssKb: 0,
      stat: "?",
    });
    expect(rows).toHaveLength(9);
  });

  it("drops a line that is not pid, rss, stat and comm", () => {
    expect(parseProcessStatRows({ text: "PID RSS STAT COMM\n12 notanumber S /bin/x\n13 0 S\n" })).toEqual([]);
  });
});

describe("hiddenFromTopLabels", () => {
  const rows = parseProcessStatRows({ text: ENDPOINT_PS_STAT_TEXT });
  const visiblePids = parseTopCpuSample({ text: TWO_SAMPLE_TOP_CPU_TEXT })!.visiblePids;

  it("names only live zero-rss processes top's table does not carry, a systemextension first, then ascending pid", () => {
    expect(hiddenFromTopLabels({ rows, visiblePids })).toEqual([
      "com.example.endpoint.Agent",
      "ScanService",
      "PredictService",
      "Endpoint Notifications",
    ]);
  });

  it("names a paged-out zero-rss process when top's table does not carry it, proving the table is what excludes it", () => {
    expect(hiddenFromTopLabels({ rows, visiblePids: [] })).toContain("sleeper");
  });

  it("names a basename once when two hidden processes share it", () => {
    const shared = parseProcessStatRows({ text: "10 0 ?s /opt/a/helper\n11 0 ?s /opt/b/helper\n" });
    expect(hiddenFromTopLabels({ rows: shared, visiblePids: [] })).toEqual(["helper"]);
  });
});

describe("hiddenCpuReading", () => {
  const statRows = parseProcessStatRows({ text: ENDPOINT_PS_STAT_TEXT });

  it("turns the whole-machine percentage into cores and subtracts what top's rows account for", () => {
    expect(hiddenCpuReading({ cores: 15, cpuSampleText: TWO_SAMPLE_TOP_CPU_TEXT, statRows })).toEqual({
      busyCores: 5.3,
      hiddenFromTop: ["com.example.endpoint.Agent", "ScanService", "PredictService", "Endpoint Notifications"],
      idlePct: 64.35,
      unattributedCores: 2.8,
      visibleCores: 2.6,
    });
  });

  it("keeps idle as top printed it, so 19.96% stays under the 20% floor rather than rounding up onto it", () => {
    const cpuSampleText = `${FIRST_SAMPLE}Processes: 1 total\nCPU usage: 80.04% user, 0.00% sys, 19.96% idle \nPID    %CPU\n100    3.0\n`;
    expect(hiddenCpuReading({ cores: 15, cpuSampleText, statRows: [] }).idlePct).toBe(19.96);
  });

  it("carries the idle percentage even with no core count, since idle needs none", () => {
    const reading = hiddenCpuReading({ cores: undefined, cpuSampleText: TWO_SAMPLE_TOP_CPU_TEXT, statRows: [] });
    expect(reading.idlePct).toBe(64.35);
    expect(reading.busyCores).toBeUndefined();
  });

  it("floors the residual at zero when processes outran the header between samples", () => {
    expect(hiddenCpuReading({ cores: 1, cpuSampleText: TWO_SAMPLE_TOP_CPU_TEXT, statRows }).unattributedCores).toBe(0);
  });

  it("leaves every number unmeasured, never zero, when the core count is unreadable or invalid", () => {
    const reading = hiddenCpuReading({ cores: 0, cpuSampleText: TWO_SAMPLE_TOP_CPU_TEXT, statRows: [] });
    expect(reading).toEqual({
      busyCores: undefined,
      hiddenFromTop: [],
      idlePct: 64.35,
      unattributedCores: undefined,
      visibleCores: undefined,
    });
  });

  it("establishes nothing hidden and no number, idle included, when the sample was unreadable", () => {
    expect(hiddenCpuReading({ cores: 15, cpuSampleText: FIRST_SAMPLE, statRows })).toEqual({
      busyCores: undefined,
      hiddenFromTop: [],
      idlePct: undefined,
      unattributedCores: undefined,
      visibleCores: undefined,
    });
  });
});

describe("hiddenCpuClause", () => {
  const reading = { busyCores: 5.3, idlePct: 64.4, unattributedCores: 2.8, visibleCores: 2.6 } as const;

  it("says nothing when no process is hidden, however large the residual", () => {
    expect(hiddenCpuClause({ reading: { ...reading, hiddenFromTop: [] } })).toBeUndefined();
  });

  it("names the first hidden process, counts the rest, and prints the residual", () => {
    expect(hiddenCpuClause({ reading: { ...reading, hiddenFromTop: ["com.example.endpoint.Agent", "a", "b"] } })).toBe(
      "hidden from top: 'com.example.endpoint.Agent' +2 more, 2.8 cores of cpu unattributed",
    );
  });

  it("says the residual is unmeasured rather than printing zero when it could not be computed", () => {
    expect(
      hiddenCpuClause({
        reading: {
          busyCores: undefined,
          hiddenFromTop: ["solo"],
          idlePct: undefined,
          unattributedCores: undefined,
          visibleCores: 2.6,
        },
      }),
    ).toBe("hidden from top: 'solo', unattributed cpu unmeasured");
  });
});

describe("hiddenCpuLines", () => {
  const unmeasured = {
    busyCores: undefined,
    hiddenFromTop: [],
    idlePct: undefined,
    unattributedCores: undefined,
    visibleCores: undefined,
  } as const;

  it("prints nothing when neither idle nor the residual was measured and nothing is hidden", () => {
    expect(hiddenCpuLines({ reading: unmeasured })).toEqual([]);
  });

  it("opens the cpu line on the idle percentage when the residual was measured too", () => {
    expect(
      hiddenCpuLines({
        reading: { ...unmeasured, busyCores: 5.3, idlePct: 64.4, unattributedCores: 2.8, visibleCores: 2.6 },
      }),
    ).toEqual(["cpu: 64.4% idle, 5.3 cores busy, 2.6 visible per process, 2.8 unattributed"]);
  });

  it("prints the idle percentage alone when it was read but the core count was not", () => {
    expect(hiddenCpuLines({ reading: { ...unmeasured, idlePct: 64.4 } })).toEqual(["cpu: 64.4% idle"]);
  });
});
