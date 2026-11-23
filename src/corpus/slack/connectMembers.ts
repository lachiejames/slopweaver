/**
 * Slack member recovery from a MESSAGE's own `user_profile` — the people `users.list` structurally cannot
 * return, kept apart from {@link ./members} because they come from a different place and carry less.
 *
 * `users.list` answers for the workspace the token is installed in. This install is a single workspace of an
 * Enterprise Grid (`corpus/structures/slack.jsonl` records an `enterprise_id` with
 * `is_enterprise_install: false`), so a colleague in a sibling Grid workspace and a Slack Connect partner are
 * both invisible to it — no amount of paging reaches them, and `src/lib/paging.ts` is not implicated.
 * Slack's own answer to that is to stamp `user_profile` onto exactly those messages, which is what this
 * module reads.
 *
 * Measured on the dogfood corpus (reproduce: `slopweaver refresh --source slack` and read the
 * `members slack:` summary lines): 848 distinct Slack author ids in bronze, 913 `users.list` member rows,
 * 359 authors with no member row — of which 210 carry a `user_profile` and are recovered here, while the
 * remaining 149 never spoke at all, appearing only in `channel_join`/`channel_leave` system events.
 *
 * **These rows classify nothing.** The largest foreign team in that set holds colleagues — people in a
 * sibling Grid workspace — beside genuine Connect partners, and `user_profile` carries a team id and no
 * enterprise id, so nothing here can tell them apart. The team id is recorded on `profile.teams` so a later
 * pass can, and `silver/accountKind.ts`'s `EXTERNAL_MEMBER_PROVENANCE` is deliberately not claimed.
 */
import { isRecord } from "../../lib/parsers.js";
import { buildMemberIdentity } from "../members/email.js";
import type { MemberBronzeRow } from "../members/types.js";
import { optStr } from "./shape.js";

/** How a recovered row records where it came from — matched exactly, never inferred from a missing field. */
export const USER_PROFILE_PROVENANCE = "slack.message.user_profile";

/**
 * How a `users.list` row records where IT came from — the string {@link ./members.projectSlackMember} writes.
 * Named here because {@link listedMemberIds} matches on it, and a literal copied into a second file is how
 * the two silently stop agreeing.
 */
export const USERS_LIST_PROVENANCE = "slack.users.list";

/**
 * Why a recovered row's email is `missing`, said out loud on the row. Unlike the `users.list` lane's
 * warning this is NOT a scope gap the operator can close: a message's `user_profile` carries no email field
 * at all, so no grant changes it.
 */
export const NO_EMAIL_WARNING =
  "no email — a message's user_profile carries none, and no Slack scope adds one; this member joins on handle/name only";

/**
 * The best display name on a message's `user_profile`: `display_name` → `real_name` → `name`, else
 * undefined. The same precedence {@link ./members.memberName} applies to a `users.list` member, written
 * separately because the two payloads differ in SHAPE — `users.list` nests these under `profile`, a message's
 * `user_profile` carries them flat — and one function reading both would have to guess which it was handed.
 *
 * @param profile the raw `user_profile` object off a message
 * @returns the display name, or undefined when the payload carries none
 */
export function connectMemberName({ profile }: { profile: Record<string, unknown> }): string | undefined {
  const display = optStr({ value: profile["display_name"] });
  if (display !== undefined) {
    return display;
  }
  const real = optStr({ value: profile["real_name"] });
  if (real !== undefined) {
    return real;
  }
  return optStr({ value: profile["name"] });
}

/**
 * The best avatar on a message's `user_profile`: the 512px image when it carries one, else the 72px image
 * these payloads do carry. Branches rather than a coalesce chain, because a substitution is being made and
 * the reader should see it happen.
 *
 * @param profile the raw `user_profile` object off a message
 * @returns the avatar URL, or undefined when the payload carries neither size
 */
function connectAvatarUrl({ profile }: { profile: Record<string, unknown> }): string | undefined {
  const large = optStr({ value: profile["image_512"] });
  if (large !== undefined) {
    return large;
  }
  return optStr({ value: profile["image_72"] });
}

/**
 * Project one message's `user_profile` into a {@link MemberBronzeRow}. Pure — undefined when the payload is
 * not an object or the author id is empty.
 *
 * **Two fields are deliberately ABSENT rather than defaulted, and both for the same reason: the payload does
 * not carry them, so any value would be invented.** `profile.active` — `users.list` always carries `deleted`,
 * which is why the sibling lane can treat an absent one as an anomaly, while `user_profile` has no such field.
 * `profile.bot` — the sibling lane's `is_bot === true` is sound because `users.list` always carries `is_bot`;
 * the same spelling here would MANUFACTURE a negative, and `classifyMemberRow`
 * ({@link ../../silver/accountKind}) tests `profile.bot === true` as its first structural rule, so a bot
 * recovered this way would be classified a teammate on a fact nobody asserted. Found by the r2 review pass.
 *
 * Measured over every `user_profile` in this corpus (210 distinct authors, reproduce with `slopweaver refresh
 * --source slack` and read the `members slack:` recovery line): `avatar_hash`, `image_72`, `first_name`,
 * `real_name`, `display_name`, `team`, `name`, `is_restricted` and `is_ultra_restricted` are each present on
 * all 210 and nothing else is present on any. So `guest` below is READ; `bot` and `active` could only be
 * guessed.
 *
 * @param userId the message's author id, which `user_profile` itself does not carry
 * @param profile the raw `user_profile` object
 * @param fetchedAtIso when this row was captured
 * @returns the member row, or `undefined` when the payload cannot produce one
 */
export function projectConnectMember({
  userId,
  profile,
  fetchedAtIso,
}: {
  userId: string;
  profile: unknown;
  fetchedAtIso: string;
}): MemberBronzeRow | undefined {
  if (!isRecord(profile) || userId.length === 0) {
    return undefined;
  }
  const handle = optStr({ value: profile["name"] });
  const name = connectMemberName({ profile });
  const title = optStr({ value: profile["title"] });
  const team = optStr({ value: profile["team"] });
  const avatarUrl = connectAvatarUrl({ profile });
  const guest = profile["is_restricted"] === true || profile["is_ultra_restricted"] === true;
  return {
    fetchedAtIso,
    identity: buildMemberIdentity({
      nativeId: userId,
      source: "slack",
      ...(handle !== undefined ? { handle } : {}),
      ...(name !== undefined ? { name } : {}),
    }),
    profile: {
      guest,
      ...(title !== undefined ? { title } : {}),
      ...(avatarUrl !== undefined ? { avatarUrl } : {}),
      ...(team !== undefined ? { teams: [team] } : {}),
    },
    provenance: [USER_PROFILE_PROVENANCE],
    raw: profile,
    source: "slack",
    sourceId: userId,
    version: 1,
    warnings: [NO_EMAIL_WARNING],
  };
}

/**
 * Every id `users.list` has EVER answered for, across the whole append-only member store. Pure.
 *
 * Read off recorded provenance rather than off a missing field, the same discipline
 * `silver/accountKind.ts`'s `EXTERNAL_MEMBER_PROVENANCE` follows, so a row's origin decides this and
 * nothing infers it.
 *
 * @param stored every Slack member row already on disk, any vintage
 * @returns the ids a `users.list` row exists for
 */
export function listedMemberIds({ stored }: { stored: readonly MemberBronzeRow[] }): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const row of stored) {
    if (row.provenance.includes(USERS_LIST_PROVENANCE)) {
      ids.add(row.sourceId);
    }
  }
  return ids;
}

/**
 * Keep only the recovered rows for ids `users.list` has never answered for, in `harvested` order. Pure.
 *
 * Load-bearing rather than tidiness: {@link ../members/store.memberFingerprint} blanks only `fetchedAtIso`,
 * so a recovered row and a `users.list` row for the SAME person differ in `provenance` and `raw`, fingerprint
 * differently, and would both persist — one id with two member rows, a fresh defect of the family this module
 * exists to close. `users.list` stays authoritative wherever it answered at all: it carries the email, the
 * `active` flag and the admin bit, and a message profile carries none of them.
 *
 * **`listed` spans every past hydration, not just this one, and that is the whole point of the parameter.**
 * Subtracting only the CURRENT batch leaves this hole: a colleague who moves to a sibling Grid workspace
 * stops appearing in `users.list` while their old messages still carry a profile, so the next hydration
 * writes a recovered row with a LATER `fetchedAtIso` — and `latestMemberRows`
 * ({@link ../../silver/mentionResolver}) collapses by recency, so that row shadows the `users.list` one and
 * the member layer loses their trusted email and their `active` flag. Their own mention then refuses on the
 * no-trusted-email rule where it used to answer. Found by the r1 review pass on this change, before it
 * landed.
 *
 * @param listed every id `users.list` has answered for, this hydration and every past one
 * @param harvested the rows recovered from message profiles
 * @returns the recovered rows worth writing
 */
export function mergeConnectMembers({
  listed,
  harvested,
}: {
  listed: ReadonlySet<string>;
  harvested: readonly MemberBronzeRow[];
}): readonly MemberBronzeRow[] {
  return harvested.filter((row) => !listed.has(row.sourceId));
}
