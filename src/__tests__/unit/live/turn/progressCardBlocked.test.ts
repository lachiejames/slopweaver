/**
 * The live progress card while a step waits on the owner: the hourglass on the live step, every earlier
 * finding kept, and the mechanical `now:` line dropped rather than left to age into a lie.
 */
import { describe, expect, it } from "vitest";
import { liveLineOf, progressChecklistSteps } from "../../../../live/turn/progressCard.js";
import type { ProgressStageEvent } from "../../../../live/turn/progressLog.js";
import { todoLine, todoTaskChunks } from "../../../../outbound/assistant/todoBlock.js";

const STAGES: readonly ProgressStageEvent[] = [
  { kind: "stage", text: "read the thread (12 messages, 1 monitor named)", tsIso: "2026-09-07T00:06:00.000Z" },
  {
    kind: "stage",
    text: "Waiting on the owner: sign in to Google Cloud locally",
    tsIso: "2026-09-07T00:20:00.000Z",
  },
];

const BLOCKED_DETAIL = "waiting on the owner to sign in — picking straight back up once it is";

describe("the card while a step waits on the owner", () => {
  it("puts the hourglass on the live step and keeps every earlier finding in the loop", () => {
    const steps = progressChecklistSteps({
      blocked: { detail: BLOCKED_DETAIL },
      finished: false,
      nowDetail: "now: reading a file (started 2m ago) · 41 tool calls so far",
      question: "can you deploy the p99 monitor?",
      timeline: STAGES,
    });
    expect(steps.slice(2)).toEqual([
      {
        children: [BLOCKED_DETAIL],
        id: "stage-1",
        state: "blocked",
        title: "Waiting on the owner: sign in to Google Cloud locally",
      },
      {
        children: STAGES.map((stage) => stage.text),
        id: "loop-0",
        placement: "loop",
        state: "blocked",
        title: "started",
      },
    ]);
    expect(liveLineOf({ steps })).toBe(BLOCKED_DETAIL);
  });

  it("renders the blocked line with an hourglass, never a cross", () => {
    const line = todoLine({
      step: {
        detail: BLOCKED_DETAIL,
        id: "stage-1",
        state: "blocked",
        title: "Waiting on the owner: sign in to Google Cloud locally",
      },
    });
    expect(line).toBe(`⏳ Waiting on the owner: sign in to Google Cloud locally — ${BLOCKED_DETAIL}`);
    expect(line.includes("✗")).toBe(false);
  });

  it("projects a blocked step onto Slack's own vocabulary as in-flight, never as an error", () => {
    const chunks = todoTaskChunks({ steps: [{ id: "s", state: "blocked", title: "Waiting on the owner" }] });
    expect(chunks[0]!.status).toBe("in_progress");
  });

  it("beats `finished`, so a caller passing both cannot render a waiting turn as done", () => {
    const steps = progressChecklistSteps({
      blocked: { detail: BLOCKED_DETAIL },
      finished: true,
      nowDetail: undefined,
      question: "can you deploy the p99 monitor?",
      timeline: STAGES,
    });
    expect(steps.find((step) => step.id === "stage-1")!.state).toBe("blocked");
  });

  it("beats `finished` on the meter and the outline too, so a waiting plan never reads as all done", () => {
    const steps = progressChecklistSteps({
      blocked: { detail: BLOCKED_DETAIL },
      finished: true,
      nowDetail: undefined,
      question: "can you deploy the p99 monitor?",
      timeline: [
        { kind: "plan", steps: ["Read the thread", "Deploy the monitor"], tsIso: "2026-09-07T00:05:00.000Z" },
        { ...STAGES[0]!, step: 1 },
      ],
    });
    expect(steps.filter((step) => step.placement !== "loop").map((step) => [step.id, step.state, step.title])).toEqual([
      ["meter", "blocked", "▱▱ step 1 of 2"],
      ["question", "done", "Read the question"],
      ["plan-1", "blocked", "Read the thread"],
      ["plan-2", "pending", "Deploy the monitor"],
    ]);
  });

  it("blocks the opening step too, when the turn stopped before declaring a stage", () => {
    const steps = progressChecklistSteps({
      blocked: { detail: BLOCKED_DETAIL },
      finished: false,
      nowDetail: undefined,
      question: "can you deploy the p99 monitor?",
      timeline: [],
    });
    expect(steps.map((step) => step.state)).toEqual(["done", "blocked"]);
    expect(steps[1]!.children).toEqual([BLOCKED_DETAIL]);
  });

  it("is unchanged when nothing is blocked — the live step still runs with its `now:` line", () => {
    const steps = progressChecklistSteps({
      finished: false,
      nowDetail: "now: reading a file (started 2m ago) · 41 tool calls so far",
      question: "can you deploy the p99 monitor?",
      timeline: STAGES,
    });
    expect(steps.map((step) => step.state)).toEqual(["running", "done", "running", "running"]);
    expect(liveLineOf({ steps })).toBe("now: reading a file (started 2m ago) · 41 tool calls so far");
  });
});
