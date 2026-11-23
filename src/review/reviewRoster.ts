/**
 * The two joins the review-state read needs from the derived roster: a GitHub login to the Slack id that
 * addresses the same person, and a Slack id to a name a row can print.
 *
 * ## Why this is a lookup and never a guess
 *
 * Identity resolution here is exact-match only — an explicit tag or a roster entry, never a name-shape or
 * nickname heuristic. Two people share a first name, nicknames vary, and a false merge corrupts the world
 * model irreversibly, so an unresolvable login stays unresolved and the caller says so. The strict addressing
 * layer in `../outbound/slack/mentionIndex.ts` is untouched by this and remains the gate for anything that
 * actually SENDS: this module only decides whether a review that already happened can be attributed to the
 * person who was tagged, which is a read, not an addressing act.
 *
 * Pure. The roster is a parameter.
 */

import type { DerivedPerson, DerivedRoster } from "../silver/derivedRoster.js";
import type { IdentityRecord } from "../silver/identity.js";

/** Both directions of the join, built once per invocation. */
export interface ReviewRoster {
  /** Lower-cased GitHub login → the Slack user id that addresses the same person. */
  readonly slackIdForLogin: ReadonlyMap<string, string>;
  /**
   * Lower-cased GitHub login → EVERY Slack id the derived and human rosters hold for that person, the one
   * {@link slackIdForLogin} picked first. What excluding a person needs: one person can carry two Slack ids
   * (a guest id and a member id, say), and an exclusion keyed on one of them misses the other.
   */
  readonly slackIdsForLogin: ReadonlyMap<string, readonly string[]>;
  /**
   * Slack id → every Slack id of the same person, the id itself included — whether or not that person has a
   * GitHub login. What leaving a reviewer out needs: an ask, a decline and a code-owner join may each name a
   * different id of one person. An id absent here is its own person.
   */
  readonly samePersonForSlackId: ReadonlyMap<string, readonly string[]>;
  /** Slack user id → a display name for a row, when the roster carries one. */
  readonly nameForSlackId: ReadonlyMap<string, string>;
  /** Lower-cased GitHub login → a display name for a row, when the roster carries one. */
  readonly nameForLogin: ReadonlyMap<string, string>;
}

/** An empty join — what an absent roster degrades to, so a caller never branches on undefined. */
export const EMPTY_REVIEW_ROSTER: ReviewRoster = {
  nameForLogin: new Map(),
  nameForSlackId: new Map(),
  samePersonForSlackId: new Map(),
  slackIdForLogin: new Map(),
  slackIdsForLogin: new Map(),
};

/** The best name a person's identities offer, or undefined when none carries one. */
function displayNameOf({ identities }: { identities: readonly { readonly name?: string }[] }): string | undefined {
  return identities.find((identity) => identity.name !== undefined && identity.name !== "")?.name;
}

/** One person's GitHub logins and Slack ids, as this roster's two lookups need them. */
function accountsOf({ person }: { person: DerivedPerson }): {
  readonly logins: readonly string[];
  readonly slackIds: readonly string[];
} {
  return {
    logins: person.identities.filter((identity) => identity.source === "github").map((i) => i.nativeId),
    slackIds: person.identities.filter((identity) => identity.source === "slack").map((i) => i.nativeId),
  };
}

/** Record one name under every key a person owns, when the roster carries a name for them at all. */
function nameInto({
  into,
  keys,
  name,
}: {
  into: Map<string, string>;
  keys: readonly string[];
  name: string | undefined;
}): void {
  if (name === undefined) {
    return;
  }
  for (const key of keys) {
    into.set(key, name);
  }
}

/** Record one Slack id under every login a person owns, when the roster carries both halves of the join. */
function joinInto({
  into,
  keys,
  slackId,
}: {
  into: Map<string, string>;
  keys: readonly string[];
  slackId: string | undefined;
}): void {
  if (slackId === undefined) {
    return;
  }
  for (const key of keys) {
    into.set(key, slackId);
  }
}

/** Add a person's Slack ids to every login they own, keeping whatever an earlier layer already recorded. */
function everyIdInto({
  into,
  keys,
  slackIds,
}: {
  into: Map<string, readonly string[]>;
  keys: readonly string[];
  slackIds: readonly string[];
}): void {
  if (slackIds.length === 0) {
    return;
  }
  for (const key of keys) {
    const merged = new Set(slackIds);
    const held = into.get(key);
    if (held !== undefined) {
      for (const each of held) {
        merged.add(each);
      }
    }
    into.set(key, [...merged]);
  }
}

/**
 * Record that some Slack ids belong to one person, merging every group any of them already belongs to, so two
 * layers (or two logins) that each name part of one person's ids end in one group.
 *
 * @param into Slack id → every id of the same person, updated in place
 * @param ids ids known to be one person's
 */
export function joinSamePerson({ into, ids }: { into: Map<string, readonly string[]>; ids: readonly string[] }): void {
  if (ids.length === 0) {
    return;
  }
  const merged = new Set<string>();
  for (const id of ids) {
    merged.add(id);
    const held = into.get(id);
    if (held !== undefined) {
      for (const each of held) {
        merged.add(each);
      }
    }
  }
  const group = [...merged];
  for (const id of group) {
    into.set(id, group);
  }
}

/**
 * Build both joins from an already-loaded derived roster.
 *
 * A person contributes to `slackIdForLogin` only when the roster carries BOTH a GitHub and a Slack identity
 * for them; one without the other is not a join and is left out rather than half-filled.
 *
 * @param roster the derived roster, as `loadDerivedRoster` returns it
 * @param overrides the human identity roster the store holds, which WINS — a person's own confirmation outranks any
 *   derived inference, and it is the only layer available when `derive` has not run
 * @returns the login → Slack id and id → name lookups
 */
export function buildReviewRoster({
  roster,
  overrides = [],
}: {
  roster: DerivedRoster;
  overrides?: readonly IdentityRecord[];
}): ReviewRoster {
  const slackIdForLogin = new Map<string, string>();
  const nameForSlackId = new Map<string, string>();
  const nameForLogin = new Map<string, string>();
  const slackIdsForLogin = new Map<string, readonly string[]>();
  const samePersonForSlackId = new Map<string, readonly string[]>();
  for (const person of roster.people) {
    const name = displayNameOf({ identities: person.identities });
    const { logins, slackIds } = accountsOf({ person });
    const [slackId] = slackIds;
    nameInto({ into: nameForSlackId, keys: slackIds, name });
    nameInto({ into: nameForLogin, keys: logins.map((login) => login.toLowerCase()), name });
    joinInto({ into: slackIdForLogin, keys: logins.map((login) => login.toLowerCase()), slackId });
    everyIdInto({ into: slackIdsForLogin, keys: logins.map((login) => login.toLowerCase()), slackIds });
    joinSamePerson({ into: samePersonForSlackId, ids: slackIds });
  }
  // The human roster is layered ON TOP and wins, because it is a person's confirmation rather than a
  // derived inference — the same precedence `../outbound/github/reviewerIndex.ts` gives it. It was missing
  // here, and the omission had teeth: three codeowner logins the owner had just confirmed by hand still
  // reported no Slack id, because `derive` had refused on heap and only the stale derived roster was read.
  for (const record of overrides) {
    const { identities = [], name } = record;
    const logins = identities.filter((i) => i.source === "github").map((i) => i.nativeId.toLowerCase());
    const slackIds = identities.filter((i) => i.source === "slack").map((i) => i.nativeId);
    nameInto({ into: nameForSlackId, keys: slackIds, name });
    nameInto({ into: nameForLogin, keys: logins, name });
    joinInto({ into: slackIdForLogin, keys: logins, slackId: slackIds[0] });
    // Every id is a UNION rather than an override: a person's confirmation outranks an inference about which
    // id addresses them, but an id either layer ties to them is still theirs when the question is who to leave out.
    everyIdInto({ into: slackIdsForLogin, keys: logins, slackIds });
    joinSamePerson({ into: samePersonForSlackId, ids: slackIds });
  }
  // A login both layers name ties their two sets of ids into one person.
  for (const ids of slackIdsForLogin.values()) {
    joinSamePerson({ into: samePersonForSlackId, ids });
  }
  return { nameForLogin, nameForSlackId, samePersonForSlackId, slackIdForLogin, slackIdsForLogin };
}

/**
 * How a row should print one CODEOWNERS owner token.
 *
 * @param token the owner token as CODEOWNERS spells it
 * @param roster the joins built by {@link buildReviewRoster}
 * @returns the token, plus the person's name and Slack id when the roster confirms them — each undefined
 *   when it does not, which is a real answer rather than a blank
 */
export function describeOwner({ token, roster }: { token: string; roster: ReviewRoster }): {
  readonly token: string;
  readonly name: string | undefined;
  readonly slackId: string | undefined;
} {
  const login = token.replace(/^@/, "").toLowerCase();
  // Undefined rather than an empty string, because "the roster does not know this login" is a real answer a
  // caller must be able to see — and it is the answer for three of the work repository's own codeowners.
  return { name: roster.nameForLogin.get(login), slackId: roster.slackIdForLogin.get(login), token };
}
