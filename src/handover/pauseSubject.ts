/**
 * The subject a pause records when it waits on the owner: the owner's ROLE, never their name.
 *
 * The console reads a paused row as the owner's by matching `pausedOn:` against role words alone
 * (`site/lib/workstreams.ts`'s `isOnOwner`), because the owner's own name is installation state the console never
 * holds. A session writing `--on <the owner's name>` would therefore park the owner's row under somebody else. This
 * module closes that at the one writer: the owner's names are the store's owner row (`readOwnerProfile`'s display
 * name) and the roster entry `profile.json` and the identity roster resolve by the same two exact crosswalks
 * `linear query --assignee me` uses, and a subject naming the owner by any of them is written as the owner role
 * word. The board publishes a row's `pausedOn:` through the same mapping (`cli/commands/handover/listJson.ts`), so a
 * row paused under the owner's name still reads as the owner's. Pure; the caller does the reads.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import type { IdentityRecord } from "../silver/identity.js";

/**
 * The role word a pause on the owner records — one of the subjects `isOnOwner` reads as the owner's. The console
 * restates it beside the subjects it reads (`site/lib/workstreams.ts`).
 */
export const OWNER_PAUSE_SUBJECT = "owner" as const;

/** Whether a roster person carries this Slack user id; a person with no linked identities carries none. */
function carriesSlackId({ person, slackUserId }: { person: IdentityRecord; slackUserId: string }): boolean {
  const identities = unsetFieldAsNull({ key: "identities", record: person });
  if (identities === null) {
    return false;
  }
  return identities.some((identity) => identity.source === "slack" && identity.nativeId === slackUserId);
}

/**
 * The roster person who is the owner, by `profile.json`'s own id and then by the Slack user id it declares as theirs —
 * exact matches only, never a name guess.
 *
 * @param profileId the persona seed's own id
 * @param ownerSlackUserId the Slack user id the profile declares as the owner's, when it declares one
 * @param roster the human identity roster the store holds
 * @returns every roster person either crosswalk names, the profile-id match first
 */
export function ownerRosterPersons({
  profileId,
  ownerSlackUserId,
  roster,
}: {
  profileId: string;
  ownerSlackUserId: string | undefined;
  roster: readonly IdentityRecord[];
}): readonly IdentityRecord[] {
  const byProfileId = roster.find((person) => person.id === profileId);
  const bySlackId =
    ownerSlackUserId === undefined
      ? undefined
      : roster.find((person) => carriesSlackId({ person, slackUserId: ownerSlackUserId }));
  return [byProfileId, bySlackId].filter((person): person is IdentityRecord => person !== undefined);
}

/**
 * A name trimmed, stripped of a leading `@` and composed, keyed by its lower AND upper case together, so `@ada` and
 * `Ada` compare equal, the way `personLookup.ts`'s `normaliseHandle` reads a handle with or without its `@`. One
 * direction alone conflates distinct letters (a dotless `ı` and an `i` both raise to `I`), and a false match here
 * writes a row as the owner's, so two names match only when both directions agree. The cost is the safe one: a pair only one direction relates (a final and a medial sigma) is written as
 * passed.
 */
function caseFolded({ name }: { name: string }): string {
  const composed = name.trim().replace(/^@/u, "").normalize("NFC");
  if (composed.length === 0) {
    return "";
  }
  return `${composed.toLowerCase()}\u0000${composed.toUpperCase()}`;
}

/** A full name and its first word, the two ways a session names a person in a pause. */
function nameAndFirstWord({ name }: { name: string }): readonly string[] {
  const [firstWord] = name.trim().split(/\s+/u);
  return firstWord === undefined ? [name] : [name, firstWord];
}

/**
 * Every name the owner is recorded under, case-folded: the store's own display name and its first word, then for
 * each roster entry its name and first word, its handle, each linked identity's handle and name, and what the owner's
 * voice-to-text makes of it.
 *
 * @param displayName the owner row's display name in the store, when it was read
 * @param persons the owner's roster entries
 * @returns the names, case-folded, empties dropped
 */
export function ownerNames({
  displayName,
  persons,
}: {
  displayName: string | undefined;
  persons: readonly IdentityRecord[];
}): ReadonlySet<string> {
  const names: string[] = displayName === undefined ? [] : [...nameAndFirstWord({ name: displayName })];
  for (const person of persons) {
    names.push(...nameAndFirstWord({ name: person.name }), person.handle);
    const identities = unsetFieldAsNull({ key: "identities", record: person });
    if (identities !== null) {
      for (const identity of identities) {
        names.push(...[identity.handle, identity.name].filter((name): name is string => name !== undefined));
      }
    }
    const heardAs = unsetFieldAsNull({ key: "heardAs", record: person });
    if (heardAs !== null) {
      names.push(...heardAs);
    }
  }
  return new Set(names.map((name) => caseFolded({ name })).filter((name) => name.length > 0));
}

/**
 * The owner's names less every one somebody else on the roster also answers to, so a first name the owner shares with a
 * colleague is never read as the owner: a pause on that colleague by first name stays theirs.
 *
 * @param names the owner's recorded names, case-folded ({@link ownerNames})
 * @param others every roster person who is not the owner
 * @returns the names only the owner is recorded under
 */
export function unsharedOwnerNames({
  names,
  others,
}: {
  names: ReadonlySet<string>;
  others: readonly IdentityRecord[];
}): ReadonlySet<string> {
  const shared = ownerNames({ displayName: undefined, persons: others });
  return new Set([...names].filter((name) => !shared.has(name)));
}

/**
 * The owner's names somebody else on the roster also answers to — the ones {@link unsharedOwnerNames} drops — each
 * in its lower-case spelling, so the reading verb can say which recorded names it is declining to read as the owner's.
 *
 * @param names the owner's recorded names, case-folded ({@link ownerNames})
 * @param others every roster person who is not the owner
 * @returns the shared names, lower-cased and sorted
 */
export function sharedOwnerNames({
  names,
  others,
}: {
  names: ReadonlySet<string>;
  others: readonly IdentityRecord[];
}): readonly string[] {
  const unshared = unsharedOwnerNames({ names, others });
  return [...names]
    .filter((name) => !unshared.has(name))
    .map((name) => name.split("\u0000")[0]!)
    .toSorted();
}

/**
 * The subject to record for `--on <who>`: the owner's role word when `who` names the owner, else `who` unchanged.
 *
 * @param who the subject the caller passed
 * @param names the owner's recorded names, case-folded ({@link ownerNames})
 * @returns the subject to write to `pausedOn:`
 */
export function pauseSubjectFor({ who, names }: { who: string; names: ReadonlySet<string> }): string {
  if (names.has(caseFolded({ name: who }))) {
    return OWNER_PAUSE_SUBJECT;
  }
  return who;
}
