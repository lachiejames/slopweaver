/**
 * What `turn status --plan` and `--step` accept — and the refusals that keep the card's outline bounded above
 * the fold rather than clipped to fit.
 */
import { describe, expect, it } from "vitest";

import { type Result, unwrap, unwrapErr } from "../../../../lib/result.js";
import { CARD_LINE_CAP, clampVisible } from "../../../../live/turn/answer.js";
import { PLAN_STEP_TITLE_MAX, PLAN_STEPS_MAX } from "../../../../live/turn/liveStatusCap.js";
import { parsePlanSteps, parseStepFlag } from "../../../../live/turn/progressPlan.js";
import { type TurnError, turnErrorLines } from "../../../../live/turn/turnErrors.js";

/** The refusal's lines, as the verb prints them. */
const refusal = ({ result }: { result: Result<unknown, TurnError> }): readonly string[] =>
  turnErrorLines({ error: unwrapErr(result) });

describe("parsePlanSteps", () => {
  it("reads one step per line, trimmed, blank lines dropped", () => {
    expect(unwrap(parsePlanSteps({ raw: "  Read the thread \n\nCheck GitHub\n" }))).toEqual([
      "Read the thread",
      "Check GitHub",
    ]);
  });

  it("refuses a plan with no step", () => {
    expect(refusal({ result: parsePlanSteps({ raw: " \n " }) })).toEqual([
      "--plan holds no step: write one step per line",
    ]);
  });

  it("accepts exactly the most steps the outline draws", () => {
    const raw = Array.from({ length: PLAN_STEPS_MAX }, (_, index) => `step ${String(index)}`).join("\n");
    expect(unwrap(parsePlanSteps({ raw }))).toHaveLength(PLAN_STEPS_MAX);
  });

  it("refuses one step more, naming the count", () => {
    const raw = Array.from({ length: PLAN_STEPS_MAX + 1 }, (_, index) => `step ${String(index)}`).join("\n");
    const result = parsePlanSteps({ raw });
    expect(unwrapErr(result).code).toBe("PLAN_REFUSED");
    expect(refusal({ result })).toEqual([
      "--plan holds 8 steps and the card draws at most 7 above the fold — merge steps until the plan reads at a glance",
    ]);
  });

  it("refuses a step title past the cap, counting characters rather than UTF-16 units", () => {
    const fits = "✓".repeat(PLAN_STEP_TITLE_MAX);
    expect(unwrap(parsePlanSteps({ raw: fits }))).toEqual([fits]);
    expect(refusal({ result: parsePlanSteps({ raw: `ok\n${"x".repeat(PLAN_STEP_TITLE_MAX + 1)}` }) })).toEqual([
      "--plan step 2 is 61 characters and a step is at most 60 — name the step, and put what it finds in --status",
    ]);
  });

  it("refuses a title the card would clamp, so an accepted step is never cut above the fold", () => {
    // Counted in code points: at most two UTF-16 units each, so an accepted title never reaches the clamp.
    expect(PLAN_STEP_TITLE_MAX * 2).toBeLessThanOrEqual(CARD_LINE_CAP);
    const flags = `Ship to ${"🇦🇺".repeat(47)}`;
    expect(refusal({ result: parsePlanSteps({ raw: flags }) })).toEqual([
      "--plan step 1 is 102 characters and a step is at most 60 — name the step, and put what it finds in --status",
    ]);
    // Alternating, because a run of one repeated symbol is a divider the card strips on purpose.
    const widest = "😀🚀".repeat(PLAN_STEP_TITLE_MAX / 2);
    expect(clampVisible({ cap: CARD_LINE_CAP, text: unwrap(parsePlanSteps({ raw: widest }))[0]! })).toBe(widest);
  });

  it("names every reason at once", () => {
    const raw = [...Array.from({ length: PLAN_STEPS_MAX }, () => "s"), "y".repeat(PLAN_STEP_TITLE_MAX + 1)].join("\n");
    expect(refusal({ result: parsePlanSteps({ raw }) })).toHaveLength(2);
  });
});

describe("parseStepFlag", () => {
  it("reads a step inside the plan", () => {
    expect(unwrap(parseStepFlag({ planLength: 3, raw: " 2 " }))).toBe(2);
  });

  it("refuses a step outside the plan, or not a whole number", () => {
    for (const raw of ["0", "4", "1.5", "two", ""]) {
      expect(refusal({ result: parseStepFlag({ planLength: 3, raw }) })).toEqual([
        `--step must be a whole number from 1 to 3, the plan's steps, but got \`${raw}\``,
      ]);
    }
  });

  it("refuses any step when no plan stands", () => {
    expect(refusal({ result: parseStepFlag({ planLength: undefined, raw: "1" }) })).toEqual([
      "--step names a step of a plan, and this turn has declared none — pass --plan first",
    ]);
  });
});
