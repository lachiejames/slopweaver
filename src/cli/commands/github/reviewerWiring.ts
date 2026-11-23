/**
 * The production wiring for `github pr request-review`: every requested login resolved through the identity
 * map, refreshing the derived roster just-in-time when the freshness contract says to.
 *
 * Lives apart from `requestReviewRun.ts` for the same reason `../linear/wiring.ts` lives apart from its own
 * shell — the shell stays a shell, and this is the one place that actually touches the rosters.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { type ReviewerResolution, resolveReviewerKey } from "../../../outbound/github/reviewerIndex.js";
import type { IdentityRosterPort } from "../../../silver/identityRoster.js";
import type { IdentityRosterError } from "../../../silver/identityRosterErrors.js";
import { loadDerivedRoster } from "../../../silver/loadDerivedRoster.js";
import { rosterForSend } from "../../../silver/rosterForSend.js";

/**
 * Resolve every requested login through BOTH identity layers, refreshing the roster just-in-time when the
 * freshness contract says to.
 *
 * EXACT MATCH ONLY, and only over keys a GITHUB identity owns (see `../../../outbound/github/reviewerIndex.js`).
 * A key that is not an exact match resolves to nothing, and the caller turns every such miss into a hard
 * refusal before any write — never a fuzzy match, never a nearest guess.
 *
 * @param home the state home holding the derived roster
 * @param logins the reviewer logins the caller named
 * @param askedAtIso when this request was asked for, which the roster's freshness is judged against
 * @param identityRoster the door the store's human roster is read through
 * @returns each login's resolution, in the same order; or the roster's typed refusal
 */
export async function reviewersFromIdentity({
  home,
  logins,
  askedAtIso,
  identityRoster,
}: {
  home: string;
  logins: readonly string[];
  askedAtIso: string;
  identityRoster: IdentityRosterPort;
}): Promise<Result<readonly ReviewerResolution[], IdentityRosterError>> {
  const snapshot = await identityRoster.read({ home });
  if (snapshot.isErr()) {
    return err(snapshot.error);
  }
  const { roster, freshness } = rosterForSend({
    affectsOutput: logins.length > 0,
    askedAtIso,
    home,
    identityRoster: snapshot.value,
  });
  const overrides = snapshot.value.records;
  return ok(logins.map((login) => resolveReviewerKey({ derived: roster, freshness, login, overrides })));
}

/**
 * Resolve every requested login WITHOUT refreshing anything — the dry-run reading.
 *
 * A dry run performs no effect at all, and {@link reviewersFromIdentity} may write silver artifacts as its
 * just-in-time refresh, so the preview cannot use it. It reads the rosters exactly as they stand instead,
 * which is why the dry-run report says a login that fails HERE may still resolve on the live run.
 *
 * @param home the state home holding the derived roster
 * @param logins the reviewer logins the caller named
 * @param identityRoster the door the store's human roster is read through
 * @returns each login's resolution against the rosters as they currently stand; or the roster's typed refusal
 */
export async function reviewersFromIdentityUnrefreshed({
  home,
  logins,
  identityRoster,
}: {
  home: string;
  logins: readonly string[];
  identityRoster: IdentityRosterPort;
}): Promise<Result<readonly ReviewerResolution[], IdentityRosterError>> {
  const snapshot = await identityRoster.read({ home });
  if (snapshot.isErr()) {
    return err(snapshot.error);
  }
  const loaded = loadDerivedRoster({ home, rosterRevision: snapshot.value.revision });
  const overrides = snapshot.value.records;
  return ok(
    logins.map((login) =>
      resolveReviewerKey({ derived: loaded.roster, freshness: loaded.freshness, login, overrides }),
    ),
  );
}
