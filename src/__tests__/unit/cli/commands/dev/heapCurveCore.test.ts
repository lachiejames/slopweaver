/**
 * The pure half of `dev heap-curve`: the arithmetic that turns phase readings into a curve, the verdict on the
 * shipped coefficient, and the rendering — all over hand-built samples, so the numbers are exact.
 */
import { describe, expect, it } from "vitest";
import {
  coefficientsCover,
  DEV_HEAP_CURVE_FLAG_NAMES,
  deriveHeapCurve,
  type HeapCurveSample,
  parseDevHeapCurveArgs,
  parseProjection,
  renderHeapCurve,
} from "../../../../../cli/commands/dev/heapCurveCore.js";
import { HEAP_BYTES_PER_DISK_BYTE } from "../../../../../corpus/corpusRowCore.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const MIB = 1024 * 1024;

const sample = ({ recordsLive }: { recordsLive: number }): HeapCurveSample => ({
  corpusDir: "/c/bronze",
  diskBytes: 100 * MIB,
  fileCount: 3,
  limitBytes: 1000 * MIB,
  phases: [
    { elapsedMs: 0, externalBytes: MIB, liveBytes: 10 * MIB, phase: "start" },
    { elapsedMs: 1000, externalBytes: MIB, liveBytes: recordsLive * MIB, phase: "records" },
  ],
  projection: "retrieval",
  recordCount: 1234,
});

describe("deriveHeapCurve", () => {
  it("derives the ratio from the delta, not the absolute reading", () => {
    const curve = deriveHeapCurve({ sample: sample({ recordsLive: 70 }) });
    expect(curve.recordsPerDiskByte).toBe(0.6);
    expect(curve.peakFractionOfLimit).toBe(0.07);
  });

  it("passes when the band brackets the records ratio", () => {
    const curve = deriveHeapCurve({ sample: sample({ recordsLive: 70 }) });
    expect(curve.coefficients.records).toEqual({
      ceiling: HEAP_BYTES_PER_DISK_BYTE.retrieval.ceiling,
      covers: true,
      floor: HEAP_BYTES_PER_DISK_BYTE.retrieval.floor,
      measured: 0.6,
    });
    expect(coefficientsCover({ curve })).toBe(true);
  });

  it("fails when the records ratio climbs past the band's ceiling", () => {
    const curve = deriveHeapCurve({ sample: sample({ recordsLive: 260 }) });
    expect(curve.recordsPerDiskByte).toBe(2.5);
    expect(curve.coefficients.records.covers).toBe(false);
    expect(coefficientsCover({ curve })).toBe(false);
  });

  it("fails when the records ratio falls below the band's floor — the preflight would over-project", () => {
    const curve = deriveHeapCurve({ sample: sample({ recordsLive: 20 }) });
    expect(curve.recordsPerDiskByte).toBe(0.1);
    expect(curve.coefficients.records.covers).toBe(false);
  });

  it("clamps a phase that settled below its predecessor to a zero ratio, never a negative coefficient", () => {
    // Measured on CI: a 50-record fixture read a NEGATIVE bytes-per-byte ratio because a collection between
    // the two readings freed something unrelated to the load.
    const curve = deriveHeapCurve({ sample: sample({ recordsLive: 5 }) });
    expect(curve.recordsPerDiskByte).toBe(0);
  });

  it("reads an empty corpus as a zero ratio rather than Infinity", () => {
    const empty: HeapCurveSample = { ...sample({ recordsLive: 10 }), diskBytes: 0, limitBytes: 0, phases: [] };
    const curve = deriveHeapCurve({ sample: empty });
    expect(curve.recordsPerDiskByte).toBe(0);
    expect(curve.peakFractionOfLimit).toBe(0);
  });
});

describe("renderHeapCurve", () => {
  it("prints the corpus, the ceiling, one row per phase, and the verdict line", () => {
    const lines = renderHeapCurve({ curve: deriveHeapCurve({ sample: sample({ recordsLive: 70 }) }) });
    expect(lines[0]).toBe("corpus: /c/bronze — 3 file(s), 100 MiB on disk, 1234 record(s), retrieval projection");
    expect(lines[1]).toBe("ceiling: 1000 MiB (this process's --max-old-space-size, or V8's default)");
    expect(lines[3]).toBe("start            10       +0              1   0.0s");
    expect(lines[4]).toBe("records          70      +60              1   1.0s");
    expect(lines[5]).toBe("peak live heap is 7% of the ceiling");
    expect(lines[6]).toContain("records: 0.60 live bytes per disk byte — shipped band 0.35…1.80 brackets it");
  });

  it("names the constant to move when the verdict fails", () => {
    const lines = renderHeapCurve({ curve: deriveHeapCurve({ sample: sample({ recordsLive: 260 }) }) });
    expect(lines[6]).toContain("DOES NOT BRACKET IT: move HEAP_BYTES_PER_DISK_BYTE.retrieval");
  });
});

describe("parseProjection", () => {
  it("defaults to bronze, the projection every surviving whole-corpus pass takes", () => {
    expect(unwrap(parseProjection({ value: undefined }))).toBe("bronze");
  });

  it("names every accepted value when refusing one it does not know", () => {
    expect(unwrapErr(parseProjection({ value: "semantic" }))[0]).toContain("--projection must be one of");
  });
});

describe("parseDevHeapCurveArgs", () => {
  it("advertises exactly the flags it parses", () => {
    expect(DEV_HEAP_CURVE_FLAG_NAMES).toEqual(["--corpus", "--home", "--json", "--projection"]);
  });

  it("parses the flag tail it advertises", () => {
    const parsed = unwrap(parseDevHeapCurveArgs({ rest: ["--projection", "derive", "--json"] }));
    expect(parsed.values["projection"]).toBe("derive");
    expect(parsed.values["json"]).toBe(true);
  });
});
