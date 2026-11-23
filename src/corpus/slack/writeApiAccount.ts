/**
 * `users.info` — whether one account a message sent as the owner tags is still active
 * (`../../outbound/slack/departedTags.ts` says what the answer decides).
 *
 * Every failure is an `unreadable` answer naming the cause, never a throw, the shape `./writeApiMembership.ts`
 * answers in: the caller decides what an unread account may and may not do.
 */
import type { WebClient } from "@slack/web-api";
import { formatIngestError } from "../../lib/ingestError.js";
import { isRecord } from "../../lib/parsers.js";
import { safeProviderCall, scopeIdForToken } from "../../lib/providerCall.js";
import type { TaggedAccount } from "../../outbound/slack/departedTags.js";
import { slackWritePrivacy } from "../../outbound/slack/writePrivacy.js";
import { GuardedWebClient } from "./guardedWebClient.js";

const NO_DELETED_CAUSE = "users.info did not say whether the account is deactivated";

/**
 * A well-formed Slack workspace id. A team comparison is the proof of "another workspace", so a malformed id on
 * either side (whitespace, lowercase, empty) is no proof at all rather than a difference.
 */
const SLACK_TEAM_ID = /^T[A-Z0-9]+$/;

/**
 * Whether a `users.info` record has the shape Slack gives a member of ANOTHER workspace seen through a shared
 * channel: no `deleted` key at all, and a boolean `is_stranger`. Pure. Measured on a Slack Connect
 * member of `#acme-external-security` (`slopweaver slack probe --method users.info user=<id> --shape-at user`): no
 * `deleted`, `is_stranger` present, a foreign `team_id`; a member of this workspace carries `deleted` and no
 * `is_stranger`. The shape alone proves nothing — Slack documents `is_stranger: false` for local users too — so it
 * only decides whether the token's own team is worth reading to compare against.
 *
 * @param user the `user` field `users.info` answered with, unvalidated
 * @returns true when the record omits `deleted` and carries a boolean `is_stranger`
 */
export function hasForeignMemberShape({ user }: { user: unknown }): boolean {
  return isRecord(user) && !("deleted" in user) && typeof user["is_stranger"] === "boolean";
}

/**
 * Project Slack's `user` record into the answer the departed-tag rule reads. Pure.
 *
 * Slack documents `deleted` as a field it may omit, so an absent or non-boolean one is UNREADABLE rather than a live
 * account: reading absence as active is exactly the silent pass the rule exists to close. The one exception is a
 * member of another workspace (Slack's Slack Connect guidance: `is_stranger` together with `team_id`), whose
 * deactivation this token cannot read and who never left this one — `external`, and only when the record omits
 * `deleted` entirely, carries a boolean `is_stranger`, names a `team_id` that differs from the token's own, and
 * carries the `id` of the account that was asked about, and no Enterprise Grid block (`enterprise_user` or
 * `enterprise_id`). Anything short of all five stays unreadable: the id binds the verdict to the tag, so a record
 * describing nobody in particular can never wave a local tag through. A Grid record is never external because its
 * `team_id` is the member's HOME workspace and `enterprise_user.teams` lists only CURRENT membership, so a member
 * homed in a sibling workspace who has just left this one reads exactly like a stranger. The Slack Connect partner
 * this exists for carries neither key (measured, same probe as `hasForeignMemberShape`).
 *
 * @param user the `user` field `users.info` answered with, unvalidated
 * @param tokenTeamId the posting token's own `auth.test` team, when it was read; absent keeps the record unreadable
 * @param userId the Slack user id the tag names; absent keeps a record without `deleted` unreadable
 * @returns whether the account is deactivated, and its handle when Slack gave one, or why the record cannot say
 */
export function taggedAccountFrom({
  user,
  tokenTeamId,
  userId,
}: {
  user: unknown;
  tokenTeamId?: string;
  userId?: string;
}): TaggedAccount {
  if (!isRecord(user)) {
    return { cause: "users.info answered with no user record", kind: "unreadable" };
  }
  const rawName = user["name"];
  const name = typeof rawName === "string" && rawName.length > 0 ? rawName : undefined;
  const deleted = user["deleted"];
  if (typeof deleted === "boolean") {
    return { deleted, kind: "read", name };
  }
  const teamId = user["team_id"];
  const foreignTeam =
    typeof teamId === "string" &&
    SLACK_TEAM_ID.test(teamId) &&
    tokenTeamId !== undefined &&
    SLACK_TEAM_ID.test(tokenTeamId) &&
    teamId !== tokenTeamId;
  const askedAbout = userId !== undefined && user["id"] === userId;
  const gridRecord = "enterprise_user" in user || "enterprise_id" in user;
  if (hasForeignMemberShape({ user }) && foreignTeam && askedAbout && !gridRecord) {
    return { kind: "external", name };
  }
  return { cause: NO_DELETED_CAUSE, kind: "unreadable" };
}

/**
 * The posting token's own team, off `auth.test`, or nothing when Slack would not say.
 *
 * @param client the repeatable-call client, under the token the message would post with
 * @param scopeId the shared-429-block key for this token
 * @returns the token's team id, or undefined when the read failed or carried none
 */
async function tokenTeamCall({ client, scopeId }: { client: WebClient; scopeId: string }): Promise<string | undefined> {
  const auth = await safeProviderCall({
    execute: () => client.auth.test(),
    operation: "slack.auth.test",
    provider: "slack",
    retryMode: "transient",
    scopeId,
  });
  if (auth.isErr()) {
    return undefined;
  }
  const teamId = auth.value.team_id;
  return typeof teamId === "string" && teamId.length > 0 ? teamId : undefined;
}

/**
 * Read one account off Slack's live roster. The token's own team is read only for a record with another
 * workspace's shape, so an ordinary tag still costs one call.
 *
 * @param client the repeatable-call client, under the token the message would post with
 * @param user the Slack user id the message tags
 * @param scopeId the shared-429-block key for this token
 * @returns whether the account is deactivated, and its handle, or why Slack could not say
 */
async function taggedAccountCall({
  client,
  user,
  scopeId,
}: {
  client: WebClient;
  user: string;
  scopeId: string;
}): Promise<TaggedAccount> {
  const info = await safeProviderCall({
    execute: () => client.users.info({ user }),
    operation: "slack.users.info",
    provider: "slack",
    retryMode: "transient",
    scopeId,
  });
  if (info.isErr()) {
    return { cause: formatIngestError({ error: info.error }), kind: "unreadable" };
  }
  const record: unknown = info.value.user;
  if (!hasForeignMemberShape({ user: record })) {
    return taggedAccountFrom({ user: record });
  }
  const tokenTeamId = await tokenTeamCall({ client, scopeId });
  if (tokenTeamId === undefined) {
    return taggedAccountFrom({ user: record });
  }
  return taggedAccountFrom({ tokenTeamId, user: record, userId: user });
}

/**
 * The live account reader, under the token the message would post with. Its own sanctioned factory rather than a
 * fourth in `./writeApi.ts`, which sits at the file-size cap; the client is the same guarded one, on the same
 * shared rate block.
 *
 * @param token the token the message would post under
 * @param home the state home the verb resolved; the client requires its privacy capability, though a read never loads it
 * @returns the account reader
 */
export function makeSlackAccountReader({
  token,
  home,
}: {
  token: string;
  home: string;
}): (args: { user: string }) => Promise<TaggedAccount> {
  // devlint: sdk-factory -- the users.info read an as-me preparation asks for each person a message tags
  const client = new GuardedWebClient({ privacy: slackWritePrivacy({ home }), token });
  const scopeId = scopeIdForToken({ token });
  return async ({ user }) => taggedAccountCall({ client, scopeId, user });
}
