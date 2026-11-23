/**
 * The review roster at a home, read: the derived roster with the store's identity roster confirmed over it.
 * `./reviewRoster.ts` stays the pure join; this is the one place the review verbs read both rosters, so the
 * revision the derived roster's freshness is judged against is the revision the overrides came from.
 */
import type { Result } from "../lib/result.js";
import { type IdentityRosterPort, identityRosterPort } from "../silver/identityRoster.js";
import type { IdentityRosterError } from "../silver/identityRosterErrors.js";
import { loadDerivedRoster } from "../silver/loadDerivedRoster.js";
import { buildReviewRoster, type ReviewRoster } from "./reviewRoster.js";

/**
 * The review roster over one read of the identity roster.
 *
 * @param home the state home holding the derived roster and whose store holds the identity roster
 * @param identityRoster the door the store's human roster is read through
 * @returns the roster, or the store's typed refusal — a review verb that cannot say who a login is stops
 */
export async function reviewRosterOver({
  home,
  identityRoster,
}: {
  home: string;
  identityRoster: IdentityRosterPort;
}): Promise<Result<ReviewRoster, IdentityRosterError>> {
  return (await identityRoster.read({ home })).map((stored) =>
    buildReviewRoster({
      overrides: stored.records,
      roster: loadDerivedRoster({ home, rosterRevision: stored.revision }).roster,
    }),
  );
}

/**
 * {@link reviewRosterOver} through the store's own port — what a review verb's production deps wire.
 *
 * @param home the state home
 * @returns the roster, or the store's typed refusal
 */
export async function liveReviewRoster({ home }: { home: string }): Promise<Result<ReviewRoster, IdentityRosterError>> {
  return reviewRosterOver({ home, identityRoster: identityRosterPort() });
}
