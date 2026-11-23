import { describe, expect, it } from "vitest";

import { type E2eCallObserved, judgeCallScenario } from "../../../desktop/e2eCallOutcome.js";
import { callRequirementsOf } from "../../../desktop/e2eCallRequirements.js";
import { CLEAN } from "./e2eCallObservedFixture.js";

describe("judgeCallScenario on card-reading-hold", () => {
  const holding = ({ held, moves }: { held: readonly string[]; moves: readonly string[] }): E2eCallObserved => ({
    ...CLEAN,
    evidence: { ...CLEAN.evidence, readingHold: { heldCallIds: held, moves } },
    voiceAnswer: false,
  });

  it("is judged on the owner's turn and the hold, never on an answer", () => {
    expect(callRequirementsOf({ id: "card-reading-hold" })).toEqual({
      cardNext: false,
      cardRead: false,
      crash: false,
      greeting: false,
      heap: false,
      ownerTurn: true,
      longTask: false,
      planCalls: 1,
      queueSearch: false,
      readingHold: true,
      reopen: false,
      voiceAnswer: false,
    });
  });

  it("passes on a call that held with no answer at all", () => {
    expect(judgeCallScenario({ id: "card-reading-hold", observed: holding({ held: ["t1"], moves: [] }) })).toEqual({
      passed: true,
    });
  });

  it("fails a move even beside a call that held, naming the line", () => {
    const moves = ["call t2: resume at 2026-11-01T10:00:12.000Z: the page resumed"];
    expect(judgeCallScenario({ id: "card-reading-hold", observed: holding({ held: ["t1"], moves }) })).toEqual({
      detail: `moved the owner off the card they were reading: ${moves[0]!}`,
      kind: "moved-off-card",
      passed: false,
    });
  });

  it("fails when no call held", () => {
    expect(judgeCallScenario({ id: "card-reading-hold", observed: holding({ held: [], moves: [] }) })).toEqual({
      detail:
        "no call of this scenario holds the named card up while the owner keeps reading through a whole quiet window",
      kind: "evidence-missing",
      passed: false,
    });
  });

  it("never judges the hold on another scenario", () => {
    const moves = ["call t2: resume"];
    expect(
      judgeCallScenario({ id: "call-live", observed: { ...holding({ held: [], moves }), voiceAnswer: true } }),
    ).toEqual({ passed: true });
  });
});
