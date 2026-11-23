/**
 * The turn the voice owes after speaking last: its own module so `voiceActivity.ts` stays under the line cap. The fold
 * there carries the fields this reads; the orb shows the nudge on them.
 *
 * The owner says "Yes, that's the one, thanks", the voice says "Good, yeah, that's clear." and stops: the
 * page showed "listening" with nothing to press for 236.9s, because the fold's `unanswered` counted any speech after
 * the owner's words as their answer. Repro: the final `segment` lines of a call in
 * `$SLOPWEAVER_HOME/talk/calls/<call-id>-*.jsonl` that carry no `nudge` or `resume` line after the voice's last final.
 */

import { micAudible } from "./micAudible";
import type { PlanWork } from "./voicePlanWork";
import { CUT_IN_MS, type TurnTaking } from "./voiceTurnTaking";

/**
 * Whether a finished turn promised work, and how ({@link voicePromiseOf}): `whole-turn` when the turn was nothing but
 * the promise — a hand-off's "let me check" — and `terminal` when it said an answer and then closed on one.
 */
export type VoicePromise = false | "whole-turn" | "terminal";

/**
 * The voice's last finished turn: when it ended, whether it put a question to the owner, and whether it promised work
 * ({@link voicePromiseOf}).
 */
export interface VoiceFinal {
  readonly atMs: number;
  readonly asked: boolean;
  readonly promised: VoicePromise;
}

/** What the orb says while the voice owes the turn ({@link voiceOwesTurn}). */
export const OWED_WORDS = "the voice spoke last and asked you nothing";

/**
 * How long a promise of work the voice made goes unkept before the page presses the nudge itself ({@link promiseDueOf}):
 * the 10s the resume used before it shortened (`RESUME_MS`, `./voiceActivity.ts`), kept apart so
 * tuning one never moves the other. Below the 12s offer of the owner's own nudge. A judgement, unmeasured.
 */
export const PROMISE_MS = 10_000;

/** A turn of the voice's that ends on a question, closing quotes or brackets after it allowed. */
const QUESTION_END = /\?["'”’)\]]*\s*$/u;

/** A last sentence that opens the way a question does, for a transcript that dropped its "?". */
const QUESTION_OPEN =
  /(?:^|[.!;:]\s+)(?:am|are|aren't|can|can't|could|couldn't|did|didn't|do|does|doesn't|don't|has|hasn't|have|haven't|how|is|isn't|may|might|must|shall|should|shouldn't|want|was|wasn't|were|what|when|where|which|who|whom|whose|why|will|won't|would|wouldn't|any|anything|sound|sounds)\b[^.!;:]*$/iu;

/**
 * Whether a finished turn of the voice's put a question to the owner: it ends on a "?", or its last sentence opens the
 * way a question does, since a transcript can drop the "?" — "Would you like me to continue" asks the owner and leaves
 * the turn theirs, never the voice's.
 *
 * @param text the voice's final transcript for the turn
 * @returns true when the turn asked the owner something
 */
export function voiceAsked({ text }: { text: string }): boolean {
  const trimmed = text.trim();
  return QUESTION_END.test(trimmed) || QUESTION_OPEN.test(trimmed);
}

/** An acknowledgement the voice opens a promise with: "Sure, one sec.", "Got it, one moment.". */
const ACK_WORD = String.raw`(?:okay|ok|sure|right|alright|yep|yeah|yes|got it|cool|great|mm-hm)`;
const ACK = String.raw`${ACK_WORD}[,!]?\s+`;

/** A sentence that only acknowledges: "Right.", "Okay, sure.". */
const ACK_ONLY = new RegExp(String.raw`^(?:${ACK_WORD}[,!]?\s*)+$`, "iu");

/** Quotes and brackets around a sentence, which say nothing about what it is. */
const WRAPPING = /^["'“‘([]+|["'”’)\]]+$/gu;

/** One word of a transcript, a channel or handle included. */
const WORD = String.raw`[\p{L}\p{N}'’#@/_-]+`;

/**
 * The closed words a promise's object is built from — "those", "which … you …", "the rest of it" — spelled as a regex
 * literal's source because the list recognises how people speak rather than naming anyone.
 */
const FUNCTION_WORDS =
  /the|a|an|that|this|those|these|it|them|which|what|for|you|your|his|her|my|me|of|on|in|into|at|to|up|out|over|from|with|now|again|quickly|real|quick|all|both/u
    .source;
const FUNCTION_WORD = String.raw`(?:${FUNCTION_WORDS})(?!${WORD})`;

/** A verb that states something or helps one ask, which no promise's object carries. */
const VERB = String.raw`(?:is|are|was|were|be|been|says|said|has|have|had|do|does|did|will|would|can|could|shall|should|may|might|must|seem|seems|seemed|appear|appears|appeared|won['’]t|can['’]t|don['’]t|isn['’]t|aren['’]t|wasn['’]t|weren['’]t|doesn['’]t|didn['’]t|hasn['’]t|haven['’]t|it['’]s|that['’]s|there['’]s|no|yes)(?!${WORD})`;

/**
 * A promise's object as a regular-expression source: closed words, plus at most `words` others, never a verb.
 *
 * @param words how many words outside the closed vocabulary it may hold
 * @returns the source, each word preceded by its whitespace
 */
function objectOf({ words }: { words: number }): string {
  return String.raw`(?:\s+${FUNCTION_WORD})*(?:\s+(?!${FUNCTION_WORD})(?!${VERB})${WORD}(?:\s+${FUNCTION_WORD})*){0,${String(words)}}`;
}

/**
 * What a promise is OF — "those", "which channel you mean", "the rest of it": closed words, plus at most TWO others
 * and never a verb that states or asks. Listing what an object may not hold never closed ("says", "is", "will you"
 * and "seems" turned up in turn), so the object is a closed vocabulary with a budget: "let me
 * check the channel seems quiet" spends three and is never a promise ("seems" is a verb here too).
 */
const OBJECT = objectOf({ words: 2 });

/**
 * The digging family, after "let me", "I'll" or "I will": "keep digging", "keep investigating", "dig deeper", and
 * "keep looking" only bare or before a work particle, so "I'll keep looking tired tomorrow" stays a state. Never a bare
 * "dig" or "dig into" ("I'll dig into dinner"), nor a "keep" before any other word. A measured call closed an answer on
 * "I'll keep digging." with nothing running: `grep -n "keep digging" $SLOPWEAVER_HOME/talk/calls/<call-id>-*.jsonl`.
 */
const DIGGING_WORK = String.raw`keep (?:digging|investigating)|dig deeper|keep looking(?=\s+(?:into|at|over|through|up|for)(?!${WORD})|\s*,|\s*$)`;

/**
 * One clause promising work not yet started, each family one the voice has said on a call: "let me check those",
 * "I'll pull it up", "one sec", "give me a moment", "having a look", "on it", "pulling that up". Bounded to
 * future-work wording, never a bare "look" or "see" — "I see what you mean" and "look at that result" are not promises.
 * Its object is {@link OBJECT}'s, so a fact the transcript ran on into it is never swallowed. Measured over every
 * call file: `grep -rhoiE '"text":"[^"]*(let me (check|look|pull|find|see|read|get)|one sec|one
 * moment|give me a (sec|moment)|having a look|pulling (that|it|those) up)[^"]*","who":"voice"'
 * $SLOPWEAVER_HOME/talk/calls/` — "Sure, one sec.", "Okay, having a look.", "Got it, one moment." recur.
 */
const PROMISE_CLAUSE = String.raw`(?:(?:let me|i['’]?ll) (?:check|look|pull|find|read|see|get)\b${OBJECT}|(?:let me|i['’]?ll|i will) (?:${DIGGING_WORK})\b${OBJECT}|(?:i['’]?m )?still on it|(?:just )?(?:one|a) (?:sec|second|moment)|give me (?:a|one) (?:sec|second|moment)\b${OBJECT}|having a look\b${OBJECT}|(?:i['’]?m )?on it|(?:i['’]?m )?checking(?: (?:that|it|those|now))?|pulling (?:(?:that|it|those|them) )?up\b${OBJECT})`;

/**
 * A sentence that is promises and nothing else: every clause after a comma is itself one, so "let me check that,
 * shall I" or "…, okay" — a tag asking the owner, which a transcript can carry with no "?" — is never a promise.
 */
const PROMISE = new RegExp(`^(?:${ACK})*${PROMISE_CLAUSE}(?:,\\s*${PROMISE_CLAUSE})*$`, "iu");

/**
 * A sentence closing on a tag with no comma before it — "let me check that shall I", "one sec is that alright".
 * Never a promise either: a question waits for the owner's press.
 */
const TAG_ASK =
  /\b(?:(?:shall|should|can|may) (?:i|we)|okay|ok|alright|all right|right|yeah|yes|sure|fine|good|huh|eh|yeah no|no|if you(?:['’]d)? (?:like|want|prefer)|want me to)$/iu;

/**
 * A condition put to the owner anywhere in a sentence — "I'll check the logs if you'd like", "let me pull it up when
 * you're ready", "I'll look into it if that helps", "provided you approve", "with your permission": work offered on
 * the owner's say-so, never promised. The forms are a closed list over an open class,
 * so a paraphrase outside it reads as a promise, and the page presses the nudge on an offer the owner never took up. A
 * terminal promise's object runs to {@link TERMINAL_OBJECT_WORDS} words, so a condition can sit inside it rather than
 * only at its end where {@link TAG_ASK} looks. "Let me check if you're on the list" reads as one too: the count leans
 * toward leaving a turn to the owner's own nudge rather than offering it on an offer. A one-word condition closing the
 * sentence — "if desired", "if possible", "if so", "when convenient" — is the same offer, whatever the word, so it is
 * matched by shape rather than by list; an embedded "whether" ("let me check if it shipped")
 * always runs to more words than that. A condition opener with "you" or "your" anywhere after it — "as long as that
 * works for you today", "if that's okay with you" — is the same offer whatever sits between, so it is matched by that
 * shape rather than by a word count; "let me check if the build you pushed passed" reads as
 * one too, on the same lean as above.
 */
const CONDITION_ON_OWNER =
  /\b(?:(?:if|when|whenever|once|unless|provided|providing|assuming|as long as|so long as|should)(?: that)? you(?:['’](?:d|re|ve|ll))?|if (?:that|it)(?:['’]s| is| would| helps)|if (?:needed|necessary|useful|helpful|wanted|desired|possible)|with your (?:permission|ok|okay|go-ahead|blessing|approval)|want me to)\b|\b(?:if|when) [\p{L}\p{N}'’#@/_-]+$|\b(?:if|when|whenever|once|unless|provided|providing|assuming|as long as|so long as)\b.*\byou(?:r|rs)?\b/iu;

/**
 * The most words a turn's LAST sentence may say its promised work is about — "how callers are actually choosing
 * modules" is five. Wider than {@link OBJECT}'s two because a terminal promise stands after the answer rather than
 * instead of one, so a fact run on into it is the answer's, already said; bounded so a whole run-on statement opening
 * "let me check" is still never read as one.
 */
const TERMINAL_OBJECT_WORDS = 12;

/**
 * What a terminal promise is OF: closed words plus at most {@link TERMINAL_OBJECT_WORDS} others, never a verb that
 * states or asks; or an embedded question — "how callers are actually choosing modules", "whether it shipped" — whose
 * own verb is the clause's, within the same budget; or a noun and the clause that says which or when — "the logs that
 * are failing", "the logs before it is deployed" — whose verb is that clause's too, the whole object one more word than
 * the budget at most, so a sentence that never opens a clause still has no verb in it. The clause needs a noun before it to say
 * which of: "let me check that will you" opens none.
 */
const TERMINAL_OBJECT = String.raw`(?:${objectOf({ words: TERMINAL_OBJECT_WORDS })}|(?:\s+${FUNCTION_WORD})*\s+(?:how|what|which|whether|why|where|when|who|if)(?!${WORD})(?:\s+${WORD}){1,${String(TERMINAL_OBJECT_WORDS - 1)}}|(?=(?:\s+${WORD}){3,${String(TERMINAL_OBJECT_WORDS + 1)}}$)(?:\s+${FUNCTION_WORD})*\s+(?!${FUNCTION_WORD})(?!${VERB})${WORD}${objectOf({ words: TERMINAL_OBJECT_WORDS - 1 })}\s+(?:that|which|who|where|when|before|after|until|while|since|because)(?!${WORD})(?:\s+${WORD})+)`;

/** The particles that turn "check" or "pull" into a move of the speaker's own day: check in, check out, pull over, pull away. */
const PHRASAL_PARTICLE = String.raw`(?:in|out|over|through|away|ahead|back|off)`;

/** The words that say when, after which a phrasal "check out" or "pull away" is a plan rather than an object. */
const WHEN_WORD = String.raw`(?:today|tomorrow|tonight|now|later|soon|early|first|then|at|on|by|before|after|around|this|next)`;

/**
 * A last sentence that promises work still to come: "Let me check how callers are actually choosing modules.", "I'll
 * look into why the deploy failed.", an acknowledgement before it allowed. Only the verbs that name work whatever
 * follows them — "check", "pull", "investigate", and "look" or "find" with the particle that makes them work: never a
 * bare "look", "find", "read" or "get", which a 12-word object turns into a state ("I'll look tired tomorrow", "I'll
 * find it hard", "I'll read that as a yes", "I'll get there"). Never "I can check" (an offer),
 * "I checked" (a completed claim) or "I'll be honest" (future explanation) either. A "check" or "pull" whose particle
 * closes the sentence or is followed by when or "of" — "I'll check out tomorrow", "I'll pull over", "I'll check out of
 * the hotel" — is a plan of the voice's day, not work for the owner; "I'll check out the logs"
 * still is.
 */
const TERMINAL_PROMISE = new RegExp(
  String.raw`^(?:${ACK})*(?:let me|i['’]?ll|i will) (?:(?:check|pull)(?!\s+${PHRASAL_PARTICLE}(?:\s+(?:${WHEN_WORD}|of)(?!${WORD})|$))|look (?:into|at|over|through|up|for)|find out|investigate|${DIGGING_WORK})\b${TERMINAL_OBJECT}$`,
  "iu",
);

/** A last sentence saying the voice is still at work — "Still on it.", "I'm still on it." — which no subject opens. */
const STILL_ON_IT = new RegExp(String.raw`^(?:${ACK})*(?:i['’]?m )?still on it$`, "iu");

/**
 * Whether a finished turn ENDS on a promise of work not started, after an answer: the voice answers and then closes on
 * "Let me check how callers are actually choosing modules." — and nothing is checking. The turn must not end on a
 * question (`voiceAsked`), though an earlier sentence may ask one; its last sentence must open on a future-work
 * construction and carry at most a bounded object; a tag asking the owner still wins.
 *
 * @param text the voice's final transcript for the turn
 * @returns true when the turn's last sentence promised work
 */
function terminalPromise({ text }: { text: string }): boolean {
  if (voiceAsked({ text })) {
    return false;
  }
  const last = text
    .split(/[.!?;:…—–]+/u)
    .map((sentence) => sentence.trim().replace(WRAPPING, "").trim())
    .findLast((sentence) => sentence !== "");
  if (last === undefined) {
    return false;
  }
  const promising = TERMINAL_PROMISE.test(last) || STILL_ON_IT.test(last);
  return promising && !TAG_ASK.test(last) && !CONDITION_ON_OWNER.test(last);
}

/**
 * Whether a finished turn of the voice's left a promise of work it has not started — {@link voicePromiseOf} as a yes or
 * no, for a reader that only asks whether work wording was said.
 *
 * @param text the voice's final transcript for the turn
 * @returns true when the turn was a promise of work, or ended on one
 */
export function voicePromised({ text }: { text: string }): boolean {
  return voicePromiseOf({ text }) !== false;
}

/**
 * Which promise of work a finished turn of the voice's left, if any. Two shapes. The whole turn is a promise — "Right.
 * Let me check those. One sec." — and nothing else: every sentence acknowledges or promises, at least one promises, and
 * there is no "?" anywhere, so an answer ("Sure, give me a moment. The bot says the key went quiet."), a question, a
 * request ("Tell me which channel. One sec.") or a tag ("let me check that, okay") is never one, whatever words it ends
 * on (review found four such shapes in turn). Or the turn answers and then ENDS on one ({@link terminalPromise}), the
 * shape two measured calls heard. Whole-turn is read first, since a turn of only "Let me check." also ends on one: it
 * is a hand-off, and a completed turn keeps it ({@link promiseDueOf}). A promise it misses still leaves the owner's
 * own nudge.
 *
 * @param text the voice's final transcript for the turn
 * @returns `whole-turn`, `terminal`, or `false` when the turn promised nothing
 */
export function voicePromiseOf({ text }: { text: string }): VoicePromise {
  if (wholeTurnPromise({ text })) {
    return "whole-turn";
  }
  return terminalPromise({ text }) ? "terminal" : false;
}

/**
 * Whether every sentence of a turn acknowledges or promises, at least one promises, and nothing asks.
 *
 * @param text the voice's final transcript for the turn
 * @returns true for a turn that is a promise and nothing else
 */
function wholeTurnPromise({ text }: { text: string }): boolean {
  if (text.includes("?")) {
    return false;
  }
  const sentences = text
    .split(/[.!;:…—–]+/u)
    .map((sentence) => sentence.trim().replace(WRAPPING, "").trim())
    .filter((sentence) => sentence !== "");
  // A condition put to the owner makes an offer of a whole-turn promise as surely as of a terminal one.
  const promises = sentences.filter(
    (sentence) => PROMISE.test(sentence) && !TAG_ASK.test(sentence) && !CONDITION_ON_OWNER.test(sentence),
  );
  const rest = sentences.filter((sentence) => !promises.includes(sentence));
  return promises.length > 0 && rest.every((sentence) => ACK_ONLY.test(sentence));
}

/** The fold's fields an owed turn is read from (`./voiceActivity.ts`). */
interface OwedFields {
  readonly lastVoiceFinal: VoiceFinal | undefined;
  readonly lastHeardMs: number | undefined;
  readonly lastSpokeMs: number | undefined;
  readonly heardWaits: boolean;
  readonly nudgedHeardMs: number | undefined;
  readonly nudgedAtMs: number | undefined;
  readonly promisedHeardMs: number | undefined;
  /**
   * When its newest Codex turn completed (`./voicePlanWork.ts`): a whole-turn promise is kept once one completes after
   * the owner's words, a promise closing an answer only once one completes at or after it.
   */
  readonly plan: Pick<PlanWork, "lastCompletedMs">;
  readonly turn: Pick<TurnTaking, "owner" | "voice">;
}

/**
 * When the line went quiet with the voice owing the next turn: its last finished turn came after the owner's words and
 * put no question to them, their words did not end on a wait or a filler (`./waitAsk.ts`), and they have not pressed
 * the nudge for them. Either meter's sound since moves the quiet on rather than ending the debt: the owner's words run
 * ahead of their transcript (`RESUME_SOUND_QUIET_MS`, `./voiceActivity.ts`), so a pause inside words not yet
 * transcribed is never offered as the voice's turn, while a sound in the owner's room, which never becomes words,
 * leaves the turn the voice's.
 *
 * @param activity the fold's fields this reads
 * @returns the instant the line last made a sound, or `undefined` when the next turn is not the voice's
 */
export function owedSinceMs({ activity }: { activity: OwedFields }): number | undefined {
  const final = activity.lastVoiceFinal;
  const heard = activity.lastHeardMs;
  if (final === undefined || heard === undefined || final.atMs <= heard || final.asked || activity.heardWaits) {
    return undefined;
  }
  if (activity.nudgedHeardMs === heard) {
    // The owner pressed for these words already: what the voice said after it is its turn taken, and their words come
    // next.
    return undefined;
  }
  const { owner, voice } = activity.turn;
  // The voice's latest known speech: its meter, or its transcript's `spoke` when the meter caught none.
  const voiceTimes = [voice?.lastMs, activity.lastSpokeMs].filter((atMs) => atMs !== undefined);
  const voiceLastMs = voiceTimes.length > 0 ? Math.max(...voiceTimes) : undefined;
  // The owner's sound after the voice's, then their words transcribed after it too: they spoke after the voice, whose
  // final only arrived late, so the turn is their words' answer, never the voice's to carry on. With no time at all
  // for the voice's speech, the owner's sound is read as the later one: no offer, exactly as before this debt.
  if (owner !== undefined && (voiceLastMs === undefined || (owner.lastMs > voiceLastMs && heard > voiceLastMs))) {
    return undefined;
  }
  const sounds = [activity.lastSpokeMs, owner?.lastMs, voice?.lastMs];
  if (activity.promisedHeardMs === heard) {
    // The page's own press over a promise ({@link promiseDueOf}) starts the quiet afresh, so the owner's press is offered a
    // whole quiet after it — past the server's nudge gap, which that press also holds (`PlanCall.nudge`).
    sounds.push(activity.nudgedAtMs);
  }
  return Math.max(final.atMs, ...sounds.filter((atMs) => atMs !== undefined));
}

/**
 * When the voice's debt began — its final, never the quiet {@link owedSinceMs} slides on with every sound — so a hold
 * timed from it is a fixed cap that a room's noise cannot extend (`ROLLOVER_OWED_HOLD_MS`, `./callRollover.ts`).
 *
 * @param activity the fold's fields this reads
 * @returns the instant the voice's owed turn ended, or `undefined` when the next turn is not the voice's
 */
export function owedFromMs({ activity }: { activity: OwedFields }): number | undefined {
  if (owedSinceMs({ activity }) === undefined) {
    return undefined;
  }
  return activity.lastVoiceFinal!.atMs;
}

/**
 * Whether the voice has owed the next turn ({@link owedSinceMs}) for `afterMs`. Never forgotten, since the turn stays
 * the voice's however long the quiet runs, and an ordinary statement is never resumed on its own: across every call
 * file, about half of the voice's statements after the owner answered its question were an "Mm-hm." while they were
 * still mid-thought, so only the owner's press acts on it. A PROMISE of work that started nothing is the one exception
 * ({@link promiseDueOf}).
 *
 * @param activity the fold's fields this reads
 * @param nowMs the same clock the fold was stamped on
 * @param afterMs the quiet a turn must go before it is owed, the fold's "still waiting" threshold
 * @returns true when the voice spoke last, asked nothing, and has been quiet long enough to be owed a press
 */
export function voiceOwesTurn({
  activity,
  nowMs,
  afterMs,
}: {
  activity: OwedFields;
  nowMs: number;
  afterMs: number;
}): boolean {
  const since = owedSinceMs({ activity });
  return since !== undefined && nowMs - since >= afterMs;
}

/**
 * Whether the owner spoke after an instant: a stretch of their microphone BEGUN after it and held {@link CUT_IN_MS}, as
 * a cut-in is, with their words transcribed after that stretch began. A click or a cough between the instant and a late
 * fragment of their earlier words is not them speaking again.
 */
function spokeAfter({ activity, atMs }: { activity: OwedFields; atMs: number }): boolean {
  const { owner } = activity.turn;
  if (owner === undefined || owner.sinceMs <= atMs || owner.lastMs - owner.sinceMs < CUT_IN_MS) {
    return false;
  }
  return activity.lastHeardMs !== undefined && activity.lastHeardMs > owner.sinceMs;
}

/**
 * Whether the page should press the nudge ITSELF now, for a promise of work the voice made and never started. Without
 * it, a voice that says "Right. Let me check those. One sec." and calls no tool and starts no Codex turn leaves the orb
 * on "listening" beside "nudge it to answer" for 114s, until the owner notices it is stuck. Repro: the `segment` and `tool` lines
 * of a call in `$SLOPWEAVER_HOME/talk/calls/<call-id>-*.jsonl` that carry a `resume` and nothing after the promise.
 *
 * True once per thing the owner said, when the voice owes the turn ({@link owedSinceMs} — a question wins), its last
 * final promised work, no Codex turn has kept it (one completed since the owner last spoke for a whole-turn promise,
 * after the promise for a terminal one), nothing is in flight, their microphone is open and quiet, and, for a
 * whole-turn promise, the line has been quiet `afterMs`: {@link PROMISE_MS}, so the press lands before the 12s offer of
 * the owner's own. A terminal one is due at once. Recorded apart from their nudge, so their press is still
 * offered, a whole quiet after this one ({@link owedSinceMs}), if this one is refused, lost or ignored.
 *
 * "In flight" is what the fold can see. A hand-off within `HANDOFF_SETTLE_MS` of a turn ending is read as that turn's
 * late copy and shows nothing (`voicePlanWork.ts`), so a genuine one there is invisible until its turn starts — 0.1s
 * measured. One whose turn has not started in the whole quiet is a dropped hand-off, the stuck case this press is for;
 * one whose turn has started is refused by the server, which counts its own running turns.
 *
 * @param activity the fold's fields this reads
 * The owner's microphone counts as sounding only when it clears both bars (`micAudible`, `./micAudible.ts`): a quiet
 * room clears the spectral one alone and would hold this press for good.
 *
 * @param afterMs the quiet the promise must go unkept, {@link PROMISE_MS} on the page
 * @param inFlight how many turns, hand-offs and tools the fold has in flight
 * @param micLevel the owner's microphone's level now
 * @param micRms the owner's microphone's waveform RMS on the same sample
 * @param muted whether the owner's microphone is muted, which never presses whatever it reads
 * @param nowMs the same clock the fold was stamped on
 * @returns true at most once per thing the owner said
 */
export function promiseDueOf({
  activity,
  afterMs,
  inFlight,
  micLevel,
  micRms,
  muted,
  nowMs,
}: {
  activity: OwedFields;
  afterMs: number;
  inFlight: number;
  micLevel: number;
  micRms: number;
  muted: boolean;
  nowMs: number;
}): boolean {
  const since = owedSinceMs({ activity });
  const final = activity.lastVoiceFinal;
  if (since === undefined || final === undefined || final.promised === false) {
    return false;
  }
  // A Codex turn completed since the owner's words is a whole-turn promise kept, whatever the voice has said of its
  // answer yet — read from their words, not the promise, since the turn's end can reach the page before the promise's
  // final does. Words of theirs count as after it only with their microphone sounding after it too: a transcript
  // fragment arriving late, into a silence, is a piece of the words that turn answered. Read that way a typed line with
  // their microphone silent keeps the promise too, which leaves them their own nudge rather than a repeat. A promise
  // closing an answer is kept only by a turn completed after it, the same instant never proving which came first: one
  // completed before it wrote the answer the voice then added the promise to ("I'll keep digging.").
  const completed = activity.plan.lastCompletedMs;
  const completionKeeps = completed !== undefined && (final.promised === "whole-turn" || completed > final.atMs);
  if (completionKeeps && !spokeAfter({ activity, atMs: completed })) {
    return false;
  }
  if (
    activity.promisedHeardMs === activity.lastHeardMs ||
    inFlight > 0 ||
    muted ||
    micAudible({ micLevel, micRms, muted })
  ) {
    return false;
  }
  // A terminal promise is due at once: on a measured call the owner challenged it 9.059s after its final, in `afterMs`.
  // A hand-off the voice makes beside it is caught by the server, whose owed start waits on a turn starting.
  if (final.promised === "terminal") {
    return true;
  }
  return nowMs - since >= afterMs;
}
