/**
 * What the Slack reader's second pass remembers about each thread the owner spoke in — the latest message, as it
 * always did, plus the three facts `slack awaiting` needs: who else spoke and when, every message of the owner's own,
 * and whether anybody replied at all.
 *
 * **Nothing here adds a line to the parse path.** Pass two already parses every line of every followed thread
 * to find its latest message; this only keeps a little more of what that parse produced. What `session-start`
 * and `slack owed` see moved once, on purpose: a reply's channel copy is no longer a thread of its own
 * (`./slackRow.ts`'s `isBroadcastCopy`), which was a phantom owed row for a tag the owner had already answered.
 *
 * **Overlapping window files carry one message more than once**, so each fact is idempotent: an author keeps
 * the later of two rows, the owner's words are keyed by `sourceId` with their reactors joined, and `hasReplies` is a
 * boolean rather than a count.
 *
 * **A reply sent also to the channel is stored twice**, and only its thread copy is a row; the channel copy's
 * answering reactors are read beside the scan and joined into the owner's matching word after it.
 *
 * Pure over the lines and rows handed in; the state it fills belongs to one read.
 */

import type { SlackRow } from "./slackRow.js";
import {
  broadcastReactorsOf,
  isLaterThan,
  mayBelongTo,
  messageKeyOf,
  slackRowOf,
  threadKeyOf,
  unreadableWord,
} from "./slackRow.js";

/** One thread's facts, filled message by message. */
export interface ThreadFacts {
  /** The thread's latest message, whoever wrote it — what `slack owed` and `session-start` read. */
  latest: SlackRow;
  /** Each author's latest message in the thread, the owner included. */
  readonly authors: Map<string, SlackRow>;
  /**
   * EVERY message of the owner's in the thread, keyed by `sourceId`, in arrival order. All of them rather than the last
   * few: a run of four loses its ask, or the tick that answered it, to a tail of three. Bounded by the owner's own messages in the read window.
   */
  readonly ownerWords: Map<string, SlackRow>;
  /** Whether any message in the thread is a reply rather than its root. */
  hasReplies: boolean;
}

/**
 * Fold one parsed message into its thread's facts.
 *
 * @param facts every thread's facts so far, keyed by thread
 * @param key the thread this message belongs to
 * @param row the parsed message
 * @param ownerId the owner's own Slack id, which decides whether the row joins the owner's words
 */
export function recordThreadMessage({
  facts,
  key,
  row,
  ownerId,
}: {
  facts: Map<string, ThreadFacts>;
  key: string;
  row: SlackRow;
  ownerId: string;
}): void {
  const isReply = row.sourceId.includes(":reply:");
  const held = facts.get(key);
  if (held === undefined) {
    facts.set(key, {
      authors: new Map([[row.author, row]]),
      hasReplies: isReply,
      latest: row,
      ownerWords: row.author === ownerId ? new Map([[row.sourceId, row]]) : new Map(),
    });
    return;
  }
  if (row.author === ownerId) {
    const copy = held.ownerWords.get(row.sourceId);
    held.ownerWords.set(row.sourceId, copy === undefined ? row : withReactorsOf({ copy, row }));
  }
  if (isLaterThan({ candidate: row, held: held.latest })) {
    held.latest = row;
  }
  held.hasReplies = held.hasReplies || isReply;
  const authorLatest = held.authors.get(row.author);
  if (authorLatest === undefined || isLaterThan({ candidate: row, held: authorLatest })) {
    held.authors.set(row.author, row);
  }
}

/**
 * Whether the thread's ROOT is one of the owner's words — the thread is the owner's, so a reply naming nobody is aimed at the owner.
 *
 * A root is the message whose `sourceId` carries no `:reply:`, the same test {@link recordThreadMessage} uses.
 * Pass two keeps every word of the owner's in a followed thread whatever its age, so a root older than the read window
 * still counts while the corpus holds it.
 *
 * @param ownerWords every message of the owner's in the thread, keyed by `sourceId`
 * @returns whether one of them is the thread's root
 */
export function ownerStartedThread({ ownerWords }: { ownerWords: ReadonlyMap<string, SlackRow> }): boolean {
  return [...ownerWords.keys()].some((sourceId) => !sourceId.includes(":reply:"));
}

/**
 * Fold one bronze line into pass two's state: a reply's channel copy gives only its reactors, a line of a followed
 * thread joins that thread's facts, and anything else is dropped unless it may be a word this read lost.
 *
 * @param line the raw JSONL line
 * @param keys the threads pass one found
 * @param ownerId the owner's own Slack id, which decides which messages join the owner's words
 * @param state each followed thread's facts, and each channel copy's reactors keyed by its `channel:ownTs`
 * @returns 1 when the line may be a person's word this read could not place, else 0
 */
export function recordThreadLine({
  line,
  keys,
  ownerId,
  state,
}: {
  line: string;
  keys: ReadonlySet<string>;
  ownerId: string;
  state: { facts: Map<string, ThreadFacts>; broadcastReactors: Map<string, readonly string[]> };
}): number {
  const copy = broadcastReactorsOf({ line });
  if (copy !== undefined) {
    const held = state.broadcastReactors.get(copy.messageKey);
    const joined = held === undefined ? copy.reactorIds : [...new Set([...held, ...copy.reactorIds])];
    state.broadcastReactors.set(copy.messageKey, joined);
    return 0;
  }
  if (!mayBelongTo({ keys, line })) {
    return 0;
  }
  const row = slackRowOf({ line });
  if (row === undefined) {
    return Number(unreadableWord({ keys, line }));
  }
  const key = threadKeyOf({ sourceId: row.sourceId });
  // `mayBelongTo` could not rule a threadless line out, so it may be a reply this read lost.
  if (key === undefined) {
    return 1;
  }
  if (keys.has(key)) {
    recordThreadMessage({ facts: state.facts, key, ownerId, row });
  }
  return 0;
}

/**
 * Join the answering reactors read off reply CHANNEL copies into the owner's matching words, by {@link messageKeyOf} — the
 * copy is dropped as a row, so without this a tick that sits only on it is lost.
 *
 * @param facts every followed thread's facts, after pass two
 * @param broadcastReactors each channel copy's reactors, keyed by its `channel:ownTs`
 */
export function joinBroadcastReactors({
  facts,
  broadcastReactors,
}: {
  facts: ReadonlyMap<string, ThreadFacts>;
  broadcastReactors: ReadonlyMap<string, readonly string[]>;
}): void {
  for (const thread of facts.values()) {
    for (const [sourceId, row] of thread.ownerWords) {
      const reactorIds = broadcastReactors.get(messageKeyOf({ sourceId }));
      if (reactorIds !== undefined) {
        thread.ownerWords.set(sourceId, withReactorsOf({ copy: { ...row, answeringReactorIds: reactorIds }, row }));
      }
    }
  }
}

/**
 * One message read twice, its answering reactors joined across both copies. Files are read in NAME order, and
 * `compact.jsonl` sorts last while holding the oldest copy, so the copy read last is not the newest: keeping it
 * alone dropped a tick added after compaction. A union answers the
 * same whatever the order; a reaction since REMOVED still counts, the rarer error and the one that drops a chase.
 *
 * @param copy the copy already held
 * @param row the copy just read
 * @returns the row just read, carrying every answering reactor either copy saw
 */
function withReactorsOf({ copy, row }: { copy: SlackRow; row: SlackRow }): SlackRow {
  return { ...row, answeringReactorIds: [...new Set([...copy.answeringReactorIds, ...row.answeringReactorIds])] };
}

/**
 * Oldest first, by the thread's own ordering rule.
 *
 * @param a one row
 * @param b another row
 * @returns the comparator's sign
 */
export function orderOf({ a, b }: { a: SlackRow; b: SlackRow }): number {
  if (isLaterThan({ candidate: a, held: b })) {
    return 1;
  }
  if (isLaterThan({ candidate: b, held: a })) {
    return -1;
  }
  return 0;
}
