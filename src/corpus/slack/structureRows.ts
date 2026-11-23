/**
 * The pure half of the Slack STRUCTURE lane: project the raw `team.info`/`auth.test`, `conversations.list` and
 * `usergroups.list` objects into {@link StructureBronzeRow}s. No SDK call and no I/O; the orchestration and
 * the live seam that feed these are in `./structures.ts`.
 */
import { isRecord } from "../../lib/parsers.js";
import type { AttrValue, StructureBronzeRow, StructureRelation } from "../structures/types.js";
import { optStr as slStr } from "./shape.js";

/** The `topic`/`purpose` value string off a Slack channel sub-object (`{ value }`). Pure. */
function nestedValue({ field }: { field: unknown }): string | undefined {
  return isRecord(field) ? slStr({ value: field["value"] }) : undefined;
}

/**
 * Project the workspace (`team.info` + `auth.test`) into an `org` structure row. Pure — undefined without a
 * team id. Enterprise id/name (Enterprise Grid) come from `auth.test` when present.
 *
 * @param team the raw `team.info` team object
 * @param auth the raw `auth.test` response (for enterprise fields)
 * @param fetchedAtIso the hydration timestamp
 * @returns the workspace row, or `undefined`
 */
export function projectWorkspaceRow({
  team,
  auth,
  fetchedAtIso,
}: {
  team: unknown;
  auth: unknown;
  fetchedAtIso: string;
}): StructureBronzeRow | undefined {
  const id = isRecord(team) ? slStr({ value: team["id"] }) : undefined;
  if (!isRecord(team) || id === undefined) {
    return undefined;
  }
  const name = slStr({ value: team["name"] });
  const domain = slStr({ value: team["domain"] });
  const enterpriseId = isRecord(auth) ? slStr({ value: auth["enterprise_id"] }) : undefined;
  const enterpriseName = isRecord(auth) ? slStr({ value: auth["enterprise_name"] }) : undefined;
  return {
    attrs: {
      ...(enterpriseId !== undefined ? { enterpriseId } : {}),
      ...(enterpriseName !== undefined ? { enterpriseName } : {}),
    },
    fetchedAtIso,
    identity: {
      nativeId: id,
      ...(name !== undefined ? { name } : {}),
      ...(domain !== undefined ? { slug: domain } : {}),
      ...(domain !== undefined ? { url: `https://${domain}.slack.com` } : {}),
    },
    kind: "org",
    provenance: ["slack.team.info"],
    raw: { auth, team },
    relations: [],
    source: "slack",
    sourceId: id,
    version: 1,
    warnings: [],
  };
}

/** The `member` relations off a channel's resolved member ids (each a `slack:<userId>` person). Pure. */
function memberRelations({ memberIds }: { memberIds: readonly string[] }): readonly StructureRelation[] {
  return memberIds.map((userId) => ({
    targetId: `slack:${userId}`,
    targetKind: "person",
    targetSource: "person",
    type: "member",
  }));
}

/**
 * The curated attributes of one channel row. Pure — split out of `projectChannelRow` because the two
 * flag fields below carry the reasoning, and it is the attribute bag a reader comes here for.
 */
function channelAttrs({
  raw,
  membershipFetched,
}: {
  raw: Readonly<Record<string, unknown>>;
  membershipFetched: boolean;
}): Record<string, AttrValue> {
  const topic = nestedValue({ field: raw["topic"] });
  const purpose = nestedValue({ field: raw["purpose"] });
  const creator = slStr({ value: raw["creator"] });
  return {
    archived: raw["is_archived"] === true,
    // Whether the reading account is IN this channel — the field that decides whether its history can be
    // read at all. `conversations.list` returns every channel in the workspace, so most rows here describe
    // a conversation this token cannot open: measured at 571 of 715 on the owner's workspace. It was being
    // fetched on every refresh and dropped, which left "does this channel exist" and "can I read it" as the
    // same unanswerable question, and made a failing `conversations.history` the only way to find out.
    //
    // A strict `=== true` rather than a truthiness check, and that matters: a row Slack sent WITHOUT the
    // field must read as not-a-member, because guessing "probably yes" here is what would send a caller at
    // a channel it cannot open.
    isMember: raw["is_member"] === true,
    // Whether `conversations.members` was actually CALLED for this channel — the difference between "nobody
    // is in it" and "we never asked", which the member relations alone cannot express because both are zero
    // of them. The row already said so in `provenance` and in a prose `warnings` entry, and neither reaches
    // silver: `StructureEntity` (`../../silver/structures`) carries `attrs` and `relationCount` and nothing
    // else, so every consumer downstream read a capped channel as an empty one.
    //
    // Measured on the owner's workspace, at a default cap of 50: 606 channels, membership
    // resolved for exactly 50, 411 active channels never asked — and ZERO of the 50 asked came back with no
    // members. So every zero in silver was a never-asked, and nothing said so.
    //
    // `../../atlas/slack` already fixed the identical hole one field over, for `is_member`, and its
    // `membershipKnown` comment states the principle: an absence is indistinguishable from a real zero.
    membershipResolved: membershipFetched,
    private: raw["is_private"] === true,
    ...(topic !== undefined ? { topic } : {}),
    ...(purpose !== undefined ? { purpose } : {}),
    ...(creator !== undefined ? { creator } : {}),
    ...(typeof raw["num_members"] === "number" ? { numMembers: raw["num_members"] } : {}),
    ...(typeof raw["created"] === "number" ? { created: raw["created"] } : {}),
  };
}

/**
 * Project one raw `conversations.list` channel object into a `channel` structure row, attaching any resolved
 * member relations. Pure — undefined without a channel id. Membership stays empty when it wasn't fetched
 * (a `membership-not-fetched` warning is added so the gap is explicit, never mistaken for "no members").
 *
 * @param raw the raw channel object
 * @param memberIds the resolved member ids (empty when membership wasn't fetched — see `membershipFetched`)
 * @param membershipFetched whether membership was actually fetched for this channel
 * @param fetchedAtIso the hydration timestamp
 * @returns the channel row, or `undefined`
 */
export function projectChannelRow({
  raw,
  memberIds,
  membershipFetched,
  fetchedAtIso,
}: {
  raw: unknown;
  memberIds: readonly string[];
  membershipFetched: boolean;
  fetchedAtIso: string;
}): StructureBronzeRow | undefined {
  const id = isRecord(raw) ? slStr({ value: raw["id"] }) : undefined;
  if (!isRecord(raw) || id === undefined) {
    return undefined;
  }
  const name = slStr({ value: raw["name"] });
  return {
    attrs: channelAttrs({ membershipFetched, raw }),
    fetchedAtIso,
    identity: { nativeId: id, ...(name !== undefined ? { name } : {}) },
    kind: "channel",
    provenance: ["slack.conversations.list", ...(membershipFetched ? ["slack.conversations.members"] : [])],
    raw,
    relations: memberRelations({ memberIds }),
    source: "slack",
    sourceId: id,
    version: 1,
    warnings: membershipFetched ? [] : ["membership not fetched (archived or past the membership cap)"],
  };
}

/**
 * Project one raw usergroup (`usergroups.list` with inline `users`) into a `usergroup` row. Pure.
 *
 * @param raw one raw usergroup object, of unvalidated shape
 * @param fetchedAtIso when the fetch happened
 * @returns the row with one membership relation per user, or undefined when it cannot be identified
 */
export function projectUsergroupRow({
  raw,
  fetchedAtIso,
}: {
  raw: unknown;
  fetchedAtIso: string;
}): StructureBronzeRow | undefined {
  const id = isRecord(raw) ? slStr({ value: raw["id"] }) : undefined;
  if (!isRecord(raw) || id === undefined) {
    return undefined;
  }
  const name = slStr({ value: raw["name"] });
  const handle = slStr({ value: raw["handle"] });
  const users = Array.isArray(raw["users"]) ? raw["users"].filter((u): u is string => typeof u === "string") : [];
  return {
    attrs: {},
    fetchedAtIso,
    identity: {
      nativeId: id,
      ...(name !== undefined ? { name } : {}),
      ...(handle !== undefined ? { slug: handle } : {}),
    },
    kind: "usergroup",
    provenance: ["slack.usergroups.list"],
    raw,
    relations: memberRelations({ memberIds: users }),
    source: "slack",
    sourceId: id,
    version: 1,
    warnings: [],
  };
}
