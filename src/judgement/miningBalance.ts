/**
 * The decision-balance contract a mined routing section must meet before `route profile-answer` accepts it.
 *
 * The defect it closes: a profile mined from correction-shaped material (rulings that say "never do X",
 * "card it", "ask the owner first") came out all ask/refuse/escalate with no principle saying when simply to ACT,
 * so a turn reading it learned only to hold back. A prompt line asking for balance is advice; this module is
 * the check, so an unbalanced draft is refused by name with its counts, never written. The prompt states the
 * same contract in `./miningPrompt.ts`.
 *
 * Every routing principle and example carries a `decision`, every counterexample both the wrong decision
 * (`example.decision`) and the right one (`expectedDecision`), and per decision:
 *
 * - at least {@link MIN_PRINCIPLES_PER_DECISION} principle — so one states when to act without asking;
 * - at least {@link MIN_EXAMPLES_PER_DECISION} examples, the largest class at most
 *   {@link MAX_EXAMPLE_CLASS_RATIO}× the smallest;
 * - at least {@link MIN_COUNTEREXAMPLES_PER_DECISION} counterexample naming it as the WRONG call, and at
 *   least one counterexample in each direction — an ask or refusal that should have been an act, and an act
 *   that should have been an ask or refusal — so the over-cautious mistake is bounded as firmly as the
 *   reckless one.
 */
import {
  JUDGEMENT_ROUTING_DECISIONS,
  type JudgementRoutingDecision,
  type RoutingJudgementSection,
} from "../live/turn/judgementProfile.js";

const MIN_PRINCIPLES_PER_DECISION = 1;
const MIN_EXAMPLES_PER_DECISION = 2;
const MIN_COUNTEREXAMPLES_PER_DECISION = 1;
const MAX_EXAMPLE_CLASS_RATIO = 2;

/** Labelled counts for one routing part, plus how many entries carried no label. */
interface DecisionCounts {
  readonly act: number;
  readonly ask: number;
  readonly refuse: number;
  readonly unlabelled: number;
}

/** The decision mix of one routing section — what `route profile-answer` prints and judges. */
export interface RoutingDecisionBalance {
  readonly principles: DecisionCounts;
  readonly examples: DecisionCounts;
  /** Counterexamples by the WRONG decision they show; `unlabelled` misses either label. */
  readonly counterexamples: DecisionCounts;
  /** Counterexamples whose wrong and right decision are the same — a contradiction, not a contrast. */
  readonly sameDecisionCounterexamples: number;
  /** An ask or refusal that should have been an act — the over-cautious mistake. */
  readonly shouldHaveActed: number;
  /** An act that should have been an ask or refusal — the reckless mistake. */
  readonly shouldNotHaveActed: number;
}

/** Count decisions over a list of possibly-unlabelled entries. */
function countDecisions({
  decisions,
}: {
  decisions: readonly (JudgementRoutingDecision | undefined)[];
}): DecisionCounts {
  const countOf = ({ decision }: { decision: JudgementRoutingDecision }): number =>
    decisions.filter((entry) => entry === decision).length;
  return {
    act: countOf({ decision: "act" }),
    ask: countOf({ decision: "ask" }),
    refuse: countOf({ decision: "refuse" }),
    unlabelled: decisions.filter((entry) => entry === undefined).length,
  };
}

/**
 * Measure the decision mix of a routing section.
 *
 * @param routing the parsed routing section
 * @returns per-part counts, and the counterexample direction counts
 */
export function routingDecisionBalance({ routing }: { routing: RoutingJudgementSection }): RoutingDecisionBalance {
  const pairs = routing.counterexamples.map((entry) => ({
    expected: entry.expectedDecision,
    wrong: entry.example.decision,
  }));
  return {
    counterexamples: countDecisions({
      decisions: pairs.map((pair) => (pair.expected === undefined ? undefined : pair.wrong)),
    }),
    examples: countDecisions({ decisions: routing.examples.map((entry) => entry.decision) }),
    principles: countDecisions({
      decisions: routing.principles.map((entry) => (typeof entry === "string" ? undefined : entry.decision)),
    }),
    sameDecisionCounterexamples: pairs.filter((pair) => pair.wrong !== undefined && pair.wrong === pair.expected)
      .length,
    shouldHaveActed: pairs.filter((pair) => pair.expected === "act" && pair.wrong !== undefined && pair.wrong !== "act")
      .length,
    shouldNotHaveActed: pairs.filter(
      (pair) => pair.wrong === "act" && pair.expected !== undefined && pair.expected !== "act",
    ).length,
  };
}

/** Problems with one part: unlabelled entries, and every decision under its minimum. */
function partProblems({
  part,
  counts,
  minimum,
}: {
  part: string;
  counts: DecisionCounts;
  minimum: number;
}): readonly string[] {
  const unlabelled = counts.unlabelled > 0 ? [`${String(counts.unlabelled)} routing ${part} miss a decision`] : [];
  const short = JUDGEMENT_ROUTING_DECISIONS.filter((decision) => counts[decision] < minimum).map(
    (decision) => `routing ${part} hold ${String(counts[decision])} "${decision}", at least ${String(minimum)} needed`,
  );
  return [...unlabelled, ...short];
}

/** The skew problem, when the largest example class is more than the ratio times the smallest non-empty one. */
function skewProblems({ examples }: { examples: DecisionCounts }): readonly string[] {
  const counts = JUDGEMENT_ROUTING_DECISIONS.map((decision) => examples[decision]);
  const largest = Math.max(...counts);
  const smallest = Math.min(...counts);
  if (smallest === 0 || largest <= smallest * MAX_EXAMPLE_CLASS_RATIO) {
    return [];
  }
  return [
    `routing examples are skewed: the largest decision holds ${String(largest)}, more than ${String(MAX_EXAMPLE_CLASS_RATIO)}x the smallest (${String(smallest)})`,
  ];
}

/** The counterexample direction problems: a contradiction, or a direction with no case at all. */
function directionProblems({ balance }: { balance: RoutingDecisionBalance }): readonly string[] {
  return [
    ...(balance.sameDecisionCounterexamples > 0
      ? [
          `${String(balance.sameDecisionCounterexamples)} routing counterexamples name the same wrong and right decision`,
        ]
      : []),
    ...(balance.shouldHaveActed === 0
      ? ["no routing counterexample shows an ask or refusal that should have been an act"]
      : []),
    ...(balance.shouldNotHaveActed === 0
      ? ["no routing counterexample shows an act that should have been an ask or refusal"]
      : []),
  ];
}

/**
 * Every way a routing section's decision mix falls short of the balance contract — empty when it meets it.
 *
 * @param balance the measured decision mix
 * @returns one sentence per shortfall, in a fixed order
 */
export function routingBalanceProblems({ balance }: { balance: RoutingDecisionBalance }): readonly string[] {
  return [
    ...partProblems({ counts: balance.principles, minimum: MIN_PRINCIPLES_PER_DECISION, part: "principles" }),
    ...partProblems({ counts: balance.examples, minimum: MIN_EXAMPLES_PER_DECISION, part: "examples" }),
    ...skewProblems({ examples: balance.examples }),
    ...partProblems({
      counts: balance.counterexamples,
      minimum: MIN_COUNTEREXAMPLES_PER_DECISION,
      part: "counterexamples",
    }),
    ...directionProblems({ balance }),
  ];
}

/**
 * Display lines for a verb to print: `examples: act 3 · ask 2 · refuse 2`, and the two directions.
 *
 * @param balance the measured decision mix
 * @returns four display lines
 */
export function routingBalanceLines({ balance }: { balance: RoutingDecisionBalance }): readonly string[] {
  const line = ({ part, counts }: { part: string; counts: DecisionCounts }): string =>
    `${part}: act ${String(counts.act)} · ask ${String(counts.ask)} · refuse ${String(counts.refuse)}`;
  return [
    line({ counts: balance.principles, part: "principles" }),
    line({ counts: balance.examples, part: "examples" }),
    line({ counts: balance.counterexamples, part: "counterexamples (wrong call)" }),
    `counterexample directions: should have acted ${String(balance.shouldHaveActed)} · should not have acted ${String(balance.shouldNotHaveActed)}`,
  ];
}
