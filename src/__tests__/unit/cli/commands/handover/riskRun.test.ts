/**
 * `handover risk`'s pure half: what one invocation asked to record. A risk must name the uncertainty,
 * so one with no reason is refused rather than journalled. The verb's write and its in-process fire are the
 * replay lane's (`subprocess/replay/explicitSteerHold.test.ts`), since they stamp the wall clock.
 */
import { describe, expect, it } from "vitest";

import { riskPlan } from "../../../../../cli/commands/handover/riskRun.js";

describe("riskPlan", () => {
  it("records a named risk, and a cleared one with --clear", () => {
    expect([
      riskPlan({ positionals: ["sup-4293"], values: { why: "  the GCP sign-in is the owner's  " } }),
      riskPlan({ positionals: ["sup-4293"], values: { clear: true, why: "the owner signed in" } }),
    ]).toEqual([
      { slug: "sup-4293", standing: "at-risk", why: "the GCP sign-in is the owner's" },
      { slug: "sup-4293", standing: "cleared", why: "the owner signed in" },
    ]);
  });

  it("refuses no slug, a second slug, and a missing or blank reason", () => {
    expect([
      riskPlan({ positionals: [], values: { why: "x" } }),
      riskPlan({ positionals: ["a", "b"], values: { why: "x" } }),
      riskPlan({ positionals: ["a"], values: {} }),
      riskPlan({ positionals: ["a"], values: { why: " " } }),
    ]).toEqual([
      { refusal: "which row? Pass its slug" },
      { refusal: 'one row at a time — "b" is not a flag this verb reads' },
      { refusal: "--why is required — what the uncertainty is, in a sentence the owner can act on" },
      { refusal: "--why is required — what the uncertainty is, in a sentence the owner can act on" },
    ]);
  });
});
