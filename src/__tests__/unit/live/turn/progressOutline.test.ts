import { describe, expect, it } from "vitest";

import type { ProgressTimelineEvent } from "../../../../live/turn/progressLog.js";
import { loopView } from "../../../../live/turn/progressLoop.js";
import { loopSteps, outlineSteps } from "../../../../live/turn/progressOutline.js";

const TS = "2026-10-02T10:00:00.000Z";

const PLANNED: readonly ProgressTimelineEvent[] = [
  { kind: "plan", steps: ["Read the thread", "Check GitHub", "Answer"], tsIso: TS },
  { kind: "stage", step: 1, text: "thread read, 12 PRs named", tsIso: TS, worker: "w1" },
  { kind: "stage", step: 2, text: "8 of 12 merged", tsIso: TS, worker: "w1" },
];

describe("outlineSteps", () => {
  it("draws one live step titled Investigating, carrying only the live line, before any stage", () => {
    expect(
      outlineSteps({
        finished: false,
        lastState: "running",
        liveLine: "now: reading",
        view: loopView({ timeline: [] }),
      }),
    ).toEqual([{ children: ["now: reading"], id: "stage-0", state: "running", title: "Investigating" }]);
  });

  it("marks the steps before the live one done with their finding, the live one running, the rest pending", () => {
    expect(
      outlineSteps({
        finished: false,
        lastState: "running",
        liveLine: "now: x",
        view: loopView({ timeline: PLANNED }),
      }),
    ).toEqual([
      { detail: "thread read, 12 PRs named", id: "plan-1", state: "done", title: "Read the thread" },
      { children: ["8 of 12 merged", "now: x"], id: "plan-2", state: "running", title: "Check GitHub" },
      { id: "plan-3", state: "pending", title: "Answer" },
    ]);
  });

  it("marks every plan step done once the turn has finished", () => {
    const steps = outlineSteps({
      finished: true,
      lastState: "done",
      liveLine: undefined,
      view: loopView({ timeline: PLANNED }),
    });
    expect(steps.map((step) => step.state)).toEqual(["done", "done", "done"]);
  });
});

describe("loopSteps", () => {
  it("draws nothing while the timeline holds a single event", () => {
    const timeline = PLANNED.slice(0, 1);
    expect(loopSteps({ lastState: "running", timeline, view: loopView({ timeline }) })).toEqual([]);
  });

  it("places every phase below the fold, the last wearing the live state", () => {
    const timeline: readonly ProgressTimelineEvent[] = [...PLANNED, { kind: "review", round: 1, tsIso: TS }];
    expect(loopSteps({ lastState: "running", timeline, view: loopView({ timeline }) })).toEqual([
      {
        children: ["thread read, 12 PRs named", "8 of 12 merged"],
        id: "loop-0",
        placement: "loop",
        state: "done",
        title: "planned 3 steps",
      },
      { id: "loop-1", placement: "loop", state: "running", title: "independent review, round 1" },
    ]);
  });
});
