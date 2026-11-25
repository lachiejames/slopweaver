/**
 * Which Slack messages belong to the conversation a review ask was made in — the thread, or the direct
 * message — and which pull request a reply that never links one is about.
 *
 * ## Why a conversation, and not "any later message by the person asked"
 *
 * Read the actual messages *and the surrounding thread* the way the owner would. Two defects follow from
 * reading only messages that link the pull request:
 *
 * - **A reply never reached the answer.** MEASURED: an ask
 *   `C0SYN000002:1788832836.453699` carries four replies in bronze, two by the tagged person, and none links
 *   the pull request — so the scan, which kept only linking lines, never read one of them.
 * - **A message elsewhere ended the silence.** Any later linking message by the person asked counted as their
 *   reply, in any channel, about anything — "<PR> triggered this unrelated deployment issue" included.
 *
 * So association is STRUCTURAL: a reply is in a thread by Slack's own `thread_ts`, and a pull request is
 * inherited only from the thread's ROOT, and only when the root names it alone. A thread participant
 * speaking is an observation for the silence test — never review completion, which stays GitHub's.
 *
 * Pure. No I/O, no clock.
 */

/**
 * The thread a message sits in, `channel:rootTs`, read off the corpus's structured source id.
 *
 * `../corpus/slack/project.ts` writes `channel:ts` for a top-level message — which is its own thread's root —
 * and `channel:threadTs:reply:ts` for a reply. Anything else (a pin, a file, a canvas) is its own object and
 * threads with nothing, so it answers its whole id.
 *
 * @param sourceId the corpus record's own source id
 * @returns `channel:rootTs`, or the source id itself when the shape carries no thread
 */
export function threadKeyOfSourceId({ sourceId }: { sourceId: string }): string {
  const parts = sourceId.split(":");
  const [channel = "", second = "", marker = ""] = parts;
  if (parts.length === 2 || (parts.length === 4 && marker === "reply")) {
    return `${channel}:${second}`;
  }
  return sourceId;
}

/**
 * Whether a corpus source id is a thread REPLY rather than a root or some other object.
 *
 * @param sourceId the corpus record's own source id
 * @returns true only for `channel:threadTs:reply:ts`
 */
export function isReplySourceId({ sourceId }: { sourceId: string }): boolean {
  const parts = sourceId.split(":");
  return parts.length === 4 && parts[2] === "reply";
}

/**
 * The thread a LIVE search hit sits in.
 *
 * `search.messages` gives a reply's permalink a `thread_ts` query parameter naming its root, and gives a root
 * none, so the root of a top-level hit is the hit itself.
 *
 * @param channelId the conversation id
 * @param ts the hit's own Slack `ts`
 * @param permalink the hit's permalink, whose `thread_ts` names a reply's root
 * @returns `channel:rootTs`
 */
export function liveThreadKey({
  channelId,
  ts,
  permalink,
}: {
  channelId: string;
  ts: string;
  permalink: string;
}): string {
  const query = permalink.indexOf("?");
  const rootTs = query === -1 ? null : new URLSearchParams(permalink.slice(query + 1)).get("thread_ts");
  return `${channelId}:${rootTs === null || rootTs === "" ? ts : rootTs}`;
}

/** One message as association needs it: its identity, its thread, whose it is, and every pull request it reaches. */
export interface ThreadMember {
  /**
   * Whether the OWNER wrote it. Only the owner's own root lends its pull request to a reply: under somebody else's
   * announcement the owner is a participant, and a reply such as "pls confirm the rename, and then I'm happy to
   * approve" on THEIR pull request would read as the owner asking for a review of it.
   */
  readonly byOwner: boolean;
  readonly sourceId: string;
  /**
   * `channel:ts` — the message's own identity. A reply also sent to the channel is stored twice, under two
   * source ids and one message key, so copies are matched on this and never on the source id.
   */
  readonly messageKey: string;
  readonly threadKey: string;
  /**
   * The distinct pull requests the WHOLE message reaches — its words, a quote, a forward, an unfurl — as
   * `owner/repo#number`. Its words alone are not enough: a reply forwarding a message about another pull
   * request is about that one, and a root quoting a second pull request does not name its first alone. Both
   * were found by a fallback review, each certifying a confident ask on the wrong pull request.
   */
  readonly linkedPrKeys: readonly string[];
}

/**
 * The pull requests each thread's ROOT reaches, quotes and forwards included — for a root the OWNER wrote, and no
 * other. A reply under somebody else's root inherits nothing, and reads `undecided` rather than an ask.
 *
 * Several readings of one root (copies the corpus cannot order) UNION their keys, so a disagreement only ever
 * grows the set — which withholds an inherited ask rather than granting one.
 *
 * @param members every current message read, roots and replies alike
 * @returns thread key → the root's linked pull requests, for every root that was read
 */
export function rootPrKeysByThread({
  members,
}: {
  members: readonly ThreadMember[];
}): ReadonlyMap<string, readonly string[]> {
  const byThread = new Map<string, Set<string>>();
  for (const member of members) {
    // Only `channel:ts` is a root. A pin or a file also threads with nothing and answers its own id, but it
    // is not the message a thread takes its subject from.
    if (member.sourceId.split(":").length !== 2 || !member.byOwner) {
      continue;
    }
    const keys = byThread.get(member.threadKey);
    if (keys === undefined) {
      byThread.set(member.threadKey, new Set(member.linkedPrKeys));
      continue;
    }
    for (const key of member.linkedPrKeys) {
      keys.add(key);
    }
  }
  return new Map([...byThread].map(([thread, keys]) => [thread, [...keys]]));
}

/**
 * The (reply, pull request) pairs a reply that links nothing belongs to by its thread alone.
 *
 * A reply joins a pull request's conversation when its thread holds a message that links that pull request
 * and the reply reaches no pull request at all, in its words or anything it quotes or forwards — one that
 * reaches a DIFFERENT pull request is talking about that one. A root is never inherited into: it is the message a thread takes its subject from.
 *
 * @param members every current message read
 * @param copies every copy read, superseded ones included — an edit that dropped a link cannot hide what the
 *   message reaches, so the reaching set is built from these
 * @param linkedThreads pull request → the threads in which some message links it
 * @returns one pair per reply and pull request it joins, in member order
 */
export function inheritedPairs({
  members,
  copies,
  linkedThreads,
}: {
  members: readonly ThreadMember[];
  copies: readonly ThreadMember[];
  linkedThreads: ReadonlyMap<string, ReadonlySet<string>>;
}): readonly { readonly member: ThreadMember; readonly prKey: string }[] {
  // A message ANY copy of which reaches a pull request is about that one, whatever its other copies say. Tested
  // per copy, a disagreeing copy that dropped the link inherited the root's pull request. Found by a fallback review.
  const reaching = new Set(copies.filter((copy) => copy.linkedPrKeys.length > 0).map((copy) => copy.messageKey));
  const pairs: { readonly member: ThreadMember; readonly prKey: string }[] = [];
  for (const member of members) {
    if (!isReplySourceId({ sourceId: member.sourceId }) || reaching.has(member.messageKey)) {
      continue;
    }
    for (const [prKey, threads] of linkedThreads) {
      if (threads.has(member.threadKey)) {
        pairs.push({ member, prKey });
      }
    }
  }
  return pairs;
}

/** What {@link sameConversation} needs of a message. */
export interface ConversationPlace {
  /** `channel:rootTs`. */
  readonly threadKey: string;
  /** `channel:ts` — the channel id is what places two messages in the same direct message. */
  readonly messageKey: string;
  readonly isDirectMessage: boolean;
}

/**
 * Whether a message was written in the conversation an ask was made in.
 *
 * The same thread always is. A direct message is one conversation whether or not anybody threads in it — you
 * answer somebody's DM by writing in the DM — so there the channel alone decides. A channel is not: a later
 * message elsewhere in `#dev-team` is not a reply to the ask, however it is worded.
 *
 * @param ask where the ask was made
 * @param message the later message
 * @returns whether the message is in the ask's own conversation
 */
export function sameConversation({ ask, message }: { ask: ConversationPlace; message: ConversationPlace }): boolean {
  if (ask.threadKey === message.threadKey) {
    return true;
  }
  const channelOf = (place: ConversationPlace): string => place.messageKey.split(":")[0]!;
  return ask.isDirectMessage && message.isDirectMessage && channelOf(ask) === channelOf(message);
}
