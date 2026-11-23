import { describe, expect, it } from "vitest";

import { compressorSegmentsPctOf, cpuTimeMsOf, parseArgvRows, parseProcessStats } from "../../lib/liveMachineParse";

describe("cpuTimeMsOf", () => {
  it("reads macOS's minutes past sixty, to the hundredth", () => {
    expect(cpuTimeMsOf({ time: "4571:18.13" })).toBe(274_278_130);
    expect(cpuTimeMsOf({ time: "0:00.00" })).toBe(0);
  });

  it("reads an hours and a days form", () => {
    expect(cpuTimeMsOf({ time: "1:02:03" })).toBe(3_723_000);
    expect(cpuTimeMsOf({ time: "2-01:00:00" })).toBe((2 * 24 + 1) * 3_600_000);
  });

  it("refuses a shape neither form is", () => {
    expect(cpuTimeMsOf({ time: "12" })).toBe(undefined);
    expect(cpuTimeMsOf({ time: "abc" })).toBe(undefined);
  });
});

describe("parseProcessStats", () => {
  it("keeps comm's spaces and counts what will not decode", () => {
    const text = [
      "  101     1   12:30.50   20480 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "  202   101    0:01.00    1024 /bin/zsh",
      "garbage line",
      "  303   101  notatime    1024 /bin/sh",
      "",
    ].join("\n");
    expect(parseProcessStats({ text })).toEqual({
      refused: 2,
      rows: [
        {
          comm: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          cpuTimeMs: 750_500,
          pid: 101,
          ppid: 1,
          residentBytes: 20_480 * 1024,
        },
        { comm: "/bin/zsh", cpuTimeMs: 1000, pid: 202, ppid: 101, residentBytes: 1024 * 1024 },
      ],
    });
  });

  it("reads nothing from nothing", () => {
    expect(parseProcessStats({ text: "" })).toEqual({ refused: 0, rows: [] });
  });
});

describe("parseArgvRows", () => {
  it("keeps every pid's whole command line", () => {
    const argv = parseArgvRows({ text: "  7 claude --session-id abc\n 8 /bin/zsh -c ls\n" });
    expect([...argv]).toEqual([
      [7, "claude --session-id abc"],
      [8, "/bin/zsh -c ls"],
    ]);
  });
});

describe("compressorSegmentsPctOf", () => {
  it("is used against limit, whole", () => {
    const text = "vm.compressor.segment.total: 412\nvm.compressor.segment.limit: 1000\n";
    expect(compressorSegmentsPctOf({ text })).toBe(41);
  });

  it("is unread when a line is absent or the limit is zero", () => {
    expect(compressorSegmentsPctOf({ text: "vm.compressor.segment.total: 412\n" })).toBe(undefined);
    expect(compressorSegmentsPctOf({ text: "vm.compressor.segment.total: 4\nvm.compressor.segment.limit: 0\n" })).toBe(
      undefined,
    );
  });
});
