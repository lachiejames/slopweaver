/**
 * The live leg: what `../live/slack/searchMessages.ts` found in the window the corpus has not ingested yet.
 *
 * A live candidate is a search hit, not a corpus record, so it carries less than one — no container metadata,
 * no edit history, no thread membership beyond its own key. Every function here says what can be read off that
 * thinner shape and stops, which is why the mentions it returns are folded in by `./slackEvidence.ts` rather
 * than compared against the corpus here.
 */

import type { AuthorRole, ConversationKind } from "./evidence.js";
import { findPrLinkSpans, findPrLinks, firstLinkStart, mentionRunsIn, type PrLinkRef, taggedIn } from "./prLink.js";
import { liveThreadKey } from "./reviewConversation.js";
import { EXCERPT_CHARS, isOwner } from "./slackEvidenceRecord.js";
import { type LiveCandidate, prKeyOf, type SlackIdentity, type SlackMention } from "./slackEvidenceTypes.js";

/** A Slack user id, as the `channel.name` of a direct message spells its counterpart. */
const USER_ID = /^[UW][A-Z0-9]{1,30}$/;

/**
 * How a row prints one candidate's conversation, and who the DM's counterpart is.
 *
 * @param candidate one live search result
 * @returns the printable conversation label, whether it is a direct message, and its counterpart's id
 */
export function conversationOf({ candidate }: { candidate: LiveCandidate }): {
  readonly channel: string;
  readonly isDirectMessage: boolean;
  readonly counterpartId: string;
} {
  const isDirectMessage = candidate.channelId.startsWith("D");
  if (!isDirectMessage) {
    return {
      channel: candidate.channelName === "" ? "" : `#${candidate.channelName}`,
      counterpartId: "",
      isDirectMessage,
    };
  }
  const counterpartId = USER_ID.test(candidate.channelName) ? candidate.channelName : "";
  return { channel: `dm:${candidate.channelName}`, counterpartId, isDirectMessage };
}

/**
 * Which conversation kind a live hit sits in.
 *
 * A direct message whose counterpart is one of the owner's own bot's ids is the owner's conversation with that bot, where
 * nobody can be asked. The corpus leg establishes that from the bot's own posts; the live leg can see it
 * directly, and without this a rehearsal the owner typed there before the corpus caught up read as an ask OF the bot.
 *
 * @param conversation the hit's conversation, as {@link conversationOf} read it
 * @param identity which ids are the owner's own bot
 * @returns the conversation kind
 */
function liveConversationKind({
  conversation,
  identity,
}: {
  conversation: { readonly isDirectMessage: boolean; readonly counterpartId: string };
  identity: SlackIdentity;
}): ConversationKind {
  if (!conversation.isDirectMessage) {
    return "channel";
  }
  return identity.selfUserIds.includes(conversation.counterpartId) ? "owner-only" : "direct-message";
}

/**
 * Judge live search candidates with the same exact matcher the corpus leg uses.
 *
 * Slack's search matches on tokens, so a candidate is a suggestion. This is what turns it into evidence: a
 * candidate survives only when its own text links the exact pull request, boundary and all.
 *
 * `search.messages` returns no `bot_profile`, so this leg cannot tell an app post from a human one on that
 * signal — but it does not need to guess. The owner's id places the owner's own posts, and everything else is
 * `other-human`, which is the conservative reading: a third-party app's channel alert reads as somebody
 * else's message rather than as the owner's ask. The corpus copy, which CAN read `bot_profile`, wins the merge and
 * corrects an app post to `app`.
 *
 * @param candidates what Slack's search offered
 * @param ref the pull request the search was for
 * @param identity who the owner is and which ids are the owner's own bot
 * @returns the candidates that genuinely link it
 */
export function judgeLiveCandidates({
  candidates,
  ref,
  identity,
}: {
  candidates: readonly LiveCandidate[];
  ref: PrLinkRef;
  identity: SlackIdentity;
}): readonly SlackMention[] {
  const key = prKeyOf({ ref });
  return candidates
    .filter((candidate) => findPrLinks({ haystack: candidate.text }).some((link) => prKeyOf({ ref: link }) === key))
    .map((candidate) => {
      const spans = findPrLinkSpans({ text: candidate.text });
      const conversation = conversationOf({ candidate });
      return {
        atIso: candidate.tsIso,
        authoredPrCount: new Set(spans.map((entry) => prKeyOf({ ref: entry.ref }))).size,
        authoredText: candidate.text,
        firstLinkAt: firstLinkStart({ spans }),
        versionsDisagree: false,
        quotedPrKeys: [],
        authorId: candidate.userId,
        authorRole: (isOwner({ author: candidate.userId, identity }) ? "owner" : "other-human") satisfies AuthorRole,
        conversation: liveConversationKind({ conversation, identity }),
        excerpt: candidate.text.slice(0, EXCERPT_CHARS),
        leg: "live" as const,
        linkSpans: spans.filter((entry) => prKeyOf({ ref: entry.ref }) === key).map((entry) => entry.span),
        mentions: mentionRunsIn({ text: candidate.text }),
        messageKey: `${candidate.channelId}:${candidate.ts}`,
        permalink: candidate.permalink,
        prKey: key,
        tagged: taggedIn({ haystack: candidate.text }),
        association: "linked" as const,
        threadKey: liveThreadKey({ channelId: candidate.channelId, permalink: candidate.permalink, ts: candidate.ts }),
        // A search hit carries no root, so what the thread is about stays unread on this leg.
        threadPrKeys: [],
        ...conversation,
      };
    });
}
