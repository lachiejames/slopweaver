/**
 * Resolve a raw Slack user id to a DISPLAY handle, through the same two roster layers every other identity
 * consumer uses: the human override roster wins, the derived roster answers otherwise.
 *
 * This exists because the live-turn dispatch path used to answer the question with `resolveHandle`, which
 * looks a token up in a map keyed by each roster record's own `id` (`person:ada`). A Slack user id is
 * never a roster `id`, so that lookup could not match and returned the raw id verbatim every time — a call
 * that read like resolution and never resolved anyone.
 *
 * The match here is an EXACT `(slack, nativeId)` comparison, which is why a HELD person is still a valid
 * answer: "held" describes an unapplied NAME merge, and nothing about an exact id match depends on it. Two
 * people claiming one Slack id is the one case that refuses — "which of their accounts?" is not a question
 * this layer may answer, so it hands back the raw id rather than picking.
 *
 * Display only. Nothing here is a join key, and a name is never invented: an unknown id comes back unchanged.
 */
import type { DerivedRoster } from "./derivedRoster.js";
import type { IdentityRecord, PersonIdentity } from "./identity.js";

/**
 * The source ids a roster entry pins. An entry written only for its `id`/`handle`/`name` display contract carries
 * no cross-source `identities`, so it claims no Slack id.
 */
function pinnedIdentities({ record }: { record: IdentityRecord }): readonly PersonIdentity[] {
  const { identities } = record;
  if (identities == null) {
    return [];
  }
  return identities;
}

/** The `@handle` an override record offers for a Slack id it explicitly claims, else `undefined`. */
function overrideHandleFor({
  overrides,
  userId,
}: {
  overrides: readonly IdentityRecord[];
  userId: string;
}): string | undefined {
  const claiming = overrides.filter((record) =>
    pinnedIdentities({ record }).some((identity) => identity.source === "slack" && identity.nativeId === userId),
  );
  const first = claiming[0];
  if (first === undefined || claiming.length > 1) {
    return undefined; // no claim, or a human wrote two answers — neither is a handle this may return
  }
  return first.handle.length > 0 ? `@${first.handle}` : undefined;
}

/** The `@handle` the derived roster offers for a Slack id, else `undefined`. */
function derivedHandleFor({ derived, userId }: { derived: DerivedRoster; userId: string }): string | undefined {
  const matches = derived.people.flatMap((person) =>
    person.identities.filter((identity) => identity.source === "slack" && identity.nativeId === userId),
  );
  const first = matches[0];
  if (first === undefined || matches.length > 1) {
    return undefined; // unknown, or claimed twice — refuse rather than choose
  }
  const { handle = first.name } = first;
  return handle !== undefined && handle.length > 0 ? `@${handle}` : undefined;
}

/**
 * The display handle for a Slack user id — override layer first, then the derived roster, then the raw id.
 *
 * @param derived the derived roster (`corpus/silver/index/identities.json`)
 * @param overrides the human override roster (the store's identity roster), which always wins
 * @param userId the raw Slack user id, with or without a leading `@`
 * @returns the resolved `@handle`, or `userId` unchanged when it is unknown or ambiguous — never a guess
 */
export function slackUserDisplayHandle({
  derived,
  overrides,
  userId,
}: {
  derived: DerivedRoster;
  overrides: readonly IdentityRecord[];
  userId: string;
}): string {
  const bare = userId.startsWith("@") ? userId.slice(1) : userId;
  const override = overrideHandleFor({ overrides, userId: bare });
  if (override !== undefined) {
    return override;
  }
  const fromRoster = derivedHandleFor({ derived, userId: bare });
  if (fromRoster !== undefined) {
    return fromRoster;
  }
  return userId;
}
