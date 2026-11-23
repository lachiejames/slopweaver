/**
 * Pure validation for the routing-judgement seam: schema, reserved live needs, and unknown-capability
 * refusal. `judgeRouting` never decides anything itself — it only validates what the injected judgement
 * function returns.
 */
import { describe, expect, it } from "vitest";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { judgeRouting, type RoutingDecision, type RoutingJudgementInput } from "../../../../../live/turn/judgement.js";
import { AVAILABLE_CAPABILITY, BASE_INPUT, HISTORICAL_CAPABILITY, NO_RESPONSE } from "./harness.js";

describe("judgeRouting", () => {
  it("passes through a valid no-response decision", () => {
    const result = judgeRouting({ context: BASE_INPUT, judgement: () => NO_RESPONSE });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toEqual(NO_RESPONSE);
  });

  it("passes through a valid respond decision naming an available capability", () => {
    const decision: RoutingDecision = {
      confidence: "high",
      needs: [{ capabilityId: "github-vulnerability-report", reason: "asked directly", requirement: "required" }],
      rationale: "a direct question about vulnerabilities",
      response: "respond",
      truthMode: "current",
      schemaVersion: 1,
      tier: "inline",
    };
    const result = judgeRouting({ context: BASE_INPUT, judgement: () => decision });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toEqual(decision);
  });

  it("ADMITS the world model as a historical leg — it is a source to consult, not a forbidden word", () => {
    // It used to be reserved outright, which kept history from masquerading as current truth by making the
    // corpus unmentionable. That collided with the owner's ruling that it is "one of the tools in the
    // toolkit". The guarantee did not go away; it moved onto `truthMode`, where it constrains the RELATION
    // between legs instead of banning one of them.
    const decision: RoutingDecision = {
      confidence: "high",
      needs: [
        { capabilityId: "corpus", reason: "what did we decide about the ticket format", requirement: "required" },
      ],
      rationale: "a question about what was decided",
      response: "respond",
      schemaVersion: 1,
      tier: "inline",
      truthMode: "history",
    };
    const result = judgeRouting({
      context: { ...BASE_INPUT, historicalCapabilities: [HISTORICAL_CAPABILITY] },
      judgement: () => decision,
    });

    expect(result.isOk()).toBe(true);
  });

  it("REFUSES a current-state claim built from historical legs alone", () => {
    // The failure this exists to stop: an answer about what is true NOW, assembled entirely from what was
    // true THEN, which reads exactly like a good answer.
    const decision: RoutingDecision = {
      confidence: "high",
      needs: [{ capabilityId: "corpus", reason: "the corpus mentions it", requirement: "required" }],
      rationale: "answering current state from history",
      response: "respond",
      schemaVersion: 1,
      tier: "inline",
      truthMode: "current",
    };
    const result = judgeRouting({
      context: { ...BASE_INPUT, historicalCapabilities: [HISTORICAL_CAPABILITY] },
      judgement: () => decision,
    });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).join(" ")).toContain("must also name a current-truth leg");
  });

  it("ACCEPTS a current claim that pairs the world model with a live leg to check it against", () => {
    // This is the shape the owner described: use the corpus to find the candidate, then read the real thing.
    const decision: RoutingDecision = {
      confidence: "high",
      needs: [
        { capabilityId: "corpus", reason: "find the candidate record", requirement: "required" },
        {
          capabilityId: "github-vulnerability-report",
          reason: "check whether it still holds",
          requirement: "required",
        },
      ],
      rationale: "corpus finds it, the live read verifies it",
      response: "respond",
      schemaVersion: 1,
      tier: "inline",
      truthMode: "current",
    };
    const result = judgeRouting({
      context: { ...BASE_INPUT, historicalCapabilities: [HISTORICAL_CAPABILITY] },
      judgement: () => decision,
    });

    expect(result.isOk()).toBe(true);
  });

  it("REFUSES truthMode none that smuggles legs anyway", () => {
    const decision: RoutingDecision = {
      confidence: "high",
      needs: [{ capabilityId: "github-vulnerability-report", reason: "sneaking a read in", requirement: "required" }],
      rationale: "claims no evidence but names a leg",
      response: "respond",
      schemaVersion: 1,
      tier: "inline",
      truthMode: "none",
    };
    const result = judgeRouting({ context: BASE_INPUT, judgement: () => decision });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).join(" ")).toContain("claims no evidence");
  });

  it("REFUSES a current claim that names no leg at all", () => {
    const decision: RoutingDecision = {
      confidence: "high",
      needs: [],
      rationale: "asserting present state from nothing",
      response: "respond",
      schemaVersion: 1,
      tier: "inline",
      truthMode: "current",
    };
    const result = judgeRouting({ context: BASE_INPUT, judgement: () => decision });

    expect(unwrapErr(result)).toEqual([
      'truthMode "current" asserts present state, but the decision names no leg that could establish it',
    ]);
  });

  it("still refuses the world model when this context did not OFFER it — unreserved is not unconditional", () => {
    const decision: RoutingDecision = {
      confidence: "low",
      needs: [{ capabilityId: "corpus", reason: "not sure, check history", requirement: "required" }],
      rationale: "uncertain",
      response: "respond",
      truthMode: "current",
      schemaVersion: 1,
      tier: "inline",
    };
    const result = judgeRouting({ context: BASE_INPUT, judgement: () => decision });
    expect(result.isErr()).toBe(true);
    // It is refused for a DIFFERENT reason than before: not because the id is forbidden, but because this
    // context never offered it. Unreserving a capability does not make it universally nameable.
    expect(unwrapErr(result).join(" ")).toContain("does not name any capability this context offers");
  });

  it("refuses an OPTIONAL need this context never offered, exactly as it refuses a required one", () => {
    const decision: RoutingDecision = {
      confidence: "low",
      needs: [{ capabilityId: "corpus", reason: "check the archive", requirement: "optional" }],
      rationale: "uncertain",
      response: "respond",
      truthMode: "current",
      schemaVersion: 1,
      tier: "inline",
    };
    const result = judgeRouting({ context: BASE_INPUT, judgement: () => decision });
    expect(unwrapErr(result).join(" ")).toContain(
      'live need "corpus" does not name any capability this context offers',
    );
  });

  it("refuses a respond decision that names a capability the context never offered", () => {
    const decision: RoutingDecision = {
      confidence: "high",
      needs: [{ capabilityId: "hallucinated-capability", reason: "made up", requirement: "required" }],
      rationale: "unclear",
      response: "respond",
      truthMode: "current",
      schemaVersion: 1,
      tier: "inline",
    };
    const result = judgeRouting({ context: BASE_INPUT, judgement: () => decision });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).join(" ")).toContain("does not name any capability");
  });

  it("refuses a hallucinated capability even when availableCapabilities carries a lying Symbol.iterator", () => {
    // A caller-supplied array could override Symbol.iterator (or `some`) to report a membership that isn't
    // real. judgeRouting must clone through the real element data (structuredClone) rather than trust
    // whatever the array's own enumeration protocol reports.
    const capabilities = [AVAILABLE_CAPABILITY];
    Object.defineProperty(capabilities, Symbol.iterator, {
      value: function* lyingIterator() {
        yield { ...AVAILABLE_CAPABILITY, id: "hallucinated-capability" };
      },
    });
    const decision: RoutingDecision = {
      confidence: "high",
      needs: [{ capabilityId: "hallucinated-capability", reason: "made up", requirement: "required" }],
      rationale: "unclear",
      response: "respond",
      truthMode: "current",
      schemaVersion: 1,
      tier: "inline",
    };
    const context: RoutingJudgementInput = { ...BASE_INPUT, availableCapabilities: capabilities };
    const result = judgeRouting({ context, judgement: () => decision });
    expect(unwrapErr(result)).toEqual([
      'live need "hallucinated-capability" does not name any capability this context offers',
    ]);
  });

  it("refuses a no-response decision that smuggles a needs array TypeScript's structural typing permits", () => {
    // A badly-behaved injected judgement can return a JS value carrying properties its declared return type
    // omits — TypeScript does not excess-property-check a value read through a variable. `judgeRouting` must
    // catch this at runtime via the same strict schema `parseRoutingDecision` uses, not trust the type.
    const smuggled = {
      ...NO_RESPONSE,
      needs: [{ capabilityId: "hallucinated-capability", reason: "made up", requirement: "required" as const }],
    };
    const result = judgeRouting({ context: BASE_INPUT, judgement: () => smuggled });
    expect(unwrapErr(result)).toEqual(['Unrecognized key: "needs"']);
  });
});
