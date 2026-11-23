/**
 * The rotation a `claude watch` tick recommends is reported, never performed, and its line says both.
 */
import { describe, expect, it } from "vitest";
import { rotationLines } from "../../../../../cli/commands/claude/watchRotation.js";

describe("rotationLines", () => {
  it("names the recommendation, its scope and that nothing was performed", () => {
    expect(
      rotationLines({
        rotation: { from: "plan-one", rotationScope: "default-slot", status: "retired", to: "plan-two" },
      }),
    ).toStrictEqual([
      "rotation RETIRED: RECOMMENDED from plan-one onto plan-two (scope default-slot) — nothing was performed, " +
        "because the credential copy is retired and a session spends a plan by being booted against its store, " +
        "which the pre-spawn gate chooses",
    ]);
  });

  it("says nothing when the tick recommended no rotation", () => {
    expect(rotationLines({})).toStrictEqual([]);
  });
});
