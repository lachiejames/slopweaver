/**
 * The ONE ranking of what is waiting on the owner — which thing the owner is led to first, on every surface that lists them.
 *
 * The case: the Queue in the Acme context held one pull request waiting on the owner's word, then 368 "was X the
 * right call?" autonomy acts, with the voice reading from the same list. Those acts ask the owner to confirm what
 * was already done, which is fine, like an evaluation, but higher-priority things that affect work and are
 * blocked on the owner must lead, and the owner should not have to go looking for the priorities.
 *
 * ## Three tiers, and the order is the rule
 *
 * 1. **team-blocked** — a colleague is on the other end: a pull request the owner's pick unblocks, a reply a person is
 *    waiting on, a post under the owner's name to people, a door in the work context needing the owner's word.
 * 2. **fleet-blocked** — the fleet's own work stopped on the owner's word, which nobody else sees.
 * 3. **check-in** — a review of something already built: an evaluation or dogfood step, or an ask that looks
 *    answered already. The owner's word here is a review, never a blocker, so it ranks last whatever it is about — a
 *    check-in on a work pull request is still a retrospective. An autonomy act is not on this list at all:
 *    every was-this-the-right-call act is on the console's Alignment page (`site/lib/alignment.ts`).
 *
 * Within a tier the caller's order stands (register order, then each register's own age order): this module
 * decides only which tier leads, so a priority cannot sneak in through a sort nobody asked for.
 *
 * ## What comes before the tiers
 *
 * The owner's priorities do: a card blocking one, a priority's own card, then a stopped automation, every tier in each
 * (`./queueOrder.ts`). That order is applied OVER this one, never inside it, so a
 * priority never changes a thing's tier and the badge, the counts and the words a tier is spoken in stay true.
 *
 * ## Who reads it
 *
 * The console's Queue and the voice's `action_items` rank through `site/lib/waitingRank.ts`,
 * a mirror of this file — `site/` cannot import `src/` (the build's `rootDir`, TS6059) — held to the same
 * answers by `site/__tests__/unit/waitingRank.test.ts`, which imports both. `hand push` ranks its one banner
 * through this file. The briefing's react-now block already draws team-facing cards above the owner's own and the
 * autonomy ledger in a section of its own below them; `src/__tests__/unit/briefing/reactNowTierOrder.test.ts`
 * holds that order to these tiers rather than re-deriving them.
 *
 * Pure and import-free: facts in, a tier or an order out. No clock.
 */

/** Which of the three tiers a waiting thing is in. */
export type WaitingTier = "team-blocked" | "fleet-blocked" | "check-in";

/** The tiers, first-led first. */
export const TIER_ORDER: readonly WaitingTier[] = ["team-blocked", "fleet-blocked", "check-in"];

/**
 * The tier one waiting thing is in.
 *
 * @param checkIn the fleet already acted and asks whether it was right
 * @param teamFacing a colleague is on the other end of it
 * @returns the tier
 */
export function waitingTierOf({ checkIn, teamFacing }: { checkIn: boolean; teamFacing: boolean }): WaitingTier {
  if (checkIn) {
    return "check-in";
  }
  if (teamFacing) {
    return "team-blocked";
  }
  return "fleet-blocked";
}

/**
 * Order waiting things tier-first, keeping the caller's order within each tier.
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
  // Each item's tier is read once, in item order, before the sort, as the site's mirror reads it: a comparator calling
  // it would ask in whatever order the sort compares, so a callback that is not pure could rank the two mirrors
  // differently.
  return items
    .map((item) => ({ item, rank: TIER_ORDER.indexOf(tierOf(item)) }))
    .toSorted((left, right) => left.rank - right.rank)
    .map((entry) => entry.item);
}
