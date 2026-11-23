/**
 * WHOSE name a finding goes out under once the owner has approved sharing it: the bot's, at the top level of a
 * channel. The bot found it and the owner has not verified it, so a finding shared at the top level of a channel
 * after the owner approved the queue card posts as the bot; as the owner only into a channel the bot cannot post
 * in, like a private DM with someone else.
 *
 * So the rule reads three facts and one identity:
 *
 * - **a finding** — declared on the row. A top-level recording outside a DM must declare `--kind`
 *   ({@link undeclaredKindRefusal}), and a held top-level channel row with none is held as one
 *   ({@link asMeChannelFinding}), so no forgotten flag and no why's wording decides it;
 * - **at the top level** — a reply in a thread the owner is already in stays theirs;
 * - **in a channel** — a direct message with a person is somewhere the bot cannot post, so it stays the owner's;
 * - and **as-me passes only where the bot cannot post there**: a PRIVATE channel the bot is not in, read LIVE
 *   under the bot's own token. A public channel never passes, because the bot token holds `chat:write.public`
 *   (`../../onboard/scopeGrants.ts`) and posts into one it has not joined. A read that cannot say refuses, because a
 *   finding under the owner's name in a channel the owner did not verify it for is the incident this closes.
 *
 * ## No hatch, and the refusal says so
 *
 * The correction is always available — record it `--as bot` — so an override would only ever put an unverified
 * finding under the owner's name where the bot could have carried it.
 */
import { isDirectConversationId } from "./conversationId.js";
import type { ParkedSlackDraft } from "./draftRegister.js";
import type { ConversationSurface } from "./types.js";

/** Whether the bot is in the conversation, as its own token read it — `unknown` when the read could not say. */
export type BotMembership = "member" | "not-member" | "unknown";

/**
 * The bot's membership off a `conversations.info` read taken under the BOT token: its `is_member`, or `false`
 * for a private channel that answered `channel_not_found`.
 *
 * @param isMember what the read said, absent when it could not say
 * @returns the membership, `unknown` when the read established nothing
 */
export function botMembershipOf({ isMember }: { isMember: boolean | undefined }): BotMembership {
  if (isMember === undefined) {
    return "unknown";
  }
  return isMember ? "member" : "not-member";
}

/**
 * Ask Slack whether the bot is in a channel — only where the answer can matter: a PRIVATE channel, with a bot token
 * to ask under. Anything else is `unknown` without a read, which {@link findingIdentityRefusal} refuses.
 *
 * @param botToken the bot's token, absent when this install has none
 * @param read the membership read under that token
 * @param surface the conversation's kind, read under the owner's token
 * @returns the membership, `unknown` when no read was taken or it could not say
 */
export async function readBotMembership({
  botToken,
  channel,
  read,
  surface,
}: {
  botToken: string | undefined;
  channel: string;
  read: (args: { channel: string; token: string }) => Promise<BotMembership>;
  surface: ConversationSurface | undefined;
}): Promise<BotMembership> {
  if (botToken === undefined || surface !== "private-channel") {
    return "unknown";
  }
  return read({ channel, token: botToken });
}

/**
 * Whether a held row is an as-me top-level finding in a channel with no recorded reason the bot could not post it
 * — the row no release will send, read off the row alone so a list can say so before anything asks Slack.
 *
 * A top-level channel row that declares no kind counts as a finding: only a recorder older than
 * {@link undeclaredKindRefusal} can have parked one, and holding it costs a re-record where letting it through
 * could put a finding under the owner's name. Only `--kind message` is exempt, and a false one is the stated limit.
 *
 * @param draft the parked row
 * @returns true when the row must be re-recorded as the bot's post
 */
export function asMeChannelFinding({
  draft,
}: {
  draft: Pick<ParkedSlackDraft, "actor" | "botCannotPost" | "channel" | "kind" | "threadTs">;
}): boolean {
  return (
    draft.actor === undefined &&
    draft.botCannotPost === undefined &&
    draft.threadTs === undefined &&
    !isDirectConversationId({ channel: draft.channel }) &&
    draft.kind !== "message"
  );
}

/**
 * The lead a held-row refusal opens on when the row declared no kind: it is held as a finding for that reason, and
 * one that is not a finding is re-recorded `--kind message` instead of as the bot's post.
 *
 * @param draft the held row
 * @returns the lead, ending in a colon, or empty for a row that declared its kind
 */
export function undeclaredKindNote({ draft }: { draft: Pick<ParkedSlackDraft, "kind"> }): string {
  if (draft.kind !== undefined) {
    return "";
  }
  return "it declares no --kind, so it is held as a finding (re-record it --kind message if it is not one): ";
}

/**
 * Whether the identity rule governs a send at all: a finding, top-level, somewhere that is not a direct message.
 *
 * `surface` absent (the read could not say) counts as a channel, so an unknown conversation is held to the rule
 * rather than waved through as a DM.
 *
 * @param isFinding whether the row is a finding, declared or by its why
 * @param threadTs the thread it replies under, absent for a top-level post
 * @param surface the conversation's kind, as `conversations.info` read it
 * @returns true when the send is a top-level finding in a channel
 */
export function findingIdentityApplies({
  isFinding,
  threadTs,
  surface,
}: {
  isFinding: boolean;
  threadTs: string | undefined;
  surface: ConversationSurface | undefined;
}): boolean {
  return isFinding && threadTs === undefined && surface !== "direct-message";
}

/**
 * Whether the bot cannot post into a conversation the rule governs: a PRIVATE channel it is not in. A public
 * channel is never one, member or not, since `chat:write.public` posts there; an unknown surface is not one either.
 *
 * @param surface the conversation's kind, as `conversations.info` read it
 * @param botMembership whether the bot is in it, read under its own token
 * @returns true only for a private channel the bot's own read says it is not in
 */
export function botCannotPostIn({
  surface,
  botMembership,
}: {
  surface: ConversationSurface | undefined;
  botMembership: BotMembership;
}): boolean {
  return surface === "private-channel" && botMembership === "not-member";
}

/**
 * Hold an as-me top-level finding in a channel the bot can post in.
 *
 * Returns an EMPTY list for a bot send, for anything the rule does not govern ({@link findingIdentityApplies}),
 * and for a private channel the bot is not in ({@link botCannotPostIn}) — so a caller asks unconditionally.
 *
 * @param actor whose name the send goes out under
 * @param isFinding whether the row is a finding, declared or by its why
 * @param threadTs the thread it replies under, absent for a top-level post
 * @param surface the conversation's kind, as `conversations.info` read it
 * @param channel where the send is aimed, for the refusal
 * @param botMembership whether the bot is in that channel, read under its own token
 * @returns the hold's lines, or nothing when the send may proceed
 */
export function findingIdentityRefusal({
  actor,
  isFinding,
  threadTs,
  surface,
  channel,
  botMembership,
}: {
  actor: "me" | "bot";
  isFinding: boolean;
  threadTs: string | undefined;
  surface: ConversationSurface | undefined;
  channel: string;
  botMembership: BotMembership;
}): readonly string[] {
  if (actor === "bot" || !findingIdentityApplies({ isFinding, surface, threadTs })) {
    return [];
  }
  if (botCannotPostIn({ botMembership, surface })) {
    return [];
  }
  return [
    `this finding cannot go out as the owner: it is a top-level post in a channel and ${botCanPostWhy({ botMembership, channel, surface })}. ` +
      "A finding shared at the top level of a channel after the owner approves the card posts as " +
      "the bot — the owner did not find it and has not verified it. As the owner only where the bot cannot post: a DM with a " +
      "person, or a private channel the bot is not in.",
    "Record it as the bot's post instead: `slopweaver slack draft record --as bot --channel <id> --form - " +
      '--why "<…>" --media a,b,c` with a `finding` form, then release it with `slack post --as bot --draft`.',
    "There is deliberately NO escape hatch here: the correction is always available, and an override would " +
      "only put an unverified finding under the owner's name where the bot could have posted it.",
  ];
}

/**
 * Hold a NEW as-me top-level recording outside a DM that does not say whether it is a finding. The why heuristic
 * exists for rows parked before `--kind` could say so; a new one declares it, so a forgotten flag cannot carry a
 * finding past the rule by a why that happens to miss the words. A false `--kind message` is the stated limit.
 *
 * Decided off the channel id, before any read, exactly as {@link asMeChannelFinding} decides a held row: a `D…`,
 * `U…` or `W…` id is a DM and needs no declaration; a group DM's `G…`/`C…` id declares like any channel.
 *
 * @param kind what the recording declared, absent when it declared nothing
 * @param threadTs the thread it replies under, absent for a top-level post
 * @param channel where the recording is aimed
 * @returns the hold's lines, or nothing when the recording may proceed
 */
export function undeclaredKindRefusal({
  kind,
  threadTs,
  channel,
}: {
  kind: ParkedSlackDraft["kind"];
  threadTs: string | undefined;
  channel: string;
}): readonly string[] {
  if (kind !== undefined || threadTs !== undefined || isDirectConversationId({ channel })) {
    return [];
  }
  return [
    "a top-level draft as the owner outside a DM declares what it is: pass `--kind finding` or `--kind message`. " +
      "A finding shared at the top level of a channel posts as the bot, so the recording says which " +
      "this is rather than leaving it to the words of its why.",
    "A finding goes `--as bot` instead: `slopweaver slack draft record --as bot --channel <id> --form - " +
      '--why "<…>" --media a,b,c` with a `finding` form.',
  ];
}

/** Why the bot can carry a finding into this channel — or why nothing could show that it cannot. */
function botCanPostWhy({
  botMembership,
  channel,
  surface,
}: {
  botMembership: BotMembership;
  channel: string;
  surface: ConversationSurface | undefined;
}): string {
  if (surface === "public-channel") {
    return `${channel} is public, so the bot can carry the finding itself, joined or not (chat:write.public)`;
  }
  if (botMembership === "member") {
    return `the bot is in ${channel}, so it can carry the finding itself`;
  }
  return `no read could establish that the bot cannot post in ${channel}, and a finding under the owner's name is the incident`;
}
