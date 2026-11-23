/**
 * The owner's own Linear handle, for `linear query --assignee me`: two exact crosswalks over the identity
 * roster and no guess. Pure; the roster and the profile's ids are read by the caller.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import { type LinearQueryError, LinearQueryErrors } from "../../../corpus/linear/queryErrors.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { IdentityRecord } from "../../../silver/identity.js";

/** Whether a roster person carries this Slack user id; a person with no linked identities carries none. */
function carriesSlackId({ person, slackUserId }: { person: IdentityRecord; slackUserId: string }): boolean {
  const identities = unsetFieldAsNull({ key: "identities", record: person });
  if (identities === null) {
    return false;
  }
  return identities.some((identity) => identity.source === "slack" && identity.nativeId === slackUserId);
}

/**
 * The Linear handle a roster person carries — its handle, else its display name — or `null` when there is no
 * person, no linked identities, no Linear identity, or a Linear identity naming neither.
 */
function linearHandleOf({ person }: { person: IdentityRecord | undefined }): string | null {
  if (person === undefined) {
    return null;
  }
  const identities = unsetFieldAsNull({ key: "identities", record: person });
  if (identities === null) {
    return null;
  }
  const linear = identities.find((identity) => identity.source === "linear");
  if (linear === undefined) {
    return null;
  }
  const handle = unsetFieldAsNull({ key: "handle", record: linear });
  if (handle !== null) {
    return handle;
  }
  return unsetFieldAsNull({ key: "name", record: linear });
}

/**
 * Resolve `--assignee me` to the owner's Linear handle, EXACTLY or not at all.
 *
 * Two exact crosswalks, in order, and no third: the identity roster person whose id is `profile.json`'s own
 * `id`, then the person carrying the Slack user id the profile DECLARES as the owner's. The second exists
 * because the first silently fails on a real install — measured, this repository's own
 * `profile.json` carries the placeholder id `me` while the identity roster keys the same human under
 * `person:ada`, so the id crosswalk matches nobody. `slackBot.ownerUserId` is the one field that names
 * the owner by their own configuration, which is why the owner-lens machinery the retired ranked path carried already
 * treats it as the seed that cannot resolve to nothing.
 *
 * Never a name guess and never a single-person fallback: assigning someone else's queue to the owner is a
 * confidently wrong answer, and a refusal that names both fixes costs one command.
 *
 * @param profileId the persona seed's own id
 * @param ownerSlackUserId the Slack user id the profile declares as the owner's, when it declares one
 * @param roster the human identity roster the store holds
 * @returns the owner's Linear handle, or a refusal naming both ways to fix it
 */
export function resolveOwnerLinearHandle({
  profileId,
  ownerSlackUserId,
  roster,
}: {
  profileId: string;
  ownerSlackUserId: string | undefined;
  roster: readonly IdentityRecord[];
}): Result<string, LinearQueryError> {
  const byProfileId = roster.find((person) => person.id === profileId);
  const bySlackId =
    ownerSlackUserId === undefined
      ? undefined
      : roster.find((person) => carriesSlackId({ person, slackUserId: ownerSlackUserId }));
  for (const person of [byProfileId, bySlackId]) {
    const handle = linearHandleOf({ person });
    if (handle !== null && handle.length > 0) {
      return ok(handle);
    }
  }
  return err(LinearQueryErrors.ownerUnresolved({ profileId }));
}
