/**
 * What `turn status --plan` and `--step` may record — the refusal half of the card's above-the-fold budget.
 *
 * A declared plan is drawn one line per step above the fold, so its size is the outline's size: a plan longer
 * than {@link PLAN_STEPS_MAX} steps, or with a step longer than {@link PLAN_STEP_TITLE_MAX} characters, is
 * REFUSED with a sentence naming the count, never clipped to fit (`AGENTS.md` rule 7, and the fold rule in
 * `.claude/rules/area-outbound.md`). A clipped plan step would say something the worker did not write.
 */

import { err, ok, type Result } from "#lib/result.js";

import { PLAN_STEP_TITLE_MAX, PLAN_STEPS_MAX } from "./liveStatusCap.js";
import { type TurnError, TurnErrors } from "./turnErrors.js";

/**
 * Read a `--plan` value — one step per line, blank lines dropped, each trimmed. Pure.
 *
 * Lines rather than a separator character, for the reason `handover ask --options` gives: a separator that
 * can also appear inside a step's own words is not a separator.
 *
 * @param raw the flag's value
 * @returns the steps, or every reason the plan cannot be drawn
 */
export function parsePlanSteps({ raw }: { raw: string }): Result<readonly string[], TurnError> {
  const steps = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (steps.length === 0) {
    return err(TurnErrors.planRefused({ reasons: ["--plan holds no step: write one step per line"] }));
  }
  const reasons: string[] = [];
  if (steps.length > PLAN_STEPS_MAX) {
    reasons.push(
      `--plan holds ${String(steps.length)} steps and the card draws at most ${String(PLAN_STEPS_MAX)} above the ` +
        "fold — merge steps until the plan reads at a glance",
    );
  }
  steps.forEach((step, index) => {
    const length = Array.from(step).length;
    if (length > PLAN_STEP_TITLE_MAX) {
      reasons.push(
        `--plan step ${String(index + 1)} is ${String(length)} characters and a step is at most ` +
          `${String(PLAN_STEP_TITLE_MAX)} — name the step, and put what it finds in --status`,
      );
    }
  });
  return reasons.length === 0 ? ok(steps) : err(TurnErrors.planRefused({ reasons }));
}

/**
 * Read a `--step` value against the plan it names a step of. Pure.
 *
 * @param planLength how many steps the plan standing for this push holds, or `undefined` with no plan at all
 * @param raw the flag's value
 * @returns the 1-based step, or why it names nothing
 */
export function parseStepFlag({
  planLength,
  raw,
}: {
  planLength: number | undefined;
  raw: string;
}): Result<number, TurnError> {
  if (planLength === undefined) {
    return err(
      TurnErrors.planRefused({
        reasons: ["--step names a step of a plan, and this turn has declared none — pass --plan first"],
      }),
    );
  }
  const step = Number(raw.trim());
  if (!Number.isInteger(step) || step < 1 || step > planLength) {
    return err(
      TurnErrors.planRefused({
        reasons: [
          `--step must be a whole number from 1 to ${String(planLength)}, the plan's steps, but got \`${raw}\``,
        ],
      }),
    );
  }
  return ok(step);
}
