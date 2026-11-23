/*
 * The pure fixtures every `turn dispatch` test file shares: the routing input a brief is built over, the
 * capture-time card a dispatching ask arrives with, and the three respond decisions. They moved here, unchanged,
 * when `dispatch.test.ts` was split by behaviour.
 */
import type { RoutingJudgementInput } from "../../../../../../live/turn/judgement.js";
import type { RespondDecision } from "../../../../../../live/turn/tier.js";

/** The routing input every brief is built over: the owner asking for their open pull requests, one turn. */
export const ROUTING_INPUT: RoutingJudgementInput = {
  availableCapabilities: [
    {
      availability: { kind: "available" },
      command: ["fleet", "status"],
      coverage: { detail: "complete", kind: "complete" },
      effect: "read",
      freshness: { detail: "live", kind: "live" },
      id: "fleet-status",
      owner: "slopweaver",
      sourceClass: "repository",
      terms: ["prs"],
      truthMode: "current",
      what: "open pull requests",
    },
  ],
  context: {
    controlPlane: { ownerAddressingText: "what are my open PRs?", structuralMetadata: [] },
    quotedEvidence: [],
  },
  execution: { mode: "single-turn", supervisorHost: "claude-code" },
};

/**
 * The capture-time card a real ask arrives with. Every test that DISPATCHES passes it, because a dispatch
 * now refuses an ask with no live progress card at all (`turn/ensureCard.ts`); a test
 * that only triages omits it, exactly as `listen` leaves it absent when its own capture post never landed.
 */
export const CAPTURE_CARD = { turnId: "turn-capture-default", workingTs: "1.100100" } as const;

/** A respond decision answered inline, from context and judgement alone. */
export const RESPOND_INLINE: RespondDecision = {
  confidence: "high",
  needs: [],
  rationale: "context and judgement alone answer this",
  response: "respond",
  truthMode: "none",
  schemaVersion: 1,
  tier: "inline",
};

/** A respond decision routed to a read-only subagent that checks open pull requests. */
export const RESPOND_SUBAGENT: RespondDecision = {
  confidence: "high",
  needs: [{ capabilityId: "fleet-status", reason: "check open PRs", requirement: "required" }],
  rationale: "a bounded investigation answers this",
  response: "respond",
  truthMode: "current",
  schemaVersion: 1,
  tier: "read-only-subagent",
};
