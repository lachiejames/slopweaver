import { describe, expect, it } from "vitest";

import {
  PLAN_SIGN_IN_WITHOUT_EMAIL_HATCH,
  type PlanSignInVerdict,
  planSignInVerdict,
} from "../../../handover/planSignInGate.js";

const PLANS = [{ alias: "plan-five", email: "claude-five@slopweaver.ai" }] as const;
const COMMAND = "slopweaver handover ask";

/** The lines of a refusal, throwing on any other verdict so the assertion stays unconditional. */
function refusedLines({ verdict }: { verdict: PlanSignInVerdict }): readonly string[] {
  if (verdict.kind !== "refused") {
    throw new Error("expected a refusal");
  }
  return verdict.lines;
}

describe("planSignInVerdict", () => {
  it("refuses the free-reset question, which asked for a claude login on one plan named by no address", () => {
    const verdict = planSignInVerdict({
      command: COMMAND,
      env: {},
      plans: PLANS,
      texts: [
        "Will you do a normal claude login on one plan so the fleet can read and claim Claude's free resets?",
        "sign in one plan with a normal claude login, and the fleet measures whether its setup token keeps working",
      ],
    });
    expect(refusedLines({ verdict })[1]).toBe(
      "  - it asks the owner to sign into a Claude or Codex plan without naming which one by its email address — add the " +
        "address of the plan the owner signs into (one of claude-five@slopweaver.ai; `slopweaver plans list` pairs each with its alias)",
    );
  });

  it("passes the same question once it names the plan by its address", () => {
    expect(
      planSignInVerdict({
        command: COMMAND,
        env: {},
        plans: PLANS,
        texts: ["Will you do a normal claude login on claude-five@slopweaver.ai (plan-five)?"],
      }),
    ).toEqual({ kind: "ok" });
  });

  it("opens on its hatch", () => {
    expect(
      planSignInVerdict({
        command: COMMAND,
        env: { [PLAN_SIGN_IN_WITHOUT_EMAIL_HATCH]: "1" },
        plans: PLANS,
        texts: ["Will you sign into plan-five?"],
      }),
    ).toEqual({ kind: "ok" });
  });
});
