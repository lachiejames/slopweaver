/**
 * Whether a message posted at the TOP of a channel answers our earlier ask there, the way a person scrolling the
 * channel would read it.
 *
 * A reply to our message that lands at the top level of a channel is an answer a human reading the channel would see,
 * and a bump claiming no one responded would look silly. A clear answer discards the bump; an ambiguous one holds it
 * for the owner's judgement. Both bumps measured had been answered this way, in the same channel: a person tagged
 * replied 27 seconds later, and a member of a group tagged replied four minutes later, each as the very next top-level
 * message.
 *
 * ## The rule
 *
 * A post is CONSIDERED when it is a top-level message in the same channel, strictly after ours and at most one
 * business day after it (`../../review/businessTime.ts`), written by a person other than us: never a bot or an app,
 * never a system row (a join, a topic change), never a reply's channel copy. A shared file is a word, with or without a
 * comment, exactly as in a thread: a screenshot posted straight after ours is as likely the answer as a sentence.
 * The NEXT post is the earliest considered one; our own posts and a bot's in between do not break that adjacency.
 *
 * Our message ASKED an author when it tagged them by name, tagged a user group or the room, or tagged nobody but
 * us (an open question to whoever reads the channel: a tag of ourselves asks nobody else). A mention written inside
 * code is no tag, as Slack renders it.
 *
 * - **answers** — the next post is by somebody ours asked, and landed within {@link ANSWER_WINDOW_MS} of ours.
 * - **may-answer** — otherwise, the earliest of: the next post inside that window by somebody ours did not ask
 *   (a colleague answering for the person tagged), or any considered post by somebody ours tagged by name.
 * - nothing otherwise: an open ask's next post hours later, or anybody else's later post, is the channel moving on.
 *
 * ## What it gets wrong, stated
 *
 * An unrelated post by somebody ours asked, landing inside the window, reads as the answer. The recorder that calls
 * this QUOTES the post it judged an answer, so that miss is visible rather than silent, and `--not-answered` is the
 * way through. An answer a tagged person posts at the top level more than one business day later, or an open ask's
 * answer more than two hours later, is not read here at all.
 *
 * Pure: no clock, no network.
 */
import { slackTsToIso } from "#lib/slackTs.js";

import { compareSlackTimestamps } from "../../live/slack/selection.js";
import { BUSINESS_DAY_MS, businessMsBetween } from "../../review/businessTime.js";
import { mentionRunsIn } from "../../review/prLink.js";

/**
 * How soon after ours the next post must land to be read as the answer, rather than held for the owner's judgement. Two
 * hours, PROVISIONAL: the only two answers measured landed 27 seconds and four minutes after the ask (#C0SYN000001;
 * `slopweaver store around --id C0SYN000001:1791341338.708319` and `--id C0SYN000001:1791348182.111109`),
 * and a wider window only moves a post from "discard" to "hold for the owner", never past them.
 */
const ANSWER_WINDOW_MS = 2 * 60 * 60 * 1000;

/** A message's subtypes that are still somebody's words at the top level: a shared file, commented or not. */
const WORD_SUBTYPES: ReadonlySet<string> = new Set(["file_share"]);

/** A broadcast to the room: everybody reading the channel was asked. */
const ROOM_BROADCAST = /<!(?:here|channel|everyone)\b/;

/** Fenced and inline code in raw mrkdwn: a mention written inside it tags nobody. */
const CODE_RUN = /```[\s\S]*?```|`[^`\n]*`/gu;

/** One top-level message as the rule reads it — the ask itself, or a post after it. */
export interface TopLevelMessage {
  readonly ts: string;
  readonly text: string;
  readonly userId?: string | undefined;
  readonly botId?: string | undefined;
  readonly appId?: string | undefined;
  readonly subtype?: string | undefined;
}

/** What one channel's top level says about our ask: a clear answer, or one the owner decides. */
export type TopLevelTie =
  | { readonly kind: "answers"; readonly post: TopLevelMessage }
  | { readonly kind: "may-answer"; readonly post: TopLevelMessage };

/** Who our message asked: the people it named, and whether it asked the whole room. */
interface Asked {
  readonly named: ReadonlySet<string>;
  readonly room: boolean;
}

/**
 * Who our message asked, read off its raw mrkdwn.
 *
 * @param ask our message
 * @returns the people it tagged by name, and whether it tagged a group, the room, or nobody but its own author
 */
function askedBy({ ask }: { ask: TopLevelMessage }): Asked {
  const named = new Set<string>();
  const text = ask.text.replace(CODE_RUN, " ");
  let group = ROOM_BROADCAST.test(text);
  for (const run of mentionRunsIn({ text })) {
    if (run.id.startsWith("S")) {
      group = true;
    } else if (run.id !== ask.userId) {
      named.add(run.id);
    }
  }
  return { named, room: group || named.size === 0 };
}

/** A Slack `ts` split exactly: its whole second, as an ISO instant, and the microseconds after it. */
interface Instant {
  readonly seconds: number;
  readonly micros: number;
  readonly iso: string;
}

/** A Slack `ts`'s two halves; the fraction is microseconds, at most six digits. */
const TS_PARTS = /^(\d+)\.(\d{1,6})$/u;

/** Microseconds in a millisecond, for comparing the rule's millisecond bounds exactly. */
const MICROS_PER_MS = 1000;

/**
 * A Slack `ts` as an exact instant, or `undefined` when it is not one. Exact because both of the rule's edges are
 * inclusive: a millisecond rounding would tie a post a microsecond past either.
 *
 * @param ts the Slack timestamp
 * @returns its whole second and the microseconds after it
 */
function instantOf({ ts }: { ts: string }): Instant | undefined {
  const parts = TS_PARTS.exec(ts);
  const iso = slackTsToIso({ ts });
  if (parts === null || iso === undefined) {
    return undefined;
  }
  return { iso, micros: Number(parts[2]!.padEnd(6, "0")), seconds: Number(parts[1]) };
}

/**
 * Whether the one second starting at an instant's whole second is business time. A business boundary is a whole
 * second, so that second is business time throughout or not at all.
 *
 * @param instant the instant whose second is judged
 * @returns true for a business second, `undefined` when it cannot be read
 */
function businessSecond({ instant }: { instant: Instant }): boolean | undefined {
  const nextIso = slackTsToIso({ ts: `${String(instant.seconds + 1)}.000000` });
  if (nextIso === undefined) {
    return undefined;
  }
  const ms = businessMsBetween({ fromIso: instant.iso, toIso: nextIso });
  return ms === undefined ? undefined : ms === 1000;
}

/**
 * The business time between two instants, to the microsecond: the whole seconds' business time, less our fraction
 * and plus theirs wherever that second is business time.
 *
 * @param from the earlier instant
 * @param to the later instant
 * @returns business microseconds, or `undefined` when the calendar cannot be read
 */
function businessMicrosBetween({ from, to }: { from: Instant; to: Instant }): number | undefined {
  const wholeMs = businessMsBetween({ fromIso: from.iso, toIso: to.iso });
  const fromCounts = businessSecond({ instant: from });
  const toCounts = businessSecond({ instant: to });
  if (wholeMs === undefined || fromCounts === undefined || toCounts === undefined) {
    return undefined;
  }
  const fromFraction = fromCounts ? from.micros : 0;
  const toFraction = toCounts ? to.micros : 0;
  return wholeMs * MICROS_PER_MS - fromFraction + toFraction;
}

/**
 * The wall-clock time between two instants, to the microsecond.
 *
 * @param from the earlier instant
 * @param to the later instant
 * @returns microseconds
 */
function wallMicrosBetween({ from, to }: { from: Instant; to: Instant }): number {
  return (to.seconds - from.seconds) * 1_000_000 + (to.micros - from.micros);
}

/**
 * Whether one post is a person's word after ours, inside the business-day horizon, its far edge included.
 *
 * @param post the post judged
 * @param ask our message
 * @param askAt our message's exact instant
 * @returns true when the rule considers it
 */
function considered({ post, ask, askAt }: { post: TopLevelMessage; ask: TopLevelMessage; askAt: Instant }): boolean {
  if (post.userId === undefined || post.userId === ask.userId) {
    return false;
  }
  if (post.botId !== undefined || post.appId !== undefined) {
    return false;
  }
  if (post.subtype !== undefined && !WORD_SUBTYPES.has(post.subtype)) {
    return false;
  }
  if (compareSlackTimestamps({ left: post.ts, right: ask.ts }) <= 0) {
    return false;
  }
  const postAt = instantOf({ ts: post.ts });
  if (postAt === undefined) {
    return false;
  }
  const business = businessMicrosBetween({ from: askAt, to: postAt });
  return business !== undefined && business <= BUSINESS_DAY_MS * MICROS_PER_MS;
}

/**
 * Whether a post landed within {@link ANSWER_WINDOW_MS} of ours, to the microsecond.
 *
 * @param post the post
 * @param askAt our message's exact instant
 * @returns true inside the window, its far edge included
 */
function insideWindow({ post, askAt }: { post: TopLevelMessage; askAt: Instant }): boolean {
  const postAt = instantOf({ ts: post.ts });
  return postAt !== undefined && wallMicrosBetween({ from: askAt, to: postAt }) <= ANSWER_WINDOW_MS * MICROS_PER_MS;
}

/**
 * Whether the channel's top level answers our ask, may answer it, or says nothing about it.
 *
 * @param ask our message, its raw mrkdwn intact so a mention reads as one
 * @param posts the channel's top-level messages around it, in any order; anything the rule does not consider is
 *   skipped, never an error
 * @returns the tie with the post it rests on, or `undefined` when nothing at the top level is tied to ours
 */
export function topLevelTieOf({
  ask,
  posts,
}: {
  ask: TopLevelMessage;
  posts: readonly TopLevelMessage[];
}): TopLevelTie | undefined {
  const askAt = instantOf({ ts: ask.ts });
  if (askAt === undefined) {
    return undefined;
  }
  const after = posts
    .filter((post) => considered({ ask, askAt, post }))
    .toSorted((left, right) => compareSlackTimestamps({ left: left.ts, right: right.ts }));
  const next = after.at(0);
  if (next === undefined) {
    return undefined;
  }
  const asked = askedBy({ ask });
  const nextAsked = asked.room || asked.named.has(next.userId!);
  const nextPrompt = insideWindow({ askAt, post: next });
  if (nextAsked && nextPrompt) {
    return { kind: "answers", post: next };
  }
  const held = after.find((post) => (post === next && nextPrompt) || asked.named.has(post.userId!));
  if (held === undefined) {
    return undefined;
  }
  return { kind: "may-answer", post: held };
}
