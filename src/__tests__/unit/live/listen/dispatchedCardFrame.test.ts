/**
 * The two frames a turn's ONE card can wear before its worker speaks — `live/listen/capture.ts`'s
 * `firstCardFrame` and `dispatchedCardFrame`.
 *
 * The property is the one the incident cost: a card advanced at dispatch must wear the SAME
 * shape every later tick writes, so the reader never watches it change genre mid-turn. That is asserted the
 * only way it can be falsified — by comparing the dispatch frame to what `progressChecklistSteps` itself
 * produces for a turn with no stage declared yet, rather than by restating the step titles here.
 *
 * The pre-routing frame is asserted beside it, because the claim is about the DIFFERENCE between them: a
 * change that made `firstCardFrame` emit the per-stage shape too would satisfy any assertion about the
 * dispatch frame alone while removing the pre-routing placeholder routing still legitimately needs.
 */
// register-class: public-ask-dispatched-with-no-live-progress-card (docs/recurring-failure-register/bindings.md)
import { describe, expect, it } from "vitest";

import { dispatchedCardFrame, firstCardFrame } from "../../../../live/listen/capture.js";
import { progressChecklistSteps } from "../../../../live/turn/progressCard.js";
import type { ProgressTimelineEvent } from "../../../../live/turn/progressLog.js";

const QUESTION = "why did the staging pool exhaust?";

describe("dispatchedCardFrame", () => {
  it("is byte-for-byte what a later tick with no declared stage writes", () => {
    expect(dispatchedCardFrame({ question: QUESTION, timeline: [] }).steps).toEqual(
      progressChecklistSteps({ finished: false, nowDetail: undefined, question: QUESTION, timeline: [] }),
    );
  });

  it("opens on the read question and runs on the investigating step", () => {
    const steps = dispatchedCardFrame({ question: QUESTION, timeline: [] });

    expect(steps.steps.map((step) => step.title)).toEqual(["Read the question", "Investigating"]);
    expect(steps.steps.map((step) => step.state)).toEqual(["done", "running"]);
    expect(steps.steps[0]!.detail).toBe(`"${QUESTION}"`);
  });

  it("carries NO now: line, since the worker has not made a tool call to derive one from", () => {
    expect(dispatchedCardFrame({ question: QUESTION, timeline: [] }).steps[1]).toEqual({
      id: "stage-0",
      state: "running",
      title: "Investigating",
    });
  });

  it("redraws a RE-dispatched ask's plan rather than wiping it back to Investigating", () => {
    const timeline: readonly ProgressTimelineEvent[] = [
      { kind: "plan", steps: ["Read the pool metrics", "Answer"], tsIso: "2026-10-02T10:00:00.000Z" },
      { kind: "stage", step: 1, text: "pool hit 100/100 at 09:58", tsIso: "2026-10-02T10:01:00.000Z", worker: "w1" },
    ];
    expect(
      dispatchedCardFrame({ question: QUESTION, timeline })
        .steps.filter((step) => step.placement === undefined)
        .map((step) => step.title),
    ).toEqual(["Read the question", "Read the pool metrics", "Answer"]);
  });

  it("labels the card with the same task label the capture frame uses", () => {
    expect(dispatchedCardFrame({ question: QUESTION, timeline: [] }).task).toBe(
      firstCardFrame({ question: QUESTION }).task,
    );
  });
});

describe("firstCardFrame — still the PRE-ROUTING placeholder, which is what dispatch replaces", () => {
  it("names the route step rather than a stage, because routing has not run at capture", () => {
    expect(firstCardFrame({ question: QUESTION }).steps.map((step) => step.title)).toEqual([
      "Read the question",
      "Work out how to answer",
    ]);
  });

  it("differs from the dispatch frame, which is the whole reason the advance exists", () => {
    expect(firstCardFrame({ question: QUESTION }).steps).not.toEqual(
      dispatchedCardFrame({ question: QUESTION, timeline: [] }).steps,
    );
  });
});
