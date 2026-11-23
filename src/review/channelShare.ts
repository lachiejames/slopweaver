/**
 * The third review state: a pull request the owner (or their bot) posted into a channel with NOBODY NAMED to
 * review it.
 *
 * A pull request posted into a public channel with no specific reviewer named is neither paused with nobody
 * seated nor asked, and it is a state the owner will find themselves in a lot. So this state is distinct from an
 * ask (somebody named) and from nobody asked (nothing posted), and it cites the post.
 *
 * ## The clock — business days only
 *
 * - **green**, waiting for engagement: no reply yet, and the first business day since the post has not run out.
 *   A post on a Sunday night is fine — the weekend never counts (`./businessTime.ts`).
 * - **yellow**: a business day passed with no engagement, OR there was engagement and the conversation then
 *   stalled for a business day with nobody reviewing.
 * - **red**: {@link RED_AFTER_BUSINESS_DAYS} business days with no reviewer; the page suggests naming one.
 *
 * Red is "a long time" with no number given. Three business days is this module's PROVISIONAL default, not the
 * owner's number.
 *
 * **A clock resting on an absence is read only as far as each absence is carried** ({@link Horizons}). Every
 * colour but "in conversation" says nothing happened — no reply, no ask — and the two absences have different
 * carriers:
 *
 * - **no ask**: the one rule every absence in this read rests on — only the exhaustive corpus establishes a "no",
 *   the owner's standing ruling (`./absenceBounded.ts`). Live search collapses matches and honours the owner's
 *   search filters, so a complete one proves nothing absent. So the ask absence holds through the corpus
 *   watermark, and not at all when a live hit proves the corpus behind and nothing read around it
 *   (`liveBeyondCorpus`), or when a read thread holds a reply of the OWNER'S no leg classified — URL-less, it may be the ask that names somebody;
 * - **no reply**: the whole thread under each post, read at sync time (`SlackCoverage.shareThreads`) — an
 *   exhaustive read of one thread, not a search — because a reply need not link anything and no search sees one
 *   that does not.
 *
 * The two horizons are kept apart, never merged into one instant, so every line says WHICH carrier stops short and
 * what it could be hiding — an ask, a reply, or both — and the share carries both (`seen`, the page's tooltip). The
 * clock is read AS OF the earlier of them. A reply the thread read found past that instant still counts — engagement
 * is positive evidence, carried by no absence — and a reply's quiet is measured to the thread reads, not the corpus.
 * Red still ranks ahead of a live thread, because red is the owner's "no reviewer" and a conversation in the thread is not
 * one. Short of either the absence is not carried at all: green inside the first business day, because green is
 * true whether or not anything was missed, and `unknown` after it. The share itself stays: the post was found, and
 * that is positive evidence.
 *
 * ## What it reads
 *
 * The Slack legs' own mentions — the search for the pull request's URL — never a regex on the pull request
 * body. A post counts when it LINKS the pull request, sits in a channel (not a direct message, not the owner's own DM
 * with the bot), ROOTS its own thread (the owner's link as a reply in somebody else's thread shares nothing), was
 * written by the OWNER — their bot posting as them arrives as them (`../corpus/slack/ownerBot.ts`), while an app speaking as itself
 * may be anybody's — and the classifier CERTIFIED it as not an ask. An
 * `undecided` message anywhere on the row means a reader is needed first, so there is no share state then: the
 * page keeps saying "not known". Engagement is a reply IN ONE OF THE OWNER'S POSTS' OWN THREADS by another human — a
 * cross-post's older thread counts (`./reviewConversation.ts` is why a thread, never "anywhere", and why only the
 * owner's root lends a reply its pull request). The clock runs from the newest post: a repost is a fresh nudge.
 *
 * "Nobody reviewing" is GitHub's half: no human other than the author has submitted a review of any kind or
 * opened a review thread — a bot being GitHub's own `Bot` type first (`../cli/commands/github/reviewStateShare.ts`).
 * Either one means somebody picked it up, and the share state stands down.
 *
 * Pure. The clock is `nowIso`.
 */
import {
  type Carried,
  type ChannelShareTone,
  clockOf,
  type Horizons,
  minuteOf,
  RED_AFTER_BUSINESS_DAYS,
  seenOf,
} from "./channelShareClock.js";
import { isOwnerChannelLink } from "./channelShareEvidence.js";
import { askDecisionFor } from "./readingMerge.js";
import {
  calendarInstantMs,
  type ShareThreadRead,
  type ShareThreadReply,
  type SlackMention,
} from "./slackEvidenceTypes.js";

/** A pull request posted to a channel with nobody named, and where its clock stands. */
export interface ChannelShare {
  readonly tone: ChannelShareTone;
  /** The badge: two to five words. */
  readonly badge: string;
  /** The one line under the badge: why that colour, in business days. */
  readonly why: string;
  /** Where the post was made, as the mention names it: `#dev-team`. */
  readonly channel: string;
  /** The post itself — the citation. */
  readonly permalink: string;
  readonly messageKey: string;
  readonly postedAtIso: string;
  /** How many replies other people left in the post's thread. */
  readonly replies: number;
  /** When the newest of those was left, when there is one. */
  readonly lastReplyAtIso: string | undefined;
  /** Business days since the post, to one decimal place. */
  readonly businessDaysSincePost: number;
  /**
   * The instant the clock was read at: the earlier of the two horizons its absences rest on, capped at now, or the
   * post itself when one carries nothing. A reply the thread read found past it still counts.
   */
  readonly asOfIso: string;
  /** Where the corpus stops carrying the absence of an ask, when it carries it at all. */
  readonly asksThroughIso: string | undefined;
  /** Where the whole-thread reads stop carrying the absence of a reply, when every thread was read. */
  readonly repliesThroughIso: string | undefined;
  /** Each horizon in words, the page's tooltip: `asks seen through M (the Slack corpus), replies seen through R …`. */
  readonly seen: string;
  /** The red threshold this clock was read against, so a reader can see the policy beside the verdict. */
  readonly redAfterBusinessDays: number;
}

/**
 * Whether one mention is a channel post of the owner's or their bot's, rooting its own thread, that the classifier certified
 * as NOT an ask.
 *
 * @returns true for a post the share state may cite
 */
function isChannelPost({ mention }: { mention: SlackMention }): boolean {
  return isOwnerChannelLink({ mention }) && askDecisionFor({ mention }).kind === "non-ask";
}

/** What a share's clock rests on — `SlackCoverage`'s fields for this one pull request. */
export interface ShareEvidence {
  /** The corpus watermark, which carries the absence of an ask; `undefined` when Slack was never ingested. */
  readonly corpusThroughIso: string | undefined;
  /** Whether a live hit newer than the watermark, with nothing read around it, proves the corpus behind. */
  readonly corpusBehind: boolean;
  /** The whole thread under each post of the owner's, by thread key, which carries the absence of a reply. */
  readonly threads: Readonly<Record<string, ShareThreadRead>>;
}

/**
 * A reply of the OWNER'S in a read thread that no Slack leg handed over — a message nobody classified. "@Alice can
 * you review this?" under the owner's own post, linking nothing, after the watermark: the corpus scan carries every
 * reply under a linking root (`./slackEvidenceScan.ts`), so one missing from the mentions is one it has not reached,
 * and it could be the ask that names a reviewer. Classified AS THE OWNER'S: a leg that placed the same key as
 * somebody else's — live search cannot see the owner's as-me bot — classified a different author, and the thread
 * read is authoritative for its own rows.
 *
 * @param posts every qualifying post, whose read threads are checked for a reply of the owner's
 * @param mentions every message the Slack legs found and classified for the pull request
 * @returns the words for the first such reply, or `undefined` when every reply of the owner's was classified
 */
function unclassifiedReplyOf({
  evidence,
  posts,
  mentions,
}: {
  evidence: ShareEvidence;
  posts: readonly SlackMention[];
  mentions: readonly SlackMention[];
}): string | undefined {
  // Classified AS THE OWNER'S: a live hit cannot see the owner's as-me bot and places its reply as a colleague's,
  // whose veto reads it a non-ask — so the thread read's word that the row is the owner's outranks a classification made of somebody else.
  const classified = new Set(mentions.filter((one) => one.authorRole === "owner").map((one) => one.messageKey));
  for (const post of posts) {
    const thread = evidence.threads[post.threadKey];
    const unread = thread?.replies.find((reply) => reply.authorRole === "owner" && !classified.has(reply.messageKey));
    if (unread !== undefined) {
      return `the owner's reply at ${minuteOf({ iso: unread.atIso })} under the post in ${post.channel} is not classified yet`;
    }
  }
  return undefined;
}

/**
 * The owner's post or reply that Slack says was EDITED after the watermark. A key is not a version: that edit is a version
 * the corpus cannot have classified — "FYI" edited into "@Alice can you review this?" keeps its key. An edit before
 * the watermark is the corpus's own claim, as every absence in this read is.
 *
 * @param posts every qualifying post, whose read threads are checked
 * @param watermarkMs the corpus watermark as epoch milliseconds
 * @returns the words for the first such edit, or `undefined` when none is past the watermark
 */
function editedPastWatermarkOf({
  evidence,
  posts,
  watermarkMs,
}: {
  evidence: ShareEvidence;
  posts: readonly SlackMention[];
  watermarkMs: number;
}): string | undefined {
  const past = ({ iso }: { iso: string | undefined }): boolean => iso !== undefined && Date.parse(iso) > watermarkMs;
  for (const post of posts) {
    const thread = evidence.threads[post.threadKey];
    if (thread === undefined) {
      continue;
    }
    if (past({ iso: thread.rootEditedAtIso })) {
      return `the owner's post in ${post.channel} was edited past the corpus watermark`;
    }
    const edited = thread.replies.find((reply) => reply.authorRole === "owner" && past({ iso: reply.editedAtIso }));
    if (edited !== undefined) {
      const at = minuteOf({ iso: edited.atIso });
      return `the owner's reply at ${at} under the post in ${post.channel} was edited past the corpus watermark`;
    }
  }
  return undefined;
}

/**
 * How far the corpus carries the absence of an ask: through its watermark, withdrawn by a reply of the owner's nobody
 * classified ({@link unclassifiedReplyOf}) or by the owner's post or reply edited past it ({@link editedPastWatermarkOf}).
 *
 * @param posts every qualifying post, whose read threads can withdraw the watermark
 * @param mentions every message the Slack legs found and classified for the pull request
 * @returns the watermark as an instant, or the words for why it carries nothing
 */
function askHorizonOf({
  evidence,
  posts,
  mentions,
}: {
  evidence: ShareEvidence;
  posts: readonly SlackMention[];
  mentions: readonly SlackMention[];
}): Carried {
  const { corpusThroughIso, corpusBehind } = evidence;
  const unclassified = unclassifiedReplyOf({ evidence, mentions, posts });
  if (unclassified !== undefined) {
    return { missing: unclassified, throughIso: undefined };
  }
  if (corpusThroughIso === undefined) {
    return { missing: "the Slack corpus was never ingested", throughIso: undefined };
  }
  if (corpusBehind) {
    return { missing: "live Slack holds a message newer than the corpus", throughIso: undefined };
  }
  // As an instant, never a string: the watermark and a read spell one instant in different shapes (`liveBeyondCorpus`).
  const watermarkMs = calendarInstantMs({ iso: corpusThroughIso });
  if (Number.isNaN(watermarkMs)) {
    return { missing: "the Slack corpus watermark is not an instant", throughIso: undefined };
  }
  const edited = editedPastWatermarkOf({ evidence, posts, watermarkMs });
  if (edited !== undefined) {
    return { missing: edited, throughIso: undefined };
  }
  return { throughIso: new Date(watermarkMs).toISOString() };
}

/**
 * How far the thread reads carry the absence of a reply: the earliest of them, since each covers only its own thread.
 *
 * @param posts every qualifying post, whose threads the absence of a reply is claimed over
 * @returns the earliest read as an instant, or the words for the first thread that carries nothing
 */
function replyHorizonOf({ posts, evidence }: { posts: readonly SlackMention[]; evidence: ShareEvidence }): Carried {
  const reads: number[] = [];
  for (const post of posts) {
    const thread = evidence.threads[post.threadKey];
    if (thread === undefined) {
      return { missing: `the thread under the post in ${post.channel} was not read`, throughIso: undefined };
    }
    const ms = calendarInstantMs({ iso: thread.readAtIso });
    if (Number.isNaN(ms)) {
      return {
        missing: `the read of the thread under the post in ${post.channel} is not dated`,
        throughIso: undefined,
      };
    }
    reads.push(ms);
  }
  return { throughIso: new Date(Math.min(...reads)).toISOString() };
}

/**
 * Every colleague's reply under any of the owner's posts, oldest first — a cross-post's older thread counts. Keyed on the
 * message, so a reply both legs returned is one reply.
 *
 * A thread read whole is AUTHORITATIVE for its own rows: it sees `bot_id`, while a live search hit cannot see an
 * app's bot profile and places every non-owner as a colleague, so an app's reply linking the pull request would
 * read as engagement. The mentions carry replies only under a post whose thread was not read.
 *
 * @param posts the owner's qualifying posts, whose threads count
 * @param mentions every message the Slack legs found for the pull request
 * @param threads the whole thread under each post, by thread key
 * @returns each reply's instant, ascending
 */
function repliesTo({
  posts,
  mentions,
  threads,
}: {
  posts: readonly SlackMention[];
  mentions: readonly SlackMention[];
  threads: ShareEvidence["threads"];
}): readonly string[] {
  const rootAt = new Map(posts.map((one) => [one.threadKey, one.atIso]));
  const candidates = mentions
    .filter((reply) => threads[reply.threadKey] === undefined)
    .map((reply): { threadKey: string; reply: ShareThreadReply } => ({ reply, threadKey: reply.threadKey }));
  for (const one of posts) {
    const thread = threads[one.threadKey];
    if (thread !== undefined) {
      candidates.push(...thread.replies.map((reply) => ({ reply, threadKey: one.threadKey })));
    }
  }
  const replyAt = new Map<string, string>();
  for (const { threadKey, reply } of candidates) {
    const threadRootAt = rootAt.get(threadKey);
    const isReply =
      threadRootAt !== undefined &&
      reply.atIso > threadRootAt &&
      reply.authorRole === "other-human" &&
      !posts.some((one) => one.messageKey === reply.messageKey);
    if (isReply) {
      replyAt.set(reply.messageKey, reply.atIso);
    }
  }
  return [...replyAt.values()].toSorted();
}

/**
 * The share state for one pull request, or `undefined` when it does not apply.
 *
 * It does not apply when an ask names somebody (the ask trail says who), when any message is still undecided
 * (a reader is needed first), when a human has already reviewed on GitHub, or when no channel post of the owner's
 * links the pull request at all.
 *
 * @param mentions every message the Slack legs found for this pull request, newest first
 * @param asks the certified asks among them
 * @param reviewedOnGithub whether a human other than the author has submitted a review or opened a thread
 * @param evidence what the clock's absences rest on
 * @param nowIso the reference instant
 * @returns the state, or `undefined`
 */
export function channelShareOf({
  mentions,
  asks,
  reviewedOnGithub,
  evidence,
  nowIso,
}: {
  mentions: readonly SlackMention[];
  asks: readonly SlackMention[];
  reviewedOnGithub: boolean;
  evidence: ShareEvidence;
  nowIso: string;
}): ChannelShare | undefined {
  if (asks.length > 0 || reviewedOnGithub) {
    return undefined;
  }
  if (mentions.some((mention) => askDecisionFor({ mention }).kind === "undecided")) {
    return undefined;
  }
  const posts = mentions.filter((mention) => isChannelPost({ mention }));
  const post = posts.toSorted((a, b) => b.atIso.localeCompare(a.atIso)).at(0);
  if (post === undefined) {
    return undefined;
  }
  const replies = repliesTo({ mentions, posts, threads: evidence.threads });
  const lastReplyAtIso = replies.at(-1);
  const horizons: Horizons = {
    asks: askHorizonOf({ evidence, mentions, posts }),
    replies: replyHorizonOf({ evidence, posts }),
  };
  const clock = clockOf({ horizons, lastReplyAtIso, nowIso, postedAtIso: post.atIso });
  if (clock === undefined) {
    return undefined;
  }
  return {
    asOfIso: clock.asOfIso,
    asksThroughIso: horizons.asks.throughIso,
    badge: clock.badge,
    businessDaysSincePost: clock.sincePost,
    channel: post.channel,
    lastReplyAtIso,
    messageKey: post.messageKey,
    permalink: post.permalink,
    postedAtIso: post.atIso,
    redAfterBusinessDays: RED_AFTER_BUSINESS_DAYS,
    replies: replies.length,
    repliesThroughIso: horizons.replies.throughIso,
    seen: seenOf({ horizons }),
    tone: clock.tone,
    why: clock.why,
  };
}
