/** The routing decision-balance contract, measured and displayed directly — pure, no brief around it. */
import { describe, expect, it } from "vitest";

import {
  routingBalanceLines,
  routingBalanceProblems,
  routingDecisionBalance,
} from "../../../judgement/miningBalance.js";
import { balancedRouting, labelledExample } from "../../balancedRouting.js";

describe("routingDecisionBalance", () => {
  it("counts the minimal balanced section exactly", () => {
    expect(routingDecisionBalance({ routing: balancedRouting() })).toEqual({
      counterexamples: { act: 1, ask: 1, refuse: 1, unlabelled: 0 },
      examples: { act: 2, ask: 2, refuse: 2, unlabelled: 0 },
      principles: { act: 1, ask: 1, refuse: 1, unlabelled: 0 },
      sameDecisionCounterexamples: 0,
      shouldHaveActed: 2,
      shouldNotHaveActed: 1,
    });
  });

  it("counts a bare-string principle and an unlabelled example as unlabelled", () => {
    const routing = {
      ...balancedRouting(),
      examples: [{ sourceHash: labelledExample({ decision: "act", text: "x" }).sourceHash, text: "x" }],
      principles: ["a pre-label principle"],
    };
    const balance = routingDecisionBalance({ routing });
    expect(balance.principles).toEqual({ act: 0, ask: 0, refuse: 0, unlabelled: 1 });
    expect(balance.examples).toEqual({ act: 0, ask: 0, refuse: 0, unlabelled: 1 });
  });
});

describe("routingBalanceProblems", () => {
  it("finds nothing wrong with the minimal balanced section", () => {
    expect(routingBalanceProblems({ balance: routingDecisionBalance({ routing: balancedRouting() }) })).toEqual([]);
  });

  it("names a section with no counterexamples at all, in its fixed order", () => {
    const routing = { ...balancedRouting(), counterexamples: [] };
    expect(routingBalanceProblems({ balance: routingDecisionBalance({ routing }) })).toEqual([
      'routing counterexamples hold 0 "act", at least 1 needed',
      'routing counterexamples hold 0 "ask", at least 1 needed',
      'routing counterexamples hold 0 "refuse", at least 1 needed',
      "no routing counterexample shows an ask or refusal that should have been an act",
      "no routing counterexample shows an act that should have been an ask or refusal",
    ]);
  });
});

describe("routingBalanceLines", () => {
  it("renders the four display lines a verb prints", () => {
    expect(routingBalanceLines({ balance: routingDecisionBalance({ routing: balancedRouting() }) })).toEqual([
      "principles: act 1 · ask 1 · refuse 1",
      "examples: act 2 · ask 2 · refuse 2",
      "counterexamples (wrong call): act 1 · ask 1 · refuse 1",
      "counterexample directions: should have acted 2 · should not have acted 1",
    ]);
  });
});
