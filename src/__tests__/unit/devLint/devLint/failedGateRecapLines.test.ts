import { describe, expect, it } from "vitest";
import { failedGateRecapLines, RECAP_LINES_PER_GATE } from "../../../../devLint/lintVerdict.js";

const FINDING = "  src/__tests__/unit/example.test.ts: asserts 3 fewer matcher(s) than at the base";
const REFUSAL = "Passing dev lint is blocked because the `example` gate caught a weakened test.";

describe("failedGateRecapLines", () => {
  it("repeats a failed gate's finding and refusal under a line naming the gate, blank lines dropped", () => {
    const lines = failedGateRecapLines({
      results: [
        { name: "clean-gate", ok: true },
        { name: "example", ok: false, output: `${FINDING}\n\n${REFUSAL}\n` },
      ],
    });

    expect(lines).toEqual([
      "dev lint: example FAILED — what it printed, repeated from its section:",
      `  ${FINDING}`,
      `  ${REFUSAL}`,
    ]);
  });

  it("is empty when every gate that ran passed", () => {
    expect(failedGateRecapLines({ results: [{ name: "clean-gate", ok: true }] })).toEqual([]);
  });

  it("leaves out a withheld gate, which ran nothing and whose summary line carries its reason", () => {
    expect(failedGateRecapLines({ results: [{ name: "oxlint", ok: false, withheld: "a lap holds it" }] })).toEqual([]);
  });

  it("says so when a failed gate printed nothing at all", () => {
    expect(failedGateRecapLines({ results: [{ name: "silent", ok: false, output: "" }] })).toEqual([
      "dev lint: silent FAILED — what it printed, repeated from its section:",
      "  (nothing: its exit code alone failed it)",
    ]);
  });

  it("caps a long finding list and names how many more lines its section holds", () => {
    const output = Array.from({ length: RECAP_LINES_PER_GATE + 3 }, (_, index) => `finding ${String(index)}`).join(
      "\n",
    );

    const lines = failedGateRecapLines({ results: [{ name: "noisy", ok: false, output }] });

    expect(RECAP_LINES_PER_GATE).toBe(20);
    expect(lines).toHaveLength(RECAP_LINES_PER_GATE + 2);
    expect(lines[RECAP_LINES_PER_GATE]).toBe(`  finding ${String(RECAP_LINES_PER_GATE - 1)}`);
    expect(lines.at(-1)).toBe("  … 3 more line(s) under `dev lint: noisy` above");
  });
});
