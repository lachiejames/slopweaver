/*
 * The pure fixtures every v6 brief test file shares: the tag decision tree for an untrusted asker on an
 * install with no rulings, the three capability contracts, the routing input, and the `brief` builder that
 * dresses a question as a channel ask. Pure data; nothing here touches a disk or a provider.
 */
import type { AskerTrust } from "../../../../../live/listen/trustedTier.js";
import { buildTurnRoutingBrief, type TurnRoutingBrief } from "../../../../../live/turn/brief.js";
import type { GeneralRulings } from "../../../../../live/turn/generalRulings.js";
import type { RoutingJudgementInput } from "../../../../../live/turn/judgement.js";
import { tagDecisionTreeLines } from "../../../../../live/turn/tagDecisionTree.js";

const NOT_TRUSTED: AskerTrust = { trusted: false, why: "`U_ASKER` is not on trusted-askers.json" };
const NO_RULINGS: GeneralRulings = { kind: "absent" };
/** The tree exactly as `tagDecisionTreeFor` renders it for an untrusted asker on an install with no rulings. */
export const TAG_TREE = tagDecisionTreeLines({ rulings: NO_RULINGS, trust: NOT_TRUSTED });

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

export const UNAVAILABLE_CAPABILITY = {
  availability: { kind: "unavailable" as const, reason: "no connector reaches production logs" },
  command: [] as readonly string[],
  coverage: { detail: "unknown", kind: "unknown" as const },
  effect: "read" as const,
  freshness: { detail: "unknown", kind: "unknown" as const },
  id: "production-logs",
  owner: "slopweaver",
  sourceClass: "provider" as const,
  terms: ["logs"],
  truthMode: "current" as const,
  what: "production log records",
};

export const HISTORICAL_CAPABILITY = {
  availability: { kind: "available" as const },
  command: ["slopweaver", "ask", "--store", "what did we decide?"],
  coverage: { detail: "a bounded recent window per platform", kind: "bounded" as const },
  effect: "read" as const,
  freshness: { detail: "as fresh as the last store load", kind: "snapshot" as const },
  id: "corpus",
  owner: "slopweaver",
  sourceClass: "corpus" as const,
  terms: ["what did we decide"],
  truthMode: "history" as const,
  what: "what the org's own records say",
};

export const ROUTING_INPUT: RoutingJudgementInput = {
  availableCapabilities: [AVAILABLE_CAPABILITY],
  historicalCapabilities: [HISTORICAL_CAPABILITY],
  context: {
    controlPlane: {
      ownerAddressingText: "what are my open vulnerabilities?",
      structuralMetadata: [{ key: "channel", value: "C1" }],
    },
    quotedEvidence: [],
  },
  execution: { mode: "single-turn", supervisorHost: "claude-code" },
};

/**
 * A channel ask from `U_ASKER` in thread `1.1`, carrying {@link ROUTING_INPUT} and the one unavailable
 * capability, so a case varies only the question.
 *
 * @returns the brief `buildTurnRoutingBrief` builds for that ask
 */
export const brief = ({ question }: { question: string }): TurnRoutingBrief =>
  buildTurnRoutingBrief({
    channel: "C1",
    messageTs: "1.1",
    question,
    routingInput: ROUTING_INPUT,
    surface: "channel",
    threadTs: "1.1",
    unavailableCapabilities: [UNAVAILABLE_CAPABILITY],
    userId: "U_ASKER",
  });
