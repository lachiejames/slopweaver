/**
 * The Codex half of a session's recorded plan choice (`../sessions/planChoice.ts`), built where a seat's route is
 * decided (`../cmux/seatRoute.ts`, `./seatDecision.ts`) while the ranking is in scope. Pure.
 *
 * A Codex exclusion's own `reason` is free text that can carry a home path (a signed-out row names the login command
 * for its `$CODEX_HOME`) or the owner's pause note, so it is NEVER copied: every reading is composed here from the
 * alias, the exclusion's typed kind and the rank position. Each registered destination appears exactly once.
 */
import type { PlanChoiceReading, SessionPlanChoice } from "../sessions/planChoice.js";
import type { CodexPlanRanking } from "./fleetTypes.js";

/** How a Codex spawn names another plan, or goes back to routing. */
const CODEX_ALTERNATIVE = "--plan <alias> names another Codex plan; omit --plan to take the ranked best";

/**
 * The choice a ranked or `--plan` Codex seat records.
 *
 * @param alias the destination the seat boots on
 * @param basis `routed` when the ranking chose it, `requested` when `--plan` named it
 * @param forced whether `--force` put the seat on it past its own exclusion
 * @param ranking the ranking the route was decided over
 * @returns the recorded choice
 */
export function rankedCodexChoice({
  alias,
  basis,
  forced,
  ranking,
}: {
  alias: string;
  basis: "routed" | "requested";
  forced: boolean;
  ranking: CodexPlanRanking;
}): SessionPlanChoice {
  const total = String(ranking.ranked.length);
  const readings: PlanChoiceReading[] = [
    ...ranking.ranked.map((destination, index): PlanChoiceReading => ({
      alias: destination.alias,
      reading: `ranked ${String(index + 1)} of ${total} eligible, on ${ranking.basis}`,
      state: destination.alias === alias ? "chosen" : "eligible",
    })),
    ...ranking.excluded.map((exclusion): PlanChoiceReading => ({
      alias: exclusion.destination.alias,
      reading: exclusion.destination.alias === alias ? `${exclusion.kind}, crossed by --force` : exclusion.kind,
      state: exclusion.destination.alias === alias ? "chosen" : "excluded",
    })),
  ];
  return {
    alias,
    basis,
    kind: "named",
    alternative: CODEX_ALTERNATIVE,
    readings,
    reason: codexReason({ basis, forced, ranking }),
    vendor: "codex",
  };
}

/** Why a ranked or named Codex seat took its destination, from typed facts only. */
function codexReason({
  basis,
  forced,
  ranking,
}: {
  basis: "routed" | "requested";
  forced: boolean;
  ranking: CodexPlanRanking;
}): string {
  if (forced) {
    return `${basis === "requested" ? "--plan named it" : "nothing was eligible"}; --force put the seat past its own exclusion`;
  }
  if (basis === "requested") {
    return "--plan named it, and the ranking found it eligible";
  }
  return `ranked first of ${String(ranking.ranked.length)} eligible destination(s), on ${ranking.basis}`;
}

/**
 * The choice a continuing Codex seat records when it resumes on the home its session was opened on: that home was
 * judged — registered, unpaused, signed in, under its usage limit — never ranked against the others.
 *
 * @param alias the plan that home belongs to
 * @returns the recorded choice
 */
export function resumedCodexChoice({ alias }: { alias: string }): SessionPlanChoice {
  return {
    alias,
    basis: "resumed",
    kind: "named",
    alternative: "a resume stays on its recorded plan; open a fresh session to route again",
    readings: [
      { alias, reading: "the plan its session was opened on, admitted by the seat preflight", state: "chosen" },
    ],
    reason: "the session resumes on the plan it was opened on, since its transcript lives under that home",
    vendor: "codex",
  };
}
