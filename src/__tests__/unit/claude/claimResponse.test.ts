import { describe, expect, it } from "vitest";

import { responseToClaim } from "../../../claude/claimResponse.js";

describe("responseToClaim", () => {
  it("rotates the plan on a five-hour wall, for either seat", () => {
    expect(responseToClaim({ claim: "five_hour", seat: "worker" })).toBe("rotate-plan");
    expect(responseToClaim({ claim: "five_hour", seat: "supervisor-chair" })).toBe("rotate-plan");
  });

  it("rotates the plan on a weekly wall, for either seat", () => {
    expect(responseToClaim({ claim: "seven_day", seat: "worker" })).toBe("rotate-plan");
    expect(responseToClaim({ claim: "seven_day", seat: "supervisor-chair" })).toBe("rotate-plan");
  });

  it("downgrades the model for a WORKER hitting a per-model wall, rather than burning a plan", () => {
    expect(responseToClaim({ claim: "seven_day_opus", seat: "worker" })).toBe("downgrade-model");
    expect(responseToClaim({ claim: "seven_day_sonnet", seat: "worker" })).toBe("downgrade-model");
  });

  it("ROTATES THE PLAN for the supervisor chair on a per-model wall — the owner's 'stay on Fable' ruling", () => {
    expect(responseToClaim({ claim: "seven_day_opus", seat: "supervisor-chair" })).toBe("rotate-plan");
    expect(responseToClaim({ claim: "seven_day_sonnet", seat: "supervisor-chair" })).toBe("rotate-plan");
  });

  it("differs by seat on a per-model wall, which is the whole point of the rule", () => {
    const chair = responseToClaim({ claim: "seven_day_opus", seat: "supervisor-chair" });
    const worker = responseToClaim({ claim: "seven_day_opus", seat: "worker" });
    expect(chair).not.toBe(worker);
  });

  it("never answers a plan-wide wall by changing model, which would leave the plan spent", () => {
    for (const seat of ["worker", "supervisor-chair"] as const) {
      expect(responseToClaim({ claim: "seven_day", seat })).not.toBe("downgrade-model");
    }
  });
});
