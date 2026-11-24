import { describe, expect, it } from "vitest";
import { EXIT_ERROR, EXIT_OK } from "../../../../cli/exitCodes.js";
import type { LintCheck, LintRun } from "../../../../devLint/devLint.js";
import { lapClose } from "../../../../devLint/lintVerdict.js";

const FINDING = "src/__tests__/unit/example.test.ts: asserts 3 fewer matcher(s) than at the base";
const CLEAN: LintCheck = { args: [], cmd: "/bin/clean-gate", name: "clean-gate" };
const EXAMPLE: LintCheck = { args: [], cmd: "/bin/example", name: "example" };

/** A whole-lane run of the two synthetic gates, narrowed or not. */
function run({ partial }: { partial: boolean }): LintRun {
  return {
    lane: "full",
    laneScope: { ran: 2, total: 2 },
    partial,
    running: [CLEAN, EXAMPLE],
    skipped: [],
    uncovered: [],
  };
}

describe("lapClose", () => {
  it("repeats a failed gate's finding directly above the verdict, which is the last line", () => {
    const close = lapClose({
      concurrency: 4,
      results: [
        { elapsedMs: 1000, name: "clean-gate", ok: true },
        { elapsedMs: 2000, name: "example", ok: false, output: `${FINDING}\n` },
      ],
      run: run({ partial: false }),
      totalGates: 2,
      wallMs: 2000,
    });

    expect(close.exit).toBe(EXIT_ERROR);
    expect(close.lines).toEqual([
      "dev lint:",
      "  ✓ clean-gate (1.0s)",
      "  ✗ example (2.0s)",
      "dev lint: 3.0s of gate time in 2.0s of wall time — 1.50x, against 1.00x for a serial lap (ceiling 4x).",
      "dev lint: example FAILED — what it printed, repeated from its section:",
      `  ${FINDING}`,
      "dev lint: FAIL",
    ]);
  });

  it("prints no recap on a green lap, and keeps the --only scope line above the verdict", () => {
    const close = lapClose({
      concurrency: 4,
      results: [
        { elapsedMs: 1000, name: "clean-gate", ok: true },
        { elapsedMs: 1000, name: "example", ok: true },
      ],
      run: run({ partial: true }),
      totalGates: 9,
      wallMs: 1000,
    });

    expect(close.exit).toBe(EXIT_OK);
    expect(close.lines).toEqual([
      "dev lint:",
      "  ✓ clean-gate (1.0s)",
      "  ✓ example (1.0s)",
      "dev lint: 2.0s of gate time in 1.0s of wall time — 2.00x, against 1.00x for a serial lap (ceiling 4x).",
      "dev lint: --only ran 2 of 9 gates, NOT the whole bar: clean-gate, example",
      "dev lint: PASS",
    ]);
  });
});
