/**
 * The three badges of a C3 description, DERIVED — never authored. Pure: no clock, no I/O.
 *
 * A badge an author types can disagree with what it summarises, and a reader meets the badge first. So each is a
 * function of the form: risk from the top ranked item, problem from when (and whether) it was seen, proof from the
 * two proof slots. Colours mean one thing each: green shown for real, amber shown in part or not yet, grey nothing to
 * show. Red appears on exactly one badge state, a `high` risk. No badge carries a grade.
 */
import { err, ok, type Result } from "#lib/result.js";
import { shortDay, utcMidnightOf } from "./days.js";
import { type PrBodyError, PrBodyErrors } from "./errors.js";
import { WORST_KINDS } from "./schema.js";
import { HOVER_MAX, type ProofHoverInput, problemHover, proofHover, riskHover } from "./tooltips.js";
import type {
  BodyLayout,
  Content,
  Level,
  PrBody,
  ProblemSeen,
  ProofSlot,
  RiskItem,
  VisualProof,
  WorstKind,
} from "./types.js";

/** Red: a high risk, and nothing else. */
const RED = "d73a49";
/** Amber: a medium risk, an unchecked top risk, proof shown in part or not run yet. */
const AMBER = "dbab09";
/** Green: a low checked risk, a problem seen on a real run, proof shown for real. */
const GREEN = "2ea44f";
/** Grey: a problem not seen yet, proof by tests only because nothing on screen changes. */
const GREY = "6e7781";

/** What one badge shows: its message, colour and hover. */
export interface BadgeVerdict {
  readonly message: string;
  readonly color: string;
  readonly tooltip: string;
}

/** The level each kind of worst case implies; the author picks the kind, never the level. */
const LEVEL_OF_KIND: Readonly<Record<WorstKind, Level>> = {
  "loses-leaks-or-changes-off-machine": "high",
  "only-tests-docs-or-dev-tooling": "low",
  "something-working-breaks": "medium",
};

/** A level's rank, high first, which is the order risk items are listed in. */
const LEVEL_RANK: Readonly<Record<Level, number>> = { high: 0, low: 2, medium: 1 };

/**
 * The level a kind of worst case implies: losing or leaking data, or a change off this machine, is high; something
 * that worked breaking is medium; only tests, docs or dev tooling breaking is low.
 *
 * @param worstKind the item's kind of worst case
 * @returns its level
 */
export function levelOf({ worstKind }: { worstKind: WorstKind }): Level {
  return LEVEL_OF_KIND[worstKind];
}

/**
 * The one kind a read-back gives each level: a description publishes the level, never the kind, and there is exactly
 * one kind per level, so the read-back is exact.
 *
 * @param level the level the risk badge shows
 * @returns the kind that implies it
 */
export function canonicalKindOf({ level }: { level: Level }): WorstKind {
  return WORST_KINDS.find((kind) => LEVEL_OF_KIND[kind] === level)!;
}

/** A verdict, or the refusal of a hover longer than a reader is shown. */
function capped({ badge, verdict }: { badge: string; verdict: BadgeVerdict }): Result<BadgeVerdict, PrBodyError> {
  if (verdict.tooltip.length > HOVER_MAX) {
    return err(PrBodyErrors.hoverTooLong({ badge, length: verdict.tooltip.length, max: HOVER_MAX }));
  }
  return ok(verdict);
}

/**
 * The ranked items' top one, or the refusal of an empty or out-of-order list.
 *
 * @param items the ranked risk items, most urgent first
 * @returns the top item, or a typed refusal
 */
export function topRiskOf({ items }: { items: readonly RiskItem[] }): Result<RiskItem, PrBodyError> {
  const first = items[0];
  if (first === undefined) {
    return err(PrBodyErrors.riskUnranked({ detail: "there are none; name at least one" }));
  }
  const rankOf = ({ item }: { item: RiskItem }): number => LEVEL_RANK[levelOf({ worstKind: item.worstKind })];
  const outOfOrder = items.findIndex(
    (item, index) => index > 0 && rankOf({ item }) < rankOf({ item: items[index - 1]! }),
  );
  if (outOfOrder > 0) {
    const level = levelOf({ worstKind: items[outOfOrder]!.worstKind });
    const before = levelOf({ worstKind: items[outOfOrder - 1]!.worstKind });
    return err(
      PrBodyErrors.riskUnranked({
        detail:
          `item ${String(outOfOrder + 1)} is ${level} after a ${before} one; list them high first, then medium, ` +
          "then low, so the top item is the worst",
      }),
    );
  }
  return ok(first);
}

/**
 * The risk badge: the top item decides the level; an unchecked top item turns a non-high badge amber and says so.
 *
 * @param items the ranked risk items, most urgent first
 * @returns the verdict, or a typed refusal
 */
export function riskBadgeOf({ items }: { items: readonly RiskItem[] }): Result<BadgeVerdict, PrBodyError> {
  return topRiskOf({ items }).andThen((top) => {
    const level = levelOf({ worstKind: top.worstKind });
    const tooltip = riskHover({ top });
    if (level === "high") {
      return capped({ badge: "risk", verdict: { color: RED, message: "high", tooltip } });
    }
    if (top.check.kind === "unchecked") {
      return capped({ badge: "risk", verdict: { color: AMBER, message: `${level}, unchecked`, tooltip } });
    }
    return capped({ badge: "risk", verdict: { color: level === "medium" ? AMBER : GREEN, message: level, tooltip } });
  });
}

/**
 * The problem badge: green `seen <day>` for a problem seen on a real run, grey `not seen yet` otherwise.
 *
 * @param seen the problem's seen state
 * @returns the verdict, or a refusal naming a malformed day or an over-long hover
 */
export function problemBadgeOf({ seen }: { seen: ProblemSeen }): Result<BadgeVerdict, PrBodyError> {
  if (seen.kind === "not-seen") {
    return capped({
      badge: "problem",
      verdict: { color: GREY, message: "not seen yet", tooltip: problemHover({ seen }) },
    });
  }
  if (utcMidnightOf({ day: seen.on }) === undefined) {
    return err(PrBodyErrors.invalidDay({ field: "problemSeen.on", value: seen.on }));
  }
  const message = `seen ${shortDay({ day: seen.on })}`;
  return capped({ badge: "problem", verdict: { color: GREEN, message, tooltip: problemHover({ seen }) } });
}

/**
 * Plain text of a cell, as a hover carries it.
 *
 * @param content the runs
 * @returns their text joined
 */
export function plainTextOf({ content }: { content: Content }): string {
  return content.map((run) => run.text).join("");
}

/** The five proof values, each with its colour. */
const PROOF_VALUES = {
  both: { color: GREEN, message: "problem and solution" },
  "not-run": { color: AMBER, message: "not run yet" },
  "problem-only": { color: AMBER, message: "problem only" },
  "solution-only": { color: GREEN, message: "solution only" },
  "tests-only": { color: GREY, message: "tests only" },
} as const;

/** The two slots reduced to what the proof badge says. */
function proofInputOf({
  visualProof,
  problemProof,
  solutionProof,
}: {
  visualProof: VisualProof;
  problemProof: ProofSlot;
  solutionProof: ProofSlot;
}): ProofHoverInput {
  if (problemProof.kind === "screenshot" && solutionProof.kind === "screenshot") {
    return { kind: "both", problemBy: problemProof.runBy, solutionBy: solutionProof.runBy };
  }
  if (solutionProof.kind === "screenshot" && problemProof.kind === "reason") {
    return {
      kind: "solution-only",
      problemReason: plainTextOf({ content: problemProof.reason }),
      solutionBy: solutionProof.runBy,
    };
  }
  if (problemProof.kind === "screenshot" && solutionProof.kind === "reason") {
    return {
      kind: "problem-only",
      problemBy: problemProof.runBy,
      solutionReason: plainTextOf({ content: solutionProof.reason }),
    };
  }
  const solutionReason = solutionProof.kind === "reason" ? plainTextOf({ content: solutionProof.reason }) : "";
  return visualProof === "nothing-on-screen"
    ? { kind: "tests-only", solutionReason }
    : { kind: "not-run", solutionReason };
}

/**
 * The proof badge: one of five values computed from the two slots, never picked and never red.
 *
 * @param body the body's visual-proof applicability and its two slots
 * @param layout the body layout the badge is rendered for, which words the tests-only hover
 * @returns the verdict, or the refusal of an over-long hover
 */
export function proofBadgeOf({
  body,
  layout,
}: {
  body: Pick<PrBody, "visualProof" | "problemProof" | "solutionProof">;
  layout: BodyLayout;
}): Result<BadgeVerdict, PrBodyError> {
  const input = proofInputOf(body);
  const value = PROOF_VALUES[input.kind];
  return capped({ badge: "proof", verdict: { ...value, tooltip: proofHover({ input, layout }) } });
}

/**
 * The proof badge's value alone, for a reader that reports proof state without rendering a body.
 *
 * @param body the body's visual-proof applicability and its two slots
 * @returns the badge's message, such as `problem and solution` or `not run yet`
 * @internal — exported for its unit test
 */
export function proofStateOf({
  body,
}: {
  body: Pick<PrBody, "visualProof" | "problemProof" | "solutionProof">;
}): string {
  return PROOF_VALUES[proofInputOf(body).kind].message;
}
