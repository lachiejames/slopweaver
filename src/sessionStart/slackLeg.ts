/**
 * The Slack leg — what reached the owner in Slack and has had no answer from them, turned into ranked items.
 *
 * Two detectors, because one thread can go unanswered in two structurally different ways.
 *
 * - **Thread movement** — a thread the owner SPOKE in whose last word belongs to somebody else.
 * - **A mention the owner has not answered** — somebody tagged them in a thread they have not spoken in since.
 *
 * They are disjoint by construction: the reader suppresses a mention whose thread the owner has spoken in
 * inside the window, so one thread never yields two rows, and "has the owner answered since" is that same
 * single rule rather than a second timestamp comparison to keep in sync.
 *
 * **What the second detector checks is SINCE, not EVER, and every row-facing sentence here says so.**
 * The reader's suppression set is window-bounded like everything else it reads, so a thread the owner spoke in
 * before the window opened is not in it. That is sound for the job — the mention is itself inside the
 * window, so any reply to it would be too — but it does NOT establish that the owner has never spoken there,
 * and asserting that in {@link slackMentionEvidence},
 * {@link slackMentionDoneWhen}, {@link slackMentionBackground} or the item's own provenance would be
 * wrong. A row
 * citing something that is not so is the failure `./staleRefs` exists to prevent, arriving by a
 * different door.
 *
 * ## Thread movement is the measured detector, and the mention detector exists because that rejection was wrong
 *
 * What reaches the owner is a conversation they are already in that moved without them. Measured over a
 * fourteen-day window: 171 threads the owner spoke in, 41 whose last word is not theirs.
 *
 * Rejecting an explicit at-mention detector on the grounds that the whole history held
 * 33 messages carrying the owner's mention token, every recent one an automated huddle-notes document, is false.
 * Re-running that claim's own command on the owner's live corpus,
 * `LC_ALL=C grep -c '<@OWNER_ID>' "$SLOPWEAVER_HOME"/corpus/bronze/slack/compact.jsonl`, answers **2691**
 * — eighty-one times the number it was rejected on. And sampling one day's file
 * turns up *"Hey <@OWNER> - multiple throws of 503s above^. Any idea on this issue?"*, *"quick bump
 * <@…> <@OWNER>, this one is just a one-file change"* and *"Is <@OWNER> even still alive?"* — people
 * asking the owner things, not huddle notes.
 *
 * Quantified on the owner's corpus: **50 distinct mention threads in a window, 49 of them absent
 * from the owner's top list**, 12 surviving a has-the-owner-answered filter. That is what {@link slackMentionLeg}
 * exists for.
 *
 * ## Two non-humans sit in the movement yield, and both would have read as a person
 *
 * **The bot is not a person.** Slopweaver posts under its own Slack id, so a thread the bot answered last
 * reads as "somebody replied and the owner did not". TWELVE of the 41 are exactly that — 29% — which is why
 * {@link SlackThread.lastAuthorIsSelf} is a field the reader fills from `profile.json`'s
 * `slackBot.selfUserIds` rather than something this module guesses from a name.
 *
 * **Slackbot is not a bot, according to Slack.** The members index carries `profile.bot` straight from
 * Slack's `is_bot`, and Slack reports `is_bot: false` for `USLACKBOT` itself. So a `bot` flag alone leaves
 * one row — an "AI huddle notes are ready" DM — reading as a colleague. The reader handles that; this
 * module only ever sees {@link SlackThread.lastAuthorIsHuman} and {@link SlackMention.authorIsHuman}.
 *
 * **That filter is what keeps the mention detector honest**, and it is not a formality. The
 * highest-volume mentioner in the sampled day is `Nightfall Enterprise DLP for Slack`, which tags the owner on
 * every alert in its own channel; the members index carries `profile.bot: true` for it and `false` for
 * the colleagues quoted above.
 *
 * ## Directness is what the readings turn on, because "the last word is not the owner's" is not an obligation
 *
 * Taken all the way to the rows rather than stopped at the count, 26 of the 41 have a human last word and
 * only FOUR carry any signal that the message wanted something from the owner — three DMs and one question — and
 * three of those four are closers (*"Thanks!"*, *"thank you!"*). The remaining 22 are ambient: *"ticked"*,
 * *"cheers!"*, *"legend"*, and several asks explicitly aimed at somebody else by name.
 *
 * So this leg does not claim an ambient thread is work. It reports what it measured and lets the readings
 * carry the spread; dropping the ambient ones instead would be inventing a closer-detection heuristic
 * nobody measured, and hiding them would make the leg's own yield unauditable. **The same spread applies
 * to a mention** — a *"cheers <@OWNER>"* is a closer and this module does not pretend to know it.
 *
 * **Being ADDRESSED and being WAITED ON are separate readings, and collapsing them was a defect the first
 * live run caught.** An earlier build read any direct message as `stoppedOnOwner` at its cap, and the verb
 * duly put *"Reply to … whose last message reads \"Thanks!\""* at score 11 — level with a session that had
 * genuinely stopped on a written question. The audience of a message is visible in the corpus: a direct
 * message or a mention is aimed at the owner, full stop. Whether somebody is BLOCKED on the owner is not, and the only
 * evidence of it a transcript carries is that the person who addressed the owner also asked something.
 *
 * ## What "a mention ranks below a thread movement" does and does not mean
 *
 * A mention row sets `finishesInFlight: false`, which is the literal truth — the owner is not in that
 * conversation — and it is the ranker's own tiebreak, the north star: wrapping up
 * in-flight work rather than chasing new shiny things. So at EQUAL signal a movement row always wins.
 *
 * It is not an unconditional demotion, and saying otherwise would be false: a mention that asks the owner
 * something scores above a movement row whose last word was *"cheers!"*, because the directness ladder is
 * the owner's own order and a question aimed at the owner IS the more important of those two. Inventing a
 * demotion constant to force the stronger claim is exactly what {@link READINGS_BY_DIRECTNESS} refuses to
 * do — spreading a scale nobody set is inventing the ranking rather than reading it.
 *
 * ## One blind spot this leg still has, stated rather than discovered
 *
 * A direct message the owner has NEVER replied to remains invisible. The reader only reaches a thread through the owner's
 * own id, and a DM rarely carries a mention token, so neither detector sees it. The Gmail leg
 * ({@link ./gmailLeg}) carries the movement detector and therefore the same gap in its own shape.
 *
 * Pure — no I/O, no clock. `nowIso` is supplied so a frozen fixture judges its own time.
 */

import type { PrLinkRef } from "../review/prLink.js";
import type { RuleZeroDecision } from "../silver/ruleZero.js";
import { applyRuleZero } from "../silver/ruleZero.js";
import type { TraceEvidence } from "../silver/traceBeforeRanking.js";
import { traceBeforeRanking } from "../silver/traceBeforeRanking.js";
import type { Item } from "./item.js";
import { asItem } from "./item.js";
import type { RankInput, SignalReadings } from "./rank.js";

/**
 * One thread the owner spoke in whose last word belongs to somebody else.
 *
 * Every field is something the reader established from a record rather than inferred, which is what lets
 * this module be pure and its rules arguable.
 */
export interface SlackThread {
  /** The channel's own id. `D…` for a direct message, which is the only way to tell one apart here. */
  readonly channelId: string;
  /** The channel's display name when the record carried one, so a row reads `#some-channel`. */
  readonly channelName?: string;
  /** The thread's parent timestamp, taken from `sourceId` rather than the redacted `attrs.threadTs`. */
  readonly threadTs: string;
  /** The permalink of the LAST message, so one click lands on what the owner has not answered. */
  readonly permalink: string;
  /** When the last message landed, by Slack's clock, as ISO 8601. */
  readonly lastIso: string;
  /** The last message's author, resolved through the members index to a display name. */
  readonly lastAuthorName: string;
  /** Whether that author is a person — false for Slackbot, an app, or Slopweaver itself. */
  readonly lastAuthorIsHuman: boolean;
  /** Whether that author is Slopweaver's own bot id. Reported apart so its yield stays countable. */
  readonly lastAuthorIsSelf: boolean;
  /** The last message's text, trimmed by the reader to what a row can show. */
  readonly lastText: string;
  /** Whether the last message carries the owner's own mention token. */
  readonly mentionsOwner: boolean;
  /** Whether the last message tags anybody at all — a person, a user group, or the room. */
  readonly lastNamesAnybody: boolean;
  /** Whether the thread's root is the owner's own message, so a reply naming nobody is a reply to the owner. */
  readonly ownerStartedThread: boolean;
  /** Whether the OWNER's latest message in the thread tags the last message's author, so their reply answers the owner's ask. */
  readonly ownerLatestTagsLastAuthor: boolean;
  /** When the OWNER's latest message in the thread landed, by Slack's clock, so a row can say how long the owner has been quiet. */
  readonly ownerLastIso: string;
}

/**
 * The most days of silence that still count, matching `SIGNAL_CAPS.age`.
 *
 * A thread that moved without the owner three weeks ago is not more urgent than one that moved four weeks ago,
 * and letting age run unbounded would sort the list by how long the owner has ignored something.
 *
 * @internal exported for its own tests until a consumer outside this module reads it.
 */
export const AGE_DAYS_CAP = 2;

/**
 * How the last message reached the owner. Three rungs, each the answer to a question the corpus can settle.
 *
 * - `asked` — it was aimed at the owner AND it asks something. Both halves are visible: the audience from the
 *   channel or the mention token, the ask from a question mark. Two more ways in, both a question naming
 *   NOBODY: in a thread whose root is the owner's — a reply under the owner's own post is a reply to them — or from the person
 *   the owner's own latest word in the thread tagged — an answer to the owner's ask is a reply to them, whoever's root it sits
 *   under.
 * - `addressed` — it was aimed at the owner and asks nothing. They are the audience; nobody is demonstrably waiting.
 * - `ambient` — the conversation moved and nothing says it wanted them. Measured, this is most of them.
 *
 * **A question in a channel is `ambient` unless it names nobody and answers the owner** — under the owner's own root, or
 * from the person the owner's latest word tagged. Two of the measured rows are a question addressed to a named
 * colleague in a room the owner happens to be in. Reading a question mark alone as an ask would have ranked somebody
 * else's ask as the owner's — so a `?` that tags anybody, or sits in somebody else's thread from somebody the owner did not
 * just ask, stays ambient. Both exceptions are measured: a colleague's "what are you trying to
 * achieve there?" under the owner's own post read `ambient` and sat unanswered for 38 hours; and an owner tag of
 * a colleague for a spend sign-off under a teammate's root, answered untagged by the colleague, was never drafted by the owed-reply
 * recipe. The owner's LATEST
 * word is what counts, not any earlier one: a tag the owner has since moved past is no live ask. Both move the
 * `asked` rung only: a reply in the owner's thread that asks nothing stays ambient, because widening the audience
 * itself would lift every `:approved:` under the owner's own posts in the ranking.
 *
 * @internal exported for its own tests until a consumer outside this module reads it.
 */
export type Directness = "addressed" | "ambient" | "asked";

/**
 * What each rung is worth on the two signals it can honestly speak to.
 *
 * `stoppedOnOwner` is the highest-capped signal in {@link ./rank.SIGNAL_CAPS} because ignoring one burns
 * somebody else's time as well as the owner's — so it fires only on `asked`, where somebody demonstrably wants
 * something. `directness` fires one rung earlier, on being the audience at all.
 *
 * `ambient` contributes nothing rather than a small invented amount, for the reason the cycle leg's
 * `PRIORITY_READINGS` gives: spreading a scale nobody set is inventing the ranking rather than reading it.
 */
const READINGS_BY_DIRECTNESS: Readonly<Record<Directness, { stoppedOnOwner: number; directness: number }>> = {
  addressed: { directness: 3, stoppedOnOwner: 0 },
  ambient: { directness: 0, stoppedOnOwner: 0 },
  asked: { directness: 3, stoppedOnOwner: 5 },
};

/**
 * Whether the last message was aimed at the owner at all.
 *
 * A direct message has no other audience, and a mention token names one. Nothing else in a Slack record
 * says who a message was for.
 *
 * @param thread the thread whose last message to classify
 * @returns whether the owner is the message's audience
 */
export function addressesOwner({ thread }: { thread: SlackThread }): boolean {
  return thread.mentionsOwner || thread.channelId.startsWith("D");
}

/**
 * How directly one thread's last message reached the owner.
 *
 * @param thread the thread whose last message to classify
 * @returns the rung, never a score — {@link READINGS_BY_DIRECTNESS} is the only place a magnitude is set
 */
export function directnessOf({ thread }: { thread: SlackThread }): Directness {
  const asks = thread.lastText.includes("?");
  if (addressesOwner({ thread })) {
    return asks ? "asked" : "addressed";
  }
  const repliesToOwner = thread.ownerStartedThread || thread.ownerLatestTagsLastAuthor;
  const askedOwnerUntagged = asks && repliesToOwner && !thread.lastNamesAnybody;
  return askedOwnerUntagged ? "asked" : "ambient";
}

/**
 * How a row names the room something happened in, for either detector.
 *
 * A direct message has no channel name, and printing its bare `D…` id tells the owner
 * nothing, so it says what it is instead. A channel the record named no name for falls back to its id, and
 * that case is spelled as its own branch rather than as an operator: the substitution from display name to
 * platform id is exactly the one the `no-silent-fallback` gate exists to keep visible.
 *
 * @param channelId the channel's own id
 * @param channelName the display name the record carried, when it carried one
 * @returns the display name a row shows
 */
function roomNameOf({ channelId, channelName }: { channelId: string; channelName: string | undefined }): string {
  if (channelId.startsWith("D")) {
    return "a direct message";
  }
  if (channelName === undefined) {
    return channelId;
  }
  return channelName;
}

/**
 * How a row names the room a thread movement happened in.
 *
 * @param thread the thread to name
 * @returns the display name a row shows
 */
export function roomOf({ thread }: { thread: SlackThread }): string {
  return roomNameOf({ channelId: thread.channelId, channelName: thread.channelName });
}

/**
 * What this leg measured for one thread.
 *
 * `drift` is zero and that is honest rather than missing: measuring drift means catching what the system
 * SAYS about a thing coming apart from what is true, and a Slack transcript makes no claim to deviate from.
 * `explicitPriority` is zero because Slack has no priority field at all. `distanceToDone` is at its cap for
 * every row because one reply is genuinely the smallest act that moves any of them.
 *
 * @param thread the thread to measure
 * @param nowIso the run's own instant, supplied rather than read
 * @returns the readings, with directness and age carrying the spread
 */
export function slackReadings({ thread, nowIso }: { thread: SlackThread; nowIso: string }): SignalReadings {
  const last = Date.parse(thread.lastIso);
  const now = Date.parse(nowIso);
  const days = Number.isNaN(last) || Number.isNaN(now) ? 0 : Math.floor((now - last) / 86_400_000);
  const byDirectness = READINGS_BY_DIRECTNESS[directnessOf({ thread })];
  return {
    age: Math.min(Math.max(0, days), AGE_DAYS_CAP),
    directness: byDirectness.directness,
    distanceToDone: 3,
    drift: 0,
    explicitPriority: 0,
    stoppedOnOwner: byDirectness.stoppedOnOwner,
  };
}

/**
 * The evidence one thread carries into the trace.
 *
 * Graded `provider-fact` because Slack owns the ordering of its own messages — who spoke last in a thread
 * is not this system's reading of anything. `showsResolved` is false for the same reason it is honest: a
 * message existing says nothing about whether the work behind it is finished, and claiming otherwise would
 * put a propose-close row in front of the owner built on somebody saying "cheers!".
 *
 * @param thread the thread to describe
 * @returns the single piece of evidence, in the words a row shows
 */
export function slackEvidence({ thread }: { thread: SlackThread }): readonly TraceEvidence[] {
  return [
    {
      grade: "provider-fact",
      showsResolved: false,
      source: thread.permalink,
      what: `${thread.lastAuthorName} spoke last in ${roomOf({ thread })} at ${thread.lastIso} and you have not replied since`,
    },
  ];
}

/**
 * The one concrete sentence a row needs, quoting what the owner would be replying to.
 *
 * The quote is what makes this an action rather than "look into Slack". Trimmed by the reader, not here,
 * because how much of a message a row can hold is a rendering question and this module renders nothing.
 *
 * @param thread the thread to describe
 * @returns what would count as done
 */
export function slackDoneWhen({ thread }: { thread: SlackThread }): string {
  return `Reply to ${thread.lastAuthorName} in ${roomOf({ thread })}, whose last message reads "${thread.lastText}"`;
}

/**
 * What a Slack thread IS, before anything about who spoke last.
 *
 * Names the room and quotes what was actually said, because a permalink alone makes the owner open Slack to find
 * out whether the row matters. A direct message says so instead of naming a channel — `D…` is not a room
 * anybody recognises, and "a direct message" is the true description of it.
 *
 * The leading `#` is added only when the stored name lacks one. The corpus carries both spellings depending
 * on which record wrote the row, and a blind prefix renders `##a-channel`.
 *
 * @param thread the thread to describe
 * @returns the background
 */
export function slackBackground({ thread }: { thread: SlackThread }): string {
  const named = thread.channelName;
  let room = "a direct message";
  if (!thread.channelId.startsWith("D") && named !== undefined && named.length > 0) {
    room = named.startsWith("#") ? named : `#${named}`;
  }
  const said = thread.lastText.replace(/\s+/g, " ").trim();
  const quoted = said.length === 0 ? "" : ` They said: "${said}"`;
  return `A conversation in ${room} that you took part in, and ${thread.lastAuthorName} has spoken in it since your last message.${quoted}`;
}

/**
 * The item one thread produces, or undefined when it is incomplete.
 *
 * @param thread the thread to turn into a row
 * @returns the item, or undefined when a mandatory field could not be filled
 */
export function slackItem({ thread }: { thread: SlackThread }): Item | undefined {
  return asItem({
    candidate: {
      background: slackBackground({ thread }),
      doneWhen: slackDoneWhen({ thread }),
      nativeId: `${thread.channelId}:${thread.threadTs}`,
      provenance: "slack leg — a thread you spoke in whose last word is somebody else's",
      source: "slack",
      state: `last word is ${thread.lastAuthorName}'s`,
      whenIso: thread.lastIso,
      where: thread.permalink,
      who: thread.lastAuthorName,
    },
  });
}

/**
 * Rule zero for a Slack thread.
 *
 * Always the owner's move, and unlike the board leg's version that is a property of the detector rather than of a
 * register: a thread only reaches this module BECAUSE the last word is somebody else's, so nobody is
 * waiting on anybody but the owner. Kept as a real call so the reason on the row comes from the same place every
 * other row's does.
 *
 * @param thread the thread to decide
 * @param nowIso the run's own instant
 * @returns the decision, which is always `show`
 */
export function slackRuleZero({ thread, nowIso }: { thread: SlackThread; nowIso: string }): RuleZeroDecision {
  return applyRuleZero({ lastMovedIso: thread.lastIso, move: { party: "owner" }, nowIso });
}

/**
 * The ONE eligibility rule both consumers of the movement detector share: a person spoke last, and the
 * thread is complete enough to become a row.
 *
 * @param threads every thread the reader established
 * @returns each surviving thread beside the item it makes, in the order given
 */
function owedEntries({
  threads,
}: {
  threads: readonly SlackThread[];
}): readonly { readonly thread: SlackThread; readonly item: Item }[] {
  const entries: { readonly thread: SlackThread; readonly item: Item }[] = [];
  for (const thread of threads) {
    if (!thread.lastAuthorIsHuman) {
      continue;
    }
    const item = slackItem({ thread });
    if (item === undefined) {
      continue;
    }
    entries.push({ item, thread });
  }
  return entries;
}

/**
 * The followed threads a person is owed a reply in — exactly the threads {@link slackLeg} turns into rows.
 *
 * `slopweaver slack owed` reads this and `session-start` reads {@link slackLeg}; both go through one private
 * filter, so the standing read and the session list cannot disagree about which threads qualify.
 *
 * @param threads every thread the reader established, in any order
 * @returns the threads whose last author is a person and whose row is complete, in the order given
 */
export function slackOwedThreads({ threads }: { threads: readonly SlackThread[] }): readonly SlackThread[] {
  return owedEntries({ threads }).map((entry) => entry.thread);
}

/**
 * Turn every thread that moved without the owner into ranker input.
 *
 * A thread whose last author is not a person never reaches a row. That covers Slopweaver's own bot, Slack's
 * apps, and Slackbot — the last of which Slack itself reports as `is_bot: false`. The filter lives here
 * rather than in the reader so the drop is a rule with a test rather than a shape of a query.
 *
 * `finishesInFlight` is true for every row, and it is the north star: wrapping up
 * in-flight work rather than chasing new shiny things. The owner is already in every one of these conversations.
 *
 * `unverified` is true throughout, and that is the leg's honest limit rather than a defect. Nothing here is
 * read live — Slack's own state may have moved since the last ingest, and somebody may have replied for
 * the owner. The ranker's response is narrow and correct: age stops counting and every row says its source has
 * not been read since.
 *
 * @param threads every thread the reader established, in any order
 * @param nowIso the run's own instant, supplied rather than read
 * @returns one rank input per thread whose last word belongs to a person, in the order given
 */
export function slackLeg({
  threads,
  nowIso,
}: {
  threads: readonly SlackThread[];
  nowIso: string;
}): readonly RankInput[] {
  const inputs: RankInput[] = [];
  for (const { thread, item } of owedEntries({ threads })) {
    inputs.push({
      finishesInFlight: true,
      item,
      readings: slackReadings({ nowIso, thread }),
      ruleZero: slackRuleZero({ nowIso, thread }),
      trace: traceBeforeRanking({ evidence: slackEvidence({ thread }) }),
      unverified: true,
    });
  }
  return inputs;
}

/**
 * One thread somebody tagged the owner in and the owner has not spoken in since.
 *
 * The reader establishes every field; the disjointness rule that keeps a thread out of both detectors is
 * the reader's too, because only it can see whether the owner spoke.
 */
export interface SlackMention {
  /** The channel's own id. `D…` for a direct message, which is the only way to tell one apart here. */
  readonly channelId: string;
  /** The channel's display name when the record carried one, so a row reads `#some-channel`. */
  readonly channelName?: string;
  /** The thread's parent timestamp, taken from `sourceId` rather than the redacted `attrs.threadTs`. */
  readonly threadTs: string;
  /** The permalink of the mention itself, so one click lands on the message that tagged the owner. */
  readonly permalink: string;
  /** When that message landed, by Slack's clock, as ISO 8601. */
  readonly mentionedIso: string;
  /** Who tagged the owner, resolved through the members index to a display name. */
  readonly authorName: string;
  /** Whether that author is a person — false for Slackbot, an app, or Slopweaver itself. */
  readonly authorIsHuman: boolean;
  /** The message's own text, trimmed by the reader to what a row can show. */
  readonly text: string;
  /**
   * The pull requests the message links, as the links themselves spell them.
   *
   * Carried so the live re-read can settle the row — MEASURED, two of the twelve mention
   * threads that survived the has-the-owner-answered filter were review asks whose pull request had already
   * merged, which is the stale-row failure in a new shape.
   */
  readonly pullRequests: readonly PrLinkRef[];
}

/**
 * How directly one mention reached the owner.
 *
 * A mention is being addressed by construction — that is the whole detector — so the only question left is
 * whether the message also asks something, which is the same evidence {@link directnessOf} reads. `ambient`
 * is therefore unreachable here, and that is a property of the detector rather than an omission: a
 * *"cheers <@OWNER>"* is still `addressed`, scoring no `stoppedOnOwner` at all.
 *
 * @param mention the mention to classify
 * @returns the rung, never a score — {@link READINGS_BY_DIRECTNESS} is the only place a magnitude is set
 */
export function mentionDirectnessOf({ mention }: { mention: SlackMention }): Directness {
  return mention.text.includes("?") ? "asked" : "addressed";
}

/**
 * What this detector measured for one mention.
 *
 * Every signal carries the same reading as the movement detector's, for the same reasons
 * ({@link slackReadings}): Slack has no priority field, a transcript makes no claim to drift from, and one
 * reply is genuinely the smallest act that moves any of them. What separates the two is not a magnitude
 * here but `finishesInFlight` on the input — see this module's header.
 *
 * @param mention the mention to measure
 * @param nowIso the run's own instant, supplied rather than read
 * @returns the readings, with directness and age carrying the spread
 */
export function slackMentionReadings({ mention, nowIso }: { mention: SlackMention; nowIso: string }): SignalReadings {
  const mentioned = Date.parse(mention.mentionedIso);
  const now = Date.parse(nowIso);
  const days = Number.isNaN(mentioned) || Number.isNaN(now) ? 0 : Math.floor((now - mentioned) / 86_400_000);
  const byDirectness = READINGS_BY_DIRECTNESS[mentionDirectnessOf({ mention })];
  return {
    age: Math.min(Math.max(0, days), AGE_DAYS_CAP),
    directness: byDirectness.directness,
    distanceToDone: 3,
    drift: 0,
    explicitPriority: 0,
    stoppedOnOwner: byDirectness.stoppedOnOwner,
  };
}

/**
 * How a row names the room a mention happened in.
 *
 * @param mention the mention to name
 * @returns the display name a row shows
 */
export function mentionRoomOf({ mention }: { mention: SlackMention }): string {
  return roomNameOf({ channelId: mention.channelId, channelName: mention.channelName });
}

/**
 * The evidence one mention carries into the trace.
 *
 * Graded `provider-fact` because Slack owns both halves of the claim: who wrote a mention run, and that no
 * message of the owner's exists in the thread. Neither is this system's reading of anything.
 *
 * @param mention the mention to describe
 * @returns the single piece of evidence, in the words a row shows
 */
export function slackMentionEvidence({ mention }: { mention: SlackMention }): readonly TraceEvidence[] {
  return [
    {
      grade: "provider-fact",
      showsResolved: false,
      source: mention.permalink,
      what: `${mention.authorName} tagged you in ${mentionRoomOf({ mention })} at ${mention.mentionedIso} and you have not spoken in that thread since`,
    },
  ];
}

/**
 * Which repository a mention's own links name, and every number it links THERE.
 *
 * A message can link two repositories and a row carries one, so the first link decides — anything else
 * would be this module picking between them on a rule nobody set. Numbers in a second repository are
 * dropped rather than checked against the first, because a number checked against the wrong repository is
 * the exact failure {@link ./staleRefs} exists to prevent.
 *
 * @param mention the mention whose links to resolve
 * @returns the `owner/name` slug and its numbers, or undefined when the message links no pull request
 */
export function mentionedPullRequests({
  mention,
}: {
  mention: SlackMention;
}): { readonly repo: string; readonly numbers: readonly number[] } | undefined {
  const [first] = mention.pullRequests;
  if (first === undefined) {
    return undefined;
  }
  const repo = `${first.owner}/${first.repo}`;
  return {
    numbers: mention.pullRequests.filter((link) => `${link.owner}/${link.repo}` === repo).map((link) => link.number),
    repo,
  };
}

/**
 * The one concrete sentence a mention row needs.
 *
 * **The quoted message deliberately does NOT appear here** — it is in {@link slackMentionBackground}
 * instead. The live re-read runs `../sessionStart/staleRefs.bareRefs` over this exact string and checks
 * every `#<digits>` it finds against ONE repository, so a number quoted in somebody's prose would be
 * resolved against a repository it was never written for. Naming only the links this row actually resolved
 * makes that unrepresentable rather than unlikely.
 *
 * @param mention the mention to describe
 * @returns what would count as done
 */
export function slackMentionDoneWhen({ mention }: { mention: SlackMention }): string {
  const room = mentionRoomOf({ mention });
  const linked = mentionedPullRequests({ mention });
  if (linked === undefined) {
    return `Reply to ${mention.authorName} in ${room}, who tagged you and has had no word from you since`;
  }
  const numbers = linked.numbers.map((number) => `#${String(number)}`).join(", ");
  return `Reply to ${mention.authorName} in ${room}, who tagged you about ${numbers} in ${linked.repo}`;
}

/**
 * What a mention IS, before anything about who has answered.
 *
 * Carries the quote, for the reason {@link slackBackground} gives and one more: this is the field the live
 * re-read never reads, so a pull-request number somebody wrote in prose stays visible to the owner without being resolved
 * against a repository nobody named.
 *
 * @param mention the mention to describe
 * @returns the background
 */
export function slackMentionBackground({ mention }: { mention: SlackMention }): string {
  const named = mention.channelName;
  let room = "a direct message";
  if (!mention.channelId.startsWith("D") && named !== undefined && named.length > 0) {
    room = named.startsWith("#") ? named : `#${named}`;
  }
  const said = mention.text.replace(/\s+/g, " ").trim();
  const quoted = said.length === 0 ? "" : ` They said: "${said}"`;
  return `A conversation in ${room} that you have not spoken in since, where ${mention.authorName} tagged you by name.${quoted}`;
}

/**
 * The item one mention produces, or undefined when it is incomplete.
 *
 * `repo` is set only when the message links a pull request, and it is the link's own `owner/name` rather
 * than a checkout path — {@link ./staleRefs.repoSlugFor} takes either.
 *
 * @param mention the mention to turn into a row
 * @returns the item, or undefined when a mandatory field could not be filled
 */
export function slackMentionItem({ mention }: { mention: SlackMention }): Item | undefined {
  const linked = mentionedPullRequests({ mention });
  return asItem({
    candidate: {
      background: slackMentionBackground({ mention }),
      doneWhen: slackMentionDoneWhen({ mention }),
      nativeId: `${mention.channelId}:${mention.threadTs}`,
      provenance: "slack leg — somebody tagged you and you have not spoken in the thread since",
      source: "slack",
      state: `tagged by ${mention.authorName}, and no word from you in the thread since`,
      whenIso: mention.mentionedIso,
      where: mention.permalink,
      who: mention.authorName,
      ...(linked === undefined
        ? {}
        : {
            linkedPullRequests: mention.pullRequests.map((link) => `${link.owner}/${link.repo}#${String(link.number)}`),
            repo: linked.repo,
          }),
    },
  });
}

/**
 * Rule zero for a mention.
 *
 * Always the owner's move, and like {@link slackRuleZero} that is a property of the detector rather than of a
 * register: a thread only reaches this module BECAUSE the owner was tagged and has not answered, so nobody is
 * waiting on anybody but the owner.
 *
 * @param mention the mention to decide
 * @param nowIso the run's own instant
 * @returns the decision, which is always `show`
 */
export function slackMentionRuleZero({ mention, nowIso }: { mention: SlackMention; nowIso: string }): RuleZeroDecision {
  return applyRuleZero({ lastMovedIso: mention.mentionedIso, move: { party: "owner" }, nowIso });
}

/**
 * Turn every unanswered mention into ranker input.
 *
 * A mention whose author is not a person never reaches a row, exactly as in {@link slackLeg} and for a
 * sharper reason: the measured top mentioner is a DLP alert app that tags the owner on every alert it raises, so
 * without this filter the list fills with alerts instead of with people.
 *
 * `finishesInFlight` is FALSE for every row, and unlike the movement leg's `true` that is the literal
 * truth rather than a claim — the owner has not spoken in these threads since being tagged. It is also what puts a mention below a
 * movement row on every tie; see this module's header for what that does and does not mean.
 *
 * `unverified` is true throughout for the same reason {@link slackLeg}'s is: nothing here was read live.
 * The rows carrying a pull-request link are settled by `../cli/commands/sessionStart/verifyRows` before
 * they are scored, which is the whole reason {@link SlackMention.pullRequests} is carried at all.
 *
 * @param mentions every mention the reader established, in any order
 * @param nowIso the run's own instant, supplied rather than read
 * @returns one rank input per mention written by a person, in the order given
 */
export function slackMentionLeg({
  mentions,
  nowIso,
}: {
  mentions: readonly SlackMention[];
  nowIso: string;
}): readonly RankInput[] {
  const inputs: RankInput[] = [];
  for (const mention of mentions) {
    if (!mention.authorIsHuman) {
      continue;
    }
    const item = slackMentionItem({ mention });
    if (item === undefined) {
      continue;
    }
    inputs.push({
      finishesInFlight: false,
      item,
      readings: slackMentionReadings({ mention, nowIso }),
      ruleZero: slackMentionRuleZero({ mention, nowIso }),
      trace: traceBeforeRanking({ evidence: slackMentionEvidence({ mention }) }),
      unverified: true,
    });
  }
  return inputs;
}
