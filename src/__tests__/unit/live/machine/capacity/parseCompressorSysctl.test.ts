import { describe, expect, it } from "vitest";
import { parseCompressorSysctl } from "../../../../../live/machine/capacityParse.js";
import { HEALTHY_COMPRESSOR_TEXT, PANIC_COMPRESSOR_TEXT } from "./fixtures.js";

describe("parseCompressorSysctl", () => {
  it("decodes the segment ratio and the compressed-pages ratio as whole percentages", () => {
    expect(parseCompressorSysctl({ text: HEALTHY_COMPRESSOR_TEXT })).toEqual({
      compressedPagesPct: 4,
      segmentsLimit: 1_234_946,
      segmentsPct: 15,
      segmentsUsed: 182_761,
    });
  });

  it("reads the panic's own state as 100% of the segments limit and 39% of the pages limit", () => {
    const gauge = parseCompressorSysctl({ text: PANIC_COMPRESSOR_TEXT })!;
    expect(gauge.segmentsPct).toBe(100);
    expect(gauge.compressedPagesPct).toBe(39);
  });

  it("carries the segment ratio alone when the compressed-pages oids are absent", () => {
    const text = "vm.compressor.segment.total: 100\nvm.compressor.segment.limit: 400\n";
    expect(parseCompressorSysctl({ text })).toEqual({
      compressedPagesPct: undefined,
      segmentsLimit: 400,
      segmentsPct: 25,
      segmentsUsed: 100,
    });
  });

  it("returns undefined when either segment oid is missing", () => {
    expect(parseCompressorSysctl({ text: "vm.compressor.segment.total: 100\n" })).toBeUndefined();
  });

  it("returns undefined when the limit is zero, rather than dividing by it", () => {
    expect(
      parseCompressorSysctl({ text: "vm.compressor.segment.total: 0\nvm.compressor.segment.limit: 0\n" }),
    ).toBeUndefined();
  });

  it("does not let a dotted oid match its underscored cousin", () => {
    const text = "vm.compressor_segment_total: 5\nvm.compressor.segment.limit: 10\n";
    expect(parseCompressorSysctl({ text })).toBeUndefined();
  });
});
