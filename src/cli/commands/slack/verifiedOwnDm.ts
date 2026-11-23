/**
 * Whether the configured `slackBot.promptChannel` really is their bot DM, read off Slack rather than trusted —
 * the one input that exempts a message from the never-lead-with-the-PR gate (`../../../outbound/slack/draftPrLead.ts`).
 *
 * A fleet-found bug in our own tooling: the profile checks no more than that `promptChannel` is a
 * non-empty string, so a colleague's DM configured there was exempt from a gate whose whole subject is what a
 * teammate opens on. So the exemption is a CAPABILITY minted here: the destination is the configured `D…` id AND a
 * `conversations.info` read under the BOT token names `slackBot.ownerUserId` as the DM's other member. The bot token
 * is the one whose answer is them — under their user token the same DM's peer is the bot — so it is the token read even
 * when the message itself posts as them.
 *
 * **Fail closed, and that is a verdict rather than a fallback.** No bot token, a user token where a bot one belongs, no
 * `ownerUserId`, a read that fails or throws, a group DM, a channel, a missing peer or a different one: each answers
 * nothing verified, so the message is JUDGED. Only a PR-led opening loses anything, and rewording it is always open.
 *
 * Every destination that is not the configured prompt channel pays no Slack call. The stated residue: `ownerUserId` is
 * still the authority for who "they" is, so a profile that names a colleague in both fields agrees with itself.
 */
import { slackBotToken } from "../../../config.js";
import { makeSlackWriteTransport } from "../../../corpus/slack/writeApi.js";
import type { ConversationSurface } from "../../../outbound/slack/types.js";
import { ownerUserIdFromProfile } from "../../../profileStore.js";
import { promptChannelFromProfile } from "./wiring.js";
import { resolveSlackWriteToken } from "./writeToken.js";

/** A Slack direct-message conversation id: a channel, a group DM or a private channel never begins with `D`. */
const DIRECT_MESSAGE_ID = /^D[A-Z0-9]+$/u;

/** What a `conversations.info` read under the bot token says about the candidate DM. */
export interface PromptChannelInfo {
  readonly surface: ConversationSurface | undefined;
  /** The member on the other end of a 1:1 DM. */
  readonly user?: string | undefined;
}

/** Resolve the destination's verified-own-DM capability for one invocation's home. */
export type VerifyOwnDm = (args: { channel: string; home: string }) => Promise<string | undefined>;

/**
 * Whether a destination is a candidate worth reading at all: exactly the configured prompt channel, untrimmed, and a
 * direct-message id. Anything else is judged without a Slack call.
 *
 * @param channel where the message is aimed
 * @param promptChannel `slackBot.promptChannel`, absent when unset
 * @returns true only when a read could exempt it
 */
function isCandidate({ channel, promptChannel }: { channel: string; promptChannel: string | undefined }): boolean {
  return channel === promptChannel && DIRECT_MESSAGE_ID.test(channel);
}

/**
 * The verified DM off a bot-token read — the destination when it is the configured prompt channel and the read names
 * them as its other member, else nothing.
 *
 * @param channel where the message is aimed
 * @param info what `conversations.info` under the bot token answered for it
 * @param ownerUserId `slackBot.ownerUserId`, null when unset
 * @param promptChannel `slackBot.promptChannel`, absent when unset
 * @returns the channel id when it is proven their own DM, undefined when it is to be judged
 */
export function verifiedOwnDmFromBotInfo({
  channel,
  info,
  ownerUserId,
  promptChannel,
}: {
  channel: string;
  info: PromptChannelInfo;
  ownerUserId: string | null;
  promptChannel: string | undefined;
}): string | undefined {
  if (!isCandidate({ channel, promptChannel }) || ownerUserId === null || ownerUserId.length === 0) {
    return undefined;
  }
  return info.surface === "direct-message" && info.user === ownerUserId ? channel : undefined;
}

/**
 * Read whether a destination is their own bot DM — at most one `conversations.info` call, under the bot token,
 * and none at all for a destination that could never be exempt.
 *
 * @param botToken the resolved Slack bot token, if any; a user token here is refused before any read
 * @param channel where the message is aimed
 * @param conversationInfo the read, injected so a test passes a plain fake
 * @param ownerUserId `slackBot.ownerUserId`, null when unset
 * @param promptChannel `slackBot.promptChannel`, absent when unset
 * @returns the channel id when proven their own DM, undefined when the message is to be judged
 */
export async function readVerifiedOwnDm({
  botToken,
  channel,
  conversationInfo,
  ownerUserId,
  promptChannel,
}: {
  botToken: string | undefined;
  channel: string;
  conversationInfo: (args: { channel: string; token: string }) => Promise<PromptChannelInfo>;
  ownerUserId: string | null;
  promptChannel: string | undefined;
}): Promise<string | undefined> {
  if (!isCandidate({ channel, promptChannel }) || ownerUserId === null || ownerUserId.length === 0) {
    return undefined;
  }
  const token = resolveSlackWriteToken({ actor: "bot", botToken, userToken: undefined });
  if (token.isErr()) {
    return undefined;
  }
  try {
    const info = await conversationInfo({ channel, token: token.value });
    return verifiedOwnDmFromBotInfo({ channel, info, ownerUserId, promptChannel });
  } catch {
    // A read that throws proves nothing about who is in the DM, so the message is judged.
    return undefined;
  }
}

/**
 * The live {@link VerifyOwnDm}: the profile, the bot secret and the Slack read all off the invocation's own home.
 *
 * @param channel where the message is aimed
 * @param home the Slopweaver home this invocation runs against
 * @returns the channel id when proven their own DM, undefined when the message is to be judged
 */
export async function liveVerifiedOwnDm({
  channel,
  home,
}: {
  channel: string;
  home: string;
}): Promise<string | undefined> {
  return readVerifiedOwnDm({
    botToken: slackBotToken({ home }),
    channel,
    conversationInfo: async (args) =>
      makeSlackWriteTransport({ home, token: args.token }).conversationInfo({ channel: args.channel }),
    ownerUserId: ownerUserIdFromProfile({ home }),
    promptChannel: promptChannelFromProfile({ home }),
  });
}
