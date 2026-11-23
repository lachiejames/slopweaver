import { describe, expect, it } from "vitest";

import { liveLineOf, progressChecklistSteps } from "../../../../live/turn/progressCard.js";
import type { ProgressStageEvent } from "../../../../live/turn/progressLog.js";

const STAGES: readonly ProgressStageEvent[] = [
  { kind: "stage", text: "thread read — 12 PRs named", tsIso: "2026-09-12T04:26:00.000Z" },
  { kind: "stage", text: "sending for independent review", tsIso: "2026-09-12T05:10:00.000Z" },
];

const WARNED_NOW = "warn raised — now: getting a second opinion (started 3m ago) · 40 tool calls so far";

describe("progressChecklistSteps — a budget warn", () => {
  it("shows the warn on the live step and nowhere else", () => {
    const steps = progressChecklistSteps({
      finished: false,
      nowDetail: "now: getting a second opinion (started 3m ago) · 40 tool calls so far",
      question: "what did mark own?",
      timeline: STAGES,
      warned: true,
    });
    const carriers = steps.filter((step) => step.detail === WARNED_NOW || step.children?.includes(WARNED_NOW));
    expect(carriers.map((step) => step.id)).toEqual(["stage-1"]);
  });

  it("still shows the warn when the live step has no detail of its own", () => {
    const steps = progressChecklistSteps({
      finished: false,
      nowDetail: undefined,
      question: "q",
      timeline: STAGES,
      warned: true,
    });
    expect(liveLineOf({ steps })).toBe("warn raised");
  });

  it("leaves a finished card untouched", () => {
    const steps = progressChecklistSteps({
      finished: true,
      nowDetail: undefined,
      question: "q",
      timeline: STAGES,
      warned: true,
    });
    expect(steps.find((step) => step.id === "stage-1")).toEqual({
      id: "stage-1",
      state: "done",
      title: "sending for independent review",
    });
  });

  it("lets a blocked step keep its own sentence", () => {
    const steps = progressChecklistSteps({
      blocked: { detail: "waiting on the owner to approve access; the turn resumes after" },
      finished: false,
      nowDetail: "now: Bash",
      question: "q",
      timeline: STAGES,
      warned: true,
    });
    expect(liveLineOf({ steps })).toBe("waiting on the owner to approve access; the turn resumes after");
  });

  it("renders exactly the unwarned card when no warn stands", () => {
    const input = { finished: false, nowDetail: "now: Bash", question: "q", timeline: STAGES };
    expect(progressChecklistSteps({ ...input, warned: false })).toEqual(progressChecklistSteps(input));
  });
});
