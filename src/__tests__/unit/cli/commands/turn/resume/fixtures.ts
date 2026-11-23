/*
 * The pure fixtures every `turn resume` test file shares: the routing input a brief is built over, the one ask
 * identity and its dispatch id, the live progress card a dispatched worker is handed, and the respond decision.
 * They moved here, unchanged, when `resume.test.ts` was split by behaviour.
 */
import { dispatchIdOf } from "../../../../../../live/turn/dispatch.js";
import type { RoutingJudgementInput } from "../../../../../../live/turn/judgement.js";
import type { RespondDecision } from "../../../../../../live/turn/tier.js";

/** The routing input every brief is built over: the owner asking for their open pull requests, one turn. */
export const ROUTING_INPUT: RoutingJudgementInput = {
  availableCapabilities: [],
  context: {
    controlPlane: { ownerAddressingText: "what are my open PRs?", structuralMetadata: [] },
    quotedEvidence: [],
  },
  execution: { mode: "single-turn", supervisorHost: "claude-code" },
};

/** The one ask every case resumes: a channel message that opens its own thread. */
export const ASK_IDENTITY = { channel: "C1", messageTs: "1785000000.000100", threadTs: "1785000000.000100" };
/** The dispatch id `turn dispatch` mints for {@link ASK_IDENTITY}. */
export const DISPATCH_ID = dispatchIdOf({ askIdentity: ASK_IDENTITY });

/** The live progress card every dispatched worker is now handed — the dispatch proves one before this. */
export const RESUME_CARD = { turnId: "turn-1789952000000", workingTs: "1789952379.900100" } as const;

/** A respond decision that needs a fresh visible session's investigation depth. */
export const DECISION: RespondDecision = {
  confidence: "high",
  needs: [],
  rationale: "context and judgement alone answer this",
  response: "respond",
  truthMode: "none",
  schemaVersion: 1,
  tier: "fresh-visible-session",
};
