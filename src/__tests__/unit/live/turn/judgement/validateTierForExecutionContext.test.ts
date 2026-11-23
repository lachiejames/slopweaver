/**
 * Which execution tiers a routing decision may name in each invocation mode, on each supervisor host.
 */
import { describe, expect, it } from "vitest";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { validateTierForExecutionContext } from "../../../../../live/turn/judgement.js";
import { turnErrorLines } from "../../../../../live/turn/turnErrors.js";

describe("validateTierForExecutionContext", () => {
  const inlineDecision = {
    confidence: "high" as const,
    needs: [],
    rationale: "a plain reply covers this",
    response: "respond" as const,
    schemaVersion: 1 as const,
    tier: "inline" as const,
    truthMode: "none" as const,
  };
  const subagentDecision = { ...inlineDecision, tier: "read-only-subagent" as const };
  const freshSessionDecision = { ...inlineDecision, tier: "fresh-visible-session" as const };

  it("refuses read-only-subagent in continuous-drain mode, since it blocks the drain loop's own session", () => {
    const result = validateTierForExecutionContext({
      decision: subagentDecision,
      execution: { mode: "continuous-drain", supervisorHost: "claude-code" },
    });
    expect(turnErrorLines({ error: unwrapErr(result) })).toEqual([
      "read-only-subagent blocks its calling session for the whole investigation, so it is not admissible " +
        "for the continuous drain loop — re-judge as inline or fresh-visible-session",
    ]);
  });

  it("accepts read-only-subagent in single-turn mode, where a brief block is fine", () => {
    const result = validateTierForExecutionContext({
      decision: subagentDecision,
      execution: { mode: "single-turn", supervisorHost: "claude-code" },
    });
    expect(result.isOk()).toBe(true);
  });

  it("accepts inline in continuous-drain mode", () => {
    const result = validateTierForExecutionContext({
      decision: inlineDecision,
      execution: { mode: "continuous-drain", supervisorHost: "claude-code" },
    });
    expect(result.isOk()).toBe(true);
  });

  it("accepts fresh-visible-session in continuous-drain mode", () => {
    const result = validateTierForExecutionContext({
      decision: freshSessionDecision,
      execution: { mode: "continuous-drain", supervisorHost: "claude-code" },
    });
    expect(result.isOk()).toBe(true);
  });

  it("refuses read-only-subagent in continuous-drain mode on the Codex host too — invocation mode is what matters, not which host", () => {
    const result = validateTierForExecutionContext({
      decision: subagentDecision,
      execution: { mode: "continuous-drain", supervisorHost: "codex" },
    });
    expect(turnErrorLines({ error: unwrapErr(result) })).toEqual([
      "read-only-subagent blocks its calling session for the whole investigation, so it is not admissible " +
        "for the continuous drain loop — re-judge as inline or fresh-visible-session",
    ]);
  });

  it("accepts fresh-visible-session in single-turn mode on the claude-code host", () => {
    const result = validateTierForExecutionContext({
      decision: freshSessionDecision,
      execution: { mode: "single-turn", supervisorHost: "claude-code" },
    });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toBeUndefined();
  });

  // The worker posts its own answer and the supervisor tick's global sweep reconciles an exceptional ending, so a
  // Codex turn needs no same-session wake to dispatch one.
  it("accepts fresh-visible-session in single-turn mode on the codex host", () => {
    const result = validateTierForExecutionContext({
      decision: freshSessionDecision,
      execution: { mode: "single-turn", supervisorHost: "codex" },
    });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toBeUndefined();
  });

  it("accepts inline in single-turn mode on the codex host", () => {
    const result = validateTierForExecutionContext({
      decision: inlineDecision,
      execution: { mode: "single-turn", supervisorHost: "codex" },
    });
    expect(result.isOk()).toBe(true);
  });
});
