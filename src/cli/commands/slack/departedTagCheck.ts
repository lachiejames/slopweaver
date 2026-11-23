/**
 * The live half of the departed-tag rule (`../../../outbound/slack/departedTags.ts`): read every account a resolved
 * as-me message tags off Slack's roster, then hand the answers to the pure refusal. Shared by `./prepareDrip.ts` —
 * so `post|reply --as me`, `draft record` and a draft's release — and by `slack edit --as me`, which resolves its
 * mentions without that preparation.
 */
import { departedTagRefusals, type TaggedAccount } from "../../../outbound/slack/departedTags.js";
import type { MentionResolution } from "../../../outbound/slack/mentionIndex.js";

/**
 * Read each distinct tagged Slack id once, in the order the message resolved them, and refuse a departed or
 * unreadable one. Every origin is read, the owner's own and the bot's included: an id is checked because it is tagged,
 * not because of how it was resolved.
 *
 * @param taggedAccount the live `users.info` read
 * @param resolution every mention the message carries, already resolved
 * @param token the token the reads go out under — the send's own
 * @param home the state home the verb resolved, whose privacy capability the read client carries
 * @returns the refusal lines, or nothing when everybody tagged is still here
 */
export async function resolvedTagRefusals({
  taggedAccount,
  resolution,
  token,
  home,
}: {
  taggedAccount: (args: { home: string; token: string; user: string }) => Promise<TaggedAccount>;
  resolution: MentionResolution;
  token: string;
  home: string;
}): Promise<readonly string[]> {
  const ids = [...new Set([...resolution.resolved.values()].map((target) => target.slackId))];
  const accounts = new Map<string, TaggedAccount>();
  for (const user of ids) {
    accounts.set(user, await taggedAccount({ home, token, user }));
  }
  return departedTagRefusals({ accounts });
}
