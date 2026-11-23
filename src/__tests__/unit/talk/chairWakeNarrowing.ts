/** Narrow a chair-wake result to the one kind a case expects, throwing on any other: pure, so any case may reuse it. */
import type { ChairWakeDecision } from "../../../talk/chairWake.js";
import type { ChairWakeOutcome } from "../../../talk/chairWakeShell.js";

/**
 * The outcome as a typed batch, throwing when it is anything else.
 *
 * @returns the outcome, narrowed to a typed batch
 */
export const woken = ({ outcome }: { outcome: ChairWakeOutcome }): Extract<ChairWakeOutcome, { kind: "woke" }> => {
  if (outcome.kind !== "woke") {
    throw new Error(`expected a typed batch, got ${outcome.kind}`);
  }
  return outcome;
};

/**
 * The decision as a batch to type, throwing when it is anything else.
 *
 * @returns the decision, narrowed to a batch to type
 */
export const wakeOf = ({ decision }: { decision: ChairWakeDecision }): Extract<ChairWakeDecision, { kind: "wake" }> => {
  if (decision.kind !== "wake") {
    throw new Error(`expected a batch to type, got ${decision.kind}`);
  }
  return decision;
};
