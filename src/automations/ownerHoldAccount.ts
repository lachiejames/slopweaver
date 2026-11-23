/**
 * The account a paused automation owes the owner when an OWNER hold stands on it, split from `./brokenAccount.ts`
 * along the one seam that matters here: whether the hold is theirs. It reads as the owner's pause only when their
 * anchored words name the automation (`../live/automation/ownerHoldPlacedBy.ts`); any other owner hold is one the
 * fleet owes the owner an answer on, never "You paused it" — a keypress of the chair's was once written up as the
 * owner's choice.
 */
import { ownerHoldIsOwners } from "../live/automation/ownerHoldPlacedBy.js";
import type { BrokenAccount } from "./brokenAccount.js";
import type { StandingHold } from "./health.js";
import type { AutomationPurpose } from "./purpose.js";

/**
 * What is worse while it is down, from its purpose.
 *
 * @param paused whether it is held rather than failing, which only changes the fallback sentence
 * @returns the purpose's own sentence, else a plain one saying what it is for does not happen
 */
export function worseOf({ purpose, paused }: { purpose: AutomationPurpose | null; paused: boolean }): string {
  if (purpose !== null && purpose.whenBroken !== null) {
    return purpose.whenBroken;
  }
  if (purpose === null) {
    return "Nothing in this build says what it is for, so what is missing cannot be named.";
  }
  return paused
    ? "While it is paused, what it is for does not happen."
    : "While it is broken, what it is for does not happen.";
}

/**
 * The account for a row an owner hold stands on.
 *
 * @param hold the standing owner hold, whose attribution state decides whose pause it is
 * @param meanwhile what runs instead, as the caller already said it
 * @returns the owner's pause when their anchored words name it, else a hold the fleet owes the owner an answer on
 */
export function ownerHoldAccount({
  freshness,
  hold,
  lastWorkedIso,
  meanwhile,
  purpose,
  recipeId,
}: {
  freshness: BrokenAccount["freshness"];
  hold: Extract<StandingHold, { kind: "owner" }>;
  lastWorkedIso: string | null;
  meanwhile: readonly string[];
  purpose: AutomationPurpose | null;
  recipeId: string;
}): BrokenAccount {
  const shared = {
    freshness,
    lastWorkedIso,
    meanwhile,
    plainly: null,
    said: null,
    sinceIso: hold.sinceIso,
    state: "paused",
    worse: worseOf({ paused: true, purpose }),
  } as const;
  if (ownerHoldIsOwners({ recipeId, state: hold.placedByState })) {
    return {
      ...shared,
      detail: null,
      fix: { by: "you", sinceIso: hold.sinceIso, words: "It runs again when you lift the pause." },
      why: "You paused it.",
    };
  }
  return {
    ...shared,
    detail: hold.placedByState.kind === "unresolved" ? hold.placedByState.reason : null,
    fix: {
      by: "fleet",
      sinceIso: hold.sinceIso,
      words: "The fleet looks for your word naming it; with none, it asks you on the Queue whether to lift the hold.",
    },
    why: "It is held, but no word of yours naming it is on the hold.",
  };
}
