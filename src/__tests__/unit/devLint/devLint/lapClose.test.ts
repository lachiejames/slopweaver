import { describe, expect, it } from "vitest";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_OK } from "../../../../cli/exitCodes.js";
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
  it("repeats a failed gate's finding, then its narrowed re-check, above the verdict, which is the last line", () => {
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
      "dev lint: once fixed, re-check only what failed, one command per line:",
      "  slopweaver dev lint --lane full --only example",
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
      "dev lint: PASS — this narrowed run ran 2 of 9 gates.",
    ]);
  });

  it("closes a narrowed failure on the run's count, below its recap and re-check", () => {
    const close = lapClose({
      concurrency: 4,
      results: [
        { elapsedMs: 1000, name: "clean-gate", ok: true },
        { elapsedMs: 2000, name: "example", ok: false, output: `${FINDING}\n` },
      ],
      run: run({ partial: true }),
      totalGates: 9,
      wallMs: 2000,
    });

    expect(close.exit).toBe(EXIT_ERROR);
    expect(close.lines).toEqual([
      "dev lint:",
      "  ✓ clean-gate (1.0s)",
      "  ✗ example (2.0s)",
      "dev lint: 3.0s of gate time in 2.0s of wall time — 1.50x, against 1.00x for a serial lap (ceiling 4x).",
      "dev lint: --only ran 2 of 9 gates, NOT the whole bar: clean-gate, example",
      "dev lint: example FAILED — what it printed, repeated from its section:",
      `  ${FINDING}`,
      "dev lint: once fixed, re-check only what failed, one command per line:",
      "  slopweaver dev lint --lane full --only example",
      "dev lint: FAIL — this narrowed run ran 2 of 9 gates.",
    ]);
  });

  // The fleet finding: `--lane seat --only no-python` closed on "the seat lane ran 89 of 92 gates".
  it("counts a narrowed seat run's own gates, never the lane's, and keeps INCOMPLETE on a withheld one", () => {
    const close = lapClose({
      concurrency: 4,
      results: [{ name: "oxlint", ok: true, withheld: "a lap holds the machine" }],
      run: {
        lane: "seat",
        laneScope: { ran: 89, total: 92 },
        partial: true,
        running: [{ args: [], cmd: "/bin/oxlint", name: "oxlint" }],
        skipped: [],
        uncovered: ["named-object-params", "knip"],
      },
      totalGates: 92,
      wallMs: 0,
    });

    expect(close.exit).toBe(EXIT_DEFERRED);
    expect(close.lines.at(-2)).toBe("dev lint: --only ran 1 of 92 gates, NOT the whole bar: oxlint");
    expect(close.lines.at(-1)).toBe(
      "dev lint: INCOMPLETE (oxlint NOT run: withheld, the reason is above) — this narrowed seat run ran 1 of 92 " +
        "gates. The seat lane did NOT cover: named-object-params, knip. CI, or `slopweaver github lap` where hosted " +
        "Actions are off, runs them.",
    );
  });
});
