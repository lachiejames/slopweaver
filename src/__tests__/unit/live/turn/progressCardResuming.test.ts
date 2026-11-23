/**
 * The card while a turn is picking up a dead session's work.
 *
 * The exact line these replace is the one that sat in a public channel after the worker died
 * — `now: <its last tool call> · 61 tool calls so far`, true when written and a lie every minute
 * after, because the session writing the command log it was derived from was gone.
 */
import { describe, expect, it } from "vitest";

import { liveLineOf, progressChecklistSteps } from "../../../../live/turn/progressCard.js";
import type { ProgressStageEvent } from "../../../../live/turn/progressLog.js";

const STAGES: readonly ProgressStageEvent[] = [
  { kind: "stage", text: "thread read — the pid question has two halves", tsIso: "2026-09-10T13:20:00.000Z" },
  { kind: "stage", text: "checking the cross-service spread", tsIso: "2026-09-10T13:52:00.000Z" },
];

const RESUMING = "resuming from checkpoint — a draft answer and 2 review rounds recovered from the last session";

const FROZEN_NOW = "now: getting a second opinion (started 49m ago) · 61 tool calls so far";

describe("progressChecklistSteps — resuming from a checkpoint", () => {
  it("replaces the dead session's now: line on the live step, and nowhere else", () => {
    const steps = progressChecklistSteps({
      finished: false,
      nowDetail: FROZEN_NOW,
      question: "why is the pid the same across every container?",
      resuming: RESUMING,
      timeline: STAGES,
    });

    const carriers = steps.filter((step) => step.detail === RESUMING || step.children?.includes(RESUMING));
    expect(carriers.map((step) => step.id)).toEqual(["stage-1"]);
    expect(steps.some((step) => step.detail === FROZEN_NOW || step.children?.includes(FROZEN_NOW))).toBe(false);
  });

  it("shows the warn over it when both stand, so neither condition hides the other", () => {
    const steps = progressChecklistSteps({
      finished: false,
      nowDetail: FROZEN_NOW,
      question: "q",
      resuming: RESUMING,
      timeline: STAGES,
      warned: true,
    });

    expect(liveLineOf({ steps })).toBe(`warn raised — ${RESUMING}`);
  });

  it("keeps the now: line when nothing is being resumed — the ordinary live card is unchanged", () => {
    const steps = progressChecklistSteps({
      finished: false,
      nowDetail: FROZEN_NOW,
      question: "q",
      timeline: STAGES,
    });

    expect(liveLineOf({ steps })).toBe(FROZEN_NOW);
  });

  it("a turn waiting on the owner still reads as waiting on them, never as resuming", () => {
    const steps = progressChecklistSteps({
      blocked: { detail: "waiting on the owner to approve the Vanta acceptance" },
      finished: false,
      nowDetail: FROZEN_NOW,
      question: "q",
      resuming: RESUMING,
      timeline: STAGES,
    });

    expect(steps.find((step) => step.id === "stage-1")!.state).toBe("blocked");
    expect(liveLineOf({ steps })).toBe("waiting on the owner to approve the Vanta acceptance");
  });

  it("a finished turn carries no live line, resuming or not", () => {
    const steps = progressChecklistSteps({
      finished: true,
      nowDetail: undefined,
      question: "q",
      resuming: RESUMING,
      timeline: STAGES,
    });

    expect(steps.find((step) => step.id === "stage-1")).toEqual({
      id: "stage-1",
      state: "done",
      title: "checking the cross-service spread",
    });
    expect(liveLineOf({ steps })).toBe(undefined);
  });

  it("renders on a turn that declared no stages yet, where the opening step is the running one", () => {
    const steps = progressChecklistSteps({
      finished: false,
      nowDetail: FROZEN_NOW,
      question: "q",
      resuming: RESUMING,
      timeline: [],
    });

    expect(steps).toHaveLength(2);
    expect(steps.slice(1)).toEqual([{ children: [RESUMING], id: "stage-0", state: "running", title: "Investigating" }]);
  });
});
