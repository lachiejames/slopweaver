/**
 * `handover pause`'s owner check: the reads that decide whether `--on <who>` names the owner, so the pause records
 * the owner's role word instead (`../../../handover/pauseSubject.ts` is the pure half). Neither the store nor the
 * home's `profile.json` can stop the pause — an unanswered half prints why and the subject is written as passed. The
 * board reads the same names (`boardOwnerNames`), to publish an older pause naming the owner as the owner's.
 */
import {
  ownerNames,
  ownerRosterPersons,
  pauseSubjectFor,
  sharedOwnerNames,
  unsharedOwnerNames,
} from "../../../handover/pauseSubject.js";
import { logger } from "../../../lib/logger.js";
import { withTimeout } from "../../../lib/resilience.js";
import { readProfile } from "../../../profileStore.js";
import type { IdentityRecord } from "../../../silver/identity.js";
import type { IdentityRosterPort } from "../../../silver/identityRoster.js";
import { openStore, type StoreClient, storeUrl } from "../../../store/client.js";
import { readOwnerProfile } from "../../../store/profile/client.js";

/**
 * How long the owner check waits on the store before the pause is written as passed. A chosen bound, not a
 * measurement: a reachable store answers one row read far inside it, and an unreachable one would otherwise hold the
 * pause for the driver's own connect timeout.
 */
const OWNER_CHECK_MS = 5000;

/** The warning every unanswered half of the owner check opens with. */
const OWNER_UNCHECKED = "handover pause: the owner check did not run, so --on is written as passed:";

/** The warning every unanswered half opens with when the board reads the owner's names. */
const BOARD_OWNER_UNCHECKED =
  "handover list: the owner's names did not read, so a pause naming the owner is published as written:";

/** Print why one half of the owner check did not answer, under the reading verb's own opening. */
function ownerUnchecked({ why, opening }: { why: unknown; opening: string }): void {
  logger.error({ msg: `${opening} ${why instanceof Error ? why.message : String(why)}` });
}

/**
 * The owner row's display name, or `undefined` with a warning printed when the store did not answer. A fresh
 * install with no owner row has no name to match and says nothing; a store that cannot be selected, opened or read
 * leaves the pause to be written as passed, and says so, because a board verb that stopped whenever the database
 * did would strand the row it was asked to park.
 *
 * The client is closed here rather than inside the raced read, so a store that never answers is shut at the
 * deadline (`close` force-ends its connection after its own short grace) instead of holding the process open on the
 * driver's connect timeout, and a read that settles after the deadline is ignored rather than printed.
 *
 * @param home the reading verb's own state home, whose store is the one read
 * @param opening the line a warning opens with
 * @returns the display name, when the store holds one
 */
async function storedOwnerName({ home, opening }: { home: string; opening: string }): Promise<string | undefined> {
  const url = storeUrl({ home });
  if (url.isErr()) {
    ownerUnchecked({ opening, why: url.error.message });
    return undefined;
  }
  let client: StoreClient;
  try {
    client = openStore({ max: 1, url: url.value });
  } catch (cause) {
    // A selected URL the driver cannot parse throws synchronously here, before any read.
    ownerUnchecked({ opening, why: cause });
    return undefined;
  }
  try {
    const owner = await withTimeout({ task: () => readOwnerProfile({ client }), timeoutMs: OWNER_CHECK_MS });
    if (owner.isOk()) {
      return owner.value.displayName;
    }
    if (owner.error.code !== "PROFILE_ABSENT") {
      ownerUnchecked({ opening, why: owner.error.message });
    }
    return undefined;
  } catch (cause) {
    // A store that never answers rejects here at the deadline.
    ownerUnchecked({ opening, why: cause });
    return undefined;
  } finally {
    await client.close();
  }
}

/**
 * The owner as this home's `profile.json` records them: its own display name, when it carries one, and the roster
 * entries it and the identity roster resolve — or no owner at all, with a warning when `profile.json` is present and will
 * not read, since that is not the same as a home with none. The rest of the roster comes back either way, because a
 * name the store's owner row shares with any of them is still not the owner's alone.
 *
 * @param home the reading verb's own state home
 * @param opening the line a warning opens with, naming the verb and what an unread profile costs it
 * @param roster the store's identity roster records, already read by the async caller
 * @returns the profile's display name, the roster entries naming the owner, and every other roster entry
 * @internal
 */
export function profileOwner({
  home,
  opening,
  roster,
}: {
  home: string;
  opening: string;
  roster: readonly IdentityRecord[];
}): {
  displayName: string | undefined;
  persons: readonly IdentityRecord[];
  others: readonly IdentityRecord[];
} {
  const profile = readProfile({ home });
  if (profile.isErr()) {
    ownerUnchecked({ opening, why: profile.error.message });
    return { displayName: undefined, others: roster, persons: [] };
  }
  if (profile.value === null) {
    return { displayName: undefined, others: roster, persons: [] };
  }
  const persons = ownerRosterPersons({
    ownerSlackUserId: profile.value.slackBot?.ownerUserId,
    profileId: profile.value.id,
    roster,
  });
  return {
    displayName: profile.value.displayName,
    others: roster.filter((person) => !persons.includes(person)),
    persons,
  };
}

/**
 * The store's identity roster records, or `undefined` with a warning printed when the store did not answer in
 * {@link OWNER_CHECK_MS}. The owner check is advisory, and a board verb that stopped whenever the database did
 * would strand the row it was asked to park — but an unread roster is NOT an empty one: it is the only witness
 * of which of the owner's names another person shares, so the caller reads `undefined` as "claim no name is the owner's".
 *
 * @param home the reading verb's own state home, whose store is the one read
 * @param opening the line a warning opens with
 * @returns the roster's records in stored order, or `undefined` when the store did not answer
 */
async function storedRoster({
  home,
  identityRoster,
  opening,
}: {
  home: string;
  identityRoster: IdentityRosterPort;
  opening: string;
}): Promise<readonly IdentityRecord[] | undefined> {
  try {
    const snapshot = await withTimeout({ task: () => identityRoster.read({ home }), timeoutMs: OWNER_CHECK_MS });
    if (snapshot.isOk()) {
      return snapshot.value.records;
    }
    ownerUnchecked({ opening, why: snapshot.error.message });
    return undefined;
  } catch (cause) {
    // A store that never answers rejects here at the deadline.
    ownerUnchecked({ opening, why: cause });
    return undefined;
  }
}

/**
 * Every name only the owner answers to in this install — the store's owner row, the profile's display name, and a
 * roster entry the profile resolves — less any another roster person also answers to. Neither half can fail the
 * read: an unanswered one prints why under `opening` and contributes nothing. An unread ROSTER yields no names at
 * all, never the profile's alone: without it a name another person shares would read as the owner's, and the role
 * word written over a shared name is a subject publication cannot recover, while a literal name it re-reads as the
 * owner's later.
 *
 * @param home the reading verb's own state home, whose profile, roster and store are read
 * @param identityRoster the door the store's identity roster is read through
 * @param opening the line a warning opens with, naming the verb and what an unread half costs it
 * @returns the owner's unshared names, case-folded; empty when the roster could not be read
 */
async function installOwnerNames({
  home,
  identityRoster,
  opening,
}: {
  home: string;
  identityRoster: IdentityRosterPort;
  opening: string;
}): Promise<ReadonlySet<string>> {
  const roster = await storedRoster({ home, identityRoster, opening });
  if (roster === undefined) {
    return new Set();
  }
  const profile = profileOwner({ home, opening, roster });
  const stored = await storedOwnerName({ home, opening });
  const names = new Set([
    ...ownerNames({ displayName: stored, persons: profile.persons }),
    ...ownerNames({ displayName: profile.displayName, persons: [] }),
  ]);
  if (names.size === 0) {
    logger.warn({
      msg: `${opening.split(":")[0]!}: the install records no name for the owner (no profile.json displayName, no store owner row, no roster entry), so a pause naming the owner by name stays as written`,
    });
  }
  const shared = sharedOwnerNames({ names, others: profile.others });
  if (shared.length > 0) {
    logger.warn({
      msg: `${opening.split(":")[0]!}: ${shared.join(", ")} — recorded for the owner AND another roster person, so never read as the owner's; a pause on the owner by that name stays as written (pass "the owner" or a name only the owner answers to)`,
    });
  }
  return unsharedOwnerNames({ names, others: profile.others });
}

/**
 * The subject a pause records: the owner's role word when `who` names the owner by any name this install records for
 * them, else `who` unchanged. A name another roster person also answers to is never read as the owner's. Neither half of the
 * owner check can stop the pause.
 *
 * @param home the pause's own state home, whose profile, roster and store are read
 * @param identityRoster the door the store's identity roster is read through
 * @param who the subject the caller passed to `--on`
 * @returns the subject to write
 */
export async function recordedSubject({
  home,
  identityRoster,
  who,
}: {
  home: string;
  identityRoster: IdentityRosterPort;
  who: string;
}): Promise<string> {
  return pauseSubjectFor({ names: await installOwnerNames({ home, identityRoster, opening: OWNER_UNCHECKED }), who });
}

/**
 * The names the board publishes a `pausedOn:` against: the same install read a pause makes, so a row paused under
 * the owner's name before the pause wrote the role word still publishes as the owner's.
 *
 * @param home the board's own state home
 * @param identityRoster the door the store's identity roster is read through
 * @returns the owner's unshared names, case-folded; empty when the install records no owner
 */
export async function boardOwnerNames({
  home,
  identityRoster,
}: {
  home: string;
  identityRoster: IdentityRosterPort;
}): Promise<ReadonlySet<string>> {
  return installOwnerNames({ home, identityRoster, opening: BOARD_OWNER_UNCHECKED });
}
