/**
 * `judgeRouting` over a proposal-shaped ask: a decision whose legs cannot say whether the proposed thing already
 * exists is refused, and one that names a provider leg to go and look with is admitted.
 */
import { describe, expect, it } from "vitest";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { judgeRouting, type RoutingDecision } from "../../../../../live/turn/judgement.js";
import {
  AVAILABLE_CAPABILITY,
  BASE_INPUT,
  HISTORICAL_CAPABILITY,
  NO_RESPONSE,
  SELF_DESCRIBING_CAPABILITY,
} from "./harness.js";

describe("judgeRouting", () => {
  it("REFUSES a proposal-shaped ask whose legs cannot say whether the thing already exists", () => {
    // The owner-BAD answer, reproduced: a present-state check on a proposal ask was the one leg
    // it never named. Its decision passed every field-level check and the truthMode pairing too — it said
    // `current` and named two current-truth legs — and both of those legs describe this installation rather
    // than the world the ask proposed something in, so neither could ever have answered "does it exist".
    const decision: RoutingDecision = {
      confidence: "high",
      needs: [
        { capabilityId: "catalog", reason: "what the verb surface offers on day one", requirement: "required" },
        { capabilityId: "corpus", reason: "what was said about it before", requirement: "optional" },
      ],
      rationale: "costing the proposal from the build and the corpus",
      response: "respond",
      schemaVersion: 1,
      tier: "fresh-visible-session",
      truthMode: "current",
    };
    const result = judgeRouting({
      context: {
        ...BASE_INPUT,
        availableCapabilities: [AVAILABLE_CAPABILITY, SELF_DESCRIBING_CAPABILITY],
        context: {
          controlPlane: {
            ownerAddressingText: "what does standing this up cost the platform team",
            structuralMetadata: [{ key: "channel", value: "C1" }],
          },
          quotedEvidence: [],
        },
        historicalCapabilities: [HISTORICAL_CAPABILITY],
      },
      judgement: () => decision,
    });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).join(" ")).toContain("names no REQUIRED leg that could check whether it already does");
  });

  it("REFUSES an existence leg the decision marked OPTIONAL — an optional check is one nobody has to run", () => {
    const decision: RoutingDecision = {
      confidence: "high",
      needs: [
        { capabilityId: "catalog", reason: "what this build offers", requirement: "required" },
        { capabilityId: "github-vulnerability-report", reason: "might be worth a look", requirement: "optional" },
      ],
      rationale: "costing it, with a look if there is time",
      response: "respond",
      schemaVersion: 1,
      tier: "inline",
      truthMode: "current",
    };
    const result = judgeRouting({
      context: {
        ...BASE_INPUT,
        availableCapabilities: [AVAILABLE_CAPABILITY, SELF_DESCRIBING_CAPABILITY],
        context: {
          controlPlane: { ownerAddressingText: "should we stand up a second queue", structuralMetadata: [] },
          quotedEvidence: [],
        },
      },
      judgement: () => decision,
    });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).join(" ")).toContain("names no REQUIRED leg");
  });

  it("quotes the proposal wording back, so the refusal points at the premise rather than at the answer", () => {
    const decision: RoutingDecision = {
      confidence: "high",
      needs: [{ capabilityId: "catalog", reason: "what this build can do", requirement: "required" }],
      rationale: "costing it from the build alone",
      response: "respond",
      schemaVersion: 1,
      tier: "inline",
      truthMode: "current",
    };
    const result = judgeRouting({
      context: {
        ...BASE_INPUT,
        availableCapabilities: [SELF_DESCRIBING_CAPABILITY],
        context: {
          controlPlane: {
            ownerAddressingText: "should we build a second review queue for this",
            structuralMetadata: [],
          },
          quotedEvidence: [],
        },
      },
      judgement: () => decision,
    });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).join(" ")).toContain('"should we"');
  });

  it("ACCEPTS a proposal-shaped ask that names a provider leg to go and look with", () => {
    const decision: RoutingDecision = {
      confidence: "high",
      needs: [
        { capabilityId: "catalog", reason: "what the verb surface offers on day one", requirement: "required" },
        {
          capabilityId: "github-vulnerability-report",
          reason: "check whether the repository is already there",
          requirement: "required",
        },
      ],
      rationale: "look first, then cost it",
      response: "respond",
      schemaVersion: 1,
      tier: "fresh-visible-session",
      truthMode: "current",
    };
    const result = judgeRouting({
      context: {
        ...BASE_INPUT,
        availableCapabilities: [AVAILABLE_CAPABILITY, SELF_DESCRIBING_CAPABILITY],
        context: {
          controlPlane: {
            ownerAddressingText: "what does standing this up cost the platform team",
            structuralMetadata: [],
          },
          quotedEvidence: [],
        },
      },
      judgement: () => decision,
    });

    expect(result.isOk()).toBe(true);
  });

  it("leaves a no-response decision on a proposal ask alone — declining asserts nothing about the premise", () => {
    const result = judgeRouting({
      context: {
        ...BASE_INPUT,
        context: {
          controlPlane: { ownerAddressingText: "should we adopt this", structuralMetadata: [] },
          quotedEvidence: [],
        },
      },
      judgement: () => NO_RESPONSE,
    });

    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toEqual(NO_RESPONSE);
  });

  it("leaves a NON-proposal ask alone — a self-describing leg is a fine answer to what can you do", () => {
    const decision: RoutingDecision = {
      confidence: "high",
      needs: [{ capabilityId: "catalog", reason: "asked what the verbs are", requirement: "required" }],
      rationale: "a direct question about this build",
      response: "respond",
      schemaVersion: 1,
      tier: "inline",
      truthMode: "current",
    };
    const result = judgeRouting({
      context: {
        ...BASE_INPUT,
        availableCapabilities: [SELF_DESCRIBING_CAPABILITY],
        context: {
          controlPlane: { ownerAddressingText: "what verbs do you have", structuralMetadata: [] },
          quotedEvidence: [],
        },
      },
      judgement: () => decision,
    });

    expect(result.isOk()).toBe(true);
  });
});
