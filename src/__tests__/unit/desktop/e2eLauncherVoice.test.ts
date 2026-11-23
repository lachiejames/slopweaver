/**
 * `launcher-voice`, the `desktop e2e --call` scenario a launcher's `slopweaver://voice` starts: what it is judged on,
 * and that it is a whole call rather than a Talk press with a different name.
 */
import { describe, expect, it } from "vitest";

import { judgeCallScenario } from "../../../desktop/e2eCallOutcome.js";
import { callRequirementsOf } from "../../../desktop/e2eCallRequirements.js";
import { CLEAN } from "./e2eCallObservedFixture.js";

describe("launcher-voice", () => {
  it("requires a caller turn and an answer, allows at most one plan call, and requires no other call evidence", () => {
    expect(callRequirementsOf({ id: "launcher-voice" })).toEqual({
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

  it("passes a call that went live, heard a caller turn and answered, with nothing else wrong", () => {
    expect(judgeCallScenario({ id: "launcher-voice", observed: CLEAN })).toEqual({ passed: true });
  });

  it("fails a call the address never took live", () => {
    expect(judgeCallScenario({ id: "launcher-voice", observed: { ...CLEAN, live: false } })).toEqual({
      detail: "the call never showed its mute control",
      kind: "call-not-live",
      passed: false,
    });
  });
});
