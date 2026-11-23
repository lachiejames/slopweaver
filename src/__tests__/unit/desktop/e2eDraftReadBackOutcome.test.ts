/**
 * Unit: how `draft-read-back` is judged. Routed through the long task, a fast and correct read-back would fail
 * `long-task-missing`, so it is judged on the owner's turn and the voice's read-back, never a long
 * task; what counts as a read-back, a quoted draft carrying both asked words, is `e2eDraftReadBackWords.test.ts`'s.
 */
import { describe, expect, it } from "vitest";

import { judgeCallScenario } from "../../../desktop/e2eCallOutcome.js";
import { callRequirementsOf } from "../../../desktop/e2eCallRequirements.js";
import { CLEAN } from "./e2eCallObservedFixture.js";

describe("judgeCallScenario on draft-read-back", () => {
  it("is judged on the owner's turn and the voice's read-back, never on a long task", () => {
    expect(callRequirementsOf({ id: "draft-read-back" })).toEqual({
      cardNext: false,
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
      voiceAnswer: true,
    });
  });

  it("passes a read-back drafted in four seconds, which the long task would fail", () => {
    const observed = { ...CLEAN, longTaskMs: 4000 };
    expect([
      judgeCallScenario({ id: "draft-read-back", observed }),
      judgeCallScenario({ id: "long-task-mid-call", observed }).passed,
    ]).toEqual([{ passed: true }, false]);
  });

  it("fails a call whose voice quoted no draft, named as that rather than as no voice row", () => {
    const observed = { ...CLEAN, voiceAnswer: false };
    expect([
      judgeCallScenario({ id: "draft-read-back", observed }),
      judgeCallScenario({ id: "fleet-ask", observed }),
    ]).toEqual([
      {
        detail: "the voice quoted no draft carrying both asked words after the owner's last turn",
        kind: "answer-missing",
        passed: false,
      },
      { detail: "no final voice row followed the owner's", kind: "answer-missing", passed: false },
    ]);
  });
});
