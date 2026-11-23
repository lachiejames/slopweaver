/**
 * Whether the thread moved since the point this answer read up to — checked live, right before `turn answer`
 * actually posts, never trusted from whatever the thread looked like when the turn began composing.
 *
 * Threads move fast, and a genuinely correct answer composed a few minutes ago can be stale or out of
 * context by the time it is about to post: someone answered the question themselves, the ask was withdrawn,
 * or new context landed that the reply should have accounted for. Re-reading is also what lets a reply land
 * in the OWNER's voice sound like it is actually part of the conversation, rather than a card that ignores
 * what just happened above it.
 *
 * This module is pure: given the thread's raw messages (already fetched) and a boundary `ts`, it decides
 * which later messages are NEW, real conversation, and {@link threadDeltaDecision} decides what the door
 * does about them — never a Slack call, never a clock.
 *
 * ## A moved thread is a NOTE, not a round — the measured failure
 *
 * Ask `C0SYN000002/1789433376.265259`: a release-incident thread moving at about one human
 * message a minute took FIVE review rounds and 156 minutes, and the owner had to answer a
 * colleague in public with _"Not sure how long until a final answer comes out lol"_. Two mechanisms fed it,
 * and this module owns the second.
 *
 * The check used to run with the ADDRESSING message as its boundary, so on a two-and-a-half-hour thread it
 * reported every non-bot reply since the ask, forever, whether or not anything had landed since the answer
 * read it. Its only escape was `accountedForTs` — a list the caller had to retype with every message it had
 * read, refusing on one omission. That is what refused a send and bought round 5, at a moment
 * when nothing new had landed since the answer's own re-read and the thread's tail was older still.
 *
 * So the boundary is now the point the ANSWER read up to, and a delta that contradicts nothing yields one
 * composed line rather than a refusal. Only a message somebody has read and judged to touch a claim the
 * answer makes can still cost a round. The judgement stays with a model because no code can decide "touches
 * a named claim" without inventing a heuristic; what moved into code is the delta, the wording, and the fact
 * that the default path costs no round at all.
 *
 * ## `accountedForTs` — excluding a message this turn ALREADY knows about
 *
 * A compound owner instruction ("add X to the whitelist, then answer their question above") deliberately
 * answers an OLDER message than the one that authorised it — the owner's own instruction is necessarily a
 * later message in the same thread. Without an exception, that instruction message would itself trip this
 * exact check, refusing the very answer it authorised. `accountedForTs` excludes specific, already-known
 * message timestamps from the "fresh" set — never a blanket exemption, never anything guessed: a genuinely
 * new, unrelated message still correctly refuses.
 */
import { compareStrings } from "../../lib/compare.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { slackTsToIso } from "../../lib/slackTs.js";
import { type ThreadBoundaryError, ThreadBoundaryErrors } from "./threadBoundaryErrors.js";

/** One message that landed in the thread after the addressing message, and was not the bot's own. */
export interface FreshThreadMessage {
  readonly ts: string;
  readonly userId?: string;
}

/** A raw message's own `ts`, whether an app authored it, and its `user`, read defensively. */
function messageFacts({
  message,
}: {
  message: unknown;
}): { readonly ts: string; readonly userId?: string; readonly botAuthored: boolean } | undefined {
  if (!isRecord(message) || typeof message["ts"] !== "string") {
    return undefined;
  }
  const userId = message["user"];
  // `bot_id` OR `app_id`: the same two fields `../listen/recover.ts`'s own `candidateFromMessage` checks,
  // for the same reason — some bot deliveries carry only the second.
  const botAuthored = message["bot_id"] !== undefined || message["app_id"] !== undefined;
  return { botAuthored, ts: message["ts"], ...(typeof userId === "string" ? { userId } : {}) };
}

/**
 * Every message in a thread that landed strictly after `sinceTs` and was not authored by an app — the
 * "did anything new happen since this turn started composing" check.
 *
 * @param rawMessages the thread's raw messages, already fetched, in any order
 * @param sinceTs the point the answer read up to, or the addressing message when it named none — the
 *   boundary "new" is measured against
 * @param accountedForTs specific message timestamps to exclude even though they land after `sinceTs` —
 *   see this module's own header for why; defaults to none, so ordinary callers are unaffected
 * @returns every later, non-bot, non-accounted-for message, sorted oldest first
 */
export function newNonBotMessagesSince({
  rawMessages,
  sinceTs,
  accountedForTs = [],
}: {
  rawMessages: readonly unknown[];
  sinceTs: string;
  accountedForTs?: readonly string[];
}): readonly FreshThreadMessage[] {
  const accounted = new Set(accountedForTs);
  const fresh: FreshThreadMessage[] = [];
  for (const message of rawMessages) {
    const facts = messageFacts({ message });
    if (facts === undefined || facts.botAuthored || facts.ts <= sinceTs || accounted.has(facts.ts)) {
      continue;
    }
    fresh.push({ ts: facts.ts, ...(facts.userId === undefined ? {} : { userId: facts.userId }) });
  }
  return fresh.toSorted((left, right) => compareStrings({ a: left.ts, b: right.ts }));
}

/**
 * The instant a freshness note names, as the thread's own readers write one: an hour and minute with a trailing `Z`.
 *
 * Sliced out of an ISO instant rather than computed, so no epoch is ever scaled into a `Date` here — the
 * `epoch-arithmetic` gate's criterion, and the reason `../../lib/slackTs.ts` exists at all.
 *
 * @param iso the instant to render, ISO-8601
 * @returns the hour and minute with a trailing `Z`
 */
function hourMinuteZulu({ iso }: { iso: string }): string {
  return `${iso.slice(11, 16)}Z`;
}

/**
 * What the door does about a thread that moved between the answer's own read and this send.
 *
 * Three arms rather than a boolean, because the measured failure was exactly the collapse of the middle one
 * into the third: a thread that had moved but contradicted nothing was refused, and the refusal cost a full
 * review round at 14-21 minutes a piece on a thread producing a message a minute.
 */
export type ThreadDeltaDecision =
  /** Nothing landed since the answer read the thread. Post it unchanged. */
  | { readonly kind: "post" }
  /** The thread moved and the author cleared it. Post, carrying one line that says how far behind it is. */
  | { readonly kind: "note"; readonly line: string; readonly since: readonly FreshThreadMessage[] }
  /** The thread moved and nobody has looked. Refuse, and name every message that has to be read. */
  | { readonly kind: "reconsider"; readonly lines: readonly string[]; readonly since: readonly FreshThreadMessage[] };

/**
 * The exact freshness note a posted answer carries when the thread moved under it.
 *
 * Composed HERE, by code, rather than by whatever session is sending: an author that words its own staleness
 * disclaimer words it differently every time, and one that is having a bad turn omits it. Lowercase and free
 * of dashes on purpose — it rides inside a card whose voice rules a reviewer classifies, and a note that
 * trips them would cost the round it exists to save.
 *
 * It NAMES the boundary it read through, not just the count, and it is written even when the count is ZERO.
 * That is what makes it checkable by the people in the room: a read-through is a claim no code can verify, so
 * somebody whose message sits below a boundary this answer claims to have passed can see that and say so.
 *
 * @param nowIso the instant the send is happening, which is what the reader is being told the answer predates
 * @param count how many messages landed since, which may be zero
 * @param readThroughIso the instant the answer claims to have read through
 * @returns the single note line
 */
function freshnessNoteLine({
  nowIso,
  count,
  readThroughIso,
}: {
  nowIso: string;
  count: number;
  readThroughIso: string;
}): string {
  const read = `i read this thread through ${hourMinuteZulu({ iso: readThroughIso })}`;
  if (count === 0) {
    return `${read}, and as of ${hourMinuteZulu({ iso: nowIso })} nothing has landed in here since.`;
  }
  const plural = count === 1 ? "message" : "messages";
  return `${read}. as of ${hourMinuteZulu({ iso: nowIso })}, ${String(count)} ${plural} landed in here since, and none of them touched anything i claim above.`;
}

/**
 * The lines a refusal prints when the thread moved and nothing has judged the new messages yet.
 *
 * Both routes are named, which is the half the measured failure was missing: the old refusal said only
 * "re-read the thread and reconsider", and a worker with no second route re-read, rewrote and opened another
 * review round for a tail that contradicted nothing.
 */
function reconsiderLines({ since }: { since: readonly FreshThreadMessage[] }): readonly string[] {
  return [
    `the thread moved since this answer read it — ${String(since.length)} new message(s):`,
    ...since.map((message) => {
      const from = message.userId === undefined ? "" : ` from ${message.userId}`;
      return `  ${message.ts}${from}`;
    }),
    "read every one of them, then take ONE of these two routes:",
    "  none of them touches a claim this answer makes — pass --delta-cleared and it posts with a freshness note, costing no review round",
    "  one of them contradicts or pre-empts a claim this answer makes — fix that claim and re-open review NARROWED to it",
  ];
}

/**
 * What to do about the messages that landed between the answer's own read and this send.
 *
 * Pure, and the whole point of the split: the door computes the delta, and only a message somebody has read
 * and judged to touch a named claim can cost a review round. A moved thread that contradicts nothing is a
 * note, never a round.
 *
 * **A claimed read-through ALWAYS rides on the answer, empty delta or not.** That is the arm this function
 * got wrong first time round: the over-claim that skips the MOST is the one that empties the delta, so
 * returning a silent `post` there left the widest possible widening with the least possible trace. No code
 * can check what a caller really read, so the answer says what it claims to have read and lets the person
 * whose message sits below that instant be the check.
 *
 * With no read-through, an empty delta posts silently and an uncleared one refuses, as before this existed.
 * **A cleared one posts with the note, naming the boundary the door actually measured from** — the
 * addressing message. The refusal offers `--delta-cleared` on its own, and this arm
 * must not ignore it whenever no `--read-through` rides beside it: a worker on ask
 * `C0SYN000002/1792730584.340449` once passed the flag the refusal named, got the identical refusal back
 * twice, and posted only by retyping every ts into `--accounted-for-ts`. A route a refusal
 * names has to be one this function takes.
 *
 * @param since the messages that landed after the boundary, oldest first
 * @param cleared whether the author states it read every one of them and none touches a claim it makes
 * @param nowIso the instant of this send, which the note names
 * @param boundaryIso the instant the delta was measured from — the read-through when one was named, else the
 *   addressing message — which a cleared delta's note names when no read-through was claimed
 * @param readThroughIso the instant the answer claims to have read through, which the note also names so the
 *   claim is checkable by the people in the thread; absent when the caller named no read-through
 * @returns which of the three things the door does
 */
export function threadDeltaDecision({
  since,
  cleared,
  nowIso,
  boundaryIso,
  readThroughIso,
}: {
  since: readonly FreshThreadMessage[];
  cleared: boolean;
  nowIso: string;
  boundaryIso: string;
  readThroughIso: string | undefined;
}): ThreadDeltaDecision {
  if (readThroughIso === undefined) {
    if (since.length === 0) {
      return { kind: "post" };
    }
    if (cleared) {
      return {
        kind: "note",
        line: freshnessNoteLine({ count: since.length, nowIso, readThroughIso: boundaryIso }),
        since,
      };
    }
    return { kind: "reconsider", lines: reconsiderLines({ since }), since };
  }
  if (since.length === 0 || cleared) {
    return { kind: "note", line: freshnessNoteLine({ count: since.length, nowIso, readThroughIso }), since };
  }
  return { kind: "reconsider", lines: reconsiderLines({ since }), since };
}

/**
 * What a send-time delta does to the answer about to be posted: the line to carry, or the lines to refuse
 * with. Exactly one of the two is ever present.
 */
export interface ThreadDeltaEffect {
  /** The freshness note to prepend to the answer's fold, absent when there is nothing to say. */
  readonly note: string | undefined;
  /** The refusal lines, absent when the send proceeds. */
  readonly refusal: readonly string[] | undefined;
}

/**
 * The decision, as the two things a caller actually does with it.
 *
 * Its own function so the property that matters is assertable without a Slack transport anywhere near it:
 * **only `reconsider` refuses**. A moved thread somebody has read and cleared costs no round, which is the
 * whole claim of the fix, and a test that could not fail on it would be decorative.
 *
 * @param decision what {@link threadDeltaDecision} returned
 * @returns the note to carry and the refusal to print, at most one of them present
 */
export function threadDeltaEffect({ decision }: { decision: ThreadDeltaDecision }): ThreadDeltaEffect {
  switch (decision.kind) {
    case "post":
      return { note: undefined, refusal: undefined };
    case "note":
      return { note: decision.line, refusal: undefined };
    case "reconsider":
      return { note: undefined, refusal: decision.lines };
  }
}

/**
 * The newest NON-BOT `ts` in a thread — the ceiling a caller's claimed read may not have passed.
 *
 * Non-bot, and that is the whole point of the filter rather than a detail. The bot's own progress card is
 * usually the thread's tail, so a ceiling that counted it would let a claimed read sit ABOVE every human
 * message in the thread and silence all of them at once. Measured against the ask this module's header names:
 * the bot's card sat above an earlier human version-mismatch message, which is exactly the
 * message an answer must not skip.
 *
 * @param rawMessages the thread as the door just fetched it
 * @returns the greatest non-bot `ts` present, or `undefined` when the thread holds no readable human message
 */
export function newestTsOf({ rawMessages }: { rawMessages: readonly unknown[] }): string | undefined {
  const timestamps = rawMessages.flatMap((message) => {
    const facts = messageFacts({ message });
    return facts === undefined || facts.botAuthored ? [] : [facts.ts];
  });
  return timestamps.toSorted((left, right) => compareStrings({ a: left, b: right })).at(-1);
}

/**
 * Where the send-time delta is measured from, having refused a claimed read that cannot be true.
 *
 * Two refusals. A read-through at or before the addressing message would WIDEN the window rather than narrow
 * it, so a caller passing one is confused and is told so. A read-through past the thread's newest HUMAN
 * message claims a read that could not have been taken. Naming an EARLIER ts than was really read is
 * deliberately allowed: it makes the check stricter, never looser.
 *
 * ## What this does NOT close, stated rather than discovered
 *
 * A read-through is a CLAIM, and no code can check what a caller actually read. A caller that names a ts
 * later than it truly reached — but still inside the thread — silences every human message below it, and
 * these bounds do not catch that. `accountedForTs` has the same trust in it; the difference is granularity,
 * because one read-through covers a range where a list covers one message each.
 *
 * Two things bound it rather than one check pretending to. The ceiling is the newest HUMAN message
 * ({@link newestTsOf}), so the bot's own card can never be used to claim a read above the whole thread. And
 * {@link threadDeltaDecision} writes the note for EVERY claimed read-through, empty delta included, so a
 * person whose message was skipped reads an answer claiming to have read past them and can say so — the
 * over-claim is visible in the room it was made in, which is the same "findable afterwards" standard
 * `.claude/rules/journalled-grants.md` settles for.
 *
 * @param addressedTs the addressing message's own `ts`, which is the boundary when no read is claimed
 * @param newestTs the newest `ts` the door just read out of the thread
 * @param readThrough the caller's claimed read, absent when it named none
 * @returns the boundary to measure the delta from, or the typed refusal of the claimed one
 */
export function deltaBoundary({
  addressedTs,
  newestTs,
  readThrough,
}: {
  addressedTs: string;
  newestTs: string | undefined;
  readThrough: string | undefined;
}): Result<string, ThreadBoundaryError> {
  if (readThrough === undefined) {
    return ok(addressedTs);
  }
  if (readThrough <= addressedTs) {
    return err(ThreadBoundaryErrors.beforeAsk({ addressedTs, given: readThrough }));
  }
  if (newestTs !== undefined && readThrough > newestTs) {
    return err(ThreadBoundaryErrors.afterThread({ given: readThrough, newestTs }));
  }
  return ok(readThrough);
}

/**
 * The whole delta judgement over a thread already read: boundary, new messages, decision. Pure, and the ONE
 * composition both callers run — `turn answer` before the send and `turn review` before round 1 — so the two
 * moments cannot disagree about what "moved" means.
 *
 * @param accountedForTs later messages this answer already accounts for (the send's compound-instruction
 *   case); round-1 open passes none
 * @param addressedTs the addressing message's own `ts`
 * @param cleared whether the author states it read every new message and none touches a claim it makes
 * @param nowIso the instant of this check, which a note names
 * @param rawMessages the thread as just read
 * @param readThrough the caller's claimed read, absent when it named none
 * @returns the decision, or the typed refusal of an impossible claimed read
 */
export function threadDeltaFromMessages({
  accountedForTs = [],
  addressedTs,
  cleared,
  nowIso,
  rawMessages,
  readThrough,
}: {
  accountedForTs?: readonly string[];
  addressedTs: string;
  cleared: boolean;
  nowIso: string;
  rawMessages: readonly unknown[];
  readThrough: string | undefined;
}): Result<ThreadDeltaDecision, ThreadBoundaryError> {
  const boundary = deltaBoundary({ addressedTs, newestTs: newestTsOf({ rawMessages }), readThrough });
  if (boundary.isErr()) {
    return err(boundary.error);
  }
  // The note a cleared delta carries names this instant, so a boundary that is no Slack ts is refused here
  // rather than rendered as a note naming nothing.
  const boundaryIso = slackTsToIso({ ts: boundary.value });
  if (boundaryIso === undefined) {
    return err(ThreadBoundaryErrors.notATimestamp({ given: boundary.value }));
  }
  const since = newNonBotMessagesSince({ accountedForTs, rawMessages, sinceTs: boundary.value });
  return ok(
    threadDeltaDecision({
      boundaryIso,
      cleared,
      nowIso,
      readThroughIso: readThrough === undefined ? undefined : slackTsToIso({ ts: readThrough }),
      since,
    }),
  );
}
