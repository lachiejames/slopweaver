/**
 * A routing section that meets the judgement-mining balance contract (`src/judgement/miningBalance.ts`)
 * exactly at its minimums: one principle and two examples per decision, and three counterexamples — an ask
 * and a refusal that should each have been an act, and an act that should have been an ask. Shared by the
 * pure brief tests and the `route profile-answer` CLI tests so both accept the same smallest valid shape.
 */
import { sha256Text } from "../lib/hash.js";
import { JUDGEMENT_ROUTING_DECISIONS, type JudgementRoutingDecision } from "../live/turn/judgementProfile.js";

/** A labelled routing example, hashed over its own text. */
interface LabelledExample {
  decision: JudgementRoutingDecision;
  sourceHash: string;
  text: string;
}

/** The mutable routing-section shape a drafted answer carries. */
interface DraftRouting {
  counterexamples: { example: LabelledExample; expectedDecision: JudgementRoutingDecision; whyRejected: string }[];
  examples: LabelledExample[];
  principles: { decision: JudgementRoutingDecision; text: string }[];
}

/**
 * A routing example labelled with a decision, hashed over its own text.
 *
 * @param decision the decision the example shows
 * @param text the example's own text
 * @returns the example
 */
export function labelledExample({
  decision,
  text,
}: {
  decision: JudgementRoutingDecision;
  text: string;
}): LabelledExample {
  return { decision, sourceHash: sha256Text({ text }), text };
}

/**
 * A routing section at the balance contract's exact minimums.
 *
 * @returns a fresh, mutable routing section each call
 */
export function balancedRouting(): DraftRouting {
  const wrongCalls: readonly { decision: JudgementRoutingDecision; expected: JudgementRoutingDecision }[] = [
    { decision: "ask", expected: "act" },
    { decision: "refuse", expected: "act" },
    { decision: "act", expected: "ask" },
  ];
  return {
    counterexamples: wrongCalls.map(({ decision, expected }) => ({
      example: labelledExample({ decision, text: `wrong ${decision}` }),
      expectedDecision: expected,
      whyRejected: `${decision} where ${expected} was right`,
    })),
    examples: JUDGEMENT_ROUTING_DECISIONS.flatMap((decision) => [
      labelledExample({ decision, text: `${decision} one` }),
      labelledExample({ decision, text: `${decision} two` }),
    ]),
    principles: JUDGEMENT_ROUTING_DECISIONS.map((decision) => ({ decision, text: `when to ${decision}` })),
  };
}
