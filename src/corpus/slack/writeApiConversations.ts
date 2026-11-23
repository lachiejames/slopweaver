/**
 * The Slack CONVERSATION write calls — creating a channel, opening a DM or group DM, inviting people, and
 * naming a channel's purpose and topic. Split out of `./writeApi.ts` for the same reason
 * `./writeApiPoll.ts` is: that file is already over `file-size-ratchet`'s 800-code-line cap. These are
 * wired into the SAME {@link SlackWriteTransport} it builds, follow its exact
 * `safeProviderCall`/`orThrow`/`scopeId` pattern, and carry no policy of their own.
 *
 * ## The retry split here is a correctness property, not tuning
 *
 * Three of these are IDEMPOTENT and three are not, and they are deliberately not given one shared mode:
 *
 *  - `conversations.open` is idempotent by Slack's own design — the same user set always answers with the
 *    same conversation id, existing or freshly minted — so a retried open cannot mint a second DM.
 *  - `conversations.invite`, `setPurpose` and `setTopic` are idempotent in their END STATE (already in the
 *    channel / the purpose already says that), so a retry converges rather than duplicating.
 *  - `conversations.join` converges too, but is sent ONCE anyway: a release decides it on the owner's yes read just
 *    before the dispatch, and a retry after a backoff would act on a yes the owner may have withdrawn in between.
 *  - `conversations.create` is NOT. A retry after a lost response would either fail `name_taken` or, on a
 *    generated name, mint a second real channel in the workspace. It is at-most-once, like every post.
 *
 * ## What the scopes measured on this install actually allow
 *
 * MEASURED, `slopweaver slack probe --method auth.test --scopes` (and `--bot`): the BOT token
 * holds neither `channels:manage` nor `groups:write`, so `conversations.create` and `conversations.invite`
 * are UNREACHABLE on the bot lane and reachable on the user lane, which holds `channels:write`,
 * `groups:write` and `groups:write.invites`. Both tokens hold `im:write` and `mpim:write`, so
 * `conversations.open` works on either. The refusal that names the missing scope lives in the shell
 * (`../../cli/commands/slack/channelCore.ts`), never here — this file holds no policy.
 */
import type { WebClient } from "@slack/web-api";

import { isRecord } from "../../lib/parsers.js";
import { safeProviderCall } from "../../lib/providerCall.js";
import { orThrow } from "../../lib/safeBoundary.js";
import { optStr } from "./shape.js";
import type { SlackWriteTransport } from "./writeTransport.js";

/** A conversation Slack created or resolved: its id, and the name it settled on. */
export interface OpenedConversation {
  readonly id: string;
  /** The name Slack settled on. Absent for a DM or group DM, which have none. */
  readonly name: string | undefined;
  /** Whether Slack reports this conversation was minted by THIS call rather than already standing. */
  readonly alreadyExisted: boolean;
}

/**
 * `conversations.create` — mint a channel.
 *
 * AT-MOST-ONCE (`retryMode: "never"`). A create is the one call in this file that a retry can turn into two
 * real channels in a workspace, and a channel nobody asked for is not something a later run can quietly
 * clean up.
 *
 * @param client the NON-RETRYING write client
 * @param name the canonical channel name, already normalised and refused-on by the caller
 * @param isPrivate whether to mint a private channel
 * @param scopeId the shared-429-block key for this token
 * @returns the created channel's identity
 */
async function conversationsCreateCall({
  client,
  name,
  isPrivate,
  scopeId,
}: {
  client: WebClient;
  name: string;
  isPrivate: boolean;
  scopeId: string;
}): Promise<OpenedConversation> {
  const res = orThrow({
    result: await safeProviderCall({
      execute: () => client.conversations.create({ is_private: isPrivate, name }),
      operation: "slack.conversations.create",
      provider: "slack",
      retryMode: "never",
      scopeId,
    }),
  });
  const channel = res.channel;
  const id = isRecord(channel) ? optStr({ value: channel["id"] }) : undefined;
  if (id === undefined) {
    throw new Error("slack.conversations.create returned no channel id");
  }
  return {
    alreadyExisted: false,
    id,
    name: isRecord(channel) ? optStr({ value: channel["name"] }) : undefined,
  };
}

/**
 * `conversations.open` — the DM or group DM for a set of people, minted if it does not exist.
 *
 * The gap this closes, stated because it was a standing one: the door could post INTO a group DM whose id
 * somebody already had, and had no way to CREATE one. One user id opens a 1:1 IM; two to eight open an
 * MPIM.
 *
 * IDEMPOTENT, and that is Slack's guarantee rather than an assumption here: the same user set always
 * resolves to the same conversation id. So this retries as `transient`, unlike {@link conversationsCreateCall}.
 * `already_open` is not an error Slack raises for this method at all — it simply answers with the standing
 * conversation and reports `no_op: true`, which is carried through as `alreadyExisted`.
 *
 * @param client the repeatable-call write client
 * @param userIds the Slack user ids to open a conversation with, 1 (IM) to 8 (MPIM)
 * @param scopeId the shared-429-block key for this token
 * @returns the conversation's identity, and whether it already stood
 */
async function conversationsOpenCall({
  client,
  userIds,
  scopeId,
}: {
  client: WebClient;
  userIds: readonly string[];
  scopeId: string;
}): Promise<OpenedConversation> {
  const res = orThrow({
    result: await safeProviderCall({
      execute: () => client.conversations.open({ users: userIds.join(",") }),
      operation: "slack.conversations.open",
      provider: "slack",
      retryMode: "transient",
      scopeId,
    }),
  });
  const channel = res.channel;
  const id = isRecord(channel) ? optStr({ value: channel["id"] }) : undefined;
  if (id === undefined) {
    throw new Error("slack.conversations.open returned no channel id");
  }
  return { alreadyExisted: res.no_op === true, id, name: undefined };
}

/**
 * What a partial `conversations.invite` actually achieved.
 *
 * The shape is dictated by a MEASUREMENT rather than by Slack's documentation, and the difference is the
 * whole reason this is not a `readonly string[]`. Measured against the live workspace (a private
 * channel created for the purpose, inviting one valid id and one that belongs to nobody): the `errors`
 * entries came back as `{"ok": false, "error": "org_user_not_in_team"}` — **with no `user` field at all**.
 * Slack's own reference shows a `user` on each entry; on an enterprise grid it is simply absent. So a
 * caller cannot always be told WHICH invite failed, and an outcome type that assumed it could would report
 * every id as landed on exactly the response that says otherwise.
 *
 * Reproduce: create a throwaway private channel and
 * `conversations.invite channel=<id> force=true users=<real>,U0NOBODY`.
 */
export interface InviteOutcome {
  /** Every id the invite asked for, in the order asked. */
  readonly requested: readonly string[];
  /** Refusals Slack ATTRIBUTED to a user id, each with the code. */
  readonly refused: readonly { readonly userId: string; readonly code: string }[];
  /**
   * Refusal codes Slack reported with NO user id — one entry per failing invite, and the measurement above
   * is why this arm exists. A caller reports the count and the codes and tells the operator to look, rather
   * than naming a person it does not know.
   */
  readonly unattributed: readonly string[];
  /**
   * How many of the requested ids are in the channel now: every one Slack did not refuse, plus every one it
   * refused as `already_in_channel` — which IS the desired end state. Counted rather than listed, because
   * an unattributed refusal makes the LIST unknowable while leaving the count exact: Slack returns one
   * `errors` entry per failing invite.
   */
  readonly landed: number;
}

/**
 * `conversations.invite` — put people in a channel.
 *
 * `force: true` is passed deliberately, and it is the whole reason this returns an outcome rather than
 * throwing. Without it ONE bad id refuses the entire batch, so inviting five colleagues of whom one has
 * left the workspace puts nobody in the channel — the batch failure mode the house rule
 * "one failure must not sink the batch" exists to prevent. With it Slack invites the valid ids and reports
 * the rest under `errors`, so the caller can say exactly who did not make it.
 *
 * `already_in_channel` counts as IN, not as a refusal: the desired end state — that person is in the
 * channel — already holds, which is the same reading {@link conversationsOpenCall} gives `no_op`.
 *
 * @param client the repeatable-call write client
 * @param channel the channel to invite into
 * @param userIds the Slack user ids to invite
 * @param scopeId the shared-429-block key for this token
 * @returns who is in the channel now, and who Slack refused with which code
 */
async function conversationsInviteCall({
  client,
  channel,
  userIds,
  scopeId,
}: {
  client: WebClient;
  channel: string;
  userIds: readonly string[];
  scopeId: string;
}): Promise<InviteOutcome> {
  const res = orThrow({
    result: await safeProviderCall({
      execute: () => client.conversations.invite({ channel, force: true, users: userIds.join(",") }),
      operation: "slack.conversations.invite",
      provider: "slack",
      retryMode: "transient",
      scopeId,
    }),
  });
  return shapeInviteOutcome({ errors: res.errors, userIds });
}

/**
 * Fold Slack's per-id `errors` array into the outcome shape. Pure, and split out to stay under the
 * complexity cap.
 *
 * `already_in_channel` is counted as LANDED wherever it appears — attributed or not — because the desired
 * end state (that person is in the channel) already holds. Every other code is a refusal, and it is
 * reported under `refused` when Slack named the user and under `unattributed` when it did not. See
 * {@link InviteOutcome} for the measurement that makes the second arm necessary.
 *
 * @param errors the `errors` array a partial `conversations.invite` returns, widened because the SDK types
 *   it loosely and an absent array is the all-succeeded case
 * @param userIds every id the invite asked for, in the order asked
 * @returns how many landed, who was refused, and which refusals Slack would not attribute
 */
export function shapeInviteOutcome({
  errors,
  userIds,
}: {
  errors: unknown;
  userIds: readonly string[];
}): InviteOutcome {
  const refused: { userId: string; code: string }[] = [];
  const unattributed: string[] = [];
  for (const entry of Array.isArray(errors) ? errors : []) {
    if (!isRecord(entry)) {
      continue;
    }
    const code = optStr({ value: entry["error"] }) ?? "unknown";
    if (code === "already_in_channel") {
      continue;
    }
    const userId = optStr({ value: entry["user"] });
    if (userId === undefined) {
      unattributed.push(code);
    } else {
      refused.push({ code, userId });
    }
  }
  return {
    landed: Math.max(0, userIds.length - refused.length - unattributed.length),
    refused,
    requested: userIds,
    unattributed,
  };
}

/** A channel the token's own account joined, or was already in. */
export interface JoinedChannel {
  readonly id: string;
  /** The channel's name as Slack answered it, absent when the response carried none. */
  readonly name: string | undefined;
  /** Slack answered with its `already_in_channel` warning: the account was a member before this call. */
  readonly alreadyMember: boolean;
}

/**
 * `conversations.join` — put the token's OWN account in a public channel.
 *
 * Here because an as-me release to a public channel the owner is not in is refused `not_in_channel` by
 * `chat.postMessage`, and joining was a hand step no verb could take. On a user token
 * the grant is `channels:write`, which this install's user token holds (`slopweaver slack probe --method
 * auth.test --scopes`). Slack itself refuses a private channel (`method_not_supported_for_channel_type`); the
 * caller never asks it to, and that policy is the caller's, never this file's.
 *
 * Idempotent in its end state: a join of a channel already held succeeds with Slack's `already_in_channel`
 * warning, carried through as `alreadyMember`. It is still AT-MOST-ONCE (`retryMode: "never"`, the non-retrying
 * client): the release decided it on the owner's yes read just before the dispatch, and a retry after a backoff would act
 * on a yes the owner may have withdrawn in the meantime. A transient failure holds the draft instead, and the
 * next release re-reads the row.
 *
 * @param client the non-retrying write client, so one join is one request
 * @param channel the public channel to join
 * @param confirm asked synchronously right before the dispatch; `false` sends nothing and throws
 * @param scopeId the shared-429-block key for this token
 * @returns the channel's identity, and whether the account was already in it
 */
async function conversationsJoinCall({
  client,
  channel,
  confirm,
  scopeId,
}: {
  client: WebClient;
  channel: string;
  confirm: () => boolean;
  scopeId: string;
}): Promise<JoinedChannel> {
  const res = orThrow({
    result: await safeProviderCall({
      // Asked HERE, after any rate-limit wait the call awaits, so nothing is awaited between it and the dispatch.
      execute: async () => {
        if (!confirm()) {
          throw new Error("slack.conversations.join withdrawn before dispatch: the caller no longer wants it");
        }
        return client.conversations.join({ channel });
      },
      operation: "slack.conversations.join",
      provider: "slack",
      retryMode: "never",
      scopeId,
    }),
  });
  const joined = shapeJoinedChannel({ channel: res.channel, warning: res.warning });
  if (joined === undefined) {
    throw new Error("slack.conversations.join returned no channel id");
  }
  return joined;
}

/**
 * Fold a `conversations.join` answer into {@link JoinedChannel}. Pure, so the warning reading is tested without a
 * client.
 *
 * @param channel the response's `channel` object, widened because the SDK types it loosely
 * @param warning the response's top-level `warning`, where Slack reports `already_in_channel`
 * @returns the joined channel's identity and whether it was already held, or `undefined` when no id came back
 */
export function shapeJoinedChannel({
  channel,
  warning,
}: {
  channel: unknown;
  warning: unknown;
}): JoinedChannel | undefined {
  const id = isRecord(channel) ? optStr({ value: channel["id"] }) : undefined;
  if (id === undefined) {
    return undefined;
  }
  const warnings = typeof warning === "string" ? warning.split(",") : [];
  return {
    alreadyMember: warnings.includes("already_in_channel"),
    id,
    name: isRecord(channel) ? optStr({ value: channel["name"] }) : undefined,
  };
}

/**
 * `conversations.setPurpose` — the one-line "what this channel is for".
 *
 * Idempotent in its end state (setting the same purpose twice leaves the same purpose), so it retries as
 * `transient`. Returns the purpose SLACK settled on rather than the one sent: Slack truncates at 250
 * characters and linkifies, so echoing the request back would misreport what the channel actually says.
 *
 * @param client the repeatable-call write client
 * @param channel the channel to describe
 * @param purpose the purpose text
 * @param scopeId the shared-429-block key for this token
 * @returns the purpose Slack stored
 */
async function conversationsSetPurposeCall({
  client,
  channel,
  purpose,
  scopeId,
}: {
  client: WebClient;
  channel: string;
  purpose: string;
  scopeId: string;
}): Promise<string | undefined> {
  const res = orThrow({
    result: await safeProviderCall({
      execute: () => client.conversations.setPurpose({ channel, purpose }),
      operation: "slack.conversations.setPurpose",
      provider: "slack",
      retryMode: "transient",
      scopeId,
    }),
  });
  const nested = isRecord(res.channel) ? res.channel["purpose"] : undefined;
  return isRecord(nested) ? optStr({ value: nested["value"] }) : undefined;
}

/**
 * `conversations.setTopic` — the topic line shown in the channel header.
 *
 * Same idempotent-end-state retry and same read-back-what-Slack-stored discipline as
 * {@link conversationsSetPurposeCall}. A separate method rather than a widened parameter because the two
 * are different endpoints with different scopes (`*:write.topic` grants the topic alone), so a caller
 * holding one grant and not the other must be able to make exactly one of these calls.
 *
 * @param client the repeatable-call write client
 * @param channel the channel to describe
 * @param topic the topic text
 * @param scopeId the shared-429-block key for this token
 * @returns the topic Slack stored
 */
async function conversationsSetTopicCall({
  client,
  channel,
  topic,
  scopeId,
}: {
  client: WebClient;
  channel: string;
  topic: string;
  scopeId: string;
}): Promise<string | undefined> {
  const res = orThrow({
    result: await safeProviderCall({
      execute: () => client.conversations.setTopic({ channel, topic }),
      operation: "slack.conversations.setTopic",
      provider: "slack",
      retryMode: "transient",
      scopeId,
    }),
  });
  const nested = isRecord(res.channel) ? res.channel["topic"] : undefined;
  return isRecord(nested) ? optStr({ value: nested["value"] }) : undefined;
}

/**
 * `conversations.archive` — put a channel away.
 *
 * Here for ONE reason and it is worth stating: the integration cassette for `conversations.create` mints a
 * real channel in a real workspace on every re-record, and a workspace cannot delete a channel at all. Without
 * this the recording lane would leave a permanent channel behind per lap — the exact litter the poll cassette's
 * own header calls out. Archiving is the only retraction Slack offers.
 *
 * `already_archived` is the desired end state and is absorbed as success, the same reading
 * `deleteMessage` gives "already gone".
 *
 * @param client the repeatable-call write client
 * @param channel the channel to archive
 * @param scopeId the shared-429-block key for this token
 * @returns true once the channel is archived, including when it already was
 */
async function conversationsArchiveCall({
  client,
  channel,
  scopeId,
}: {
  client: WebClient;
  channel: string;
  scopeId: string;
}): Promise<boolean> {
  const result = await safeProviderCall({
    execute: () => client.conversations.archive({ channel }),
    operation: "slack.conversations.archive",
    provider: "slack",
    retryMode: "transient",
    scopeId,
  });
  if (result.isOk()) {
    return true;
  }
  return result.error.message.includes("already_archived");
}

/**
 * This family's seven methods, already bound to their clients — spread straight into the transport table.
 *
 * The wiring lives HERE rather than in `./writeApi.ts` for the same reason the calls themselves do, stated
 * in this file's own header: that file stands at its recorded size, and one line per method there is seven
 * lines plus an import block naming every call. A family that already has its own module can carry its own
 * row in the table, and the retry split the header explains stays beside the code it is about — which is
 * why `createChannel` and `joinChannel` take the NON-retrying `posting` client and the other five do not.
 *
 * @param client the repeatable-call write client
 * @param posting the non-retrying client, for the two at-most-once calls in this family
 * @param scopeId the shared-429-block key for this token
 * @returns the seven methods, keyed as {@link SlackWriteTransport} names them
 */
export function conversationMethods({
  client,
  posting,
  scopeId,
}: {
  client: WebClient;
  posting: WebClient;
  scopeId: string;
}): Pick<
  SlackWriteTransport,
  | "archiveChannel"
  | "createChannel"
  | "inviteToChannel"
  | "joinChannel"
  | "openConversation"
  | "setChannelPurpose"
  | "setChannelTopic"
> {
  return {
    archiveChannel: ({ channel }) => conversationsArchiveCall({ channel, client, scopeId }),
    createChannel: ({ name, isPrivate }) => conversationsCreateCall({ client: posting, isPrivate, name, scopeId }),
    inviteToChannel: ({ channel, userIds }) => conversationsInviteCall({ channel, client, scopeId, userIds }),
    joinChannel: ({ channel, confirm }) => conversationsJoinCall({ channel, client: posting, confirm, scopeId }),
    openConversation: ({ userIds }) => conversationsOpenCall({ client, scopeId, userIds }),
    setChannelPurpose: ({ channel, purpose }) => conversationsSetPurposeCall({ channel, client, purpose, scopeId }),
    setChannelTopic: ({ channel, topic }) => conversationsSetTopicCall({ channel, client, scopeId, topic }),
  };
}
