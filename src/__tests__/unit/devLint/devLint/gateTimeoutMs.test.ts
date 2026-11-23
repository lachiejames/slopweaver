import { describe, expect, it } from "vitest";
import { GATE_TIMEOUT_MS } from "../../../../devLint/gateRunner.js";

describe("GATE_TIMEOUT_MS", () => {
  // Measured: two `time yarn lint:local` laps ran the whole 45-gate lane in 220.8s and 273.2s,
  // slowest single gate prettier at 76.6s — so the ceiling sits above the ENTIRE lap and cannot fire on a
  // gate that is merely starved.
  it("stands above the whole measured lane, not above one gate's share of it", () => {
    expect(GATE_TIMEOUT_MS).toBe(600_000);
  });
});
