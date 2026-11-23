/**
 * The console's copy of the ONE ranking of what is waiting on the owner — `src/waiting/rank.ts` states the rule, the
 * owner's words behind it, and every surface that reads it.
 *
 * A mirror because `site/` cannot import `src/`. `site/__tests__/unit/waitingRank.test.ts` imports both and runs
 * one case table through each, so a tier or an order that drifts on one side only is a failed test rather than
 * the Queue and the voice leading the owner somewhere the banner does not. It is written differently on purpose (a
 * rank table rather than an index lookup) so the clone ratchet never has to argue for it; the drift test is
 * what keeps the ANSWERS identical, which is the only sameness that matters.
 *
 * The words a tier prints live here and only here: they are the console's and the voice's, and the banner
 * names a single thing rather than a tier.
 *
 * Imports nothing, like `./queueCard.ts`, so the unit lane and the drift test load it on its own.
 */

/** Which of the three tiers a waiting thing is in. */
export type WaitingTier = "team-blocked" | "fleet-blocked" | "check-in";

/** The tiers, first-led first — the order every list of waiting things is drawn and spoken in. */
export const TIERS: readonly WaitingTier[] = ["team-blocked", "fleet-blocked", "check-in"];

/** Each tier's place in the order: smaller leads. */
const RANK: Readonly<Record<WaitingTier, number>> = { "check-in": 2, "fleet-blocked": 1, "team-blocked": 0 };

/**
 * What each tier reads as, wherever a list of waiting things is headed or spoken. A check-in on the Queue is a step
 * its poster marked as an evaluation, or an ask that looks answered: an act the fleet already took is the Alignment
 * page's question (`./alignment.ts`), never a Queue tier, so the words no longer describe one.
 */
export const TIER_WORDS: Readonly<Record<WaitingTier, { readonly heading: string; readonly spoken: string }>> = {
  "check-in": {
    heading: "Check-ins: your word is a review",
    spoken: "a check-in: a review of something already built, or an ask that looks answered already",
  },
  "fleet-blocked": {
    heading: "Blocking the fleet",
    spoken: "the fleet's own work, stopped on your word",
  },
  "team-blocked": {
    heading: "Blocking a colleague",
    spoken: "work a colleague is waiting on you for",
  },
};

/**
 * The tier one waiting thing is in. A check-in stays a check-in even when a colleague's work is its subject.
 *
 * @param checkIn the fleet already acted and asks whether it was right
 * @param teamFacing a colleague is on the other end of it
 * @returns the tier
 */
export function waitingTierOf({ checkIn, teamFacing }: { checkIn: boolean; teamFacing: boolean }): WaitingTier {
  if (checkIn) {
    return "check-in";
  }
  return teamFacing ? "team-blocked" : "fleet-blocked";
}

/**
 * Order waiting things tier-first; within a tier the caller's order stands. The owner's priorities lead over this, never
 * inside it (`./queueFocus.ts` `queueOrdered`), so a tier never moves.
 *
 * @param items the things, in the caller's own order
 * @param tierOf reads one thing's tier
 * @returns a new list, team-blocked first and check-ins last
 */
export function rankWaiting<T>({
  items,
  tierOf,
}: {
  items: readonly T[];
  tierOf: (item: T) => WaitingTier;
}): readonly T[] {
  // Each item's tier is read once, in item order, before the sort, exactly as `src/waiting/rank.ts` reads it, so a
  // reader that is not pure ranks identically in both mirrors.
  const placed = items.map((item, at) => ({ at, item, place: RANK[tierOf(item)] }));
  placed.sort((left, right) => left.place - right.place || left.at - right.at);
  return placed.map((entry) => entry.item);
}
