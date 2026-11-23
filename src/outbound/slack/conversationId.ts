/**
 * What a Slack conversation id says about where a post lands, decided off the id alone and before any read. Pure.
 *
 * A `D…` id is a DM and a `U…`/`W…` member id is one Slack opens; everything else — `C…`, `G…` — is a channel or a
 * group, so a `G…` group DM reads as a channel and every rule keyed on this fails toward applying, never away.
 */

/** A Slack id that can only name a direct conversation. */
const DIRECT_MESSAGE_ID = /^[DUW][A-Z0-9]+$/;

/**
 * Whether a Slack id can only name a direct conversation.
 *
 * @param channel the conversation id a send or recording names
 * @returns true for a `D…` DM or a `U…`/`W…` member id
 */
export function isDirectConversationId({ channel }: { channel: string }): boolean {
  return DIRECT_MESSAGE_ID.test(channel);
}

/**
 * Whether a post lands at the top level of a channel: no thread root, and an id that is not a DM's.
 *
 * @param channel where the post is aimed
 * @param threadTs the root it replies under, absent for a top-level post
 * @returns true for a top-level channel or group post
 */
export function landsTopLevelInChannel({
  channel,
  threadTs,
}: {
  channel: string;
  threadTs: string | undefined;
}): boolean {
  return threadTs === undefined && !isDirectConversationId({ channel });
}
