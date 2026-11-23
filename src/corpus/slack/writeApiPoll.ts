/**
 * The Slack POLL write calls — post, ballot-chip add/remove/read, visibility and `@group` resolution — split
 * out of `./writeApi.ts` purely to keep that file under `file-size-ratchet`'s 800-code-line cap. This is
 * still the one seam that mutates a workspace: these functions are wired into the SAME `SlackWriteTransport`
 * `writeApi.ts` builds, follow its exact `safeProviderCall`/`orThrow`/`scopeId` pattern, and carry no policy
 * of their own — the decisions about poll content, ping targets and when to seed a ballot live in the
 * caller, exactly as `writeApi.ts`'s own header describes for every other method here.
 */
import type { WebClient } from "@slack/web-api";

import { absentAsEmpty } from "#lib/absent.js";
import { formatIngestError } from "../../lib/ingestError.js";
import { isRecord } from "../../lib/parsers.js";
import { safeProviderCall } from "../../lib/providerCall.js";
import { orThrow } from "../../lib/safeBoundary.js";
import type { ConversationSurface, SlackPollPayload } from "../../outbound/slack/types.js";
import { optStr } from "./shape.js";
import type { PostedMessage } from "./writeTransport.js";

/*
 * Each call below takes only the ONE client method it reaches, so its type names exactly what it calls. A real
 * `WebClient` satisfies every one of them.
 */

/** `chat.postMessage`, for the poll post. */
interface ChatPostClient {
  readonly chat: Pick<WebClient["chat"], "postMessage">;
}

/** `reactions.add`, for seeding a ballot chip. */
interface ReactionAddClient {
  readonly reactions: Pick<WebClient["reactions"], "add">;
}

/** `reactions.remove`, for taking a chip back off. */
interface ReactionRemoveClient {
  readonly reactions: Pick<WebClient["reactions"], "remove">;
}

/** `reactions.get`, for the live vote read. */
interface ReactionReadClient {
  readonly reactions: Pick<WebClient["reactions"], "get">;
}

/** `conversations.info`, for the surface and name of one conversation. */
interface ConversationInfoClient {
  readonly conversations: Pick<WebClient["conversations"], "info">;
}

/** `usergroups.list`, for resolving group handles. */
interface UserGroupListClient {
  readonly usergroups: Pick<WebClient["usergroups"], "list">;
}

/**
 * `chat.postMessage` with a POLL frame. At-most-once, like every other post.
 *
 * Carries `metadata`, which is what makes a poll deletable: `messageOwnership` refuses to mutate a message
 * with no slopweaver metadata, so a poll posted without it could never be taken back after posting it wrong.
 *
 * @param client the NON-RETRYING posting client
 * @param channel the destination channel id
 * @param payload the poll's rendered card and metadata
 * @param scopeId the shared-429-block key for this token
 * @returns the posted poll message's identity
 */
export async function postPollCall({
  client,
  channel,
  payload,
  scopeId,
}: {
  client: ChatPostClient;
  channel: string;
  payload: SlackPollPayload;
  scopeId: string;
}): Promise<PostedMessage> {
  const res = orThrow({
    result: await safeProviderCall({
      // NO retry, and `client` is the NON-RETRYING one — see `writeApi.ts`'s `postingClient`. A retried poll
      // is a double post.
      execute: () =>
        client.chat.postMessage({
          // The wrapper carries the stripe; `metadata` stays TOP-LEVEL or Slack ignores it.
          attachments: [{ ...payload.attachments[0], blocks: [...payload.attachments[0].blocks] }],
          channel,
          metadata: payload.metadata,
          text: payload.text,
          unfurl_links: payload.unfurl_links,
          unfurl_media: payload.unfurl_media,
        }),
      operation: "slack.chat.postMessage.poll",
      provider: "slack",
      retryMode: "never",
      scopeId,
    }),
  });
  const postedChannel = optStr({ value: res.channel });
  const ts = optStr({ value: res.ts });
  if (postedChannel === undefined || ts === undefined) {
    throw new Error("slack.chat.postMessage returned no channel/ts");
  }
  return { channel: postedChannel, ts };
}

/**
 * `reactions.add` — seed ONE ballot chip on a poll slopweaver just posted.
 *
 * Retries as a TRANSIENT operation rather than at-most-once, because adding a reaction is IDEMPOTENT: Slack
 * answers `already_reacted` for a repeat, so a retry cannot produce a second vote. That is the opposite of a
 * post, and the difference is why this is a separate method rather than a flag.
 *
 * `already_reacted` is absorbed as success for the same reason — the desired end state is "this chip is on the
 * message", and it already is.
 *
 * @param client the repeatable-call write client
 * @param posted the poll message's identity
 * @param name the emoji name to seed
 * @param scopeId the shared-429-block key for this token
 * @returns true once the chip is on the message, including when it already was
 */
export async function addReactionCall({
  client,
  posted,
  name,
  scopeId,
}: {
  client: ReactionAddClient;
  posted: PostedMessage;
  name: string;
  scopeId: string;
}): Promise<boolean> {
  const result = await safeProviderCall({
    execute: () => client.reactions.add({ channel: posted.channel, name, timestamp: posted.ts }),
    operation: "slack.reactions.add",
    provider: "slack",
    retryMode: "transient",
    scopeId,
  });
  if (result.isOk()) {
    return true;
  }
  // A chip that is already there IS the desired state. Anything else (bad emoji name, missing scope) is
  // reported false so the caller can say which options were not seeded rather than implying all of them were.
  return result.error.message.includes("already_reacted");
}

/**
 * `reactions.remove` — take one reaction back off a message, the completion signal's own edge.
 *
 * Same IDEMPOTENT-retry shape as {@link addReactionCall}, mirrored in the opposite direction: Slack answers
 * `no_reaction` when the name was never on the message, and that IS the desired end state ("this chip is
 * gone"), so it is absorbed as success rather than reported as a failed remove.
 *
 * @param client the repeatable-call write client
 * @param posted the poll message's identity
 * @param name the emoji name to remove
 * @param scopeId the shared-429-block key for this token
 * @returns true once the chip is gone, including when it never was there
 */
export async function removeReactionCall({
  client,
  posted,
  name,
  scopeId,
}: {
  client: ReactionRemoveClient;
  posted: PostedMessage;
  name: string;
  scopeId: string;
}): Promise<boolean> {
  const result = await safeProviderCall({
    execute: () => client.reactions.remove({ channel: posted.channel, name, timestamp: posted.ts }),
    operation: "slack.reactions.remove",
    provider: "slack",
    retryMode: "transient",
    scopeId,
  });
  if (result.isOk()) {
    return true;
  }
  return result.error.message.includes("no_reaction");
}

/**
 * `reactions.get` — the LIVE vote read.
 *
 * A poll is a live artifact people are still clicking, so its counts come from Slack, never from the corpus:
 * a corpus snapshot can only ever answer "as of the last ingest", which for a running poll is a wrong number
 * presented as a result.
 *
 * @param client the repeatable-call write client
 * @param posted the poll message's identity
 * @param scopeId the shared-429-block key for this token
 * @returns the live reaction tally, or `undefined` when the poll message is gone
 */
export async function readReactionsCall({
  client,
  posted,
  scopeId,
}: {
  client: ReactionReadClient;
  posted: PostedMessage;
  scopeId: string;
}): Promise<
  readonly { readonly name: string; readonly count: number; readonly users: readonly string[] }[] | undefined
> {
  const result = await safeProviderCall({
    execute: () => client.reactions.get({ channel: posted.channel, full: true, timestamp: posted.ts }),
    operation: "slack.reactions.get",
    provider: "slack",
    retryMode: "transient",
    scopeId,
  });
  if (result.isErr()) {
    // ONLY `message_not_found` means "the poll is gone" — a real answer, distinct from "no reactions". Every
    // other failure (a bad token, a missing scope, a rate block) is re-thrown rather than flattened into the
    // same `undefined`, because reporting an auth problem as "someone deleted your poll" is a lie the operator
    // would act on. The integration test's gone-case would otherwise pass on a 401.
    if (result.error.message.includes("message_not_found")) {
      return undefined;
    }
    throw new Error(`slack.reactions.get failed: ${result.error.message}`);
  }
  return shapeLiveReactions({ message: result.value.message });
}

/** Shape a live `reactions.get` message into name/count pairs. Split out to stay under the complexity cap. */
function shapeLiveReactions({
  message,
}: {
  message: unknown;
}): readonly { name: string; count: number; users: readonly string[] }[] {
  const raw = isRecord(message) && Array.isArray(message["reactions"]) ? message["reactions"] : [];
  const out: { name: string; count: number; users: readonly string[] }[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) {
      continue;
    }
    const name = optStr({ value: entry["name"] });
    const count = entry["count"];
    if (name !== undefined && typeof count === "number") {
      // `users` is WHO reacted, which is what makes the tally "everyone except us" rather than arithmetic.
      // Measured complete on a real message (`users.length === count` for every reaction), but Slack may
      // truncate it at scale — so the count comes along and the counter falls back to it when they disagree.
      const users = Array.isArray(entry["users"])
        ? entry["users"].filter((user): user is string => typeof user === "string")
        : [];
      out.push({ count, name, users });
    }
  }
  return out;
}

/** Both halves absent: what every failure path here answers, so no caller can read half an answer. */
const NO_CONVERSATION_INFO = { name: undefined, surface: undefined } as const;

/**
 * `conversations.info` — is this a 1:1 DM, a private channel, or a channel anyone in the org can read?
 *
 * ASKED rather than inferred from the `D`/`C` prefix. The prefix is a decent heuristic, but Slack gives a
 * PRIVATE channel a `C` id too, so the prefix cannot tell the two channel arms apart at all — and both
 * answers this returns are used to make a promise. A poll's footer promises who can see someone's vote; the
 * as-me door promises that a multi-message top-level post is not about to land in a very public place
 * (`../../outbound/slack/publicCardGate.ts`). Slack's own flags are authoritative for both.
 *
 * `undefined` when the answer cannot be established — every caller refuses to post rather than guess,
 * because a footer that misstates visibility costs exactly the trust of the people whose honest answers are
 * wanted, and a drip that guessed wrong is a wall of messages under the owner's name in `#dev-team`.
 *
 * @param client the repeatable-call write client
 * @param channel the conversation id to classify
 * @param scopeId the shared-429-block key for this token
 * @returns the conversation's surface and its name, each `undefined` when it cannot be established, and whether the
 *   token's identity is a member — `false` on a `channel_not_found`, absent when Slack did not say; for a 1:1 DM, the member on the other end;
 *   and `groupDm` on a group DM
 */
export async function conversationInfoCall({
  client,
  channel,
  scopeId,
}: {
  client: ConversationInfoClient;
  channel: string;
  scopeId: string;
}): Promise<{
  surface: ConversationSurface | undefined;
  name: string | undefined;
  user?: string | undefined;
  isMember?: boolean | undefined;
  groupDm?: true | undefined;
}> {
  const result = await safeProviderCall({
    execute: () => client.conversations.info({ channel }),
    operation: "slack.conversations.info",
    provider: "slack",
    retryMode: "transient",
    scopeId,
  });
  if (result.isErr()) {
    // A private channel the token's identity is not in answers `channel_not_found` — which, asked under the bot
    // token, IS the answer "the bot is not in it". Every other failure stays unknown.
    const notFound = formatIngestError({ error: result.error }).includes("channel_not_found");
    return notFound ? { ...NO_CONVERSATION_INFO, isMember: false } : NO_CONVERSATION_INFO;
  }
  const info = result.value.channel;
  if (!isRecord(info)) {
    return NO_CONVERSATION_INFO;
  }
  // The NAME rides on the same response the surface is read from, so the console can draw `#iso-27001`
  // over a parked draft without a second call. Absent rather than guessed when Slack did not send one.
  const name = typeof info["name"] === "string" ? info["name"] : undefined;
  // So does membership: whether the token's own identity is in the conversation, which the bot-token read of an
  // as-me finding asks (`../../outbound/slack/findingIdentity.ts`). A DM answers no `is_member`, so it stays unknown.
  const isMember = typeof info["is_member"] === "boolean" ? info["is_member"] : undefined;
  // And whether it is a group DM, which carries a `C…` id like a channel: `is_mpim` is the only signal there is
  // (`../../live/slack/permalink.ts`). Stamped only on a definite `true`, so an absent flag never exempts a channel
  // from the first-message proof bar that reads it (`../../outbound/slack/firstMessageProof.ts`).
  const groupDm = info["is_mpim"] === true ? { groupDm: true as const } : {};
  const surfaced = { ...surfaceOf({ info, name }), ...groupDm };
  return isMember === undefined ? surfaced : { ...surfaced, isMember };
}

/**
 * The conversation's surface off its `conversations.info` record — see {@link conversationInfoCall}.
 *
 * @param info the `channel` record Slack answered
 * @param name what it is called, carried through
 * @returns the surface and name, the surface `undefined` when the flags cannot establish it, and for a 1:1 DM the
 *   member on the other end
 */
function surfaceOf({ info, name }: { info: Record<string, unknown>; name: string | undefined }): {
  surface: ConversationSurface | undefined;
  name: string | undefined;
  user?: string | undefined;
} {
  // FAIL CLOSED on anything that is not a definite boolean. A ternary on `is_im === true` would classify an
  // absent or malformed flag as `shared-channel`, so a partial-but-successful response for a real DM would
  // render "Everyone in this channel can see who voted" INSIDE that DM — precisely the lie this lookup exists
  // to prevent, reintroduced one level down. Unknown must stay unknown so the caller refuses.
  //
  // `is_im` is read EXPLICITLY rather than by elimination: measured, a DM returns `is_mpim`/`is_private` as
  // `undefined` rather than `false`, so "not the others" would misread it. A group DM (`is_mpim`) is SHARED —
  // several people do see each other's reactions there, exactly as in a channel.
  const isIm = info["is_im"];
  if (isIm === true) {
    // Slack names the other member of a 1:1 DM in `user`; absent rather than guessed when it did not.
    const user = typeof info["user"] === "string" ? info["user"] : undefined;
    return { name, surface: "direct-message", user };
  }
  if (isIm !== false) {
    return { name, surface: undefined };
  }
  // The channel arms fail closed the same way and for the same reason: `is_private` absent or malformed
  // must not read as "public" (which would refuse a legal private drip) OR as "private" (which would admit
  // the wall this classification exists to stop). Unknown stays unknown, and the caller decides.
  const isPrivate = info["is_private"];
  if (isPrivate === true) {
    return { name, surface: "private-channel" };
  }
  return { name, surface: isPrivate === false ? "public-channel" : undefined };
}

/**
 * `usergroups.list` — resolve user-group HANDLES to ids, for a poll's `@engineers`-style ping.
 *
 * Returns a handle→id map rather than resolving one, because one call answers every handle in a poll and the
 * endpoint is Tier 2. A handle that is absent from the map is reported by the caller and never guessed at: a
 * poll that pings the wrong team is worse than one that refuses to send.
 *
 * @param client the repeatable-call write client
 * @param scopeId the shared-429-block key for this token
 * @returns every resolvable handle mapped to its group id
 */
export async function userGroupIdsCall({
  client,
  scopeId,
}: {
  client: UserGroupListClient;
  scopeId: string;
}): Promise<ReadonlyMap<string, string>> {
  const res = orThrow({
    result: await safeProviderCall({
      execute: () => client.usergroups.list(),
      operation: "slack.usergroups.list",
      provider: "slack",
      retryMode: "transient",
      scopeId,
    }),
  });
  const out = new Map<string, string>();
  for (const group of absentAsEmpty({ value: res.usergroups })) {
    const handle = optStr({ value: group.handle });
    const id = optStr({ value: group.id });
    if (handle !== undefined && id !== undefined) {
      out.set(handle, id);
    }
  }
  return out;
}
