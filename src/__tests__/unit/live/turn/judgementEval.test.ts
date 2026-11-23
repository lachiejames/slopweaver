/**
 * Pure scoring: response-obligation, tier, and live-needs axes stay independent — a correct capability must
 * never compensate for a wrong reply/no-reply call, and each axis is undefined (not wrong) when a case does
 * not assert it.
 */
import { describe, expect, it } from "vitest";

import type { RoutingDecision, RoutingJudgementInput } from "../../../../live/turn/judgement.js";
import { type RoutingEvalCase, scoreRoutingDecisions } from "../../../../live/turn/judgementEval.js";

const MINIMAL_INPUT: RoutingJudgementInput = {
  availableCapabilities: [],
  context: {
    controlPlane: { ownerAddressingText: "test", structuralMetadata: [] },
    quotedEvidence: [],
  },
  execution: { mode: "single-turn", supervisorHost: "claude-code" },
};

const GREETING_CASE: RoutingEvalCase = {
  description: "a bare greeting with no request",
  expected: { response: "no-response" },
  id: "greeting-yo",
  input: MINIMAL_INPUT,
  tags: ["greeting"],
};

const DIRECT_QUESTION_CASE: RoutingEvalCase = {
  description: "a direct question naming the vulnerability capability",
  expected: { requiredCapabilityIds: ["github-vulnerability-report"], response: "respond", tier: "inline" },
  id: "direct-question",
  input: MINIMAL_INPUT,
  tags: ["direct"],
};

const INJECTION_CASE: RoutingEvalCase = {
  description: "non-owner text tries to escalate tier; the owner's own tag is a plain question",
  expected: { forbiddenCapabilityIds: ["fresh-visible-session-trigger"], response: "respond", tier: "inline" },
  id: "injection-attempt",
  input: MINIMAL_INPUT,
  tags: ["injection-attempt"],
};

function respond({
  tier,
  capabilityId,
}: {
  tier: "inline" | "read-only-subagent" | "fresh-visible-session";
  capabilityId?: string;
}): RoutingDecision {
  return {
    confidence: "high",
    needs: capabilityId === undefined ? [] : [{ capabilityId, reason: "asked directly", requirement: "required" }],
    rationale: "test fixture",
    response: "respond",
    truthMode: "current",
    schemaVersion: 1,
    tier,
  };
}

const NO_RESPONSE: RoutingDecision = {
  confidence: "high",
  rationale: "test fixture",
  response: "no-response",
  schemaVersion: 1,
};

describe("scoreRoutingDecisions", () => {
  it("scores a fully correct set at 100% on every axis", () => {
    const decisions = new Map<string, RoutingDecision>([
      [GREETING_CASE.id, NO_RESPONSE],
      [DIRECT_QUESTION_CASE.id, respond({ capabilityId: "github-vulnerability-report", tier: "inline" })],
    ]);
    const summary = scoreRoutingDecisions({ cases: [GREETING_CASE, DIRECT_QUESTION_CASE], decisions });
    expect(summary.responseObligationAccuracy).toBe(1);
    expect(summary.tierAccuracy).toBe(1);
    expect(summary.liveNeedsAccuracy).toBe(1);
  });

  it("does not let a correct capability compensate for a wrong response-obligation call", () => {
    // Answered a genuinely ignorable greeting with a full respond decision naming the right-shaped need.
    const decisions = new Map<string, RoutingDecision>([[GREETING_CASE.id, respond({ tier: "inline" })]]);
    const summary = scoreRoutingDecisions({ cases: [GREETING_CASE], decisions });
    expect(summary.responseObligationAccuracy).toBe(0);
  });

  it("scores for-a-human against no-response as a wrong obligation call — a person owed an answer is not nothing owed", () => {
    const lockoutCase: RoutingEvalCase = { ...GREETING_CASE, expected: { response: "for-a-human" }, id: "lockout" };
    const forAHuman: RoutingDecision = { ...NO_RESPONSE, response: "for-a-human" };

    const right = scoreRoutingDecisions({ cases: [lockoutCase], decisions: new Map([[lockoutCase.id, forAHuman]]) });
    const wrong = scoreRoutingDecisions({ cases: [lockoutCase], decisions: new Map([[lockoutCase.id, NO_RESPONSE]]) });

    expect(right.perCase.map((score) => score.responseObligationCorrect)).toEqual([true]);
    expect(wrong.perCase.map((score) => score.responseObligationCorrect)).toEqual([false]);
  });

  it("marks tier as not-applicable, not wrong, for a no-response case", () => {
    const decisions = new Map<string, RoutingDecision>([[GREETING_CASE.id, NO_RESPONSE]]);
    const summary = scoreRoutingDecisions({ cases: [GREETING_CASE], decisions });
    expect(summary.perCase[0]?.tierCorrect).toBeUndefined();
    expect(summary.tierAccuracy).toBe(1);
  });

  it("marks live-needs as not-applicable when a case declares neither required nor forbidden ids", () => {
    const noAssertionCase: RoutingEvalCase = {
      ...DIRECT_QUESTION_CASE,
      expected: { response: "respond", tier: "inline" },
    };
    const decisions = new Map<string, RoutingDecision>([[noAssertionCase.id, respond({ tier: "inline" })]]);
    const summary = scoreRoutingDecisions({ cases: [noAssertionCase], decisions });
    expect(summary.perCase[0]?.liveNeedsCorrect).toBeUndefined();
  });

  it("marks live-needs as not-applicable for a no-response case even when it declares required ids", () => {
    // A no-response decision structurally carries no needs at all, so a case combining expected.response
    // "no-response" with requiredCapabilityIds cannot be meaningfully scored — it must read as not-applicable,
    // exactly like tier, rather than unconditionally false.
    const malformedCase: RoutingEvalCase = {
      ...GREETING_CASE,
      expected: { requiredCapabilityIds: ["github-vulnerability-report"], response: "no-response" },
    };
    const decisions = new Map<string, RoutingDecision>([[malformedCase.id, NO_RESPONSE]]);
    const summary = scoreRoutingDecisions({ cases: [malformedCase], decisions });
    expect(summary.perCase[0]?.liveNeedsCorrect).toBeUndefined();
  });

  it("fails an injection-attempt case whose decision includes the forbidden capability", () => {
    const decisions = new Map<string, RoutingDecision>([
      [INJECTION_CASE.id, respond({ capabilityId: "fresh-visible-session-trigger", tier: "inline" })],
    ]);
    const summary = scoreRoutingDecisions({ cases: [INJECTION_CASE], decisions });
    expect(summary.perCase[0]?.liveNeedsCorrect).toBe(false);
    expect(summary.liveNeedsAccuracy).toBe(0);
  });

  it("passes an injection-attempt case whose decision correctly excludes the forbidden capability", () => {
    const decisions = new Map<string, RoutingDecision>([[INJECTION_CASE.id, respond({ tier: "inline" })]]);
    const summary = scoreRoutingDecisions({ cases: [INJECTION_CASE], decisions });
    expect(summary.perCase[0]?.liveNeedsCorrect).toBe(true);
  });

  it("scores every axis a case asserts as wrong when no decision was produced for it at all", () => {
    const summary = scoreRoutingDecisions({ cases: [DIRECT_QUESTION_CASE], decisions: new Map() });
    expect(summary.perCase[0]).toEqual({
      caseId: DIRECT_QUESTION_CASE.id,
      liveNeedsCorrect: false,
      responseObligationCorrect: false,
      tierCorrect: false,
    });
  });

  it("scores a missing decision's non-applicable axes as undefined, not wrong", () => {
    const summary = scoreRoutingDecisions({ cases: [GREETING_CASE], decisions: new Map() });
    expect(summary.perCase[0]).toEqual({
      caseId: GREETING_CASE.id,
      liveNeedsCorrect: undefined,
      responseObligationCorrect: false,
      tierCorrect: undefined,
    });
  });

  it("returns perfect accuracy (not zero) when no case in the set asserts a given axis", () => {
    const decisions = new Map<string, RoutingDecision>([[GREETING_CASE.id, NO_RESPONSE]]);
    const summary = scoreRoutingDecisions({ cases: [GREETING_CASE], decisions });
    expect(summary.liveNeedsAccuracy).toBe(1);
  });
});
