import { describe, expect, it } from "vitest";
import { gateHungLine } from "../../../../devLint/gateRunner.js";

describe("gateHungLine", () => {
  it("names the gate, the ceiling and the command that re-runs it alone", () => {
    expect(gateHungLine({ name: "door-coverage", timeoutMs: 600_000 })).toBe(
      "dev lint: door-coverage HUNG — no exit after 600.0s, killed. It is waiting on something that will " +
        "never arrive, not running slowly; re-run `slopweaver dev lint --only door-coverage` to see it alone.",
    );
  });
});
