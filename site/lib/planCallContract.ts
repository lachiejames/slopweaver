/**
 * What a plan call promises the page: every deadline it keeps, why it ends, the events its stream carries and how
 * each of its requests lands. The server's `PlanCall` (`./talkPlanCall.ts`) keeps it, and the page reads
 * it — its own module so the page's code reaches this contract without importing the class that drives the child.
 */
import type { AnnounceCue } from "./announceCue";
import type { PlanCodexNoticeEvent, PlanModelWaitEvent } from "./talkPlanCodexEvents";
import type { CodexStep, TokenUsageBreakdown } from "./talkPlanProtocolItems";

/** Every deadline a call keeps, named so a test can shorten none of them by accident. */
export const PLAN_CALL_LIMITS = {
  /** Each handshake request before `thread/realtime/start`. Measured under 2s on a warm machine. */
  handshakeStepMs: 20_000,
  /** `thread/realtime/start` through its SDP notification. Measured ~1.5s. */
  realtimeStartMs: 30_000,
  /** A tool call the page CLAIMED and has not answered is answered as a failure, so the thread never waits forever. */
  pendingToolMs: 120_000,
  /**
   * A tool call no page has CLAIMED this long never reached one that can run it, and is answered as undelivered so the
   * turn goes on. A claim that rides a keep-alive socket to a swapped-out server is refused there; this server never
   * hears it, and each turn sits out the two-minute window above, the voice silent,
   * until the owner's next words end it. Longer than the page's ten-second `PLAN_POST_MS`, so a slow claim still gets its
   * whole budget. A judgement, not a measurement.
   */
  unclaimedToolMs: 15_000,
  /** The page's event stream may be absent this long (a reload, a reconnect) before the call is stopped. */
  streamAbsentMs: 30_000,
  /**
   * No call outlives this, whatever else is true. The CONSOLE's cap, not OpenAI's: the app-server protocol declares no
   * realtime session duration, and a plan call has run to it (89.9 min) with the voice still up.
   */
  lifetimeMs: 90 * 60_000,
  /**
   * From this far into a call, the page is told to roll it over onto a fresh one (a `rollover` event) the
   * first time the floor is free, so {@link PLAN_CALL_LIMITS.lifetimeMs} is a backstop the owner never meets mid-sentence,
   * which the ninety-minute cut otherwise lands on (the owner hit it four times in one day). Ten minutes of pauses
   * to find one in; a judgement.
   */
  rolloverFromMs: 80 * 60_000,
  /**
   * The floor is free once neither side has been transcribed for this long, with no work or speech of this server's
   * in flight. Twice {@link PLAN_CALL_LIMITS.resumeQuietMs}, since a rollover's cost of being wrong is the owner's words
   * landing in the gap before the next call is up, not a sentence of the voice's. A judgement.
   */
  rolloverQuietMs: 4_000,
  /**
   * With this little of {@link PLAN_CALL_LIMITS.lifetimeMs} left, the rollover stops waiting for a conversational turn
   * to settle: the server asks whatever holds its floor, and the page drops the holds that only wait for the next turn
   * (`site/lib/callRolloverFloor.ts`). MEASURED on one call: from the rollover's start to the cut, 8m11s later, every pause —
   * 15s, 28s, 11s — fell inside a 90-second "the voice owes the next turn" hold or one of the owner's, so the cut landed
   * mid-sentence. Longer than two of those 90s holds back to back. Repro: `grep -n -e '"kind":"closed"'
   * -e '"final":true' $SLOPWEAVER_HOME/talk/calls/<call-id>-*.jsonl | tail -n 12`.
   */
  rolloverUrgentMs: 3 * 60_000,
  /**
   * With this little left, the owner's turn no longer holds the rollover, only the voice's work and a second of silence on both
   * meters: a successor opened in a breath of the owner's is a smaller cut than the lifetime's, which lands wherever it falls,
   * while an answer the voice is still giving or a Codex turn still running loses nothing to the lifetime that it would
   * not lose to the rollover sooner. Many such pauses fit in it; a judgement.
   */
  rolloverLastMs: 30_000,
  /** While the floor is taken past {@link PLAN_CALL_LIMITS.rolloverFromMs}, it is looked at again this often. */
  rolloverPollMs: 250,
  /**
   * Once the delegated thread's last request filled this share of its context window, the call rolls over at the next
   * free floor, whatever its age, so Codex never compacts the thread in the middle of the owner's question. MEASURED on one call: the thread grew from 46,809 input tokens to 242,538 of a
   * 258,400 window over 79 minutes, and the turn answering sat 118s silent while it compacted to 99,532, 38s before
   * the age rollover. It crossed 85% with a free floor after; its largest step between two
   * requests was 13,000 tokens, so the share leaves room for a turn to finish. Repro: `jq -r 'select(.kind=="usage")
   * | "\(.atIso) \(.last.inputTokens)"' $SLOPWEAVER_HOME/talk/calls/<call-id>-*.jsonl`.
   */
  rolloverContextShare: 0.85,
  /**
   * Once the delegated thread's last request filled this share of its window, a context rollover still held stops
   * waiting for the conversation's next turn: the server asks again at once, whatever its floor holds, marked
   * `contextUrgent`, and the page judges its floor at the `urgent` stage. MEASURED on one call: the
   * thread crossed 85%, the page held the ask for nine minutes at `calm`, where the two holds
   * waiting on the next turn renewed every other one (only "the voice still owes its turn" held
   * it), and the turn after one of 242,428 input tokens compacted silently for 61s, then 110s more once a nudge
   * interrupted it, until the owner hung up. Both calls measured compacted after a request of about 242,500; less the
   * largest step between two requests (13,000) that is 88.8%, so 88% is the latest share that still sees one
   * coming. Repro: `grep -o -e '"atIso":"[^"]*","contextWindow":[0-9]*,"kind":"usage","last":{[^}]*' -e
   * '"atIso":"[^"]*","detail":"[^"]*","kind":"tool","name":"rollover"' $SLOPWEAVER_HOME/talk/calls/<call-id>-*.jsonl`.
   */
  rolloverContextUrgentShare: 0.88,
  /** Events a late or reconnecting stream can replay. */
  replayRing: 256,
  /**
   * A running Codex turn's progress reaches the page at most this often, beyond each item starting — enough that a
   * turn with no update for `STALL_MS` (35s) has sent the server nothing at all. A judgement, not a measurement.
   */
  progressEveryMs: 5_000,
  /** Each of a nudge's requests. Both answer `{}` at once on a live session (measured, ~0.1s). */
  nudgeStepMs: 10_000,
  /**
   * The owner's typed turn, taken by the session, waits this long for the voice to speak or hand it to Codex; with neither,
   * the voice is handed `TYPED_IN_KICK_TEXT` (`./talkPlanTypedIn.ts`). Three times the 0.8s a developer message took
   * to be answered live (`RESUME_TEXT`, `./talkPlanWords.ts`), so an answer already on its way is never kicked.
   */
  typedInKickMs: 2_500,
  /**
   * A resume or nudge the session took waits this long, from the moment it was taken, for the voice's own hand-off to
   * start a Codex turn; past it the console starts the owed turn itself (`./talkPlanOwedTurn.ts`). A resume no longer
   * asks the voice to hand off (`RESUME_TEXT`), so for it the window is only the wait for
   * the owner's final words to reach the spoken record. The same 2.5s as
   * {@link PLAN_CALL_LIMITS.typedInKickMs}, three times the 0.8s a developer message took to be answered live, and long
   * enough for the owner's final words — closed by the developer message, 0.6s after it on one measured call — to reach the
   * spoken record the page steers into the turn. A separate lifecycle: this one ends in `turn/start`, never a kick.
   * Asking the voice is no backstop: across every call file measured, 0 of 6 promise presses, 0 of 17 of the owner's
   * nudges and 6 of 55 resumes with no turn running were followed by a Codex turn before they spoke again. The owner's final
   * words asking for the next card open the same window from their `done` (`./talkPlanWalkAsk.ts`), so a voice that
   * hands off a moment late still answers in its own words.
   */
  owedTurnStartMs: 2_500,
  /** One nudge, then this long before another is taken, so a double press is one nudge. A judgement. */
  nudgeGapMs: 10_000,
  /** A Codex turn that ended this recently is about to be spoken: a nudge now would talk over it. A judgement. */
  nudgeSettleMs: 4_000,
  /**
   * A delegated Codex turn still running this long sends the page one `progress` event, and again each time this long
   * passes, and the page plays its `working` cue — a sound, never words. The cadence is the one the spoken progress
   * line kept, with a subtle sound effect instead of words. It is set so the owner never sits through the minute of
   * silence that makes them ask "are you there". Timed from `turn/started`, which followed the hand-off's first
   * `delegation.created` within 0.1s on both live calls measured beside the retired spoken line.
   */
  progressCueMs: 30_000,
  /**
   * The FIRST progress cue after the voice last spoke — its acknowledgement, a look line, a voiced commentary — comes
   * this long in; later ones keep {@link PLAN_CALL_LIMITS.progressCueMs}. The friction starts at about ten to twenty
   * seconds with no update heard. MEASURED over 8 calls: 37 of 192 hand-offs left the owner 10s or more with nothing and
   * 9 past 20s, the worst 31.0s, so a 30s first signal all but never came. A judgement inside the owner's
   * ten-to-twenty (`./talkPlanHandOffSpeech.ts` carries the repro).
   */
  progressFirstMs: 15_000,
  /**
   * A hand-off of the owner's words is acknowledged this long after its Codex turn starts, if the voice has said nothing
   * since: long enough that an answer already on its way is not preceded by "on it", short enough that the line,
   * spoken ~1s after it is written (a look line, measured on a live call), lands inside the "second
   * or two" the owner expects. A judgement.
   */
  ackHoldMs: 1_000,
  /**
   * The acknowledgement waits until the owner's words have been quiet this long, since a hand-off can start before their last
   * words are transcribed (0.85s ahead of them on the probe, {@link PLAN_CALL_LIMITS.lookStartMs}). A judgement.
   */
  ackQuietMs: 600,
  /** While the owner's words are not yet quiet, the acknowledgement is looked at again this often. */
  ackPollMs: 250,
  /** While a thinking-model answer is held for the owner's words to go quiet (`./talkPlanHeldAnswers.ts`), the floor is looked at this often. */
  heldPollMs: 250,
  /**
   * Past this long after its Codex turn started, an acknowledgement still waiting is dropped: a late "on it" lands on
   * the answer, and the first progress cue covers the gap. A judgement.
   */
  ackGiveUpMs: 4_000,
  /**
   * One "having a look" line, then this long before another is taken: the page asks once per turn of the owner's, so a second
   * ask this soon is a double post or a replay, never a fresh look. A judgement.
   */
  lookGapMs: 5_000,
  /**
   * One resume, then this long before another is taken: the page asks once per silence of the owner's, so a second ask this
   * soon is a double post or a replay. A judgement.
   */
  resumeGapMs: 10_000,
  /**
   * A resume is refused when the realtime session transcribed anyone this recently: the page asks only after
   * `RESUME_MS` of quiet, or exactly this long after words ending on the owner's code word "over" (`endsOnOver`), so a
   * transcript this fresh is speech that began after it judged the silence.
   * Long enough to cover the page's post and a transcript's lag behind the audio. A judgement. The
   * app-server does send these: a live call took 72 `thread/realtime/transcript/delta|done` notifications with the
   * call's `threadId`, the owner's and the voice's, the first 4s after it opened. Repro: log every
   * `thread/realtime/transcript/` method in `notification` over one plan call.
   */
  resumeQuietMs: 2_000,
  /**
   * A frame for the owner's look ask that reaches the server with no Codex turn running waits this long, from its arrival, for
   * the voice's own hand-off to start one; past it the console starts the turn itself with the frame as its input
   * (`PlanCall.attachLook`). MEASURED on a live call (a fake-microphone probe of "Can you take a look at my
   * screen real quick"): a healthy hand-off started its turn 0.85s BEFORE the owner's words were final, so a frame taken on
   * their final words finds a turn already running; and the page's capture took ~1.1s (`look` to `frame`). A second of
   * slack on top is ten times the hand-off's own 0.1s, and keeps
   * the started turn inside the three seconds the owner expects (`docs/console/voice-sees-the-owners-screen.md`). Asking the voice
   * to hand it over instead is not a backstop: 1 of 17 such asks reached a turn.
   */
  lookStartMs: 1_000,
  /**
   * A reopened call (`src/talk/reopenReminder.ts`) is the owner's to open for this long from the page's connection coming up;
   * silent through it, the voice is handed the reminder of where they left off, and the owner's words inside it win. The
   * owner's own number is three seconds. A ruling, not a
   * measurement (`./talkPlanReopenReminder.ts`).
   */
  reopenReminderSilenceMs: 3_000,
} as const;

/**
 * How the frame for the owner's look landed: steered into a running Codex turn, the input of a turn the console started
 * because none ran, refused before anything was sent, failed on the child's own answer, or `unsure` — the request was
 * written and no answer came, in time or before the call ended, so it may have landed.
 */
export type PlanFrameOutcome =
  | { readonly kind: "steered"; readonly turnId: string }
  | { readonly kind: "started"; readonly turnId: string }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "failed"; readonly reason: string }
  | { readonly kind: "unsure"; readonly reason: string };

/** What a `turn/start` carrying a look's frame came to: a frame outcome that is never `steered` nor `refused`. */
export type PlanLookStartOutcome = Extract<PlanFrameOutcome, { kind: "started" | "failed" | "unsure" }>;

/** How a "having a look" line landed: said, refused before anything was written, or not taken by the voice. */
export type PlanLookOutcome =
  | { readonly kind: "said"; readonly text: string }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "failed"; readonly reason: string };

/** Why a call reaching {@link PLAN_CALL_LIMITS.lifetimeMs} ended, whose cap it is, and what the owner does next. */
export const LIFETIME_REASON =
  "the console's own 90-minute call limit was reached; start a new call and it picks up where this one left off";

/** Why a call the page rolled over onto a fresh one in a free floor ended, as its call file records it. */
export const ROLLOVER_REASON =
  "the console rolled this call over onto a fresh one in a pause, ahead of its own 90-minute limit";

/** Why a call the page rolled over because its thread's context was nearly full ended, as its call file records it. */
export const CONTEXT_ROLLOVER_REASON =
  "the console rolled this call over onto a fresh one in a pause, before its thread's context filled and had to compact";

/**
 * Whether one usage reading puts the thread past {@link PLAN_CALL_LIMITS.rolloverContextShare} of its window. A thread
 * that reports no window is never judged full: nothing measured says how close it is.
 *
 * @param contextWindow the thread's window, as its usage reported it
 * @param inputTokens the last request's input, which is the thread's context as it stands
 * @returns true once the call should roll over before the thread compacts
 */
export function contextRolloverDue({
  contextWindow,
  inputTokens,
}: {
  contextWindow: number | null;
  inputTokens: number;
}): boolean {
  return contextFilled({ contextWindow, inputTokens, share: PLAN_CALL_LIMITS.rolloverContextShare });
}

/**
 * Whether one usage reading puts the thread past {@link PLAN_CALL_LIMITS.rolloverContextUrgentShare} of its window,
 * where a held context rollover stops waiting for the conversation's next turn. Judged as {@link contextRolloverDue} is.
 *
 * @param contextWindow the thread's window, as its usage reported it
 * @param inputTokens the last request's input, which is the thread's context as it stands
 * @returns true once a held context rollover should be urgent
 */
export function contextRolloverUrgent({
  contextWindow,
  inputTokens,
}: {
  contextWindow: number | null;
  inputTokens: number;
}): boolean {
  return contextFilled({ contextWindow, inputTokens, share: PLAN_CALL_LIMITS.rolloverContextUrgentShare });
}

/** Whether `inputTokens` fill `share` of a window the usage named; a window it did not name is never full. */
function contextFilled({
  contextWindow,
  inputTokens,
  share,
}: {
  contextWindow: number | null;
  inputTokens: number;
  share: number;
}): boolean {
  if (contextWindow === null || contextWindow <= 0) {
    return false;
  }
  return inputTokens >= contextWindow * share;
}

/** The longest message the owner may send in one go, in characters — a pasted thread or page, never a file. */
export const TYPED_TEXT_MAX_CHARS = 16_000;

/** The longest id the page may name one typed message by. */
export const TYPED_MESSAGE_ID_MAX_CHARS = 128;

/** What the page's event stream carries. */
export type PlanCallEvent =
  | {
      readonly kind: "tool";
      readonly token: string;
      readonly tool: string;
      readonly arguments: string;
      /** The model's answer the call was made in, `undefined` from a server that names none (`./talkPlanProtocolItems.ts`). */
      readonly turnId: string | undefined;
    }
  | {
      readonly kind: "rollover";
      readonly reason: string;
      /**
       * How long until the call's lifetime cuts it, measured by the server's own elapsed timer, or `null` while more
       * than {@link PLAN_CALL_LIMITS.rolloverUrgentMs} remain. A remainder, never a wall-clock instant: the cut is an
       * elapsed timer, and a wall clock stepped either way would move an instant the cut never moved. The server sends the ask again, with this set, as its urgent and last windows open.
       */
      readonly lifetimeRemainingMs: number | null;
      /**
       * Whether the thread's context has passed {@link PLAN_CALL_LIMITS.rolloverContextUrgentShare}, so the page holds
       * this ask at no calmer than `urgent` (`./callRollover.ts`). Sticky: once set, every later ask and replay of this
       * call carries it.
       */
      readonly contextUrgent: boolean;
    }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "closed"; readonly reason: string }
  | PlanLookStartEvent
  | PlanOwedStartEvent
  | PlanAcknowledgedEvent
  | PlanTurnOutcomeEvent
  | PlanHeldAnswerEvent
  | PlanProgressEvent
  | PlanAnnounceEvent
  | PlanUsageEvent
  | PlanTurnEvent
  | PlanModelWaitEvent
  | PlanCodexNoticeEvent
  | PlanWrittenEvent
  | PlanTypedInEvent
  | PlanReopenReminderEvent;

/** What took a reopened call's opening before its reminder: the owner's voice on the page's meter or transcribed, their typing, or the voice. */
export type ReopenReminderGiveWay = "speech" | "transcribed" | "typed" | "voice-spoke";

/**
 * One step of a reopened call's opening window (`./talkPlanReopenReminder.ts`), written into the call file so the
 * window is measured, never assumed: `armed` as the page's connection came up, `handed` once the voice took the
 * reminder, `gave-way` when something took the opening first, `failed` when the voice would not take it. Every
 * duration is on the call's never-stepped elapsed clock, from `armed`.
 */
export interface PlanReopenReminderEvent {
  readonly kind: "reopen-reminder";
  readonly phase: "armed" | "handed" | "gave-way" | "failed";
  /** From `armed` to this step: the deadline firing for `handed`/`failed`, the give-way itself for `gave-way`. */
  readonly elapsedMs: number;
  /** The window this call kept, {@link PLAN_CALL_LIMITS.reopenReminderSilenceMs}. */
  readonly windowMs: number;
  /** The call the owner hung up on. */
  readonly previousCallId: string;
  readonly reason: ReopenReminderGiveWay | null;
  /** From `armed` to the session's answer to the hand-over, for `handed` and `failed`. */
  readonly acceptedElapsedMs: number | null;
  /** Why the voice did not take it, for `failed`. */
  readonly failure: string | null;
}

/**
 * The owner typed or pasted into the Messenger box during this call and the realtime session took it as their turn
 * (`PlanCall.typeIn`). Sent on the call's own stream because the window they typed in may not be the one holding the
 * call: the holder draws it as theirs, writes it into the call file and hears it for the relay gate, once per `messageId`.
 */
export interface PlanTypedInEvent {
  readonly kind: "typed-in";
  readonly messageId: string;
  readonly text: string;
}

/**
 * The console wrote a `turn/start` carrying the frame for the owner's look ask, because it reached the server and no Codex
 * turn started within {@link PLAN_CALL_LIMITS.lookStartMs}: the voice had answered the look itself. Written into the
 * call file, so the next measurement counts how often the console had to start a look. It says the request was
 * written, never that its answer was read.
 */
export interface PlanLookStartEvent {
  readonly kind: "look-start";
}

/**
 * Which of the server's developer messages owed the voice a turn it never handed to Codex — or, for `triage`, owes the
 * turn the console starts itself as soon as the triage clock's line is taken. `walk` is
 * the one owed by no developer message at all: the owner's own final words asked for the next card and no turn started during
 * them (`./talkPlanWalkAsk.ts`).
 */
export type OwedTurnWhy = "resume" | "nudge" | "promise" | "triage" | "walk";

/**
 * The console wrote a `turn/start` of its own because a resume, the owner's nudge or the page's promise press was taken, or the owner's
 * final words asked for the next card, and no Codex turn started within {@link PLAN_CALL_LIMITS.owedTurnStartMs}; or
 * because the triage clock's line was taken and no Codex turn started while it was being written
 * (`./talkPlanOwedTurn.ts`). Written into the call
 * file, so the next measurement counts how often the voice handed nothing over — bar a resume, whose turn is the
 * console's by design (`RESUME_TEXT`), so a taken resume is followed by one unless the voice handed
 * off against its instruction. It says the request was written, never that its answer was read: a start that failed
 * follows as an `error` event.
 */
export interface PlanOwedStartEvent {
  readonly kind: "owed-start";
  readonly why: OwedTurnWhy;
}

/**
 * The voice was given an `ACK_SPEECHES` line (`./talkPlanWords.ts`) because a hand-off of the owner's words went
 * {@link PLAN_CALL_LIMITS.ackHoldMs} with nothing said. Written into the call file, so the next measurement of their
 * silence can tell an acknowledged hand-off from one the voice answered itself.
 */
export interface PlanAcknowledgedEvent {
  readonly kind: "acknowledged";
}

/**
 * A Codex turn the voice was told was on — the console's acknowledgement, or a promise of the voice's own — ended
 * having handed it nothing, or failed, so the voice was given a fixed line saying so (`said`), or that line was not
 * said: a newer turn took the owner's words, those words ran past it, or the session would not take it (`dropped`, with why)
 * (`./talkPlanTurnOutcome.ts`). Written into the call file, so "it said it was checking and never came back" is
 * countable: `grep '"name":"turn-outcome"'` over `$SLOPWEAVER_HOME/talk/calls/*.jsonl`.
 */
export interface PlanTurnOutcomeEvent {
  readonly kind: "turn-outcome";
  readonly turnId: string;
  readonly phase: "said" | "dropped";
  readonly detail: string;
}

/**
 * A message the thinking model completed was held off the voice because the floor was the owner's (`held`, with why), or
 * being handed to the voice (`handing`, the write sent and not yet answered, which can take the voice's whole timeout),
 * handed to it once the floor was free (`released`, with what freed it — the last message of the release named)
 * (`./talkPlanHeldAnswers.ts`), or a release that handed nothing (`failed`, refused or timed out — each also an
 * `error`), or a message not handed because the owner's newer words had overtaken it (`dropped`)
 * or because it was blank or a nod alone, no fault (`dropped`). `held`, `released` and `dropped` are written
 * into the call file, so the next measurement can tell an answer held over the owner's words from one the voice spoke over them. Every one carries whether an answer is STILL owed the voice after
 * it, read off the server rather than rebuilt by the page: a release in flight can be overtaken by a newer hold, so
 * its `released` must not clear that one. The page's rollover holds on it (`pageRolloverHold`, `./callRolloverFloor.ts`).
 * `handing` is what makes that hold whole: an answer released the moment it completes is never `held` first, so without it nothing said it was owed while the voice's write was in flight.
 */
export interface PlanHeldAnswerEvent {
  readonly kind: "held-answer";
  readonly phase: "held" | "handing" | "released" | "failed" | "dropped";
  readonly turnId: string;
  readonly itemId: string;
  readonly detail: string;
  /** Whether at least one completed message is still waiting to be handed to the voice after this event. */
  readonly pending: boolean;
}

/**
 * A delegated turn on a speaking call is still running {@link PLAN_CALL_LIMITS.progressFirstMs} after the voice last
 * spoke, or another {@link PLAN_CALL_LIMITS.progressCueMs} after the last of these: the page plays its `working` cue
 * while that work still runs, the call is quiet and the owner's sound is on. It carries nothing, because what it signals is
 * only that the work goes on; the words that once said so are retired.
 */
export interface PlanProgressEvent {
  readonly kind: "progress";
}

/**
 * The call is about to have the voice say something the owner did not ask for — a focus nudge, a meeting reminder, a send
 * that landed, or something needing their word — so the page plays that kind's herald chime now, and the line is
 * written `ANNOUNCE_LEAD_MS` later (`./announceCue.ts`, `./talkPlanAnnounce.ts`). Replayed to a stream that
 * reconnects inside that lead and never after it: one heard then would sound after the line it heralds.
 */
export interface PlanAnnounceEvent {
  readonly kind: "announce";
  readonly cue: AnnounceCue;
}

/**
 * What the delegated thread has written so far of one message, whole each time. A typed conversation
 * (`./talkTypedSession.ts`) streams it as it grows; a voice call sends only the completed message, which the page
 * writes into the call file beside what the voice said of it. `final` is the item's completion, whose text is
 * authoritative.
 */
export interface PlanWrittenEvent {
  readonly kind: "written";
  readonly turnId: string;
  readonly itemId: string;
  readonly text: string;
  readonly final: boolean;
}

/**
 * The delegated Codex thread's turn starting, doing something, or ending — what tells the orb a hand-off is being
 * worked on, and whether it has gone quiet. Absent fields are `null`, because the event crosses JSON.
 */
export type PlanTurnEvent =
  | { readonly kind: "codex-turn"; readonly phase: "started"; readonly turnId: string }
  | {
      readonly kind: "codex-turn";
      readonly phase: "progress";
      readonly turnId: string;
      readonly step: CodexStep | null;
    }
  | {
      readonly kind: "codex-turn";
      readonly phase: "completed";
      readonly turnId: string;
      readonly status: "completed" | "interrupted" | "failed";
      readonly failure: string | null;
    };

/** How a resume landed: written, refused before anything was written, or not taken by the session. */
export type PlanResumeOutcome =
  | { readonly kind: "sent" }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "failed"; readonly reason: string };

/** How a send outcome landed: handed to the voice now, handed already, refused before anything was written, or failed. */
export type PlanSendOutcomeNotice =
  | { readonly kind: "said" }
  | { readonly kind: "already" }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "failed"; readonly reason: string };

/**
 * How a count or claim grounding landed (`./talkVoiceProvenance.ts`): kept as provenance now, kept already under its
 * key, or refused because the call has ended. Nothing is ever handed to the voice.
 */
export type PlanGroundingOutcome =
  { readonly kind: "recorded" } | { readonly kind: "already" } | { readonly kind: "refused"; readonly reason: string };

/**
 * How a spoken record landed: steered into the turn, refused before anything was written, not taken, or written with
 * no answer read — `unsure`, so the page keeps its lines for the next turn. `steered` proves transport only.
 */
export type PlanSpokenRecordOutcome =
  | { readonly kind: "steered"; readonly turnId: string }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "failed"; readonly reason: string }
  | { readonly kind: "unsure"; readonly reason: string };

/** How a meeting notice landed: said now, said already on this call, refused before anything was written, or failed. */
export type PlanMeetingOutcome =
  | { readonly kind: "said" }
  | { readonly kind: "already" }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "failed"; readonly reason: string };

/** How a drift line landed: said now, claimed already by a call of this server, refused before anything was written, or failed. */
export type PlanDriftOutcome =
  | { readonly kind: "said" }
  | { readonly kind: "already" }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "failed"; readonly reason: string };

/** How an ISO nudge landed: said now, claimed already by a call of this server, refused before anything was written, or failed. */
export type PlanIsoNudgeOutcome = PlanDriftOutcome;

/**
 * How the owner's typed turn landed: taken by the session now, taken already under that id, refused before anything was
 * written, refused by the session, or written with no answer read — `unsure`, so the page never sends it again.
 */
export type PlanTypedInOutcome =
  | { readonly kind: "sent" }
  | { readonly kind: "already" }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "failed"; readonly reason: string }
  | { readonly kind: "unsure"; readonly reason: string };

/** How a nudge landed: sent, with the Codex turns it stopped; refused before anything was written; or failed. */
export type PlanNudgeOutcome =
  | { readonly kind: "sent"; readonly interrupted: readonly string[]; readonly notInterrupted: readonly string[] }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "failed"; readonly reason: string };

/**
 * The delegated Codex thread's token usage after one of its turns. The plan thread is ephemeral, so Codex keeps no
 * rollout of it: this event, written into the call file by the page, is the only record of what a call cost per turn.
 */
export interface PlanUsageEvent {
  readonly kind: "usage";
  readonly turnId: string;
  readonly last: TokenUsageBreakdown;
  readonly total: TokenUsageBreakdown;
  readonly contextWindow: number | null;
}

/** One event with its position, so a reconnecting stream resumes after the last one it saw. */
export interface SequencedEvent {
  readonly seq: number;
  readonly event: PlanCallEvent;
}

/** How a handshake ended. */
export type PlanOpenOutcome =
  | { readonly kind: "open"; readonly sdp: string; readonly threadId: string }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "ambiguous"; readonly reason: string };

/** How an answer the page posted landed. */
export type PlanAnswerOutcome =
  /**
   * `tool` and `arguments`: the tool the answer settled and what the model called it with, as this server received
   * them, which the triage clock reads rather than anything the page says (`./triagePresented.ts`).
   */
  | { readonly kind: "answered"; readonly tool: string; readonly arguments: string }
  | { readonly kind: "refused"; readonly reason: string };

/**
 * Whether the page may run a tool call: only one still waiting, and only once. `tool` and `arguments` on a claim are
 * the call as this server received it, which the triage clock reads before the page can run it (`./triagePresented.ts`),
 * and `turnId` the answer it came in, so a ruling binds to the card in front of the owner as that answer began.
 */
export type PlanClaimOutcome =
  | {
      readonly kind: "claimed";
      readonly tool: string;
      readonly arguments: string;
      readonly turnId: string | undefined;
    }
  | { readonly kind: "refused"; readonly reason: string };

/**
 * What the model reads when the page could not run a tool call because a request between it and this server failed
 * — a claim that got no answer, a real answer that did not arrive, or no claim reaching this server within
 * {@link PLAN_CALL_LIMITS.unclaimedToolMs}. The server writes this for a call nobody claimed rather than the page's own
 * words, so an answer that skipped the run path carries no text of the page's.
 */
export const UNDELIVERED_TOOL_TEXT =
  "The console could not run this tool call: a request between the page and this machine failed. Nothing was done.";
