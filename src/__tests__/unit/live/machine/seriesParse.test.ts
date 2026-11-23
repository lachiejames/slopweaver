/**
 * `parseMachineSeriesTop`, `topBytes` and `parseVmStatUsedBytes`: the final `top` sample and memory in use decoded,
 * and every missing machine-wide figure an error naming it rather than a zero.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { MachineSeriesErrors } from "../../../../live/machine/seriesErrors.js";
import { parseMachineSeriesTop, parseVmStatUsedBytes, topBytes } from "../../../../live/machine/seriesParse.js";
import { TOP_TEXT, VM_STAT_TEXT, VM_STAT_USED_BYTES } from "./seriesFixtures.js";

describe("topBytes", () => {
  it("reads each unit as a power of 1024", () => {
    expect(topBytes({ text: "7B" })).toBe(7);
    expect(topBytes({ text: "2048K" })).toBe(2_097_152);
    expect(topBytes({ text: "464M" })).toBe(486_539_264);
    expect(topBytes({ text: "1.5G" })).toBe(1_610_612_736);
  });

  it("refuses a figure with no unit or a change marker still on it", () => {
    expect(topBytes({ text: "464" })).toBe(undefined);
    expect(topBytes({ text: "464M+" })).toBe(undefined);
  });
});

describe("parseMachineSeriesTop", () => {
  it("reads the final sample only: its load, and each process with the change marker dropped", () => {
    const snapshot = unwrap(parseMachineSeriesTop({ text: TOP_TEXT }));
    expect(snapshot.load).toEqual({ load1: 24.5, load15: 18, load5: 20.1 });
    expect(snapshot.processes).toEqual([
      { cpuPct: 50, footprintBytes: 100 * 1024 ** 2, pid: 100 },
      { cpuPct: 30.5, footprintBytes: 200 * 1024 ** 2, pid: 101 },
      { cpuPct: 120, footprintBytes: 1024 ** 3, pid: 200 },
      { cpuPct: 10, footprintBytes: 2048 * 1024, pid: 300 },
      { cpuPct: 5, footprintBytes: 10 * 1024 ** 2, pid: 400 },
      { cpuPct: 2, footprintBytes: 30 * 1024 ** 2, pid: 0 },
    ]);
  });

  it("reads the final sample's idle percentage off its CPU usage header", () => {
    expect(unwrap(parseMachineSeriesTop({ text: TOP_TEXT })).idlePct).toBe(40);
  });

  it("keeps idle as top printed it, so 19.96% stays under the 20% floor", () => {
    const text = TOP_TEXT.replace(
      "CPU usage: 40.0% user, 20.0% sys, 40.0% idle",
      "CPU usage: 80.04% user, 0.00% sys, 19.96% idle",
    );
    expect(unwrap(parseMachineSeriesTop({ text })).idlePct).toBe(19.96);
  });

  it("reads the final sample's idle, never the first sample's", () => {
    const text = TOP_TEXT.replace(
      "Load Avg: 1.00, 1.00, 1.00\n",
      "Load Avg: 1.00, 1.00, 1.00\nCPU usage: 10.0% user, 10.0% sys, 80.0% idle\n",
    );
    expect(unwrap(parseMachineSeriesTop({ text })).idlePct).toBe(40);
  });

  it("leaves idle undefined, and the load still read, when the final sample has no CPU usage header", () => {
    const text = TOP_TEXT.replace("CPU usage: 40.0% user, 20.0% sys, 40.0% idle\n", "");
    const snapshot = unwrap(parseMachineSeriesTop({ text }));
    expect(snapshot.idlePct).toBeUndefined();
    expect(snapshot.load.load1).toBe(24.5);
  });

  it("leaves idle undefined when the header's percentages do not sum to 100", () => {
    const text = TOP_TEXT.replace("40.0% user, 20.0% sys, 40.0% idle", "40.0% user, 20.0% sys, 90.0% idle");
    expect(unwrap(parseMachineSeriesTop({ text })).idlePct).toBeUndefined();
  });

  it("refuses a print with one sample, whose %CPU measured nothing", () => {
    const first = TOP_TEXT.split("\n").slice(0, 7).join("\n");
    expect(unwrapErr(parseMachineSeriesTop({ text: first })).code).toBe("TOP_NO_SECOND_SAMPLE");
  });

  it("names a missing load line", () => {
    const text = TOP_TEXT.replace("Load Avg: 24.50, 20.10, 18.00", "");
    expect(unwrapErr(parseMachineSeriesTop({ text })).code).toBe("TOP_NO_LOAD");
  });

  it("names a missing process heading in the final sample", () => {
    const lines = TOP_TEXT.split("\n");
    const text = lines.toSpliced(lines.lastIndexOf("PID    %CPU MEM"), 1).join("\n");
    expect(unwrapErr(parseMachineSeriesTop({ text })).code).toBe("TOP_NO_PROCESS_HEADING");
  });
});

describe("parseVmStatUsedBytes", () => {
  it("sums app memory, wired and compressed pages at the printed page size, leaving the file cache out", () => {
    expect(unwrap(parseVmStatUsedBytes({ text: VM_STAT_TEXT }))).toBe(VM_STAT_USED_BYTES);
    expect(VM_STAT_USED_BYTES).toBe(27_033_600_000);
  });

  it("names a missing page size", () => {
    const text = VM_STAT_TEXT.replace("(page size of 16384 bytes)", "");
    expect(unwrapErr(parseVmStatUsedBytes({ text }))).toEqual(
      MachineSeriesErrors.vmStatIncomplete({ field: "page size" }),
    );
  });

  it("names the one line it is missing, rather than summing without it", () => {
    const text = VM_STAT_TEXT.replace(/^Pages occupied by compressor:.*$/mu, "");
    expect(unwrapErr(parseVmStatUsedBytes({ text }))).toEqual(
      MachineSeriesErrors.vmStatIncomplete({ field: "Pages occupied by compressor" }),
    );
  });
});
