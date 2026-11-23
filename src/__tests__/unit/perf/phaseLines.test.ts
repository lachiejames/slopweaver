import { describe, expect, it } from "vitest";
import { parsePhaseLines, peakPhaseMib } from "../../../perf/phaseLines.js";

/**
 * Verbatim output of
 * `SLOPWEAVER_HEAP_PHASES=1 yarn tsx --expose-gc --max-old-space-size=8192 src/devLint/namedObjectParams.entry.ts`,
 * measured — interleaved with the gate's own verdict lines, which is what the parser really meets.
 */
const REAL_OUTPUT = [
  "named-object-params: clean (6716 sources scanned, live heap 3830 MiB of a 3950 MiB budget)",
  "named-object-params phase: createProgram        2314 MiB",
  "named-object-params files: loaded 18642 (122 MiB text), in-scope 6716 (60 MiB), vendored 11926 (62 MiB)",
  "named-object-params phase: rule scan            3830 MiB",
].join("\n");

describe("parsePhaseLines", () => {
  it("reads both phase marks out of a real run and skips every other line", () => {
    expect(parsePhaseLines({ text: REAL_OUTPUT })).toEqual([
      { label: "createProgram", liveMib: 2314, subject: "named-object-params" },
      { label: "rule scan", liveMib: 3830, subject: "named-object-params" },
    ]);
  });

  it("keeps a multi-word label intact", () => {
    expect(parsePhaseLines({ text: "gate phase: semantic pass            99 MiB" })).toEqual([
      { label: "semantic pass", liveMib: 99, subject: "gate" },
    ]);
  });

  it("reports an unmeasured phase as unmeasured rather than as zero", () => {
    expect(parsePhaseLines({ text: "gate phase: createProgram        unmeasured (no --expose-gc)" })).toEqual([
      { label: "createProgram", liveMib: undefined, subject: "gate" },
    ]);
  });

  it("finds nothing in output that carries no marks", () => {
    expect(parsePhaseLines({ text: "jsdoc-tags: clean (6761 sources scanned)\n\n" })).toEqual([]);
  });

  it("refuses a line whose subject is not one word, so prose mentioning the marker is not a reading", () => {
    expect(parsePhaseLines({ text: "the second phase: createProgram        12 MiB" })).toEqual([]);
  });

  it("refuses a MiB line whose figure is not a number", () => {
    expect(parsePhaseLines({ text: "gate phase: scan        lots MiB" })).toEqual([]);
  });

  it("survives a carriage return, because a spawned child's output is not normalised", () => {
    expect(parsePhaseLines({ text: "gate phase: scan        7 MiB\r\n" })).toEqual([
      { label: "scan", liveMib: 7, subject: "gate" },
    ]);
  });
});

describe("peakPhaseMib", () => {
  it("takes the highest phase, not the last one", () => {
    const readings = [
      { label: "a", liveMib: 100, subject: "g" },
      { label: "b", liveMib: 900, subject: "g" },
      { label: "c", liveMib: 300, subject: "g" },
    ];
    expect(peakPhaseMib({ readings })).toBe(900);
  });

  it("reports nothing when no phase could be measured", () => {
    expect(peakPhaseMib({ readings: [{ label: "a", liveMib: undefined, subject: "g" }] })).toBeUndefined();
  });

  it("reports nothing for an empty run", () => {
    expect(peakPhaseMib({ readings: [] })).toBeUndefined();
  });

  it("ignores the unmeasured phases beside a measured one", () => {
    const readings = [
      { label: "a", liveMib: undefined, subject: "g" },
      { label: "b", liveMib: 42, subject: "g" },
    ];
    expect(peakPhaseMib({ readings })).toBe(42);
  });
});
