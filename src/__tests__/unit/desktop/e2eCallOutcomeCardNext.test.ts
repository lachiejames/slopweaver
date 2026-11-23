import { describe, expect, it } from "vitest";

import { type E2eCallObserved, judgeCallScenario } from "../../../desktop/e2eCallOutcome.js";
import { callRequirementsOf } from "../../../desktop/e2eCallRequirements.js";
import { CLEAN } from "./e2eCallObservedFixture.js";

describe("judgeCallScenario on card-next", () => {
  const leaving = ({ moves, stuck }: { moves: readonly string[]; stuck: readonly string[] }): E2eCallObserved => ({
    ...CLEAN,
    evidence: { ...CLEAN.evidence, cardNext: { moves, stuck } },
    voiceAnswer: false,
  });

  it("is judged on the owner's turn and the card leaving, never on an answer", () => {
    expect(callRequirementsOf({ id: "card-next" })).toEqual({
      cardNext: true,
      cardRead: false,
      crash: false,
      greeting: false,
      heap: false,
      ownerTurn: true,
      longTask: false,
      planCalls: 1,
      queueSearch: false,
      readingHold: false,
      reopen: false,
      voiceAnswer: false,
    });
  });

  it("passes on a call that took the card down, with no answer at all", () => {
    const moves = ["call t1: card-move at 2026-11-01T10:00:31.500Z: ask:a to ask:b, 11.5s after their ask"];
    expect(judgeCallScenario({ id: "card-next", observed: leaving({ moves, stuck: [] }) })).toEqual({ passed: true });
  });

  it("fails a card that stayed up even beside a call that moved, naming it", () => {
    const stuck = ["call t2: ask:a still up 25s after their ask at 2026-11-01T10:00:20.000Z"];
    expect(judgeCallScenario({ id: "card-next", observed: leaving({ moves: ["call t1: moved"], stuck }) })).toEqual({
      detail: `the card stayed up after they asked for the next one: ${stuck[0]!}`,
      kind: "card-stuck",
      passed: false,
    });
  });

  it("fails when no call decided", () => {
    expect(judgeCallScenario({ id: "card-next", observed: leaving({ moves: [], stuck: [] }) })).toEqual({
      detail: `no call of this scenario holds the named card up, the owner's "next card please" and the card taken down after it`,
      kind: "evidence-missing",
      passed: false,
    });
  });

  it("never judges the card leaving on another scenario", () => {
    const stuck = ["call t2: stuck"];
    expect(
      judgeCallScenario({ id: "call-live", observed: { ...leaving({ moves: [], stuck }), voiceAnswer: true } }),
    ).toEqual({ passed: true });
  });
});
