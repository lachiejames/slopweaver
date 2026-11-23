import { describe, expect, it } from "vitest";

import { HANDOVER_REGISTER_HATCHES } from "../../../hatch/handoverRegisterHatches.js";
import { ESCAPE_HATCHES } from "../../../hatch/registry.js";

describe("HANDOVER_REGISTER_HATCHES", () => {
  it("declares handover register's rows, in their register order", () => {
    expect(HANDOVER_REGISTER_HATCHES.length).toBeGreaterThan(0);
    expect(HANDOVER_REGISTER_HATCHES.map((hatch) => hatch.id)).toEqual([
      "anchor-attribution",
      "proof-witness",
      "stale-seat-finding",
    ]);
  });

  it("is spread into the one register at its head, where the rows were typed", () => {
    expect(ESCAPE_HATCHES.slice(0, 3).map((hatch) => hatch.id)).toEqual([
      "anchor-attribution",
      "proof-witness",
      "stale-seat-finding",
    ]);
  });

  it("keeps the proof-witness hatch ambient on its env key, read by the settle's proof gate", () => {
    const row = HANDOVER_REGISTER_HATCHES.find((hatch) => hatch.id === "proof-witness")!;
    expect(row.key).toEqual({ kind: "env", variable: "SLOPWEAVER_ALLOW_UNPROVEN_ANSWER" });
    expect(row.lane).toBe("ambient");
    expect(row.reader).toBe("src/cli/commands/handover/proofWitnessGate.ts");
  });

  it("keeps the anchor-attribution hatch ambient on its env key, read by the register gate", () => {
    const row = HANDOVER_REGISTER_HATCHES.find((hatch) => hatch.id === "anchor-attribution")!;
    expect(row.key).toEqual({ kind: "env", variable: "SLOPWEAVER_ALLOW_ANCHOR_ATTRIBUTION" });
    expect(row.lane).toBe("ambient");
    expect(row.reader).toBe("src/cli/commands/handover/anchorAttributionGate.ts");
  });
});
