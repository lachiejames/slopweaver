import { describe, expect, it } from "vitest";

import { PROOF_CAPTURE_HATCHES } from "../../../hatch/proofCaptureHatches.js";
import { ESCAPE_HATCHES } from "../../../hatch/registry.js";

describe("PROOF_CAPTURE_HATCHES", () => {
  it("declares the proof capture surface's rows, in their register order", () => {
    expect(PROOF_CAPTURE_HATCHES.length).toBeGreaterThan(0);
    expect(PROOF_CAPTURE_HATCHES.map((hatch) => hatch.id)).toEqual([
      "proof-output-in-tree",
      "slow-cassette",
      "page-lint",
    ]);
  });

  it("is spread into the one register, so a lookup by id finds each row", () => {
    const ids = ESCAPE_HATCHES.map((hatch) => hatch.id);
    expect(ids).toContain("proof-output-in-tree");
    expect(ids).toContain("slow-cassette");
  });

  it("keeps the slow-cassette hatch ambient on its env key, read by the cassette verb", () => {
    const row = PROOF_CAPTURE_HATCHES.find((hatch) => hatch.id === "slow-cassette")!;
    expect(row.key).toEqual({ kind: "env", variable: "SLOPWEAVER_ALLOW_SLOW_CASSETTE" });
    expect(row.lane).toBe("ambient");
    expect(row.reader).toBe("src/cli/commands/proof/cassette.ts");
  });
});
