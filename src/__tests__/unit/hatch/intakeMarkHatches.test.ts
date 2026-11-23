import { describe, expect, it } from "vitest";

import { INTAKE_MARK_HATCHES } from "../../../hatch/intakeMarkHatches.js";
import { ESCAPE_HATCHES } from "../../../hatch/registry.js";

describe("INTAKE_MARK_HATCHES", () => {
  it("declares the one witness-reuse row, spread into the register", () => {
    expect(INTAKE_MARK_HATCHES.length).toBeGreaterThan(0);
    expect(INTAKE_MARK_HATCHES.map((hatch) => hatch.id)).toEqual(["intake-witness-reuse"]);
    expect(ESCAPE_HATCHES.filter((hatch) => hatch.id === "intake-witness-reuse").length).toBe(1);
  });

  it("keeps the hatch ambient on its env key, read by the intake-mark verb", () => {
    const row = INTAKE_MARK_HATCHES.find((hatch) => hatch.id === "intake-witness-reuse")!;
    expect(row.key).toEqual({ kind: "env", variable: "SLOPWEAVER_ALLOW_INTAKE_WITNESS_REUSE" });
    expect(row.lane).toBe("ambient");
    expect(row.reader).toBe("src/cli/commands/supervisor/intakeMarkRun.ts");
    expect(row.command).toBe("slopweaver supervisor intake-mark");
  });
});
