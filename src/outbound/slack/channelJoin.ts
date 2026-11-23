/**
 * Whether an approved as-me release may JOIN the channel it is about to post into, as the owner, first.
 *
 * FLEET FINDING: an approved draft was refused `not_in_channel` by `chat.postMessage`, because the owner was not a
 * member of the target channel and a user token cannot post where its account is not. No verb joined a channel on
 * the owner's token, so the only route left was a floating note asking them to join by hand. A release now reads
 * the owner's membership (`conversations.info`), and when they are outside a PUBLIC channel and the row carries
 * their yes, joins (`conversations.join`) and then posts, in one run.
 *
 * The decision is pure and the order of its refusals is the design:
 *
 * - **Already a member, or a membership the read could not answer**, is no join: the send runs exactly as before. An
 *   unanswered read never joins, since a join is an act on the owner's account that only a proven `is_member: false`
 *   earns.
 * - **A direct message is never joined**: Slack has no join for one, and a DM the owner is outside is not theirs to
 *   enter.
 * - **A private channel is refused with the reason**: Slack cannot join one (`method_not_supported_for_channel_type`),
 *   and only a member can invite the owner, so the step is a person's and nothing is sent.
 * - **A channel whose kind did not read is refused**, rather than guessed public.
 * - **A row without the owner's recorded yes is refused**: joining a channel as the owner is an act on their account,
 *   and the only thing that earns it is the approval the send itself stands on. A digest typed at release is a
 *   session's word that it showed the owner the preview, never theirs.
 */
import type { ConversationSurface } from "./types.js";

/** What a release's membership read answered about the channel it is about to post into. */
export interface ChannelAccess {
  readonly surface: ConversationSurface | undefined;
  /** `conversations.info`'s own `is_member`; absent when the read did not carry it. */
  readonly isMember: boolean | undefined;
  /** The channel's name, for the line the owner reads; absent when the read named none. */
  readonly name: string | undefined;
}

/** A join refused because the channel is private: only a member can bring the owner in. */
export interface ChannelJoinPrivateError {
  readonly code: "JOIN_PRIVATE_CHANNEL";
  readonly message: string;
  readonly channel: string;
}

/** A join refused because the channel's kind did not read, so it cannot be shown to be public. */
export interface ChannelJoinSurfaceUnknownError {
  readonly code: "JOIN_SURFACE_UNKNOWN";
  readonly message: string;
  readonly channel: string;
}

/** A join refused because the row carries no recorded yes from the owner. */
export interface ChannelJoinNotApprovedError {
  readonly code: "JOIN_NOT_APPROVED";
  readonly message: string;
  readonly channel: string;
  readonly draftId: string;
}

/** Slack refused the join itself (archived, a workspace policy, a missing scope). */
export interface ChannelJoinRefusedError {
  readonly code: "JOIN_REFUSED";
  readonly message: string;
  readonly channel: string;
  readonly cause: unknown;
}

/** Every reason a release does not join, each a different act for whoever reads it. */
export type ChannelJoinError =
  ChannelJoinNotApprovedError | ChannelJoinPrivateError | ChannelJoinRefusedError | ChannelJoinSurfaceUnknownError;

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const ChannelJoinErrors = {
  notApproved: ({
    channel,
    draftId,
    label,
  }: {
    channel: string;
    draftId: string;
    label: string;
  }): ChannelJoinNotApprovedError => ({
    channel,
    code: "JOIN_NOT_APPROVED",
    draftId,
    message:
      `the owner is not a member of ${label}, and joining it as the owner needs their recorded yes on draft ` +
      `${draftId}: record it with slopweaver slack draft approve ${draftId} --anchor <where the owner said it>, then ` +
      "release again — nothing was joined or sent.",
  }),
  privateChannel: ({ channel, label }: { channel: string; label: string }): ChannelJoinPrivateError => ({
    channel,
    code: "JOIN_PRIVATE_CHANNEL",
    message:
      `the owner is not a member of ${label}, which is a private channel: Slack cannot join one, and only a member ` +
      "can invite the owner — nothing was joined or sent.",
  }),
  refused: ({
    cause,
    channel,
    label,
  }: {
    cause: unknown;
    channel: string;
    label: string;
  }): ChannelJoinRefusedError => ({
    cause,
    channel,
    code: "JOIN_REFUSED",
    message: `Slack refused to join ${label} as the owner:${cause instanceof Error ? cause.message : String(cause)} — nothing was sent.`,
  }),
  surfaceUnknown: ({ channel, label }: { channel: string; label: string }): ChannelJoinSurfaceUnknownError => ({
    channel,
    code: "JOIN_SURFACE_UNKNOWN",
    message:
      `the owner is not a member of ${label}, and whether it is public did not read, so it is not joined on a guess — ` +
      "nothing was joined or sent.",
  }),
} as const;

/**
 * How a channel is named in a line the owner reads: `#name` when the read named it, else its id.
 *
 * @param channel the channel id
 * @param name the name the membership read answered, when it did
 * @returns the label
 */
export function channelLabel({ channel, name }: { channel: string; name: string | undefined }): string {
  return name === undefined ? channel : `#${name}`;
}

/** What a release does about membership before it posts. */
export type ChannelJoinDecision =
  | { readonly kind: "no-join" }
  | { readonly kind: "join"; readonly name: string | undefined }
  | { readonly kind: "refuse"; readonly error: ChannelJoinError };

/**
 * Decide whether a release joins the channel before it posts. Pure.
 *
 * @param access what the membership read answered
 * @param approved whether the row carries the owner's recorded yes
 * @param channel the channel id the release posts into
 * @param draftId the row being released, named in the refusal that asks for the owner's yes
 * @returns no join, a join, or the typed refusal
 */
export function channelJoinDecision({
  access,
  approved,
  channel,
  draftId,
}: {
  access: ChannelAccess;
  approved: boolean;
  channel: string;
  draftId: string;
}): ChannelJoinDecision {
  if (access.isMember !== false || access.surface === "direct-message") {
    return { kind: "no-join" };
  }
  const label = channelLabel({ channel, name: access.name });
  if (access.surface === "private-channel") {
    return { error: ChannelJoinErrors.privateChannel({ channel, label }), kind: "refuse" };
  }
  if (access.surface === undefined) {
    return { error: ChannelJoinErrors.surfaceUnknown({ channel, label }), kind: "refuse" };
  }
  if (!approved) {
    return { error: ChannelJoinErrors.notApproved({ channel, draftId, label }), kind: "refuse" };
  }
  return { kind: "join", name: access.name };
}
