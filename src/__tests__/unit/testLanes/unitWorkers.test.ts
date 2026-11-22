import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LAP_VITEST_MAX_WORKERS } from "../../../cli/commands/github/lapCore.js";
import { UNIT_LANE_MAX_WORKERS, unitLaneMaxWorkers } from "../../../testLanes/unitWorkers.js";

describe("unitLaneMaxWorkers — the unit lane's default worker count", () => {
  it("caps a 10-core machine at the lap's 4 off CI, never Vitest's 9", () => {
    expect(unitLaneMaxWorkers({ ci: false, cpus: 10 })).toBe(4);
  });

  it("keeps Vitest's own default under CI, where a lane owns its runner", () => {
    expect(unitLaneMaxWorkers({ ci: true, cpus: 16 })).toBe(15);
  });

  it("gives CI's 4-vCPU runner Vitest's 3 either way", () => {
    expect([unitLaneMaxWorkers({ ci: true, cpus: 4 }), unitLaneMaxWorkers({ ci: false, cpus: 4 })]).toEqual([3, 3]);
  });

  it("runs one worker on one core, as Vitest's floor does", () => {
    expect([unitLaneMaxWorkers({ ci: false, cpus: 1 }), unitLaneMaxWorkers({ ci: true, cpus: 1 })]).toEqual([1, 1]);
  });

  it("is the lap's own width, so the two cannot part", () => {
    expect(UNIT_LANE_MAX_WORKERS).toBe(LAP_VITEST_MAX_WORKERS);
  });
});

describe("the unit config's wiring", () => {
  it("sets maxWorkers from this machine's usable cores and CI", () => {
    // Read as TEXT: a file under `src/` importing `config/` fails the `compile` job with TS6059.
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
    const text = readFileSync(join(root, "config", "vitest", "unit.ts"), "utf8");
    expect(text).toContain('import { availableParallelism } from "node:os";');
    expect(text).toContain(
      'maxWorkers: unitLaneMaxWorkers({ ci: process.env["CI"] === "true", cpus: availableParallelism() }),',
    );
  });
});
