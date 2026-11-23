/**
 * The SECOND outbound lane, and the evidence `recover.ts`'s exact-identity proof cannot see.
 *
 * MEASURED: an old ask was re-answered by the bot multiple times. The owner's own DM thread
 * `D0SYN000001/1789829999.819679` was answered once and corrected once, and a fresh loop's boot recovery pass
 * captured it as a dropped tag 34 hours later and posted a THIRD reply. Both real answers had gone out through the
 * `slopweaver slack post`/`reply` BOT-CARD lane rather than through `turn answer`, so they carry
 * `renderSlackCard`'s own metadata (`../outbound/slack/render.ts`) instead of an `askIdentity`, and they
 * appended no `answered` row — leaving every lifecycle exclusion silent too. A V2-only test could not see
 * either half. Probed on the wire, the four bot replies in that one thread carry four DIFFERENT
 * `metadata.event_type` values, and that is the whole discriminator:
 *
 *  - the operator's `slackBot.cardChrome.metadataEventType` (`../profile.ts`, default
 *    `slopweaver_card_v1`) — a bot CARD, stamped only by `renderSlackCard`. THIS is the evidence.
 *  - `slopweaver_assistant_answer_v2` — an answer naming its ask exactly; `already-answered` above.
 *  - `slopweaver_assistant_answer_v1` — `renderAssistantMessage`, whose own doc says it is a handover
 *    delivery or a turn's held/failure NOTICE and "NEVER an actual answer as of H6". Never evidence.
 *  - the operator's `progressChrome.metadataEventType` (default `slopweaver_progress_v1`) — the capture
 *    checklist. Never evidence.
 *
 * Because the checklist and the failure notice each carry their OWN event type, this exclusion stays silent
 * on a stranded ask's own thread, so the owner's one-re-dispatch ruling (`./stranded.ts`) is
 * untouched and needed no fence. Both traps stay closed: the as-me token is not rendered by `renderSlackCard`
 * at all AND the card must be authored by this install, and two asks sharing a thread are separated by the
 * INTERVAL — evidence for a candidate stops at the first later message that itself ADDRESSES the bot, so a
 * card answering ask A can never be read as answering ask B. See {@link answeredInThread}.
 *
 * It is reported as its own exclusion rather than folded into `already-answered` because the two claims are
 * not equally strong: one names the ask, the other places a card in its interval. An operator reading the
 * report has to be able to tell them apart.
 *
 * What it still cannot see, stated rather than discovered: an answer hand-posted under the owner's OWN
 * identity (`slack post --as me`) carries no slopweaver metadata at all and is indistinguishable from the owner
 * simply talking. The durable fix for that is upstream — a hand-composed answer should append its own
 * `answered` row — and it is not this module's to make.
 *
 *
 * Its own module because the whole concern is one seam: read a thread into {@link ThreadMark}s, then ask
 * whether this install already carded an answer inside one candidate's own stretch of it. `recover.ts`
 * keeps the exclusion vocabulary and the report; nothing here knows either.
 */
import { isRecord } from "#lib/parsers.js";

import type { AskIdentity, RecordedAskIdentity } from "../ask/identity.js";
import { looksLikeBotId, type SelfAuthoredReason, selfAuthoredCheck, taggedIn } from "./mention.js";

/**
 * One thread row, reduced to the five facts `{@link answeredInThread}` decides an ask's own interval
 * from — who spoke, when, whether it tags the bot, and which renderer stamped it.
 *
 * `metadataEventType` is the load-bearing one and it is carried RAW rather than classified here: which
 * event type means "a bot card" is the OPERATOR's own `slackBot.cardChrome.metadataEventType`
 * (`../profile.ts`), so the comparison belongs where that value is threaded in, not in a pure shaper
 * that would have to be handed it twice.
 */
export interface ThreadMark {
  /** The row's own Slack `ts`. */
  readonly ts: string;
  /** `user`, or a shape-valid `bot_id` when a genuine bot delivery carries no `user` — or neither. */
  readonly userId: string | undefined;
  /** The text AS SENT, tags intact, so the same `taggedIn` test the live parser uses can read it. */
  readonly text: string;
  /** Whether Slack gave it a `subtype` — an edit, a join, a deletion, a broadcast. */
  readonly hasSubtype: boolean;
  /**
   * Why `./mention.ts#selfAuthoredCheck` refused this row as bot-authored, or `undefined` when it did not
   * refuse it at all. The REASON rather than a boolean, because the two questions asked of it want
   * different answers: closing an ask's interval needs "somebody other than the bot spoke", which is any
   * non-refusal, while calling a row EVIDENCE needs "this install's own `bot_id` was on it", which is only
   * `confirmed-match`. Collapsed to one boolean, an install whose `auth.test` never resolved would treat
   * every bot's card as its own, since `selfAuthoredCheck` refuses all of them under
   * `unknown-self-identity` — and the header's belt-and-braces authorship claim would be vacuous exactly
   * when it is most needed.
   */
  readonly selfAuthoredReason: SelfAuthoredReason | undefined;
  /** `metadata.event_type`, verbatim, when the row carries metadata at all. */
  readonly metadataEventType: string | undefined;
}

/**
 * Reduce a page of raw thread rows to {@link ThreadMark}s, in the rows' own order.
 *
 * Pure, and deliberately keeping every row rather than filtering here: the interval
 * `{@link answeredInThread}` computes needs the rows that are NOT evidence just as much as the ones that
 * are, because the first later ADDRESS of the bot is what closes the interval.
 *
 * @param rawMessages the raw rows to scan (a fully-read or incrementally-read thread)
 * @param selfBotId this install's own `bot_id` from `auth.test`, or `undefined` when it is not yet known
 * @returns one mark per well-formed row carrying a `ts`, in the rows' own order
 */
export function threadMarks({
  rawMessages,
  selfBotId,
}: {
  rawMessages: readonly unknown[];
  selfBotId: string | undefined;
}): readonly ThreadMark[] {
  const marks: ThreadMark[] = [];
  for (const message of rawMessages) {
    if (!isRecord(message)) {
      continue;
    }
    const ts = message["ts"];
    if (typeof ts !== "string" || ts.length === 0) {
      continue;
    }
    const metadata = message["metadata"];
    const eventType = isRecord(metadata) ? metadata["event_type"] : undefined;
    marks.push({
      hasSubtype: typeof message["subtype"] === "string",
      metadataEventType: typeof eventType === "string" ? eventType : undefined,
      selfAuthoredReason: refusalReason({ message, selfBotId }),
      text: typeof message["text"] === "string" ? message["text"] : "",
      ts,
      userId: threadMarkUserId({ message }),
    });
  }
  return marks;
}

/**
 * Why `selfAuthoredCheck` refused a row, flattened to `undefined` when it did not refuse it.
 *
 * A one-line adapter rather than an inline call because the check's own return is a discriminated union and
 * only the reason half is carried on a {@link ThreadMark}; keeping the narrowing here means neither caller
 * of the mark has to know that shape.
 *
 * @param message the raw row, passed through as the check's `event`
 * @param selfBotId this install's own `bot_id`, or `undefined` when `auth.test` never resolved it
 * @returns the refusal reason, or `undefined` when the row was not refused
 */
function refusalReason({
  message,
  selfBotId,
}: {
  message: Readonly<Record<string, unknown>>;
  selfBotId: string | undefined;
}): SelfAuthoredReason | undefined {
  const check = selfAuthoredCheck({ event: message, selfBotId });
  if (check.refuse) {
    return check.reason;
  }
  return undefined;
}

/**
 * A row's author id, by the SAME rule `recover.ts#candidateFromMessage` applies — `user` first, then a
 * `bot_id` only when it is shape-valid, because an unvalidated `bot_id` can carry anything a poster typed.
 *
 * @param message the raw row
 * @returns the author id, or `undefined` when the row carries neither
 */
function threadMarkUserId({ message }: { message: Readonly<Record<string, unknown>> }): string | undefined {
  const user = message["user"];
  if (typeof user === "string" && user.length > 0) {
    return user;
  }
  const botId = message["bot_id"];
  if (typeof botId === "string" && looksLikeBotId({ value: botId })) {
    return botId;
  }
  return undefined;
}

/**
 * The bot CARD this candidate's own interval carries, or `undefined` when it carries none — the weaker
 * half of "did we already answer", and this module's header carries the measured incident it exists for.
 *
 * The interval is `(candidate.messageTs, nextAddress)`, both exclusive: strictly after this candidate's own
 * message, and strictly before the first later row that itself ADDRESSES the bot. That upper bound is the
 * whole answer to "two asks can share one thread" — a card answering the earlier ask sits before the later
 * ask's own `ts`, so it is outside the later ask's interval by construction, and never the other way round.
 *
 * A row inside the interval is evidence only when all three hold: it is a card by the operator's own
 * `cardEventType`, `selfAuthoredCheck` CONFIRMED this install's own `bot_id` on it, and it carries no
 * `subtype`. That excludes the capture
 * checklist and the failure notice by their own event types, the poll by `pollEventType`, and the stranded
 * lane's re-dispatch line by its notice type (`../../outbound/slack/noticeMetadata.ts`). Authorship is
 * belt-and-braces — the owner's as-me lane is not rendered by `renderSlackCard` at all, so the event type
 * alone already excludes it — and it is a CONFIRMED match rather than a bare "was refused as bot-authored",
 * because the latter is true of every bot on earth once `auth.test` has not resolved this install's own id.
 * That closes an operator pointing two installs at one chrome, and closes it on the unknown-identity path
 * too, which the boolean it replaced did not. See {@link ThreadMark.selfAuthoredReason}.
 *
 * **The card lane cannot tell an answer from anything else it sends, and that is the residue this test
 * accepts.** `renderSlackCard` (`../../outbound/slack/render.ts`) stamps `cardEventType` on EVERY card
 * `slopweaver slack post`/`reply` renders, so a non-answer card dropped into a thread that holds an
 * unanswered ask — a nudge, a link, a heads-up — reads here exactly like an answer, and that ask stops
 * being recovered. Found by the r1 review pass on this change, and kept rather than fenced for two
 * reasons: the cost is bounded (the LIVE listener is untouched, so a fresh tag still wakes a session, and
 * the new ask's interval starts after the card), and it is reported as its own exclusion with the card's
 * `ts` in the sentence, so an operator reading the report can see exactly which row caused it. The durable
 * fix is upstream and is not this module's to make — the card lane should take the ask it is answering and
 * append its own `answered` row, at which point this test keys on that row instead of on an event type
 * shared by everything the lane sends.
 *
 * `Number` rather than string comparison on `ts`: Slack's decimal timestamps are same-width in practice but
 * nothing guarantees the seconds part stays ten digits, and a numeric compare is right either way.
 *
 * @param botUserId the bot's own Slack USER id — what a later row has to tag to close the interval
 * @param marks every row of the candidate's thread, in the rows' own order
 * @param messageTs the candidate's own Slack `ts` — the lower bound of the interval
 * @param cardEventType the operator's `slackBot.cardChrome.metadataEventType`
 * @returns the sentence for the exclusion, or `undefined` when this candidate's interval carries no card
 */
export function answeredInThread({
  botUserId,
  cardEventType,
  marks,
  messageTs,
}: {
  botUserId: string;
  cardEventType: string;
  marks: readonly ThreadMark[];
  messageTs: string;
}): string | undefined {
  const own = Number(messageTs);
  let upperBound = Number.POSITIVE_INFINITY;
  for (const mark of marks) {
    const at = Number(mark.ts);
    const addressesBot =
      mark.selfAuthoredReason === undefined &&
      !mark.hasSubtype &&
      mark.userId !== botUserId &&
      taggedIn({ text: mark.text, userId: botUserId });
    if (at > own && addressesBot && at < upperBound) {
      upperBound = at;
    }
  }
  for (const mark of marks) {
    const at = Number(mark.ts);
    const isOwnCard =
      mark.metadataEventType === cardEventType && mark.selfAuthoredReason === "confirmed-match" && !mark.hasSubtype;
    if (at > own && at < upperBound && isOwnCard) {
      return (
        `this install already posted a bot card at ${mark.ts} inside this ask's own stretch of the thread — ` +
        "a card composed through `slopweaver slack post`/`reply` rather than `turn answer`, so it carries no " +
        "askIdentity and wrote no `answered` row, but it is an answer to this ask and re-answering is what " +
        "a repeated answer is the failure this exclusion exists to prevent"
      );
    }
  }
  return undefined;
}

/**
 * Whether a recorded answer identity names EXACTLY this ask — `quality: "thread-only"` never matches, because a
 * thread-only record carries no `messageTs` and so cannot prove which of several asks sharing a thread it
 * resolved. See `../slack/messageMetadata.ts` for where a `RecordedAskIdentity` is read off real metadata.
 *
 * @param ask the ask being classified
 * @returns whether the record resolves this exact ask
 */
function matchesExactly({ ask, identity }: { ask: AskIdentity; identity: RecordedAskIdentity }): boolean {
  return identity.quality === "exact" && identity.channel === ask.channel && identity.messageTs === ask.messageTs;
}

/**
 * The two exclusions decided by the thread's OWN contents, in descending strength.
 *
 * Here rather than in `./recover.ts` because they read a different witness from the lifecycle exclusions:
 * these two ask what Slack still SHOWS, the lifecycle ones ask what this install wrote DOWN. This module's
 * header is the measured incident where only one witness was consulted and the other was silent.
 *
 * **`interimAnswers` is how many exact answers in the thread are known to be FIRST answers** — a plan posted
 * with follow-through still owed (`../ask/lifecycleEvents.ts`'s `FirstAnsweredEvent`). That post carries the
 * same answer metadata as a final one, because it IS an answer, so without this count a builder that vanished
 * after its plan would read as answered and the stranded lane would never pick it up. `already-answered`
 * fires only when the thread holds MORE exact answers than that: a plan plus a final answer still excludes.
 * Zero by default, so every caller but the stranded lane reads exactly as before.
 *
 * @param ask the ask being classified, carrying its own thread's answers and marks
 * @param botUserId the bot's own Slack USER id
 * @param cardEventType the operator's `slackBot.cardChrome.metadataEventType`
 * @param interimAnswers exact answers the lifecycle log records as first answers, discounted from the count
 * @returns every thread-evidence exclusion that applies, each with its sentence
 */
export function threadExclusions({
  ask,
  botUserId,
  cardEventType,
  interimAnswers = 0,
}: {
  ask: AskIdentity & {
    readonly threadAnswers: readonly RecordedAskIdentity[];
    readonly threadMarks: readonly ThreadMark[];
  };
  botUserId: string;
  cardEventType: string;
  interimAnswers?: number;
}): { exclusions: ("already-answered" | "answered-in-thread")[]; why: string[] } {
  const exclusions: ("already-answered" | "answered-in-thread")[] = [];
  const why: string[] = [];
  const exactAnswers = ask.threadAnswers.filter((identity) => matchesExactly({ ask, identity })).length;
  if (exactAnswers > interimAnswers) {
    exclusions.push("already-answered");
    why.push(`a real answer's metadata names exactly this ask (${ask.channel}, ${ask.messageTs})`);
  }
  const card = answeredInThread({ botUserId, cardEventType, marks: ask.threadMarks, messageTs: ask.messageTs });
  if (card !== undefined) {
    exclusions.push("answered-in-thread");
    why.push(card);
  }
  return { exclusions, why };
}
