/**
 * The planning loop read off a turn's timeline — the meter, the standing plan and the loop's phases. The
 * timeline below is the shape of the thread the owner watched: a first worker, a plan, a review
 * round, a fresh worker picking the work up, and a re-plan.
 */
import { describe, expect, it } from "vitest";

import type { ProgressTimelineEvent } from "../../../../live/turn/progressLog.js";
import {
  boundedPhases,
  boundedUpdates,
  LOOP_PHASE_UPDATES_MAX,
  LOOP_PHASES_MAX,
  type LoopPhase,
  loopView,
  meterLine,
} from "../../../../live/turn/progressLoop.js";

const at = ({ minute }: { minute: number }): string => `2026-10-02T08:${String(minute).padStart(2, "0")}:00.000Z`;

const LOOP: readonly ProgressTimelineEvent[] = [
  { kind: "stage", text: "reading the thread", tsIso: at({ minute: 0 }), worker: "w1" },
  { kind: "plan", steps: ["Find the monitor", "Instrument the test"], tsIso: at({ minute: 1 }) },
  { kind: "stage", step: 1, text: "monitor found", tsIso: at({ minute: 2 }), worker: "w1" },
  { kind: "review", round: 1, tsIso: at({ minute: 3 }) },
  { kind: "stage", text: "picked up after the review", tsIso: at({ minute: 4 }), worker: "w2" },
  { kind: "plan", steps: ["Find the monitor", "Instrument the test", "Ship it", "Watch CI"], tsIso: at({ minute: 5 }) },
  { kind: "stage", step: 3, text: "pull request open", tsIso: at({ minute: 6 }), worker: "w2" },
];

describe("loopView", () => {
  it("opens a phase on every plan, review round and change of writer", () => {
    expect(loopView({ timeline: LOOP }).phases).toEqual([
      { kind: "start", title: "started", updates: ["reading the thread"] },
      { kind: "plan", title: "planned 2 steps", updates: ["monitor found"] },
      { kind: "review", title: "independent review, round 1", updates: [] },
      { kind: "handover", title: "worker 2 picked up the work", updates: ["picked up after the review"] },
      { kind: "replan", title: "re-planned to 4 steps", updates: ["pull request open"] },
    ]);
  });

  it("follows the newest plan, filing each stage against the step in flight since it", () => {
    const plan = loopView({ timeline: LOOP }).plan!;
    expect(plan.steps).toEqual(["Find the monitor", "Instrument the test", "Ship it", "Watch CI"]);
    expect(plan.replans).toBe(1);
    expect(plan.currentStep).toBe(3);
    expect([...plan.findings]).toEqual([[3, "pull request open"]]);
  });

  it("counts worker generations and the highest review round", () => {
    const view = loopView({ timeline: LOOP });
    expect([view.workers, view.reviewRounds, view.updates]).toEqual([2, 1, 4]);
  });

  it("joins a stage that names no writer to the generation before it", () => {
    const view = loopView({
      timeline: [
        { kind: "stage", text: "a", tsIso: at({ minute: 0 }), worker: "w1" },
        { kind: "stage", text: "legacy line", tsIso: at({ minute: 1 }) },
        { kind: "stage", text: "b", tsIso: at({ minute: 2 }), worker: "w1" },
      ],
    });
    expect(view.workers).toBe(1);
    expect(view.phases).toEqual([{ kind: "start", title: "started", updates: ["a", "legacy line", "b"] }]);
  });

  it("reads a step past the plan's end as its last step", () => {
    const plan = loopView({
      timeline: [
        { kind: "plan", steps: ["a", "b"], tsIso: at({ minute: 0 }) },
        { kind: "stage", step: 9, text: "hand-edited", tsIso: at({ minute: 1 }) },
      ],
    }).plan!;
    expect(plan.currentStep).toBe(2);
  });

  it("reads an empty timeline as a turn that has not started reporting", () => {
    expect(loopView({ timeline: [] })).toEqual({
      latest: undefined,
      phases: [],
      plan: undefined,
      reviewRounds: 0,
      updates: 0,
      workers: 1,
    });
  });
});

describe("meterLine", () => {
  it("draws the bar and the fraction, then every loop fact that happened", () => {
    expect(meterLine({ finished: false, view: loopView({ timeline: LOOP }) })).toBe(
      "▰▰▱▱ step 3 of 4 · worker 2 · review round 1 · re-planned",
    );
  });

  it("fills the bar once the turn has finished", () => {
    expect(meterLine({ finished: true, view: loopView({ timeline: LOOP }) })).toBe(
      "▰▰▰▰ 4 of 4 steps done · worker 2 · review round 1 · re-planned",
    );
  });

  it("counts re-plans past the first", () => {
    const timeline: readonly ProgressTimelineEvent[] = [1, 2, 3].map((minute) => ({
      kind: "plan",
      steps: ["only"],
      tsIso: at({ minute }),
    }));
    expect(meterLine({ finished: false, view: loopView({ timeline }) })).toBe("▱ step 1 of 1 · re-planned 2 times");
  });

  it("counts updates when there is no plan to measure against", () => {
    const timeline = LOOP.filter((event) => event.kind !== "plan");
    expect(meterLine({ finished: false, view: loopView({ timeline }) })).toBe(
      "worker 2 · review round 1 · 4 updates so far",
    );
  });

  it("draws nothing for a single update with nothing loop-shaped behind it", () => {
    const timeline: readonly ProgressTimelineEvent[] = [{ kind: "stage", text: "a", tsIso: at({ minute: 0 }) }];
    expect(meterLine({ finished: false, view: loopView({ timeline }) })).toBe(undefined);
  });
});

describe("boundedUpdates", () => {
  it("keeps a phase within the bound whole", () => {
    expect(boundedUpdates({ updates: ["a", "b"] })).toEqual(["a", "b"]);
  });

  it("keeps the latest updates behind a line counting the rest", () => {
    const updates = Array.from({ length: LOOP_PHASE_UPDATES_MAX + 2 }, (_, index) => `u${String(index)}`);
    expect(boundedUpdates({ updates })).toEqual(["… 2 earlier updates", ...updates.slice(2)]);
  });
});

describe("boundedPhases", () => {
  const phase = ({ index }: { index: number }): LoopPhase => ({
    kind: "review",
    title: `p${String(index)}`,
    updates: [],
  });

  it("shows every phase within the bound", () => {
    const phases = [phase({ index: 0 })];
    expect(boundedPhases({ phases })).toEqual({ folded: 0, shown: phases });
  });

  it("keeps the latest phases and counts the rest", () => {
    const phases = Array.from({ length: LOOP_PHASES_MAX + 1 }, (_, index) => phase({ index }));
    expect(boundedPhases({ phases })).toEqual({ folded: 1, shown: phases.slice(1) });
  });
});
