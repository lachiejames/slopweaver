/**
 * What to DO about a rate-limit claim, which is not the same question as which claim was hit.
 *
 * ## The rule, and why it has two answers rather than one
 *
 * A model-scoped weekly cap normally means "use a different model", not "burn a whole plan": the plan is
 * healthy and only one model on it is spent, so rotating would spend a second plan's budget to solve a
 * problem a `--model` change solves for free. That is the right answer for almost every session, because by
 * the owner's model-tiering rule almost every session runs Opus or Sonnet.
 *
 * **The supervisor chair is the exception, and it is a stated rule rather than a quiet special case.** The
 * chair is the one seat that runs Fable, and the owner's rule is that it stays on
 * Fable. So for the chair a Fable wall may NOT be answered by downgrading the model — that would silently
 * move the chair off the model the owner asked it to keep. It rotates the plan instead, because a different plan carries its
 * own per-model budget.
 *
 * The reason this is worth a module rather than a branch: the chair is also the seat whose failure stops
 * everything: if the supervisor goes down, everything goes down. A
 * rule that lives in one named place with its own tests is a rule the next session can find before it
 * rediscovers the incident.
 *
 * ## What this cannot see
 *
 * Nothing here measures a per-model budget, because nothing can. Measured against a live plan,
 * the response headers carry `5h` and `7d` utilisation and no per-model figure at all; the
 * `representative-claim` header NAMES the binding claim without quantifying it. So a per-model wall is only
 * visible once it has been HIT, never in advance, and this module decides what to do about a wall rather
 * than predicting one.
 */
import type { ClaudeRateClaim } from "./contracts.js";

/**
 * What a session should do about the claim that just refused it.
 *
 * @internal — the value {@link responseToClaim} returns; callers branch on it rather than constructing one.
 */
export type ClaimResponse =
  /** Move the fleet to another plan — the claim is plan-wide, or the seat may not change model. */
  | "rotate-plan"
  /** Keep the plan and use a different model — the plan is healthy and one model on it is spent. */
  | "downgrade-model"
  /** Neither: this refusal says nothing about plan capacity. */
  | "ignore";

/**
 * Which seat hit the claim. The chair is the one seat that runs Fable and may not be moved off it.
 *
 * @internal — an argument to {@link responseToClaim}; the caller knows which seat it is.
 */
export type SessionSeat = "supervisor-chair" | "worker";

/**
 * Decide what to do about a claim.
 *
 * @param claim which rate-limit claim refused the request
 * @param seat which seat hit it — the supervisor chair may not answer a model wall by changing model
 * @returns the response to take
 */
export function responseToClaim({ claim, seat }: { claim: ClaudeRateClaim; seat: SessionSeat }): ClaimResponse {
  if (claim === "five_hour" || claim === "seven_day") {
    return "rotate-plan";
  }
  return seat === "supervisor-chair" ? "rotate-plan" : "downgrade-model";
}
