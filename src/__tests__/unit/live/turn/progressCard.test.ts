import { describe, expect, it } from "vitest";

import {
  activityGloss,
  elapsedWords,
  liveLineOf,
  nowLine,
  progressChecklistSteps,
} from "../../../../live/turn/progressCard.js";
import type { ProgressStageEvent, ProgressTimelineEvent } from "../../../../live/turn/progressLog.js";

const stage = ({ text, tsIso }: { text: string; tsIso: string }): ProgressStageEvent => ({
  kind: "stage",
  text,
  tsIso,
});

const TAG_THREE_STAGES: readonly ProgressStageEvent[] = [
  stage({ text: "reading the thread and the private brief", tsIso: "2026-08-29T09:55:56.595Z" }),
  stage({ text: "thread read (47 msgs, 12 PRs named); now reading live GitHub", tsIso: "2026-08-29T09:58:17.328Z" }),
  stage({ text: "live: 4 open criticals left, 8 of 10 bot PRs merged", tsIso: "2026-08-29T10:01:35.519Z" }),
];

describe("elapsedWords", () => {
  it("says just now inside the first minute", () => {
    expect(elapsedWords({ fromIso: "2026-08-29T10:00:00.000Z", toIso: "2026-08-29T10:00:59.000Z" })).toBe("just now");
  });

  it("counts whole minutes under an hour", () => {
    expect(elapsedWords({ fromIso: "2026-08-29T10:00:00.000Z", toIso: "2026-08-29T10:06:30.000Z" })).toBe("6m");
  });

  it("splits hours and minutes past an hour", () => {
    expect(elapsedWords({ fromIso: "2026-08-29T09:00:00.000Z", toIso: "2026-08-29T10:12:00.000Z" })).toBe("1h 12m");
  });

  it("returns undefined for an unreadable instant", () => {
    expect(elapsedWords({ fromIso: "nope", toIso: "2026-08-29T10:00:00.000Z" })).toBe(undefined);
  });

  it("never reports negative time when the clock runs backwards", () => {
    expect(elapsedWords({ fromIso: "2026-08-29T10:05:00.000Z", toIso: "2026-08-29T10:00:00.000Z" })).toBe("just now");
  });
});

describe("activityGloss", () => {
  it("glosses a slopweaver turn status call as reader-facing prose", () => {
    expect(activityGloss({ target: "slopweaver turn status --brief [path]/…", tool: "Bash" })).toBe(
      "checking the turn status",
    );
  });

  it("glosses by tool alone when the rule carries no target prefix", () => {
    expect(activityGloss({ target: "src/live/turn/progressCard.ts", tool: "Read" })).toBe("reading a file");
  });

  it("matches a target prefix case-insensitively", () => {
    expect(activityGloss({ target: "YARN TEST --run unit", tool: "Bash" })).toBe("running the test gate");
  });

  it("falls back to the bare tool name when no gloss fits", () => {
    expect(activityGloss({ target: "curl https://example.com", tool: "Bash" })).toBe("Bash");
  });

  it("falls back to the bare tool name when the tool itself is unrecognised", () => {
    expect(activityGloss({ target: undefined, tool: "ToolSearch" })).toBe("ToolSearch");
  });

  it("never lets the target's own text reach the returned phrase", () => {
    const gloss = activityGloss({
      target: "slopweaver turn status --brief this-marker-must-never-surface.json",
      tool: "Bash",
    });
    expect(gloss.includes("this-marker-must-never-surface")).toBe(false);
  });
});

describe("nowLine", () => {
  it("names a glossed phrase for the call, how long it has been running, and the call count", () => {
    expect(
      nowLine({
        callsSoFar: 41,
        latest: { target: "slopweaver github read .../pull/15895", tool: "Bash", tsIso: "2026-08-29T10:35:00.000Z" },
        nowIso: "2026-08-29T10:37:00.000Z",
      }),
    ).toBe("now: checking GitHub (started 2m ago) · 41 tool calls so far");
  });

  it("never renders the call's own argv, even sanitised", () => {
    expect(
      nowLine({
        callsSoFar: 5,
        latest: { target: "gh pr view 15895", tool: "Bash", tsIso: "2026-08-29T10:35:00.000Z" },
        nowIso: "2026-08-29T10:37:00.000Z",
      }),
    ).toBe("now: checking GitHub (started 2m ago) · 5 tool calls so far");
  });

  it("says still working rather than inventing a subject when the command log has nothing", () => {
    expect(nowLine({ callsSoFar: 0, latest: undefined, nowIso: "2026-08-29T10:37:00.000Z" })).toBe(
      "now: still working — 0 tool calls so far",
    );
  });

  it("singularises one call", () => {
    expect(nowLine({ callsSoFar: 1, latest: undefined, nowIso: "2026-08-29T10:37:00.000Z" })).toBe(
      "now: still working — 1 tool call so far",
    );
  });

  it("shows a tool with no gloss as just the tool", () => {
    expect(
      nowLine({
        callsSoFar: 3,
        latest: { target: undefined, tool: "ToolSearch", tsIso: "2026-08-29T10:36:40.000Z" },
        nowIso: "2026-08-29T10:37:00.000Z",
      }),
    ).toBe("now: ToolSearch (started just now) · 3 tool calls so far");
  });
});

describe("progressChecklistSteps — no declared plan", () => {
  it("puts the latest stage live above the fold and keeps every stage's own text in the loop below it", () => {
    const steps = progressChecklistSteps({
      finished: false,
      nowDetail: "now: checking GitHub · 41 tool calls so far",
      question: "how many criticals are left?",
      timeline: TAG_THREE_STAGES,
    });
    expect(steps.slice(2)).toEqual([
      {
        children: ["now: checking GitHub · 41 tool calls so far"],
        id: "stage-2",
        state: "running",
        title: "live: 4 open criticals left, 8 of 10 bot PRs merged",
      },
      {
        children: TAG_THREE_STAGES.map((event) => event.text),
        id: "loop-0",
        placement: "loop",
        state: "running",
        title: "started",
      },
    ]);
  });

  it("opens with a meter counting the updates, since there is no plan to measure against", () => {
    const steps = progressChecklistSteps({
      finished: false,
      nowDetail: undefined,
      question: "q",
      timeline: TAG_THREE_STAGES,
    });
    expect(steps[0]).toEqual({ id: "meter", placement: "meter", state: "running", title: "3 updates so far" });
  });

  it("puts the now-line on the live step and nowhere else", () => {
    const steps = progressChecklistSteps({
      finished: false,
      nowDetail: "now: Bash — gh pr view 15895",
      question: "how many criticals are left?",
      timeline: TAG_THREE_STAGES,
    });
    const carriers = steps.filter(
      (step) =>
        step.detail === "now: Bash — gh pr view 15895" || step.children?.includes("now: Bash — gh pr view 15895"),
    );
    expect(carriers.map((step) => step.id)).toEqual(["stage-2"]);
    expect(liveLineOf({ steps })).toBe("now: Bash — gh pr view 15895");
  });

  it("shows the question as its own finding, and no meter before anything has happened", () => {
    const steps = progressChecklistSteps({
      finished: false,
      nowDetail: undefined,
      question: "who owns this?",
      timeline: [],
    });
    expect(steps[0]).toEqual({ detail: '"who owns this?"', id: "question", state: "done", title: "Read the question" });
  });

  it("renders a truthful running step before any stage has been declared, and no loop yet", () => {
    const steps = progressChecklistSteps({
      finished: false,
      nowDetail: "now: still working",
      question: "q",
      timeline: [],
    });
    expect(steps.slice(1)).toEqual([
      { children: ["now: still working"], id: "stage-0", state: "running", title: "Investigating" },
    ]);
  });

  it("marks everything done, with no live line, once the turn is finished", () => {
    const steps = progressChecklistSteps({
      finished: true,
      nowDetail: "now: Bash",
      question: "q",
      timeline: TAG_THREE_STAGES,
    });
    expect(steps.map((step) => step.state)).toEqual(["done", "done", "done", "done"]);
    expect(steps[2]).toEqual({
      id: "stage-2",
      state: "done",
      title: "live: 4 open criticals left, 8 of 10 bot PRs merged",
    });
    expect(liveLineOf({ steps })).toBe(undefined);
  });

  it("gives every step an id so an advance edits the same rows rather than adding some", () => {
    const steps = progressChecklistSteps({
      finished: false,
      nowDetail: undefined,
      question: "q",
      timeline: TAG_THREE_STAGES,
    });
    expect(steps.map((step) => step.id)).toEqual(["meter", "question", "stage-2", "loop-0"]);
  });
});

describe("progressChecklistSteps — a declared plan", () => {
  const PLAN: ProgressTimelineEvent = {
    kind: "plan",
    steps: ["Read the thread", "Check live GitHub", "Write the answer"],
    tsIso: "2026-08-29T09:55:00.000Z",
  };
  const timeline: readonly ProgressTimelineEvent[] = [
    PLAN,
    { ...TAG_THREE_STAGES[0]!, step: 1 },
    { ...TAG_THREE_STAGES[1]!, step: 2 },
    TAG_THREE_STAGES[2]!,
  ];

  it("draws the outline: done steps keep their finding, the live one expands, the rest wait", () => {
    const steps = progressChecklistSteps({
      finished: false,
      nowDetail: "now: checking GitHub",
      question: "q",
      timeline,
    });
    expect(steps.filter((step) => step.id.startsWith("plan-"))).toEqual([
      { detail: "reading the thread and the private brief", id: "plan-1", state: "done", title: "Read the thread" },
      {
        children: ["live: 4 open criticals left, 8 of 10 bot PRs merged", "now: checking GitHub"],
        id: "plan-2",
        state: "running",
        title: "Check live GitHub",
      },
      { id: "plan-3", state: "pending", title: "Write the answer" },
    ]);
  });

  it("meters the job against the plan", () => {
    const steps = progressChecklistSteps({ finished: false, nowDetail: undefined, question: "q", timeline });
    expect(steps[0]!.title).toBe("▰▱▱ step 2 of 3");
  });

  it("reads every planned step done once the turn has finished", () => {
    const steps = progressChecklistSteps({ finished: true, nowDetail: undefined, question: "q", timeline });
    expect(steps[0]!.title).toBe("▰▰▰ 3 of 3 steps done");
    expect(steps.filter((step) => step.id.startsWith("plan-")).map((step) => step.state)).toEqual([
      "done",
      "done",
      "done",
    ]);
  });

  it("files the plan as the loop's first phase, with every update written under it", () => {
    const steps = progressChecklistSteps({ finished: false, nowDetail: undefined, question: "q", timeline });
    expect(steps.filter((step) => step.placement === "loop")).toEqual([
      {
        children: TAG_THREE_STAGES.map((event) => event.text),
        id: "loop-0",
        placement: "loop",
        state: "running",
        title: "planned 3 steps",
      },
    ]);
  });
});

describe("the card never shows a raw Slack id", () => {
  it("strips the ask's addressing from step 0's own finding, not just from the title", () => {
    const steps = progressChecklistSteps({
      finished: false,
      nowDetail: undefined,
      question: "@(U0BOT) which of my open PRs are waiting on someone else?",
      timeline: [],
    });
    expect(steps[0]?.detail).toBe('"which of my open PRs are waiting on someone else?"');
  });
});

/** A run of 10+ identical box-drawing/dash characters — never legitimate content in a rendered card body. */
const DIVIDER_RUN = /([^\p{L}\p{N}\s])\1{9,}/gu;

/** An internal ask/review cmux session key — operator plumbing, never legitimate content in a card body. */
const SESSION_KEY = /\b(?:ask|review)-\S+-\d+\.\d+\b/;

describe("the card never shows operator plumbing", () => {
  it("drops a divider run and an ask session key riding along in a worker's own stage text", () => {
    const steps = progressChecklistSteps({
      finished: false,
      nowDetail: undefined,
      question: "q",
      timeline: [
        stage({
          text: `attaching the before/after proof image — ${"─".repeat(60)} ask-C_ASK-1788169792.593579`,
          tsIso: "2026-08-31T20:43:00.000Z",
        }),
      ],
    });
    const title = steps[1]!.title;
    expect(title).toBe("attaching the before/after proof image");
    expect(DIVIDER_RUN.test(title)).toBe(false);
    expect(SESSION_KEY.test(title)).toBe(false);
  });

  it("drops a divider run and a review session key riding along in the now-line's own target", () => {
    // `nowDetail` reaches `progressChecklistSteps` already clamped — every producer (`nowLine`,
    // `liveStatusFromScreen`) runs it through `clampVisible` first — so this goes through `nowLine` itself
    // rather than handing raw text straight to `progressChecklistSteps`, matching the real pipeline.
    const nowDetail = nowLine({
      callsSoFar: 5,
      latest: {
        target: `review-C_REVIEW-1788134088.884069 ${"=".repeat(30)}`,
        tool: "Bash",
        tsIso: "2026-08-31T20:42:00.000Z",
      },
      nowIso: "2026-08-31T20:43:00.000Z",
    });
    const steps = progressChecklistSteps({ finished: false, nowDetail, question: "q", timeline: [] });
    const detail = steps[1]!.children![0]!;
    expect(DIVIDER_RUN.test(detail)).toBe(false);
    expect(SESSION_KEY.test(detail)).toBe(false);
  });
});
