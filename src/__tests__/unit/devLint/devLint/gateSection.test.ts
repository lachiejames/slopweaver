import { describe, expect, it } from "vitest";
import { GATE_TIMEOUT_MS, gateHungLine, gateSection } from "../../../../devLint/gateRunner.js";

const FINDING = "  src/__tests__/unit/example.test.ts: asserts 3 fewer matcher(s) than at the base";
const REFUSAL = "Passing dev lint is blocked because the `example` gate caught a weakened test.";

describe("gateSection", () => {
  it("puts a gate's stderr finding directly under its own header, as one string for one stream", () => {
    const section = gateSection({
      outcome: { result: { name: "example", ok: false }, stderr: `${FINDING}\n${REFUSAL}\n`, stdout: "" },
    });

    expect(section).toBe(`\ndev lint: example\n${FINDING}\n${REFUSAL}\n`);
  });

  it("prints the gate's stdout before its stderr, both inside the section", () => {
    const section = gateSection({
      outcome: { result: { name: "example", ok: false }, stderr: `${REFUSAL}\n`, stdout: "example: 1 finding\n" },
    });

    expect(section).toBe(`\ndev lint: example\nexample: 1 finding\n${REFUSAL}\n`);
  });

  it("closes a gate killed at the ceiling with the hung line, still inside its section", () => {
    const section = gateSection({
      outcome: { result: { hung: true, name: "door-coverage", ok: false }, stderr: "", stdout: "" },
    });

    expect(section).toBe(
      `\ndev lint: door-coverage\n${gateHungLine({ name: "door-coverage", timeoutMs: GATE_TIMEOUT_MS })}\n`,
    );
  });

  it("is the header alone for a gate that printed nothing", () => {
    expect(gateSection({ outcome: { result: { name: "quiet", ok: true }, stderr: "", stdout: "" } })).toBe(
      "\ndev lint: quiet\n",
    );
  });
});
