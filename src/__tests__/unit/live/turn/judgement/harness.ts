/**
 * The shared fixtures for the routing-judgement tests: the capabilities a context can offer, the base input and a
 * valid no-response decision. Pure data, read by every `judgeRouting` and `parseRoutingDecision` file beside it.
 */
import type { RoutingDecision, RoutingJudgementInput } from "../../../../../live/turn/judgement.js";

export const AVAILABLE_CAPABILITY = {
  availability: { kind: "available" as const },
  command: ["private-cli", "github", "vulnerability-report"],
  coverage: { detail: "complete", kind: "complete" as const },
  effect: "read" as const,
  freshness: { detail: "live", kind: "live" as const },
  id: "github-vulnerability-report",
  owner: "private-cli",
  sourceClass: "provider" as const,
  terms: ["vulnerability"],
  truthMode: "current" as const,
  what: "open security vulnerabilities",
};

export const HISTORICAL_CAPABILITY = {
  availability: { kind: "available" as const },
  command: ["slopweaver", "ask", "brief"],
  coverage: { detail: "only configured sources and the ingested window", kind: "bounded" as const },
  effect: "read" as const,
  freshness: { detail: "the most recent successful local refresh", kind: "periodic" as const },
  id: "corpus",
  owner: "slopweaver",
  sourceClass: "corpus" as const,
  terms: ["what did we decide"],
  truthMode: "history" as const,
  what: "what the connected sources said, decided or recorded",
};

/**
 * The capability that made the measured answer look well-grounded while being blind to its own premise:
 * live, current-truth, and about THIS BUILD rather than about the world the ask was proposing something in.
 */
export const SELF_DESCRIBING_CAPABILITY = {
  availability: { kind: "available" as const },
  command: ["slopweaver", "catalog", "list"],
  coverage: { detail: "every command registered in this build", kind: "complete" as const },
  effect: "read" as const,
  freshness: { detail: "the currently loaded plugin build", kind: "snapshot" as const },
  id: "catalog",
  owner: "slopweaver",
  sourceClass: "artifact" as const,
  terms: ["verbs", "capabilities"],
  truthMode: "current" as const,
  what: "the command surface this plugin build exposes",
};

export const BASE_INPUT: RoutingJudgementInput = {
  availableCapabilities: [AVAILABLE_CAPABILITY],
  context: {
    controlPlane: { ownerAddressingText: "yo", structuralMetadata: [{ key: "channel", value: "C1" }] },
    quotedEvidence: [],
  },
  execution: { mode: "single-turn", supervisorHost: "claude-code" },
};

export const NO_RESPONSE: RoutingDecision = {
  confidence: "high",
  rationale: "a bare greeting carries no request",
  response: "no-response",
  schemaVersion: 1,
};
