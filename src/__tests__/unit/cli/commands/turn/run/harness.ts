/*
 * What the `turn answer` test files share: the full v6 brief and its answerable projection, the decision a turn was
 * dispatched under, and the throwaway directories a case mints. Each test file that mints one registers
 * `removeFixtureDirs` with `afterEach`. It moved here when the `turn answer` tests were split by behaviour.
 */
import { rmSync } from "node:fs";

import { buildTurnRoutingBrief, type TurnRoutingBrief } from "../../../../../../live/turn/brief.js";
import { type AnswerableBrief, answerableProjectionOf } from "../../../../../../live/turn/briefAnswerable.js";
import type { RoutingJudgementInput } from "../../../../../../live/turn/judgement.js";
import type { RespondDecision } from "../../../../../../live/turn/tier.js";

/** Every fixture directory these tests have minted, so a test file's `afterEach` can remove them. */
export const fixtureDirs: string[] = [];

/** Remove every fixture directory minted since the last call; each test file registers it with `afterEach`. */
export function removeFixtureDirs(): void {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
}

const ROUTING_INPUT: RoutingJudgementInput = {
  availableCapabilities: [],
  context: { controlPlane: { ownerAddressingText: "what did we decide?", structuralMetadata: [] }, quotedEvidence: [] },
  execution: { mode: "single-turn", supervisorHost: "claude-code" },
};

/** A well-formed FULL v6 brief, as `turn brief` would have written it. */
export const FULL_BRIEF: TurnRoutingBrief = buildTurnRoutingBrief({
  channel: "C1",
  messageTs: "1.1",
  question: "what did we decide?",
  routingInput: ROUTING_INPUT,
  surface: "channel",
  threadTs: "1.1",
  unavailableCapabilities: [
    {
      availability: { kind: "unavailable", reason: "no connector" },
      command: [],
      coverage: { detail: "n/a", kind: "unknown" },
      effect: "read",
      freshness: { detail: "n/a", kind: "unknown" },
      id: "test",
      owner: "slopweaver",
      sourceClass: "provider",
      terms: ["test"],
      truthMode: "current",
      what: "a test surface",
    },
  ],
  userId: "U_ASKER",
});

/** The answerable projection — what `mentionFromBrief` and the assertions below actually read. */
export const BRIEF: AnswerableBrief = answerableProjectionOf({ brief: FULL_BRIEF });

export const DECISION: RespondDecision = {
  confidence: "high",
  needs: [],
  rationale: "context and judgement alone answer this",
  response: "respond",
  truthMode: "none",
  schemaVersion: 1,
  tier: "inline",
};
