/*
 * `buildSlackWritePlan`: an automation prompt's no-fold message recurs by design, and a plain no-fold message
 * goes out once.
 */
import { describe, expect, it } from "vitest";

import { planFor } from "./harness.js";

describe("buildSlackWritePlan — a no-fold message's recurrence", () => {
  it("marks an automation prompt as recurring by design, and a plain no-fold message as once", () => {
    const prompt = JSON.stringify({
      kind: "automation-prompt",
      prompt: "Daily Datadog hunt for big problems nobody is talking about.",
      recipeId: "datadog-regression-hunt-daily",
    });
    const plain = JSON.stringify({
      kind: "no-fold",
      lead: [{ text: "Two things to do before Friday.", type: "text" }],
    });
    expect(planFor({ form: prompt })).toMatchObject({ kind: "no-fold", recurrence: "automation-prompt" });
    expect(planFor({ form: plain })).toMatchObject({ kind: "no-fold", recurrence: "once" });
  });
});
