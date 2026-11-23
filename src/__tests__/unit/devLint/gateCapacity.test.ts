import { describe, expect, it } from "vitest";
import { gateConcurrency, KNEE_CONCURRENCY, RUNNER_FLOOR_MIB } from "../../../devLint/gateCapacity.js";
import { HEAP_BUDGET_MIB } from "../../../devLint/namedObjectParamsHeap.js";

describe("RUNNER_FLOOR_MIB", () => {
  // The whole lint lap peaked at 10.1–10.4 GiB (runs 36253592098, 36254743988, 36256720224).
  it("holds the lint lap's measured peak and the exclusive gate's own heap budget", () => {
    expect(RUNNER_FLOOR_MIB).toBe(12_288);
    expect(RUNNER_FLOOR_MIB).toBeGreaterThan(10.4 * 1024);
    expect(RUNNER_FLOOR_MIB).toBeGreaterThan(HEAP_BUDGET_MIB);
  });
});

describe("gateConcurrency", () => {
  it("answers main's four at the floor", () => {
    expect(gateConcurrency({ cpus: 16, totalMib: RUNNER_FLOOR_MIB })).toBe(4);
  });

  // the larger runner's own runner facts, run 36246401008; the sweep's knee, run 36253592098.
  it("answers the knee's eight on the CI runner, not its sixteen CPUs", () => {
    expect(gateConcurrency({ cpus: 16, totalMib: 64297 })).toBe(KNEE_CONCURRENCY);
    expect(KNEE_CONCURRENCY).toBe(8);
  });

  it("is bounded by memory when memory runs out before CPUs do", () => {
    expect(gateConcurrency({ cpus: 16, totalMib: 18_432 })).toBe(6);
  });

  it("is bounded by CPUs when CPUs run out before memory does", () => {
    expect(gateConcurrency({ cpus: 6, totalMib: 32_768 })).toBe(6);
  });

  it("goes as narrow as the machine is, down to one, rather than oversubscribing a small one", () => {
    expect(gateConcurrency({ cpus: 2, totalMib: 6144 })).toBe(2);
    expect(gateConcurrency({ cpus: 1, totalMib: 512 })).toBe(1);
  });

  // A slot is a quarter of the floor, 3,072 MiB, so seven slots need exactly 21,504.
  it("adds a slot only at the first MiB that holds it", () => {
    expect(gateConcurrency({ cpus: 16, totalMib: 21_503 })).toBe(6);
    expect(gateConcurrency({ cpus: 16, totalMib: 21_504 })).toBe(7);
  });
});
