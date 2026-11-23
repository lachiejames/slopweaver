/**
 * `conversations.info` + `conversations.members` — who is in the conversation an as-me message posts into, and
 * whether it is a direct message (`../../outbound/slack/dmMembership.ts` says what each half decides).
 *
 * Its own read rather than a field on `conversationInfoCall` (`./writeApiPoll.ts`), whose surface deliberately files a
 * group DM under `private-channel` for the visibility questions it answers: a group DM's membership is fixed like a
 * 1:1's, so this read classifies `is_im || is_mpim` itself. Every failure is an `unreadable` answer naming the cause,
 * never a throw — the caller decides what an unread conversation may and may not do.
 */
import type { WebClient } from "@slack/web-api";
import { formatIngestError } from "../../lib/ingestError.js";
import { isRecord } from "../../lib/parsers.js";
import { safeProviderCall } from "../../lib/providerCall.js";
import type { ConversationMembership } from "../../outbound/slack/dmMembership.js";

/** Slack's own ceiling for one `conversations.members` page. */
const MEMBERS_PAGE_LIMIT = 1000;

/**
 * The most pages read before the answer is called unreadable rather than paged on — 20,000 members, far past any
 * conversation an as-me message is composed for, so a runaway cursor cannot hold a send open.
 */
const MEMBERS_MAX_PAGES = 20;

/**
 * Whether Slack's `channel` record is a 1:1 or group DM — `undefined` when neither flag is a definite boolean, which
 * the caller reports as unreadable rather than guessing either way.
 *
 * @param info the `channel` record `conversations.info` answered
 * @returns true for a DM, false for a channel, undefined when the record does not say
 */
export function isDirectMessage({ info }: { info: Record<string, unknown> }): boolean | undefined {
  const isIm = info["is_im"];
  const isMpim = info["is_mpim"];
  if (isIm === true || isMpim === true) {
    return true;
  }
  // Measured on `conversationInfoCall`: a DM answers `is_mpim` as absent, so only a definite `is_im: false` places a
  // conversation as a channel.
  return isIm === false ? false : undefined;
}

/**
 * Read who is in one conversation, and whether it is a direct message.
 *
 * @param client the repeatable-call client, under the token the message would post with
 * @param channel the conversation id
 * @param scopeId the shared-429-block key for this token
 * @returns the members and the DM verdict, or why they could not be read
 */
export async function conversationMembershipCall({
  client,
  channel,
  scopeId,
}: {
  client: WebClient;
  channel: string;
  scopeId: string;
}): Promise<ConversationMembership> {
  const info = await safeProviderCall({
    execute: () => client.conversations.info({ channel }),
    operation: "slack.conversations.info",
    provider: "slack",
    retryMode: "transient",
    scopeId,
  });
  if (info.isErr()) {
    return { cause: formatIngestError({ error: info.error }), kind: "unreadable" };
  }
  const record = info.value.channel;
  const directMessage = isRecord(record) ? isDirectMessage({ info: record }) : undefined;
  if (directMessage === undefined) {
    return { cause: "conversations.info did not say whether it is a direct message", kind: "unreadable" };
  }
  const members: string[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MEMBERS_MAX_PAGES; page += 1) {
    const read = await safeProviderCall({
      execute: () =>
        client.conversations.members({
          channel,
          limit: MEMBERS_PAGE_LIMIT,
          ...(cursor === undefined ? {} : { cursor }),
        }),
      operation: "slack.conversations.members",
      provider: "slack",
      retryMode: "transient",
      scopeId,
    });
    if (read.isErr()) {
      return { cause: formatIngestError({ error: read.error }), kind: "unreadable" };
    }
    const pageMembers = read.value.members;
    if (pageMembers === undefined) {
      return { cause: "conversations.members answered with no member list", kind: "unreadable" };
    }
    members.push(...pageMembers);
    const next = read.value.response_metadata?.next_cursor;
    if (next === undefined || next.length === 0) {
      return { directMessage, kind: "read", members: new Set(members) };
    }
    cursor = next;
  }
  return { cause: `more than ${String(MEMBERS_MAX_PAGES)} pages of members`, kind: "unreadable" };
}
