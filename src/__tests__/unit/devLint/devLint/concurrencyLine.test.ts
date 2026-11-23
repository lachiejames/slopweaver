import { describe, expect, it } from "vitest";
import { concurrencyLine } from "../../../../devLint/gateRunner.js";

describe("concurrencyLine", () => {
  // A faster lap is not evidence that concurrency engaged — a quiet machine reads the same. The ratio is.
  it("reports the ratio of summed gate time to wall time", () => {
    expect(
      concurrencyLine({
        concurrency: 4,
        results: [
          { elapsedMs: 4000, name: "a", ok: true },
          { elapsedMs: 4000, name: "b", ok: true },
        ],
        wallMs: 4000,
      }),
    ).toBe("dev lint: 8.0s of gate time in 4.0s of wall time — 2.00x, against 1.00x for a serial lap (ceiling 4x).");
  });

  it("reads 1.00x for a lap that overlapped nothing, which is what the serial loop always did", () => {
    expect(
      concurrencyLine({ concurrency: 4, results: [{ elapsedMs: 3000, name: "a", ok: true }], wallMs: 3000 }),
    ).toContain("1.00x");
  });

  it("counts a gate carrying no timing as zero rather than dropping the lap's own wall time", () => {
    expect(concurrencyLine({ concurrency: 4, results: [{ name: "a", ok: false }], wallMs: 2000 })).toBe(
      "dev lint: 0.0s of gate time in 2.0s of wall time — 0.00x, against 1.00x for a serial lap (ceiling 4x).",
    );
  });

  it("answers 0.00x rather than dividing by a zero wall time", () => {
    expect(concurrencyLine({ concurrency: 16, results: [{ elapsedMs: 5, name: "a", ok: true }], wallMs: 0 })).toContain(
      "0.00x",
    );
  });
});
