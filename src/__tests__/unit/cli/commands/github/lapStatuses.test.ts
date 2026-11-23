import { describe, expect, it } from "vitest";

import { LAP_CONTEXTS, lapPlan, STATUS_DESCRIPTION_MAX } from "../../../../../cli/commands/github/lapCore.js";
import { lapErrorStatuses, lapPendingStatuses, lapStatuses } from "../../../../../cli/commands/github/lapStatuses.js";

const BASE = "4cf8df588ae4aaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("lapStatuses", () => {
  const plan = lapPlan();
  const allGreen = plan.map((step) => ({ context: step.context, exitCode: 0, id: step.id, wallMs: 60_000 }));

  it("posts both contexts green only when every planned step under each ran green", () => {
    const statuses = lapStatuses({ baseTip: BASE, outcomes: allGreen, plan });
    expect(statuses.map((status) => [status.context, status.state])).toEqual([
      ["build", "success"],
      ["integration", "success"],
    ]);
    expect(statuses[1]!.description).toBe("local lap: 1 steps green in 1m over base 4cf8df588a");
  });

  it("names every step that went green only on its retry, so a retried green never reads as a clean one", () => {
    const outcomes = allGreen.map((outcome) =>
      outcome.id === "integration" ? { ...outcome, firstExit: 1, wallMs: 120_000 } : outcome,
    );
    expect(lapStatuses({ baseTip: BASE, outcomes, plan })[1]!.description).toBe(
      "local lap: 1 steps green in 2m over base 4cf8df588a; 1 green only on retry: integration",
    );
  });

  it("still names an earlier retried green when a later step in the same context fails", () => {
    const upTo = plan.findIndex((step) => step.id === "unit-2");
    const outcomes = allGreen.slice(0, upTo + 1).map((outcome) => {
      if (outcome.id === "unit-1") {
        return { ...outcome, firstExit: 1 };
      }
      return outcome.id === "unit-2" ? { ...outcome, exitCode: 1, firstExit: 1 } : outcome;
    });
    expect(lapStatuses({ baseTip: BASE, outcomes, plan })[0]!.description).toBe(
      "local lap: unit-2 failed (exit 1) on its retry over base 4cf8df588a; 1 green only on retry: unit-1",
    );
  });

  it("never lets GitHub's cap cut a retry qualifier or the base, however long the step's id", () => {
    const outcomes = [{ context: "build", exitCode: 1, firstExit: 1, id: "a".repeat(110), wallMs: 2 }];
    expect(lapStatuses({ baseTip: BASE, outcomes, plan })[0]!.description).toBe(
      `local lap: ${"a".repeat(29)}… failed (exit 1) on its retry over base 4cf8df588a`,
    );
  });

  it("counts a step id's length by character, so an astral id of exactly 30 is kept whole and never split", () => {
    const whole = "😀".repeat(30);
    const long = "😀".repeat(31);
    const statusOf = ({ id }: { id: string }) =>
      lapStatuses({ baseTip: BASE, outcomes: [{ context: "build", exitCode: 1, id, wallMs: 1 }], plan })[0]!
        .description;
    expect(statusOf({ id: whole })).toBe(`local lap: ${whole} failed (exit 1) over base 4cf8df588a`);
    expect(statusOf({ id: long })).toBe(`local lap: ${"😀".repeat(29)}… failed (exit 1) over base 4cf8df588a`);
  });

  it("lets the cap cut only the retried ids' list, never its count, when every Vitest lane went green on retry", () => {
    const retried = plan.filter((step) => step.retryable && step.id !== "subprocess");
    const outcomes = [
      ...retried.map((step) => ({ context: "build", exitCode: 0, firstExit: 1, id: step.id, wallMs: 1 })),
      { context: "build", exitCode: 1, firstExit: 1, id: "subprocess", wallMs: 1 },
    ];
    expect(lapStatuses({ baseTip: BASE, outcomes, plan })[0]!.description).toBe(
      "local lap: subprocess failed (exit 1) on its retry over base 4cf8df588a; 7 green only on retry: integration, unit-1, unit-2, unit-3, unit-4,",
    );
  });

  it("names a retried green in a context another context's red stopped", () => {
    const upTo = plan.findIndex((step) => step.id === "unit-1");
    const outcomes = allGreen
      .slice(0, upTo + 1)
      .map((outcome) => (outcome.id === "unit-1" ? { ...outcome, firstExit: 1 } : outcome));
    const planned = plan.filter((step) => step.context === "build").length;
    const ran = outcomes.filter((outcome) => outcome.context === "build").length;
    expect(lapStatuses({ baseTip: BASE, outcomes, plan })[0]!.description).toBe(
      `local lap stopped: ${String(planned - ran)} of ${String(planned)} steps never ran over base 4cf8df588a; 1 green only on retry: unit-1`,
    );
  });

  it("retries only the Vitest lanes", () => {
    expect(
      lapPlan()
        .filter((step) => step.retryable)
        .map((step) => step.id),
    ).toEqual(["integration", "unit-1", "unit-2", "unit-3", "unit-4", "unit-5", "unit-6", "subprocess"]);
  });

  it("posts the red step's name, and an unrun context as stopped, never green", () => {
    const outcomes = [allGreen[0]!, { ...allGreen[1]!, exitCode: 1 }];
    expect(lapStatuses({ baseTip: BASE, outcomes, plan })).toEqual([
      {
        context: "build",
        description: `local lap stopped: ${String(plan.filter((s) => s.context === "build").length - 1)} of ${String(plan.filter((s) => s.context === "build").length)} steps never ran over base 4cf8df588a`,
        state: "failure",
      },
      {
        context: "integration",
        description: "local lap: integration failed (exit 1) over base 4cf8df588a",
        state: "failure",
      },
    ]);
  });

  it("keeps every description within GitHub's 140-character cap", () => {
    const outcomes = plan.map((step) => ({ context: step.context, exitCode: 1, id: step.id.repeat(20), wallMs: 1 }));
    const lengths = lapStatuses({ baseTip: BASE, outcomes, plan }).map((status) => status.description.length);
    expect(lengths.filter((length) => length > STATUS_DESCRIPTION_MAX)).toEqual([]);
    expect(lengths.length).toBe(LAP_CONTEXTS.length);
  });
});

describe("lapPendingStatuses and lapErrorStatuses", () => {
  it("marks both contexts pending over the base before a lane runs", () => {
    expect(lapPendingStatuses({ baseTip: BASE })).toEqual([
      { context: "build", description: "local lap running over base 4cf8df588a", state: "pending" },
      { context: "integration", description: "local lap running over base 4cf8df588a", state: "pending" },
    ]);
  });

  it("marks both contexts error with the reason, cut to GitHub's cap", () => {
    const statuses = lapErrorStatuses({ baseTip: BASE, why: "x".repeat(400) });
    expect(statuses.map((status) => [status.state, status.description.length])).toEqual([
      ["error", STATUS_DESCRIPTION_MAX],
      ["error", STATUS_DESCRIPTION_MAX],
    ]);
  });
});
