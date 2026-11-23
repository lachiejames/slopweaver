/**
 * The Gmail leg — a mail thread the owner wrote into that somebody answered after them, turned into ranked items.
 *
 * ## It reads LIVE, and that is forced rather than preferred
 *
 * The corpus cannot answer this question at all. Bronze's Gmail label vocabulary is `CATEGORY_PERSONAL`,
 * `CATEGORY_UPDATES`, `CATEGORY_PROMOTIONS`, `SENT` and `DRAFT` — **there is no `INBOX` and no `UNREAD`** —
 * and `attrs.to` is redacted to a placeholder at ingest, so neither "in my inbox" nor "addressed to me" is
 * computable from it. The live mailbox carries all fourteen labels. So unlike
 * {@link ./slackLeg}, whose rows are the corpus's own copy, every row here is current to the second and
 * `unverified` is honestly false.
 *
 * ## `is:unread` is the wrong filter, and the rows say so rather than a theory
 *
 * The obvious build asks Gmail for unread inbox mail. Measured on the owner's real mailbox, that is
 * five messages and **not one of them is a person asking the owner anything** — two calendar invitations, a
 * Datadog cost report, a Google security alert and a document-share notification. Meanwhile all three of
 * the genuinely human threads in the same window were already READ. Unread measures what the owner has opened,
 * not what they owe.
 *
 * ## The detector is the Slack leg's, ported, and the port is the point
 *
 * A thread the owner WROTE INTO whose last message is somebody else's. One rule across two surfaces, so there is
 * one idea to argue with rather than two. Measured over the owner's whole inbox for a fourteen-day
 * window — ten messages — it drops all five automated senders, both calendar invitations and the
 * document-share notification, with no sender-name rule anywhere.
 *
 * **It also drops two things a count would have called real, and both drops are correct.** The memo this
 * leg was built from recorded three real messages. One is a thread the owner is only CC'd on, where a colleague is
 * arranging a meeting and has asked the other side to include them — nothing is the owner's to do. The other the owner had
 * already ANSWERED five days after the message that looked outstanding. So the honest yield on that mailbox
 * is zero, and a leg reporting zero there is right rather than broken.
 *
 * ## Answered means answered LATER, which is the whole of {@link outstandingThreads}
 *
 * A thread qualifying because it holds one of the owner's messages and one of theirs is not enough — that is every
 * conversation ever. The inbound message has to be later than the owner's last word in the same thread. Getting
 * this wrong is what made the first build report the answered thread as owed.
 *
 * Pure — no I/O, no clock. `nowIso` is supplied so a frozen fixture judges its own time.
 */

import { absentAs } from "#lib/absent.js";
import type { RuleZeroDecision } from "../silver/ruleZero.js";
import { applyRuleZero } from "../silver/ruleZero.js";
import type { TraceEvidence } from "../silver/traceBeforeRanking.js";
import { traceBeforeRanking } from "../silver/traceBeforeRanking.js";
import type { Item } from "./item.js";
import { asItem } from "./item.js";
import type { RankInput, SignalReadings } from "./rank.js";

/** One message, reduced to what this leg reads. Both directions use the same shape. */
export interface MailMessage {
  /** Gmail's own thread id — the join key between what the owner sent and what came back. */
  readonly threadId: string;
  /** When it was sent, by Gmail's clock, as ISO 8601. Absent when the header could not be read. */
  readonly sentAtIso: string | undefined;
  /** The `From` header verbatim, display name and angle-bracketed address together. */
  readonly from: string | undefined;
  readonly subject: string | undefined;
  /** Gmail's own snippet — the only body text a listing carries. */
  readonly snippet: string | undefined;
  readonly labelIds: readonly string[];
}

/**
 * A thread the owner wrote into whose last word is somebody else's.
 *
 * `inboundIso` is a REQUIRED field rather than a re-read of `inbound.sentAtIso`, which is optional. The
 * detector already dropped every message with no readable timestamp, so hoisting the instant onto the
 * thread makes that guarantee part of the type instead of something every consumer re-defends against with
 * a fallback that could never fire.
 */
export interface MailThread {
  readonly threadId: string;
  /** The inbound message that is later than the owner's last word in this thread. */
  readonly inbound: MailMessage;
  /** When that inbound message landed. Always readable — the detector dropped the ones that were not. */
  readonly inboundIso: string;
  /** When the owner last wrote in this thread, which the inbound message is later than. */
  readonly ownerLastIso: string;
}

/**
 * The most days of silence that still count, matching `SIGNAL_CAPS.age`.
 *
 * @internal exported for its own tests until a consumer outside this module reads it.
 */
export const AGE_DAYS_CAP = 2;

/**
 * The display name a `From` header carries, or the bare address when it carries none.
 *
 * `who` is mandatory on an item, and "somebody" is not a reason to act. Gmail gives `Ada Lovelace
 * <ada@example.com>` when a display name exists and a bare address when it does not, so both spellings
 * resolve to something a reader recognises without the roster being consulted at all.
 *
 * @param from the raw `From` header
 * @returns the display name, the bare address, or undefined when the header is absent or empty
 */
export function senderName({ from }: { from: string | undefined }): string | undefined {
  if (from === undefined) {
    return undefined;
  }
  // Scanned rather than matched. The obvious `/^(.*?)<([^>]+)>$/` is polynomial-backtracking on a header
  // full of angle brackets, and `From` is attacker-influenced text arriving from outside.
  const trimmed = from.trim();
  const opened = trimmed.lastIndexOf("<");
  const closed = trimmed.lastIndexOf(">");
  if (opened < 0 || closed < opened) {
    return trimmed.length === 0 ? undefined : trimmed;
  }
  const display = trimmed.slice(0, opened).trim().replace(/^"/, "").replace(/"$/, "").trim();
  if (display.length > 0) {
    return display;
  }
  const address = trimmed.slice(opened + 1, closed).trim();
  return address.length === 0 ? undefined : address;
}

/**
 * The threads where somebody answered after the owner's last word.
 *
 * Pairs the two listings on Gmail's own thread id and keeps a thread only when the inbound message is
 * strictly LATER than the owner's most recent message in it. A message with no readable timestamp is dropped
 * rather than assumed recent, because assuming would manufacture the exact row this leg exists to avoid.
 *
 * @param inbound every message currently in the owner's inbox, in any order
 * @param sent every message the owner sent, over a window deliberately wider than the inbound one
 * @returns one thread per conversation that moved after the owner, newest inbound first
 */
export function outstandingThreads({
  inbound,
  sent,
}: {
  inbound: readonly MailMessage[];
  sent: readonly MailMessage[];
}): readonly MailThread[] {
  const ownerLast = new Map<string, string>();
  for (const message of sent) {
    if (message.sentAtIso === undefined) {
      continue;
    }
    const held = ownerLast.get(message.threadId);
    if (held === undefined || message.sentAtIso > held) {
      ownerLast.set(message.threadId, message.sentAtIso);
    }
  }
  const latest = new Map<string, MailMessage>();
  for (const message of inbound) {
    const mine = ownerLast.get(message.threadId);
    if (message.sentAtIso === undefined || mine === undefined || message.sentAtIso <= mine) {
      continue;
    }
    const held = latest.get(message.threadId);
    if (held?.sentAtIso === undefined || message.sentAtIso > held.sentAtIso) {
      latest.set(message.threadId, message);
    }
  }
  return [...latest.entries()]
    .map(([threadId, message]) => ({
      ownerLastIso: ownerLast.get(threadId)!,
      inbound: message,
      // Guaranteed readable: the loop above skipped every message whose timestamp would not parse.
      inboundIso: message.sentAtIso!,
      threadId,
    }))
    .toSorted((left, right) => right.inboundIso.localeCompare(left.inboundIso));
}

/**
 * Where a row sends the owner. Gmail's own permalink for the thread, in the default account's mailbox.
 *
 * `#all` rather than `#inbox` so the link still resolves once the owner archives it, which is a thing they are quite
 * likely to do between the list being printed and the link being clicked.
 *
 * @param thread the thread to link
 * @returns the permalink
 */
export function mailPermalink({ thread }: { thread: MailThread }): string {
  return `https://mail.google.com/mail/u/0/#all/${thread.threadId}`;
}

/**
 * What this leg measured for one thread.
 *
 * `directness` is at its cap for every row and that is a property of the DETECTOR rather than an
 * assumption: a thread only arrives here because the owner wrote in it and somebody answered them, so they are
 * unambiguously the audience. `stoppedOnOwner` follows {@link ./slackLeg}'s rule exactly — being addressed
 * is not being blocked, and the only evidence of an ask a listing carries is a question in the subject or
 * the snippet.
 *
 * `explicitPriority` reads STARRED and deliberately NOT Gmail's `IMPORTANT`. Starring is something the owner did;
 * `IMPORTANT` is Gmail's own model guessing, and dressing a guess as the owner's stated priority is how a row
 * becomes one they cannot argue with.
 *
 * `drift` is zero because a mail transcript makes no claim about the work that it could deviate from.
 *
 * @param thread the thread to measure
 * @param nowIso the run's own instant, supplied rather than read
 * @returns the readings
 */
export function mailReadings({ thread, nowIso }: { thread: MailThread; nowIso: string }): SignalReadings {
  const last = Date.parse(thread.inboundIso);
  const now = Date.parse(nowIso);
  const days = Number.isNaN(last) || Number.isNaN(now) ? 0 : Math.floor((now - last) / 86_400_000);
  const asks = [thread.inbound.subject, thread.inbound.snippet].some((text) => text?.includes("?") === true);
  return {
    age: Math.min(Math.max(0, days), AGE_DAYS_CAP),
    directness: 3,
    distanceToDone: 3,
    drift: 0,
    explicitPriority: thread.inbound.labelIds.includes("STARRED") ? 2 : 0,
    stoppedOnOwner: asks ? 5 : 0,
  };
}

/**
 * The evidence one thread carries into the trace.
 *
 * Graded `provider-fact` because Gmail owns the ordering of its own messages, and read LIVE rather than
 * from a stored copy, so there is no cursor between this claim and the mailbox.
 *
 * @param thread the thread to describe
 * @returns the single piece of evidence, in the words a row shows
 */
export function mailEvidence({ thread }: { thread: MailThread }): readonly TraceEvidence[] {
  const who = absentAs({ value: senderName({ from: thread.inbound.from }), whenAbsent: "somebody" });
  return [
    {
      grade: "provider-fact",
      showsResolved: false,
      source: mailPermalink({ thread }),
      what: `you wrote in this thread at ${thread.ownerLastIso} and ${who} answered at ${thread.inboundIso}`,
    },
  ];
}

/**
 * What a mail thread IS, before anything about who replied last.
 *
 * The subject and Gmail's own snippet are the only description a metadata listing carries, and together
 * they are what tells the owner whether the thread matters without opening it. A thread with neither is described
 * honestly as one with no subject rather than dressed up.
 *
 * @param thread the thread to describe
 * @returns the background
 */
export function mailBackground({ thread }: { thread: MailThread }): string {
  const who = absentAs({ value: senderName({ from: thread.inbound.from }), whenAbsent: "somebody" });
  const subject = thread.inbound.subject?.trim();
  const named = subject === undefined || subject.length === 0 ? "a thread with no subject" : `"${subject}"`;
  const snippet = thread.inbound.snippet?.replace(/\s+/g, " ").trim();
  const quoted = snippet === undefined || snippet.length === 0 ? "" : ` Their message opens: "${snippet}"`;
  return `An email conversation you wrote into, ${named}, and ${who} has replied since your last message.${quoted}`;
}

/**
 * The item one thread produces, or undefined when it is incomplete.
 *
 * @param thread the thread to turn into a row
 * @returns the item, or undefined when a mandatory field could not be filled
 */
export function mailItem({ thread }: { thread: MailThread }): Item | undefined {
  const who = senderName({ from: thread.inbound.from });
  const subject = thread.inbound.subject;
  const about = subject === undefined ? "a thread with no subject" : `"${subject}"`;
  return asItem({
    candidate: {
      background: mailBackground({ thread }),
      doneWhen: `Reply to ${absentAs({ value: who, whenAbsent: "the sender" })} about ${about}, which they answered after your last message`,
      nativeId: thread.threadId,
      provenance: "gmail leg — a mail thread you wrote in that somebody answered after you",
      source: "gmail",
      state: "answered after your last message",
      whenIso: thread.inboundIso,
      where: mailPermalink({ thread }),
      ...(who === undefined ? {} : { who }),
    },
  });
}

/**
 * Rule zero for a mail thread.
 *
 * Always the owner's move, as a property of the detector: a thread only reaches here because somebody answered
 * after the owner's last word, so nobody is waiting on anybody but the owner.
 *
 * @param thread the thread to decide
 * @param nowIso the run's own instant
 * @returns the decision, which is always `show`
 */
export function mailRuleZero({ thread, nowIso }: { thread: MailThread; nowIso: string }): RuleZeroDecision {
  return applyRuleZero({ lastMovedIso: thread.inboundIso, move: { party: "owner" }, nowIso });
}

/**
 * Turn every thread that was answered after the owner into ranker input.
 *
 * `finishesInFlight` is true for every row, carrying the north star: wrapping up
 * in-flight work rather than chasing new shiny things. The owner started every one of these conversations or
 * joined them, and a reply is the smallest act that moves one.
 *
 * `unverified` is false throughout, and this is the only leg that can honestly say so. Both listings are
 * live reads of the mailbox rather than a stored projection of it.
 *
 * @param threads every outstanding thread, in the order the reader established
 * @param nowIso the run's own instant, supplied rather than read
 * @returns one rank input per thread that produced a complete item
 */
export function gmailLeg({
  threads,
  nowIso,
}: {
  threads: readonly MailThread[];
  nowIso: string;
}): readonly RankInput[] {
  const inputs: RankInput[] = [];
  for (const thread of threads) {
    const item = mailItem({ thread });
    if (item === undefined) {
      continue;
    }
    inputs.push({
      finishesInFlight: true,
      item,
      readings: mailReadings({ nowIso, thread }),
      ruleZero: mailRuleZero({ nowIso, thread }),
      trace: traceBeforeRanking({ evidence: mailEvidence({ thread }) }),
      unverified: false,
    });
  }
  return inputs;
}
