/**
 * FILTERED recovery of dropped tags — the half of "one tag, one turn" that the `--once` close created.
 *
 * The listener already guarantees one response per tag: the dedupe keys on `payload.event_id`, which is
 * stable across Slack's redeliveries, and the frame queue is single-consumer so two tags cannot run at once.
 * What it does not guarantee is that a tag is never LOST — a frame arriving after the connection closed is
 * thrown away, and with no listener running at all a tag is a no-op by design. Both are acceptable. Silence
 * about them is not.
 *
 * ## Filtered, and emphatically not exhaustive
 *
 * The aim is to handle dropped tags, but not all of them: ignore messages to the
 * bot that were already replied to, came in weeks ago, or were not in an appropriate place to respond. So a
 * recovery pass that answered everything it found would be worse than one that answered nothing: it would
 * reply to week-old questions people have long since resolved, in channels the bot has no business in.
 *
 * Every exclusion is a mechanical test rather than a judgement, because a judgement here would need a model
 * and this whole feature exists to keep the model in the visible session:
 *
 *  - **not addressed** — reusing the listener's own rules, never reimplementing them
 *  - **wrong place** — a channel the bot may not answer in (the WHERE gate)
 *  - **already answered** — a real answer's metadata names EXACTLY this candidate
 *  - **answered in thread** — a bot CARD sits inside this candidate's own interval — see below
 *  - **already resolved** — the ask-lifecycle log's current FOLDED state is a genuine resolution
 *    (`triaged-no-response`/`withheld`) a thread read can never observe — see below
 *  - **terminal lifecycle** — the ask-lifecycle log has EVER recorded a terminal event for this exact ask
 *    (any of `answered`/`triaged-no-response`/`withheld`), suppressed even when Slack's own metadata cannot
 *    independently confirm an answer — belt-and-suspenders alongside `already-answered` specifically
 *  - **in flight** — a turn is holding this ask RIGHT NOW (`captured`/`checklist-posted`/`dispatched`)
 *  - **already worked** — it was worked and ended with no answer, and its one re-dispatch is already spent
 *    (`answer-lost` always; `failed`/`dispatch-failed`/`lease-expired` only once `redispatched` is on the
 *    fold — see `./stranded.ts`, and the header section below)
 *  - **too old** — before a cutoff the caller sets
 *  - **deliberately ignored** — `slopweaver turn ignore` was run for this EXACT ask; a candidate `listen
 *    recover` finds is checked against the same registry the listener's own live capture checks
 *
 * ## Thread membership is NOT the discriminator, and this is the trap
 *
 * The obvious test for "did we already answer" is "does a message with our identity appear anywhere in the
 * thread" — by `bot_id` (wrong: the owner's as-me token carries one too, so a thread the owner merely spoke
 * in reads as answered and the tag stays dropped forever) or even by the bot's own user id (still wrong: two
 * asks can share one thread, and a reply to the FIRST would make the SECOND read as answered too). The
 * strongest proof, surviving both traps, is `../slack/messageMetadata.ts`'s exact `(channel, messageTs)`
 * match — a V2 answer's `askIdentity` names precisely which ask it resolved, never "somewhere in this
 * thread". That is `already-answered`, and it is unchanged.
 *
 * ## Every exclusion is REPORTED, and all of them are
 *
 * {@link classifyCandidate} returns every exclusion that applies rather than the first, because the report
 * is the product here. A tag excluded as "too old" that was also "already answered" is a different situation
 * from one that is merely stale, and collapsing them would hide the very thing an operator is checking.
 *
 * ## Two exclusions the thread cannot see: `already-resolved` and `terminal-lifecycle`
 *
 * "Already answered" matches a real POSTED message's own metadata — but a deliberate no-response resolution
 * posts nothing at all (scenario 4's whole point), and a withheld answer is parked in the admit queue, not
 * Slack. Neither would ever satisfy `already-answered`, so without a second check a genuinely-resolved ask
 * would be resurfaced by every future recovery pass forever. `already-resolved` closes that gap by consulting
 * the ask-lifecycle log's current FOLDED state for the terminal states a thread read cannot observe:
 * `triaged-no-response`, `left-for-a-human` and `withheld`. The non-terminal cleanup intents
 * (`triage-cleanup-intended`, `handover-cleanup-intended`) are deliberately NOT among them — see
 * `../ask/lifecycleEvents.ts`'s own doc comments on those events: a sweep or recovery pass is exactly what is
 * supposed to find one still pending.
 *
 * `terminal-lifecycle` is a separate, broader check over the SAME log: it reads whether ANY event — ever,
 * not just the current fold — reached `answered`/`triaged-no-response`/`withheld` for this exact ask, and it
 * overlaps `already-resolved` deliberately for two of those three. It exists for `answered` specifically: a
 * belt-and-suspenders suppression that holds even when Slack's own metadata cannot independently confirm the
 * answer still exists (a deleted reply, an unreadable thread) — the owner's own ruling is that a terminal
 * ledger entry must never be re-flagged as dropped, accepting a false-negative bias over re-litigating a
 * closed ask.
 *
 * ## The ONE exception: a stranded ask, picked up again exactly once
 *
 * `already-worked` is not permanent, and a fresh tag is not the retry path. The owner does not re-tag the bot
 * to get it going, and a stranded ask is picked up again by a session the owner can SEE, never by a daemon, a queue consumer, a restart or a retry. So an
 * ask whose fold is one of the three stranded states and carries no `redispatched` spend record is a
 * SURVIVOR here, exactly like a dropped tag: same whitelist, same capture UX, same three steps. Everything
 * about that lane, including why it is a re-admission rather than a relaunch and where the day-long bound
 * came from, is in `./stranded.ts`. Nothing in this file starts anything; the session running the pass does.
 *
 * ## Recovery is for a tag with NO trace — `in-flight` and `already-worked`
 *
 * The three checks above all ask "is this ask FINISHED". None of them asked the prior question: was it ever
 * captured at all. Recovery exists for a tag the listener never saw, and an ask with a lifecycle entry is by
 * definition one it did see — so re-capturing it is never recovery, it is a second turn on one message.
 *
 * Measured: one `listen recover --scheduled` pass re-captured
 * message `1787720846.032529` while its `fresh-visible-session` worker was alive and mid-answer, and did
 * three separable harms with one capture: it posted a SECOND working card (the worker finalises only its
 * own, so the duplicate freezes forever); it appended `checklist-posted` OVER the `dispatched` event, which
 * took the ask out of `turn dispatch --sweep`'s supervision entirely (fixed on the other side too — see
 * `../ask/lifecycle.ts#AskLifecycle.activeDispatch`); and in the same pass it re-captured
 * `1787720788.183959`, which had `failed` 37 minutes earlier, so a dead ask was queued as a live burst
 * candidate to resurrect whenever the queue next drained.
 *
 * Both new exclusions read the FOLD rather than the message: a burst-dequeued survivor is captured long after
 * its message was sent, so no test on the message's own shape or age can tell the two cases apart. The states
 * deliberately left recoverable are the two cleanup intents — `../ask/lifecycleEvents.ts` says in as many
 * words that a sweep or recovery pass finding one still pending is the point of splitting it from its
 * terminal twin.
 *
 * ## `recoverSlackAsks` — the effectful scan, exported here rather than left private to the CLI
 *
 * The CLI (`cli/commands/listen/recover.ts`) stays responsible only for flags, token selection, loading
 * stores, rendering and exit codes; this is where the actual paginated Slack read + classify orchestration
 * lives, behind a typed `SlackApi` seam so it is testable with a plain fake rather than a live workspace.
 */

import { isRecord } from "../../lib/parsers.js";
import { slackTsToIso } from "../../lib/slackTs.js";
import type { StartedChecklist } from "../ask/checklist.js";
import type { AskIdentity, RecordedAskIdentity } from "../ask/identity.js";
import type { IgnoredAsk } from "../ask/ignore.js";
import type { IgnoredConversation } from "../ask/ignoredConversation.js";
import { type AskLifecycle, askLifecycleKey, type TerminalAskLifecycleEvent } from "../ask/lifecycle.js";
import { type ThreadMark, threadExclusions, threadMarks } from "./answeredInThread.js";
import { looksLikeBotId, type Mention, selfAuthoredCheck, stripMentionTags, taggedIn } from "./mention.js";
import { zeroExclusionCounts } from "./recoverExclusionCounts.js";
import { ignoreExclusions } from "./recoverIgnores.js";
import { lifecycleExclusions } from "./recoverLifecycle.js";
import { answerIdentitiesFromMessages } from "./recoverThreads.js";

/** Which surface a recovery candidate was found on. `group` covers `mpim` — several humans, so not address. */
export type CandidateSurface = "channel" | "dm" | "group";

/** One message that MIGHT have been a dropped tag, with everything the filters need to decide. */
export interface RecoveryCandidate extends AskIdentity {
  /** Which surface — a channel, a 1:1 DM, or a group DM. */
  readonly surface: CandidateSurface;
  /** Who sent it. */
  readonly userId: string;
  /** The message text AS SENT, tags intact — the tag is what "addressed" is decided on. */
  readonly rawText: string;
  /** When it was sent, ISO-8601. */
  readonly tsIso: string;
  /**
   * Every EXACT-quality answer identity found in this thread — never `legacy`, because a legacy record names
   * no `messageTs` and so cannot prove which of several asks sharing this thread it resolved.
   *
   * The whole thread rather than one lookup because that is what the already-answered test needs: a real
   * answer's metadata carries the exact `(channel, messageTs)` it resolved, and the only way to find it is to
   * have read every message that could carry it.
   */
  readonly threadAnswers: readonly RecordedAskIdentity[];
  /**
   * Every row of this candidate's own thread, reduced to `./recoverThreads.ts#ThreadMark` — what
   * {@link answeredInThread} computes this candidate's interval from.
   *
   * REQUIRED rather than optional, and carrying the whole thread rather than a pre-filtered subset: the
   * rows that are not evidence are what close the interval, and a construction site that could omit the
   * field would silently opt itself out of the exclusion. An empty array is the honest value for a
   * candidate built from a history row whose thread was never read.
   */
  readonly threadMarks: readonly ThreadMark[];
  /**
   * Whether THIS INSTALL'S OWN app authored it — determined by `../listen/mention.ts`'s own
   * `selfAuthoredCheck`, reused rather than reimplemented so recovery can never drift from the live parser's
   * self-vs-peer rule. A peer bot or a human is never `selfAuthored`, and reaches the ordinary responder
   * whitelist exactly like the live path now does (see `selfAuthoredCheck`'s own doc for the three cases).
   */
  readonly selfAuthored: boolean;
  /**
   * The capture-time checklist this exact ask's own ask-lifecycle entry carries, when one exists — copied
   * straight onto the recovered {@link Mention} so `briefReplayCommand` can pass `--turn-id`/`--working-ts`
   * for a resumed capture, exactly as a live capture already would.
   */
  readonly started?: StartedChecklist | undefined;
  /**
   * Slack's own `subtype`, when the message carries one — an edit, a deletion, a join, a thread broadcast.
   * Retained (never dropped) so classification can refuse the whole class the same way the LIVE parser
   * does (`../listen/mention.ts`'s own doc: "a person speaking sends a message with NO subtype"), rather
   * than recovery quietly admitting a channel-invite-shaped event the live path would already have refused.
   */
  readonly subtype?: string;
}

/** A non-empty string field of a raw Slack message, or `undefined`. */
function field({ message, key }: { message: Readonly<Record<string, unknown>>; key: string }): string | undefined {
  const value = message[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Slack decimal `ts` (`epochSeconds.micros`) to ISO-8601.
 *
 * @param ts the Slack timestamp, as the API returns it
 * @returns the ISO-8601 instant, or `undefined` when the value will not parse as one
 */
export function tsToIso({ ts }: { ts: string }): string | undefined {
  return slackTsToIso({ ts });
}

/**
 * The two evidence lists ONE thread read yields, always together.
 *
 * Bundled rather than threaded as two parameters because both are derived from the same `rawMessages` at
 * every site — and a site that derived only one of them is exactly how the classifier stayed blind to a
 * whole outbound lane for two days (`./answeredInThread.ts`). A third kind of evidence adds a field here
 * and nothing anywhere else.
 */
export interface ThreadEvidence {
  /** Every EXACT-quality `askIdentity` the thread carries — `already-answered`'s proof. */
  readonly answers: readonly RecordedAskIdentity[];
  /** Every row of the thread, reduced — `answered-in-thread`'s interval. */
  readonly marks: readonly ThreadMark[];
}

/** A candidate built BEFORE its thread has been read. Both lists empty, and the read is what decides them. */
export const UNREAD_THREAD: ThreadEvidence = { answers: [], marks: [] };

/**
 * Both of a thread read's evidence lists, derived from its rows in ONE place.
 *
 * The single derivation point {@link ThreadEvidence} promises: every caller that reads a thread gets both
 * lists or neither, so the shape that caused the re-answer — a site that computed the answer
 * identities and never the marks — cannot be written by accident.
 *
 * @param rawMessages the thread's rows, read with `includeAllMetadata: true`
 * @param selfBotId this install's own `bot_id`, or `undefined` when it is not yet known
 * @returns the evidence every candidate built from this thread carries
 */
export function threadEvidence({
  rawMessages,
  selfBotId,
}: {
  rawMessages: readonly unknown[];
  selfBotId: string | undefined;
}): ThreadEvidence {
  return { answers: answerIdentitiesFromMessages({ rawMessages }), marks: threadMarks({ rawMessages, selfBotId }) };
}

/**
 * Who wrote a history message. `user` is what a human (or the owner's as-me token) carries; a genuine bot
 * delivery — measured directly against the official Claude-in-Slack app — carries only a shape-valid `bot_id`
 * and no `user` at all. The same reading `../listen/mention.ts`'s own `coreFields()` applies, so a peer bot's
 * tag is recoverable exactly the way the live path admits it.
 */
function historyAuthor({ message }: { message: Record<string, unknown> }): string | undefined {
  const rawBotId = field({ key: "bot_id", message });
  const human = field({ key: "user", message });
  if (human === undefined) {
    return rawBotId !== undefined && looksLikeBotId({ value: rawBotId }) ? rawBotId : undefined;
  }
  return human;
}

/**
 * The thread a history message belongs to. Slack omits `thread_ts` on a top-level message, which is its own
 * thread.
 */
function historyThreadTs({ message, messageTs }: { message: Record<string, unknown>; messageTs: string }): string {
  const threadTs = field({ key: "thread_ts", message });
  if (threadTs === undefined) {
    return messageTs;
  }
  return threadTs;
}

/**
 * Read one raw `conversations.history` message into a candidate.
 *
 * Separate from the classifying so the SHAPE question ("is this even a message") never mixes with the
 * POLICY question ("should we answer it"). A message missing `ts` or `user` is not an excluded tag, it is
 * not a tag at all, and returning `undefined` says that without inventing a fifth exclusion reason.
 *
 * @param message the raw message object from `conversations.history`
 * @param channel the channel it came from
 * @param surface which surface that channel is
 * @param evidence what this candidate's thread read yielded — {@link UNREAD_THREAD} before it has been read
 * @param selfBotId this install's own `bot_id` from `auth.test`, or `undefined` when it is not yet known —
 *   threaded straight into `selfAuthoredCheck`, the same self-vs-peer test the live parser uses
 * @returns the candidate, or `undefined` when the message lacks the fields a candidate needs
 */
export function candidateFromMessage({
  message,
  channel,
  surface,
  evidence,
  selfBotId,
}: {
  message: unknown;
  channel: string;
  surface: CandidateSurface;
  evidence: ThreadEvidence;
  selfBotId: string | undefined;
}): RecoveryCandidate | undefined {
  if (!isRecord(message)) {
    return undefined;
  }
  const messageTs = field({ key: "ts", message });
  const userId = historyAuthor({ message });
  if (messageTs === undefined || userId === undefined) {
    return undefined;
  }
  const tsIso = tsToIso({ ts: messageTs });
  if (tsIso === undefined) {
    return undefined;
  }
  const subtype = field({ key: "subtype", message });
  return {
    channel,
    messageTs,
    rawText: typeof message["text"] === "string" ? message["text"] : "",
    // Reused, never reimplemented — the same three-case self-vs-peer test the live parser applies via
    // `selfAuthoredCheck`, so recovery can never drift from what the live path admits.
    selfAuthored: selfAuthoredCheck({ event: message, selfBotId }).refuse,
    surface,
    threadAnswers: evidence.answers,
    threadMarks: evidence.marks,
    threadTs: historyThreadTs({ message, messageTs }),
    tsIso,
    userId,
    ...(subtype === undefined ? {} : { subtype }),
  };
}

/** Why a candidate will not be recovered. */
export type RecoveryExclusion =
  | "not-addressed"
  | "wrong-place"
  | "already-answered"
  | "answered-in-thread"
  | "already-resolved"
  | "terminal-lifecycle"
  | "in-flight"
  | "already-worked"
  | "too-old"
  | "blocked-on-human"
  | "deliberately-ignored"
  | "deliberately-ignored-conversation";

/** A candidate, classified: either a mention to answer, or every reason it is not one. */
export interface RecoveryVerdict {
  /** The candidate this is about. */
  readonly candidate: RecoveryCandidate;
  /** Every exclusion that applies, in the order the tests run. Empty means recoverable. */
  readonly exclusions: readonly RecoveryExclusion[];
  /** A sentence per exclusion, in the same order. */
  readonly why: readonly string[];
  /** The mention to answer, present exactly when `exclusions` is empty. */
  readonly mention?: Mention | undefined;
}

/**
 * Whether this candidate ADDRESSED the bot, by the listener's own rules.
 *
 * The rules are restated as a predicate rather than imported wholesale because the listener's parser reads a
 * Slack EVENT and a recovery candidate comes from conversation history, which has a different shape. What is
 * deliberately not restated is the substance: a channel needs an explicit tag, a 1:1 DM needs the SAME
 * explicit tag (the owner's DM-tag ruling — see `../../../live/listen/mention.ts`'s own header), a group
 * DM is not address, and a message THIS INSTALL'S OWN APP authored is never address — a peer bot or a human
 * reaches the ordinary checks below exactly like the live parser now allows. Those four are the listener's
 * decisions and changing them here would be the drift this comment exists to prevent. The tag test itself IS
 * imported (`taggedIn`), so the two surfaces cannot disagree on what "tags us" means.
 */
function addressed({ botUserId, candidate }: { botUserId: string; candidate: RecoveryCandidate }): boolean {
  if (candidate.selfAuthored || candidate.subtype !== undefined) {
    return false;
  }
  switch (candidate.surface) {
    case "group":
      // Several humans plus the bot. The turn answers with the OWNER's lens, which is safe in a 1:1 and is
      // not safe in front of an audience — the same reason the live listener refuses `mpim`.
      return false;
    case "dm":
    case "channel":
      // One predicate for both surfaces. A recovery sweep that still admitted an untagged
      // DM would re-flag exactly the drafts the live parser now refuses, hours after the fact.
      return taggedIn({ text: candidate.rawText, userId: botUserId });
  }
}

/** Why a candidate failed `addressed` — one sentence, naming the specific reason rather than a generic one. */
function notAddressedReason({ candidate }: { candidate: RecoveryCandidate }): string {
  if (candidate.selfAuthored) {
    return "this install's own app authored it — our own answer must never re-trigger itself";
  }
  if (candidate.subtype !== undefined) {
    return `it carries subtype "${candidate.subtype}" (an edit, join, deletion or broadcast) — never somebody addressing the bot`;
  }
  if (candidate.surface === "group") {
    return "a group DM has an audience, and the turn answers with the owner's lens — not address";
  }
  return candidate.surface === "dm"
    ? "no explicit tag of the bot, and a direct message is only address when it tags"
    : "no explicit tag of the bot, and a channel message is only address when it tags";
}

/**
 * Every exclusion that applies to one candidate, and a sentence per exclusion, in test order.
 *
 * @param candidate the message to classify
 * @param botUserId the bot's own Slack USER id — what "already answered" compares against, never a `bot_id`
 * @param cardEventType the operator's `slackBot.cardChrome.metadataEventType` — what {@link answeredInThread} treats as a bot card
 * @param allowedChannels the channels the bot may answer in; a candidate outside them is `wrong-place`
 * @param ignored the permanent ignore registry, already folded; a candidate it names is `deliberately-ignored`
 * @param ignoredConversations the permanent conversation-ignore registry, already folded; a candidate whose
 *   channel it names is `deliberately-ignored-conversation`
 * @param lifecycles the ask-lifecycle fold, keyed by {@link askLifecycleKey}; a genuinely terminal state this
 *   candidate's own entry names is `already-resolved`
 * @param terminalByAsk every ask that has ever reached a terminal lifecycle event, keyed by
 *   `askLifecycleKey` — a candidate this names is `terminal-lifecycle`, suppressed regardless of whether
 *   Slack's own metadata independently confirms an answer exists
 * @param since the cutoff, ISO-8601; anything sent strictly before it is `too-old`
 * @param strandedLane whether the caller is `./stranded.ts`'s lane rather than the window scan — the only
 *   caller that may exempt a stranded ask from `already-worked`; see `./recoverLifecycle.ts`
 * @returns every exclusion that applies, and a sentence per exclusion, in the same order
 */
function everyExclusion({
  candidate,
  botUserId,
  cardEventType,
  allowedChannels,
  ignored,
  ignoredConversations,
  lifecycles,
  strandedLane = false,
  terminalByAsk,
  since,
}: {
  candidate: RecoveryCandidate;
  botUserId: string;
  cardEventType: string;
  allowedChannels: readonly string[];
  ignored: ReadonlyMap<string, IgnoredAsk>;
  ignoredConversations: ReadonlyMap<string, IgnoredConversation>;
  lifecycles: ReadonlyMap<string, AskLifecycle>;
  strandedLane?: boolean;
  terminalByAsk: ReadonlyMap<string, TerminalAskLifecycleEvent>;
  since: string;
}): { readonly exclusions: readonly RecoveryExclusion[]; readonly why: readonly string[] } {
  const exclusions: RecoveryExclusion[] = [];
  const why: string[] = [];
  if (!addressed({ botUserId, candidate })) {
    exclusions.push("not-addressed");
    why.push(notAddressedReason({ candidate }));
  }
  if (!allowedChannels.includes(candidate.channel)) {
    exclusions.push("wrong-place");
    why.push(`${candidate.channel} is not a channel the bot answers in`);
  }
  const lifecycle = lifecycles.get(askLifecycleKey({ askIdentity: candidate }));
  // The stranded lane, and only it, discounts the one answer the log records as a FIRST answer — a plan whose
  // builder vanished is stranded, not answered. `./answeredInThread.ts`'s `threadExclusions` says why.
  const interimAnswers = strandedLane && lifecycle?.firstAnswer !== undefined ? 1 : 0;
  const fromThread = threadExclusions({ ask: candidate, botUserId, cardEventType, interimAnswers });
  exclusions.push(...fromThread.exclusions);
  why.push(...fromThread.why);
  const fromLog = lifecycleExclusions({
    lifecycle,
    strandedLane,
    terminal: terminalByAsk.get(askLifecycleKey({ askIdentity: candidate })),
  });
  exclusions.push(...fromLog.exclusions);
  why.push(...fromLog.why);
  if (candidate.tsIso < since) {
    exclusions.push("too-old");
    why.push(`sent ${candidate.tsIso}, before the ${since} cutoff`);
  }
  const fromIgnores = ignoreExclusions({ candidate, ignored, ignoredConversations });
  exclusions.push(...fromIgnores.exclusions);
  why.push(...fromIgnores.why);
  return { exclusions, why };
}

/**
 * Classify one candidate against every exclusion.
 *
 * @param candidate the message to classify
 * @param botUserId the bot's own Slack USER id — what "already answered" compares against, never a `bot_id`
 * @param cardEventType the operator's `slackBot.cardChrome.metadataEventType` — what {@link answeredInThread} treats as a bot card
 * @param allowedChannels the channels the bot may answer in; a candidate outside them is `wrong-place`
 * @param ignored the permanent ignore registry, already folded; a candidate it names is `deliberately-ignored`
 * @param ignoredConversations the permanent conversation-ignore registry, already folded
 * @param lifecycles the ask-lifecycle fold, keyed by {@link askLifecycleKey}
 * @param terminalByAsk every ask that has ever reached a terminal lifecycle event, keyed by `askLifecycleKey`
 * @param since the cutoff, ISO-8601; anything sent strictly before it is `too-old`
 * @param strandedLane whether the caller is `./stranded.ts`'s lane; see `./recoverLifecycle.ts`
 * @returns the verdict, carrying every exclusion that applies and the mention when none does
 */
export function classifyCandidate({
  candidate,
  botUserId,
  cardEventType,
  allowedChannels,
  ignored,
  ignoredConversations,
  lifecycles,
  strandedLane = false,
  terminalByAsk,
  since,
}: {
  candidate: RecoveryCandidate;
  botUserId: string;
  cardEventType: string;
  allowedChannels: readonly string[];
  ignored: ReadonlyMap<string, IgnoredAsk>;
  ignoredConversations: ReadonlyMap<string, IgnoredConversation>;
  lifecycles: ReadonlyMap<string, AskLifecycle>;
  strandedLane?: boolean;
  terminalByAsk: ReadonlyMap<string, TerminalAskLifecycleEvent>;
  since: string;
}): RecoveryVerdict {
  const { exclusions, why } = everyExclusion({
    allowedChannels,
    botUserId,
    candidate,
    cardEventType,
    ignored,
    ignoredConversations,
    lifecycles,
    since,
    strandedLane,
    terminalByAsk,
  });
  if (exclusions.length > 0) {
    return { candidate, exclusions, why };
  }
  return {
    candidate,
    exclusions,
    mention: {
      channel: candidate.channel,
      messageTs: candidate.messageTs,
      started: candidate.started,
      // Narrowed rather than cast: `group` cannot reach here (it fails `addressed`), but a cast would assert
      // that instead of establishing it, and the assertion would survive someone making group DMs answerable.
      surface: candidate.surface === "dm" ? "dm" : "channel",
      text: stripMentionTags({ text: candidate.rawText }),
      threadTs: candidate.threadTs,
      userId: candidate.userId,
    },
    why,
  };
}

/** What a whole recovery pass found. */
export interface RecoveryReport {
  /** Every candidate examined, classified, in the order they were supplied. */
  readonly verdicts: readonly RecoveryVerdict[];
  /** The candidates worth answering. */
  readonly recoverable: readonly RecoveryVerdict[];
  /** How many candidates each exclusion accounted for. A candidate with two exclusions counts under both. */
  readonly excludedBy: Readonly<Record<RecoveryExclusion, number>>;
}

/**
 * Classify a whole batch of candidates.
 *
 * @param candidates the messages to examine
 * @param botUserId the bot's own Slack USER id
 * @param allowedChannels the channels the bot may answer in
 * @param ignored the permanent ignore registry, already folded
 * @param ignoredConversations the permanent conversation-ignore registry, already folded
 * @param lifecycles the ask-lifecycle fold, keyed by {@link askLifecycleKey}
 * @param terminalByAsk every ask that has ever reached a terminal lifecycle event, keyed by `askLifecycleKey`
 * @param since the cutoff, ISO-8601
 * @returns the full report — every verdict, the recoverable subset, and the per-exclusion tallies
 */
export function recoveryReport({
  candidates,
  botUserId,
  cardEventType,
  allowedChannels,
  ignored,
  ignoredConversations,
  lifecycles,
  terminalByAsk,
  since,
}: {
  candidates: readonly RecoveryCandidate[];
  botUserId: string;
  cardEventType: string;
  allowedChannels: readonly string[];
  ignored: ReadonlyMap<string, IgnoredAsk>;
  ignoredConversations: ReadonlyMap<string, IgnoredConversation>;
  lifecycles: ReadonlyMap<string, AskLifecycle>;
  terminalByAsk: ReadonlyMap<string, TerminalAskLifecycleEvent>;
  since: string;
}): RecoveryReport {
  const verdicts = candidates.map((candidate) =>
    classifyCandidate({
      allowedChannels,
      botUserId,
      cardEventType,
      candidate,
      ignored,
      ignoredConversations,
      lifecycles,
      since,
      terminalByAsk,
    }),
  );
  const excludedBy = zeroExclusionCounts();
  for (const verdict of verdicts) {
    for (const exclusion of verdict.exclusions) {
      excludedBy[exclusion] += 1;
    }
  }
  return { excludedBy, recoverable: verdicts.filter((verdict) => verdict.exclusions.length === 0), verdicts };
}
