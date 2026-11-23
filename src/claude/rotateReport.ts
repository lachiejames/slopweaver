/**
 * What a rotation says when it is done, and what it says when it refuses. Pure.
 *
 * Split from the shell so the WORDS are pinned by tests rather than by whatever the shell happened to
 * print. Two of these lines are the ones the owner reads when the fleet did something they did not ask for in
 * the moment, so they have to say which plan, why, and what to do if it was wrong.
 *
 * Nothing here can carry a credential: every input is an alias, an instant or a typed error message, and
 * the swap's own verdict is built to name a plan rather than a token.
 */
import type { ClaudeRotationDecision } from "./contracts.js";
import type { ClaudeRotationError } from "./errors.js";

/**
 * What the rotate verb did, as a caller-parseable document and a line a person reads.
 *
 * @internal — the value {@link rotateReport} and {@link refusalReport} return and the shell serialises;
 *   a caller parses the JSON rather than importing this shape.
 */
export interface ClaudeRotateReport {
  /**
   * `recommended`, `stayed`, `all-exhausted`, or `refused` — what a caller branches on.
   *
   * It used to read `rotated`, and that became a lie when the credential copy was retired: nothing rotates, so
   * nothing is rotated. `recommended` is what the
   * selection pass actually concluded, which is information worth keeping rather than a renamed nothing.
   */
  readonly outcome: "recommended" | "stayed" | "all-exhausted" | "refused";
  /** One sentence a person reads. Never contains a credential. */
  readonly line: string;
}

/**
 * Turn a decision into the report the verb prints.
 *
 * **There is no `active` field any more either.** It named the plan the fleet was on, and the only branch that
 * still set it is one no production caller constructs — `rotate.ts` builds `kind: "rotate"` and nothing else, so
 * after the recommendation branch stopped claiming an `active` the field had no producer a reader could reach. The line still names the plan; what is gone is the structured claim about
 * where the fleet IS, which this verb no longer establishes.
 *
 * **There is no `dryRun` any more, and that is the retirement rather than a simplification.** It chose between
 * "would move" and "moved", and nothing moves: the credential copy is retired (`../cli/commands/claude/rotate.ts`
 * § This verb no longer writes a credential), so the past-tense branch was unreachable from production while
 * tests still exercised and endorsed it.
 *
 * @param decision what the selection pass concluded
 * @returns the report
 */
export function rotateReport({ decision }: { decision: ClaudeRotationDecision }): ClaudeRotateReport {
  if (decision.kind === "stay") {
    return { line: `staying on ${decision.on} — ${decision.reason}`, outcome: "stayed" };
  }
  if (decision.kind === "all-exhausted") {
    const back =
      decision.earliestResetIso === undefined
        ? "no reset time is known"
        : `the earliest reset is ${decision.earliestResetIso}`;
    return {
      line: `every plan is spent, so nothing rotated. ${back}`,
      outcome: "all-exhausted",
    };
  }
  const from = decision.from === undefined ? "" : ` off ${decision.from}`;
  // No `active`: this moved nothing, so naming a plan as the one in the chair would be the document answering
  // the one question it must not get wrong. The line says what a session should be booted against instead.
  return {
    line:
      `${decision.to} is the plan a spawn should be booted against${from} — nothing was moved, because the ` +
      `credential copy is retired and a session spends a plan by being booted against its store`,
    outcome: "recommended",
  };
}

/**
 * Turn a typed failure into the same report shape, so a caller parses one document either way.
 *
 * @param error what refused
 * @returns the report
 */
export function refusalReport({ error }: { error: ClaudeRotationError }): ClaudeRotateReport {
  return { line: `refused: ${error.message}`, outcome: "refused" };
}
