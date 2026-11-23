/**
 * Who is in the conversation an as-me message posts into — and, in a direct message, the hold on tagging anybody
 * who is not.
 *
 * Two halves of one fact. An external contact can sit in a three-person DM the owner opened with them and a
 * colleague (`C0SYN000028`) and carry no email on their member row, so the mention ladder refused them even by their
 * own id, and a draft to that DM could not address the person it was written to. A draft that went out instead
 * tagged three colleagues, none of whom was in that DM.
 *
 * - **Being IN the conversation makes a person addressable there**, whatever their email says. The set read here is
 *   handed to the mention ladder (`../../silver/mentionResolver.ts`'s `inConversationId`), where a colleague still
 *   answers first.
 * - **In a direct message, a tag of somebody who is NOT in it is held.** A DM's membership is fixed when it is opened:
 *   the person tagged cannot read the message, Slack notifies nobody, and the reader sees a colleague named over
 *   their head. A channel is not held — a non-member tag there is how somebody is pulled in.
 *
 * A group DM counts as a direct message. `conversationInfoCall`'s surface does not say so — it classifies a group DM
 * as a private channel, which is right for the visibility questions it answers — so the membership read classifies
 * `is_im || is_mpim` itself.
 *
 * **The owner's bot DM is never held**: a tag there is a reference the bot reads, not an address.
 *
 * ## No hatch, and the refusal says so
 *
 * Dropping the tag, or posting where they are, is always available.
 */

import type { MentionResolution } from "./mentionIndex.js";

/** What one membership read established — or why it could not. */
export type ConversationMembership =
  | {
      readonly kind: "read";
      /** A 1:1 or group DM, whose members cannot change by a mention. */
      readonly directMessage: boolean;
      readonly members: ReadonlySet<string>;
    }
  | { readonly kind: "unreadable"; readonly cause: string };

/**
 * The conversation's members to hand the mention ladder — nothing when the read failed, so a failed read can only
 * leave an outsider refused, never address anyone.
 *
 * @param membership what the read established
 * @returns the member ids, or `undefined` when unread
 */
export function addressableMembers({
  membership,
}: {
  membership: ConversationMembership | undefined;
}): ReadonlySet<string> | undefined {
  return membership?.kind === "read" ? membership.members : undefined;
}

/**
 * Why a message into a direct message cannot tag somebody — empty when every person it tags is a member, when the
 * conversation is not a DM, when it is the owner's bot DM, or when membership could not be read.
 *
 * An unreadable read passes this hold: it cannot say the conversation IS a direct message, and holding every
 * as-me send on a flaky read would regress every channel. The residue is stated, not hidden — a non-member tag in a
 * DM passes on a read that failed. The rescue in the mention ladder does NOT pass on one, so a failed read never
 * widens who can be addressed.
 *
 * @param channel the conversation the message posts into
 * @param membership what the read established, or nothing when the message mentions nobody
 * @param promptChannel the owner's bot DM, where a tag is a reference rather than an address
 * @param resolution every person mention the message resolved, keyed as written
 * @returns the refusal lines, empty when the message may go on
 */
export function dmNonMemberRefusal({
  channel,
  membership,
  promptChannel,
  resolution,
}: {
  channel: string;
  membership: ConversationMembership | undefined;
  promptChannel: string | undefined;
  resolution: Pick<MentionResolution, "resolved">;
}): readonly string[] {
  if (membership?.kind !== "read" || !membership.directMessage || channel === promptChannel) {
    return [];
  }
  const outside = [...resolution.resolved].filter(([, target]) => !membership.members.has(target.slackId));
  if (outside.length === 0) {
    return [];
  }
  return [
    `REFUSING to tag somebody who is not in direct message ${channel}: a DM's members are fixed, so the person ` +
      "tagged cannot read it and Slack notifies nobody.",
    ...outside.map(([key, target]) => `  ${JSON.stringify(key)} is ${target.slackId}, who is not a member.`),
    `  in this DM: ${[...membership.members].toSorted().join(", ")}`,
    "There is deliberately NO escape hatch: drop the tag, or post where they are.",
  ];
}
