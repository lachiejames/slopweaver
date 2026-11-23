/**
 * One Slack record read as evidence: what it links, who sent it, where it sits, and whether it tagged anybody.
 *
 * This is the pure half of the two readers. Every function here is handed a record and returns what is true of
 * it, so nothing in this module opens a file or reaches a provider, and nothing here decides what an ask MEANS
 * — that is `./reviewState.ts`. Both legs stand on it: `./slackEvidenceScan.ts` for the corpus and
 * `./slackEvidenceLive.ts` for the search window.
 */

import type { CorpusRecord } from "../corpus/types.js";
import { isRecord } from "../lib/parsers.js";
import type { AuthorRole, ConversationKind } from "./evidence.js";
import {
  authoredTextOf,
  findPrLinkSpans,
  findPrLinks,
  firstLinkStart,
  mentionRunsIn,
  slackHaystack,
  taggedIn,
} from "./prLink.js";
import { type ThreadMember, threadKeyOfSourceId } from "./reviewConversation.js";
import { messageKeyOfSourceId, prKeyOf, type SlackIdentity, type SlackMention } from "./slackEvidenceTypes.js";

/** How much of a message body a row carries, so `--json` stays readable and no wall of text is stored. */
export const EXCERPT_CHARS = 240;

/** What placing a corpus record needs beyond the record itself — the same for every record in one scan. */
export interface RecordContext {
  readonly identity: SlackIdentity;
  /** Conversations already established as the owner's own with the owner's bot. */
  readonly ownerOnlyContainers: ReadonlySet<string>;
  /** Message keys whose corpus copies disagree with nothing to order them. */
  readonly disagreeing: ReadonlySet<string>;
  /** Thread key → the pull requests that thread's root links in its own words. */
  readonly rootPrKeys: ReadonlyMap<string, readonly string[]>;
}

/**
 * One corpus record as a mention of one pull request.
 *
 * @param record the corpus record
 * @param prKey the pull request, as `owner/repo#number`
 * @param association whether the record links it or joins it through its thread
 * @param context the scan-wide facts that place a record
 * @returns the mention
 */
export function mentionOf({
  record,
  prKey,
  association,
  context,
}: {
  record: CorpusRecord;
  prKey: string;
  association: SlackMention["association"];
  context: RecordContext;
}): SlackMention {
  const authoredText = authoredTextOf({ record });
  const authoredSpans = findPrLinkSpans({ text: authoredText });
  const { author = "" } = record;
  const isDirectMessage = record.container.startsWith("slack/D");
  const messageKey = messageKeyOfSourceId({ sourceId: record.sourceId });
  const threadKey = threadKeyOfSourceId({ sourceId: record.sourceId });
  const isReply = threadKey !== messageKey;
  return {
    association,
    atIso: record.tsIso,
    authoredPrCount: new Set(authoredSpans.map((entry) => prKeyOf({ ref: entry.ref }))).size,
    authoredText,
    authorId: author,
    authorRole: authorRoleOf({ author, identity: context.identity, record }),
    channel: channelOf({ record }),
    conversation: conversationKindOf({
      container: record.container,
      isDirectMessage,
      ownerOnlyContainers: context.ownerOnlyContainers,
    }),
    // A corpus DM record names its conversation but never its other participant, so the counterpart stays
    // empty here and is filled in by the live leg, which gets it from Slack's own `channel.name`.
    counterpartId: "",
    excerpt: record.text.slice(0, EXCERPT_CHARS),
    firstLinkAt: firstLinkStart({ spans: authoredSpans }),
    isDirectMessage,
    leg: "corpus",
    linkSpans: authoredSpans.filter((entry) => prKeyOf({ ref: entry.ref }) === prKey).map((entry) => entry.span),
    mentions: mentionRunsIn({ text: authoredText }),
    messageKey,
    permalink: record.url,
    prKey,
    quotedPrKeys: quotedPrKeysOf({ authoredText, record }),
    tagged: taggedIn({ haystack: slackHaystack({ record }) }),
    threadKey,
    // Only a reply that reaches NO pull request itself takes one from its thread. A linked reply — even one
    // whose link sits only in a forward the classifier cannot attribute — is about what it links, and handing
    // it the root's pull request certified an ask there. Found by a fallback review.
    threadPrKeys: inheritedRootKeys({
      isReply: isReply && association === "thread",
      rootPrKeys: context.rootPrKeys,
      threadKey,
    }),
    versionsDisagree: context.disagreeing.has(messageKey),
  };
}

/**
 * The pull requests a reply's thread root links, or none — for a root, or a reply whose root was never read.
 *
 * @param isReply whether the record is a thread reply
 * @param threadKey the thread it sits in
 * @param rootPrKeys thread key → what that thread's root links
 * @returns the root's pull requests, empty when there is no root to inherit from
 */
function inheritedRootKeys({
  isReply,
  threadKey,
  rootPrKeys,
}: {
  isReply: boolean;
  threadKey: string;
  rootPrKeys: ReadonlyMap<string, readonly string[]>;
}): readonly string[] {
  const keys = isReply ? rootPrKeys.get(threadKey) : undefined;
  return keys === undefined ? [] : [...keys];
}

/**
 * Turn one matched corpus record into one mention per wanted pull request it links.
 *
 * @param record the corpus record
 * @param wanted the pull requests being looked for, as `owner/repo#number`
 * @param context the scan-wide facts that place a record
 * @returns one mention per (message, pull request) pair
 */
export function mentionsFromRecord({
  record,
  wanted,
  context,
}: {
  record: CorpusRecord;
  wanted: ReadonlySet<string>;
  context: RecordContext;
}): readonly SlackMention[] {
  return findPrLinks({ haystack: slackHaystack({ record }) })
    .map((ref) => prKeyOf({ ref }))
    .filter((prKey) => wanted.has(prKey))
    .map((prKey) => mentionOf({ association: "linked", context, prKey, record }));
}

/**
 * The pull requests linked inside every message unfurl whose permalink the authored text itself writes.
 *
 * An attachment Slack did not mark `is_msg_unfurl` is a link preview, not a quoted message, and one whose URL
 * the author did not write is somebody else's context, so neither counts.
 *
 * @param record the corpus record, whose raw payload carries Slack's attachments
 * @param authoredText the author's own visible words
 * @returns the quoted pull requests as `owner/repo#number`, deduplicated, in first-seen order
 * @internal
 */
export function quotedPrKeysOf({
  record,
  authoredText,
}: {
  record: CorpusRecord;
  authoredText: string;
}): readonly string[] {
  const attachments = isRecord(record.raw) ? record.raw["attachments"] : undefined;
  if (!Array.isArray(attachments)) {
    return [];
  }
  const keys = new Set<string>();
  for (const attachment of attachments) {
    if (!isRecord(attachment) || attachment["is_msg_unfurl"] !== true) {
      continue;
    }
    const urls = [attachment["from_url"], attachment["original_url"]].filter((url) => typeof url === "string");
    if (!urls.some((url) => authoredText.includes(url))) {
      continue;
    }
    const quoted = [attachment["text"], attachment["fallback"]].filter((part) => typeof part === "string").join("\n");
    for (const ref of findPrLinks({ haystack: quoted })) {
      keys.add(prKeyOf({ ref }));
    }
  }
  return [...keys];
}

/**
 * Which of the three conversation kinds a record sits in.
 *
 * @param isDirectMessage whether the container is a Slack `D` conversation
 * @param container the corpus container
 * @param ownerOnlyContainers the conversations established as the owner's own with the owner's bot
 * @returns the conversation kind
 */
function conversationKindOf({
  isDirectMessage,
  container,
  ownerOnlyContainers,
}: {
  isDirectMessage: boolean;
  container: string;
  ownerOnlyContainers: ReadonlySet<string>;
}): ConversationKind {
  if (ownerOnlyContainers.has(container)) {
    return "owner-only";
  }
  return isDirectMessage ? "direct-message" : "channel";
}

/**
 * Which of the three roles wrote a record.
 *
 * The as-me lane needs no special case: `../corpus/slack/ownerBot.ts` rewrites the owner's own bot back to
 * the owner's user id at projection time, so the owner's message sent through the bot arrives with the owner's author id and reads
 * `owner`. An app speaking as ITSELF is caught structurally instead — Slack sets `bot_profile.user_id` equal
 * to `user` exactly then, and leaves it absent when a human posts through the app's token.
 *
 * @param author the record's author as the corpus stored it
 * @param identity who the owner is and which ids are the owner's own bot
 * @param record the corpus record, whose raw payload carries `bot_profile`
 * @returns the author's role
 */
function authorRoleOf({
  author,
  identity,
  record,
}: {
  author: string;
  identity: SlackIdentity;
  record: CorpusRecord;
}): AuthorRole {
  if (appPostedAsItself({ raw: record.raw })) {
    return "app";
  }
  return isOwner({ author, identity }) ? "owner" : "other-human";
}

/**
 * Whether an author id is the owner's — and never when either side is empty.
 *
 * An unconfigured `slackBot.ownerUserId` arrives as the empty string, and so does a record or search hit with
 * no `user` at all (an integration's post, a pin). Compared bare, the two absences are EQUAL, so an
 * authorless review-request notification read as the owner asking.
 *
 * @param author the author id as the record or search hit carried it
 * @param identity who the owner is
 * @returns whether this is provably the owner
 */
export function isOwner({ author, identity }: { author: string; identity: SlackIdentity }): boolean {
  return identity.ownerSlackUserId !== "" && author === identity.ownerSlackUserId;
}

/**
 * Whether an app posted a raw Slack message as ITSELF rather than a human posting through it. A message the owner sends
 * with their user token through an app carries that app's `bot_id` and still the owner's own `user`, so a `bot_id` alone
 * is never the test: Slack's `bot_profile` naming the row's own `user` is.
 *
 * @param raw the raw Slack payload, whose `bot_profile` Slack sets on an app's message
 * @returns true only when Slack marked the author as the app's own identity
 */
export function appPostedAsItself({ raw }: { raw: unknown }): boolean {
  if (!isRecord(raw)) {
    return false;
  }
  const profile = raw["bot_profile"];
  if (!isRecord(profile)) {
    return false;
  }
  const profileUser = profile["user_id"];
  return typeof profileUser === "string" && profileUser === raw["user"];
}

/**
 * Whether a record marks its conversation as one only the owner can see.
 *
 * A direct message between the owner and the owner's own bot has exactly one human in it. Detected structurally — a
 * `D`-prefixed conversation in which the app has posted as itself — rather than by naming a channel id,
 * which would put a private identifier in this repository.
 *
 * **The WHOLE conversation is excluded, not the app's posts within it.** Nobody else is in it, so a
 * pull-request link there can never be somebody being asked, whoever posted it. Testing per MESSAGE would
 * exclude only the app's own, leaving the owner's own messages in that DM reading as asks — measured, six of
 * them did, and two were verbatim DRAFTS of a message that goes to a real channel minutes later, so the rehearsal and the
 * performance would both count as asks.
 *
 * Its stated bound: the scan only ever sees records that LINK a pull request, so a direct message in which
 * the bot has never linked one is not established as owner-only and falls through to the ordinary rules.
 * That errs toward reading a real ask, never toward suppressing one.
 *
 * @param record the corpus record
 * @param identity the owner's own bot ids
 * @returns whether this record proves the conversation is the owner's own with the owner's bot
 */
export function marksOwnerOnlyConversation({
  record,
  identity,
}: {
  record: CorpusRecord;
  identity: SlackIdentity;
}): boolean {
  if (!record.container.startsWith("slack/D")) {
    return false;
  }
  return (
    appPostedAsItself({ raw: record.raw }) ||
    (record.author !== undefined && identity.selfUserIds.includes(record.author))
  );
}

/** The channel a Slack record was posted in, as the projection labelled it. */
function channelOf({ record }: { record: CorpusRecord }): string {
  const channel = record.attrs?.["channel"];
  return typeof channel === "string" ? channel : record.container;
}

/**
 * One current record as association reads it.
 *
 * @param record the corpus record
 * @param identity who the owner is, so only the OWNER's root can lend a reply its pull request
 * @returns its source id, thread, whose it is, and every distinct pull request the whole message reaches
 */
export function threadMemberOf({ record, identity }: { record: CorpusRecord; identity: SlackIdentity }): ThreadMember {
  const { author = "" } = record;
  return {
    byOwner: authorRoleOf({ author, identity, record }) === "owner",
    linkedPrKeys: [...new Set(findPrLinks({ haystack: slackHaystack({ record }) }).map((ref) => prKeyOf({ ref })))],
    messageKey: messageKeyOfSourceId({ sourceId: record.sourceId }),
    sourceId: record.sourceId,
    threadKey: threadKeyOfSourceId({ sourceId: record.sourceId }),
  };
}
