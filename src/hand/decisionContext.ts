/**
 * The decision a hand step may carry INSIDE its own record: the problem, two to four options each with its
 * trade-off, the lean, and the stakes. It is the same shape a recorded ask carries, and it is decoded with the
 * ask's own readers and caps (`../handover/askShape.ts`), so there is no second schema to drift.
 *
 * Why a step carries it rather than always linking an ask: a monitor's card is posted and settled by the
 * monitor lane alone, and a board ask minted beside it would need its own settlement. It would also read as
 * something the owner asked for. Where the card is the only record of the choice, the record holds the choice — never
 * for a stopped job, which a seat repairs (`../monitor/card.ts` refuses that choice). `./decision.ts`'s `decisionWithoutAsk` accepts a decision that carries this
 * context, exactly as it accepts one that opens a shaped ask, and the console draws both through the same
 * decision card.
 *
 * Pure and total. Absence is a valid answer — every step posted before this field existed reads unchanged.
 */
import {
  type AskOption,
  type AskStakes,
  askOptionsFrom,
  askShapeProblems,
  askStakesFrom,
} from "../handover/askShape.js";
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";

import { type HandStepError, HandStepErrors } from "./errors.js";

/** A decision carried on the step itself, as whole as a recorded ask's shape. */
export interface HandDecisionContext {
  /** One line: what is wrong or undecided. */
  readonly problem: string;
  /** Two to four, each lettered by position. */
  readonly options: readonly AskOption[];
  /** What the posting session recommends — never presented as the owner's word. */
  readonly lean: string;
  /** Required here, unlike a historical ask's: a card that cannot say what is at stake is the defect. */
  readonly stakes: AskStakes;
}

/**
 * Decode and check a step's `decision` field, whatever shape it arrived in.
 *
 * Refused rather than repaired when partial, because a card drawing some of a decision would read as a whole
 * one that is merely short. Option letters are derived by position and never trusted from the wire.
 *
 * @param value the raw field — absent on every step that carries no decision
 * @returns the context, `undefined` when absent, or the refusal naming what is wrong
 */
export function checkedHandDecision({
  value,
}: {
  value: unknown;
}): Result<HandDecisionContext | undefined, HandStepError> {
  if (value === undefined) {
    return ok(undefined);
  }
  if (!isRecord(value)) {
    return err(HandStepErrors.invalidField({ field: "decision", why: "is not an object" }));
  }
  const { problem, lean } = value;
  if (typeof problem !== "string" || typeof lean !== "string") {
    return err(HandStepErrors.invalidField({ field: "decision", why: "carries no problem or no lean as text" }));
  }
  const stakes = askStakesFrom({ value: value["stakes"] });
  if (stakes === undefined) {
    return err(
      HandStepErrors.invalidField({
        field: "decision",
        why: "carries no whole stakes — risk, blast radius and the still-real check are all required",
      }),
    );
  }
  const rawOptions = value["options"];
  const options = askOptionsFrom({ value: rawOptions });
  if (!Array.isArray(rawOptions) || options.length !== rawOptions.length) {
    return err(
      HandStepErrors.invalidField({ field: "decision", why: "has an option that is not an option and a trade-off" }),
    );
  }
  const decision: HandDecisionContext = { lean: lean.trim(), options, problem: problem.trim(), stakes };
  const problems = askShapeProblems({ shape: decision });
  if (problems.length > 0) {
    return err(HandStepErrors.invalidField({ field: "decision", why: problems.join("; ") }));
  }
  return ok(decision);
}
