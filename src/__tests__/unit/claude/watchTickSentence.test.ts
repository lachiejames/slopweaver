/**
 * What one watch tick says — pure. `rotateTarget` reads a target only off a rotate that named one; `tickSentence`
 * words each outcome, the dead-slot cause with its instant when the slot's credential had one.
 */
import { describe, expect, it } from "vitest";

import type { TriggerOutcome } from "../../../claude/trigger.js";
import { rotateTarget, tickSentence } from "../../../claude/watchTickSentence.js";

const ROTATE: TriggerOutcome = {
  act: "rotate",
  decision: { excluded: [], from: "plan-one", kind: "rotate", to: "plan-two" },
  why: "plan-one's week is at 95%",
};
const SPENT: TriggerOutcome = {
  act: "rotate",
  decision: { excluded: [], kind: "all-exhausted" },
  why: "every plan is at its bar",
};
const HOLD: TriggerOutcome = { act: "hold", why: "plan-one is under its bar" };

describe("rotateTarget", () => {
  it("names the plan a rotate moves to, and none when every plan is spent or the tick holds", () => {
    expect(rotateTarget({ outcome: ROTATE })).toBe("plan-two");
    expect(rotateTarget({ outcome: SPENT })).toBe(undefined);
    expect(rotateTarget({ outcome: HOLD })).toBe(undefined);
  });
});

describe("tickSentence", () => {
  it("recommends the target rather than claiming a rotation", () => {
    expect(tickSentence({ active: "plan-one", activeFrom: "pinned", outcome: ROTATE, target: "plan-two" })).toBe(
      "RECOMMENDING plan-two as the plan to boot against — plan-one's week is at 95%",
    );
  });

  it("says every plan is spent on a rotate with no target, and names a downgrade", () => {
    expect(tickSentence({ activeFrom: "pinned", outcome: SPENT })).toBe(
      "every plan is spent, so there is nothing to rotate onto — every plan is at its bar",
    );
    expect(tickSentence({ activeFrom: "pinned", outcome: { act: "downgrade-model", why: "Fable is spent" } })).toBe(
      "the plan is healthy and one model on it is spent — Fable is spent",
    );
  });

  it("names a dead slot's expiry instant, or that it held no usable credential", () => {
    const tail =
      ", so no session is authenticating with it and there is no active plan to hold or move — " +
      "keep-alive is not held back on that account";
    expect(tickSentence({ activeFrom: "none", activeSlotExpiryIso: "2026-09-08T09:27:11.000Z", outcome: HOLD })).toBe(
      `the active slot's credential expired 2026-09-08T09:27:11.000Z${tail}`,
    );
    expect(tickSentence({ activeFrom: "none", outcome: HOLD })).toBe(
      `the active slot holds no usable credential${tail}`,
    );
  });

  it("says no plan is active when no source named one, else the trigger's own reason", () => {
    expect(tickSentence({ activeFrom: "unknown", outcome: HOLD })).toBe(
      "no plan could be identified as active, so there is nothing to hold or move",
    );
    expect(tickSentence({ active: "plan-one", activeFrom: "identified", outcome: HOLD })).toBe(
      "plan-one is under its bar",
    );
  });
});
