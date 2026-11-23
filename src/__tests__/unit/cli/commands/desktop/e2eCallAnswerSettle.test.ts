import { describe, expect, it } from "vitest";

import { stillnessStep } from "../../../../../cli/commands/desktop/e2eCallAnswerSettle.js";

const ANSWER = [
  { text: "who writes the briefing?", who: "owner" },
  { text: "I read the configuration but", who: "voice" },
] as const;
const LONGER = [...ANSWER, { text: "the fleet writes that briefing, not me.", who: "voice" }] as const;

describe("holding a call up until its answer is still", () => {
  it("restarts the clock on the first read, and is not yet still", () => {
    const step = stillnessStep({ now: 1_000, rows: ANSWER, state: { changedAt: 0, last: undefined } });
    expect(step).toEqual({ state: { changedAt: 1_000, last: ANSWER }, still: false });
  });

  it("keeps the clock on an unchanged read, and is still once 20s have held", () => {
    const step = stillnessStep({ now: 21_000, rows: [...ANSWER], state: { changedAt: 1_000, last: ANSWER } });
    expect(step).toEqual({ state: { changedAt: 1_000, last: ANSWER }, still: true });
  });

  it("is not still one millisecond short of 20s", () => {
    const step = stillnessStep({ now: 20_999, rows: ANSWER, state: { changedAt: 1_000, last: ANSWER } });
    expect(step.still).toBe(false);
  });

  it("restarts the clock when a row is added, however long the old rows held", () => {
    const step = stillnessStep({ now: 30_000, rows: LONGER, state: { changedAt: 1_000, last: ANSWER } });
    expect(step).toEqual({ state: { changedAt: 30_000, last: LONGER }, still: false });
  });
});
