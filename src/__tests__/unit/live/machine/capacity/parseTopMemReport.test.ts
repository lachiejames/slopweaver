import { describe, expect, it } from "vitest";
import { parseTopMemReport } from "../../../../../live/machine/capacityParse.js";
import { SAMPLE_TOP_TEXT } from "./fixtures.js";

describe("parseTopMemReport", () => {
  it("decodes the load-average header line", () => {
    const decoded = parseTopMemReport({ text: SAMPLE_TOP_TEXT });
    expect(decoded.load).toEqual({ load1: 5.43, load15: 14.23, load5: 9.74 });
  });

  it("decodes every process row, in top's own order, converting M/K to exact bytes", () => {
    const decoded = parseTopMemReport({ text: SAMPLE_TOP_TEXT });
    expect(decoded.processes).toEqual([
      { footprintBytes: 20_656_947_200, pid: 100 },
      { footprintBytes: 524_288_000, pid: 200 },
      { footprintBytes: 901_120, pid: 300 },
    ]);
  });

  it("keeps a row carrying top's change marker, so a heavy process is never dropped from the ranked list", () => {
    const decoded = parseTopMemReport({ text: "PID    MEM  \n700    40G+\n345    32G-\n88556  1024M\n" });
    expect(decoded.processes).toEqual([
      { footprintBytes: 40 * 1024 ** 3, pid: 700 },
      { footprintBytes: 32 * 1024 ** 3, pid: 345 },
      { footprintBytes: 1024 ** 3, pid: 88556 },
    ]);
  });

  it("reports no load average when the header line is absent", () => {
    const decoded = parseTopMemReport({ text: "PID    MEM  \n100    1M" });
    expect(decoded.load).toBeUndefined();
  });
});
