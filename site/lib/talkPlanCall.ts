/**
 * One Talk call's conversation with its `codex app-server` child on the owner's ChatGPT plan — the handshake that mints it,
 * the tool calls it relays to the page, and every way it ends.
 *
 * The child is reached only through an {@link AppServerPort} and time only through a {@link PlanCallClock}, both
 * handed in, so the whole lifecycle is a unit test (`site/__tests__/unit/talkPlanCall/`) and the real
 * process is `talkPlanLaunch.ts`'s business alone.
 *
 * **One class, built in layers.** `PlanCall` is the class every caller makes and extends; it holds the unasked writes
 * below and sits on a chain of layers that hold the rest, each its own file: the call's state and constructor
 * (`./talkPlanCallBase.ts`), the wire and lifecycle — the handshake, each request, the event stream, the stop
 * (`./talkPlanCallWire.ts`) — the thread's notifications, the rollover and the floor
 * (`./talkPlanCallNotifications.ts`), and the tool relay (`./talkPlanCallTools.ts`).
 *
 * **Definitive or ambiguous — what the refusal the call widget shows says.** Everything that fails before
 * `thread/realtime/start` is written, and a JSON-RPC error answering it, is DEFINITIVE: the plan refused and no
 * realtime session can exist. A timeout, an exit or a missing SDP after it was written is AMBIGUOUS: a plan session
 * may exist, so the child is killed. Either way the call is refused plainly in the widget; nothing is paid for elsewhere
 * (model use rides the ChatGPT plans, never platform.openai usage).
 *
 * **What the page sees is opaque.** A tool call reaches the page as a random token; the server's JSON-RPC id
 * never leaves this module, so a page (or anything posting as one) can answer only a call that is pending, once.
 *
 * **The Codex turns a hand-off becomes reach the page too, and the owner can nudge one that went quiet.** The thread's
 * `turn/started`, `turn/completed` and throttled `item/*` progress are forwarded as `codex-turn` events, so the orb
 * can tell a turn still working from one that stopped. Into the SESSION this server
 * writes unasked by the model only words it owns, or a fact the page read:
 *
 * - an `ackSpeech` line — "on it", worded differently each time — once any hand-off of the owner's words has gone
 *   {@link PLAN_CALL_LIMITS.ackHoldMs} with the voice silent ({@link HandOffSpeech});
 * - {@link PlanCall.sayLooking}, a {@link lookSpeech} line the moment a look or a lookup the owner asked for is handed
 *   off;
 * - {@link PlanCall.nudge}, a developer message the voice answers the owner's last words from, then an interrupt;
 * - {@link PlanCall.resume}, {@link RESUME_TEXT} as a developer message that closes the owner's turn and has the voice
 *   only acknowledge them when their words went unanswered, the thinking model's turn the console's own;
 * - {@link PlanCall.announceSendOutcome}, a Slack send the owner asked for that was held or failed — a server-read
 *   fact, never the page's words, and never one that went;
 * - {@link PlanCall.announceMeeting}, a {@link meetingSpeech} line naming a meeting of the owner's about to start or
 *   started, the one write that, once the meeting has started, cuts in while they talk;
 * - {@link PlanCall.announceTriageDue}, {@link TRIAGE_DUE_ANNOUNCEMENT} once a triage card's clock is up, on a clear
 *   floor;
 * - {@link WindowNoticeLines.announceDrift} (`./talkPlanWindowNotices.ts`, held as {@link PlanCall.windowNotices}), a
 *   `driftSpeech` line naming the owner's plan and the application they drifted into, on a clear floor — only that
 *   label and that name cross, never a window title;
 * - {@link WindowNoticeLines.announceIsoNudge}, the same way, an `isoNudgeSpeech` line naming the ISO card waiting on
 *   the owner when they have strayed off ISO in work hours, at most twice a stretch;
 * - {@link PlanCall.notifyRunningListChanged}, the fixed {@link RUNNING_LIST_CHANGED_TEXT} when the owner puts
 *   something on their running list, never the item itself;
 * - a `TurnOutcomes` line (`./talkPlanTurnOutcome.ts`), a turn the voice was on ending silent or failed.
 *
 * Every one of those goes through {@link PlanCall.speak} or {@link PlanCall.handDeveloperOutcome}, and each names WHY
 * it was written: both funnels record the line and its reason in {@link PlanCall.provenance}
 * (`./talkVoiceProvenance.ts`), which the next spoken record carries into the thread, so "where did that come from" is
 * answered from what the console did rather than "I have no record of that". A count or claim of the voice's that the
 * page finds ungrounded is recorded there too ({@link PlanCall.recordGrounding}) and never handed back to the voice.
 *
 * The owner's own words typed mid-call are not the server's: {@link PlanCall.typeIn} hands them over verbatim as
 * `user` text, and only the {@link TYPED_IN_KICK_TEXT} that may follow them is a line of its own.
 *
 * While a delegated turn runs on with the voice silent it writes nothing: the page is sent a `progress` event, the first
 * {@link PLAN_CALL_LIMITS.progressFirstMs} in and later ones each {@link PLAN_CALL_LIMITS.progressCueMs}, and plays a
 * sound. That window restarts whenever the voice speaks one of the turn's commentary messages — a walk's
 * next question, asked mid-lookup — or a look line or an acknowledgement. Into the delegated THREAD it writes three
 * things unasked by the model: {@link PlanCall.attachLook}, the
 * frame of the owner's screen the page took when they asked for a look, beside a sentence of this server's, steered
 * into the Codex turn answering it or, when the voice handed nothing off, starting that turn;
 * {@link PlanCall.steerSpokenRecord}, the call's completed speech a
 * starting turn has not had, and the draft of the card the owner's words began over, as quoted data; and,
 * when a resume or nudge the voice took starts no turn, the owed turn itself (`./talkPlanOwedTurn.ts`).
 *
 * **It always ends.** A closed realtime transport, a stop, the child exiting, the page's event stream absent past
 * a grace period, or the hard lifetime each stop the call, and stopping kills the child. Rule 2 is why: the
 * delegated model thread lives exactly as long as the visible call does. The lifetime is a backstop the owner should
 * never meet: past {@link PLAN_CALL_LIMITS.rolloverFromMs} the page is told, once, the first time the floor is free, to
 * roll the call over onto a fresh one (`site/lib/callRollover.ts`), so the cut lands in a pause rather than
 * mid-sentence. The same holds sooner once the thread's context passes {@link PLAN_CALL_LIMITS.rolloverContextShare}
 * of its window: a fresh thread in a pause, not a compaction inside the owner's next question.
 */
import type { LookAsk } from "./lookAck";
import type { MeetingNotice } from "./meetingDue";
import {
  PLAN_CALL_LIMITS,
  type PlanFrameOutcome,
  type PlanGroundingOutcome,
  type PlanLookOutcome,
  type PlanMeetingOutcome,
  type PlanNudgeOutcome,
  type PlanResumeOutcome,
  type PlanSendOutcomeNotice,
  type PlanSpokenRecordOutcome,
  type PlanTypedInOutcome,
} from "./planCallContract";
import { sendOutcomeAnnouncement, type UnsentSlackSendOutcome } from "./slackSendWatch";
import { PlanCallTools } from "./talkPlanCallTools";
import {
  floorRefusal,
  floorWithin,
  HELD_ANSWERS_REFUSAL,
  lookRefusal,
  nudgeRefusal,
  ownWriteRefusal,
} from "./talkPlanFloor";
import { meetingLine, type ScriptedLineOutcome, sayScriptedLine } from "./talkPlanNotices";
import { fateOf, type OwnWrite, type RpcOutcome, writeWithProvenance } from "./talkPlanProtocol";
import { RESUME_OVER_TURN_TEXT, resumesOverRunningTurn } from "./talkPlanResumeOverTurn";
import { attachLookFrame, offerProvenance, type SteerState, steerSpokenRecord } from "./talkPlanSteer";
import { interruptTurns, lookTurnOf } from "./talkPlanTurns";
import { lookSpeech, nudgeTextOf, PROMISE_OWED_TEXT, RESUME_TEXT } from "./talkPlanWords";
import type { VoiceGroundingPost } from "./talkVoiceProvenance";
import type { SpokenRecord } from "./talkVoiceRecord";
import { TRIAGE_DUE_ANNOUNCEMENT } from "./triageDueWords";

export type { CallClock, PlanCallClock } from "./talkPlanStart";

/** How the call writes to and ends its child. */
export interface AppServerPort {
  /** Write one line to the child's stdin. */
  readonly write: (input: { readonly line: string }) => void;
  /** Kill the child. Called once, and safe to call on a child that already exited. */
  readonly kill: () => void;
}

/** Why a resume handed the voice Codex's held words: the page's microphone meter heard the owner stop. */
const RESUME_RELEASE_WHY = "the owner's words had gone unanswered and the page judged the silence not theirs";

/** Why a resume over a running turn handed the voice its message: the turn began before the owner's latest words. */
const RESUME_OVER_TURN_WHY = "the owner's words after the running turn began had gone unanswered";

/** A live plan call. */
export class PlanCall extends PlanCallTools {
  /**
   * The third unasked write: the owner asked the voice to look at their screen and the turn has been handed off, so
   * the voice says one {@link lookSpeech} line now rather than going silent (for 11–13s, measured on each of three asks) until the look is answered.
   * The page decides the moment (`foldLookAck`,
   * `./lookAck.ts`) and posts nothing but the press; the words are this server's. Stops nothing, and restarts the
   * progress window once the voice has taken the line. Refused, with nothing written, while a nudge or another look line
   * is being sent; inside {@link PLAN_CALL_LIMITS.lookGapMs} of the last look, nudge or voiced commentary message; and
   * inside {@link PLAN_CALL_LIMITS.nudgeSettleMs} of a Codex turn ending — each
   * would put the look line straight behind speech the voice has not said yet. A lookup the owner asked for (`find`)
   * gets a `FIND_SPEECHES` line (`./talkPlanWords.ts`) on the same terms.
   *
   * @param ask a look at the owner's screen, or a lookup — which the page's fold decided, choosing only the wording
   * @returns the line said, or why none was
   */
  async sayLooking({ ask }: { ask: LookAsk }): Promise<PlanLookOutcome> {
    const refusal = lookRefusal({ floor: this.floor() });
    if (refusal !== undefined) {
      return { kind: "refused", reason: refusal };
    }
    const text = lookSpeech({ ask, said: this.lookSaid });
    this.lookSaid += 1;
    this.lastLookMs = this.clock.nowMs();
    this.looking = true;
    try {
      const why = `the owner asked it to ${ask === "find" ? "look something up" : "look at their screen"} and that was handed off`;
      const spoke = await this.speak({ text, why });
      if (spoke.kind !== "result") {
        return { kind: "failed", reason: `the voice did not say it was looking: ${fateOf({ outcome: spoke })}` };
      }
      // Only a line the voice took restarts the window: a failed one said nothing, so the cue due stays due.
      this.handOff.restartProgress();
      return { kind: "said", text };
    } finally {
      this.looking = false;
    }
  }

  /**
   * The fourth unasked write: the owner's words have gone unanswered and the page judged the silence not theirs
   * (`resumeDueOf`, `./voiceActivity.ts`), so the voice is handed {@link RESUME_TEXT} as a developer message, which
   * closes the owner's turn and asks it only to acknowledge them, and once the session takes it the console starts the
   * thinking model's turn after `PLAN_CALL_LIMITS.owedTurnStartMs` (`./talkPlanOwedTurn.ts`): the answer and the next
   * real item come from that turn, never from the voice's memory. Stops nothing. The reason is that an owner who
   * gives a steer expects the conversation to be driven onto the next thing, and a voice that only shows presence
   * leaves them watching an idle indicator.
   * Refused, with nothing written, whenever other speech or work holds the floor — a nudge or a look line being sent
   * or just said, Codex's words held for the owner or just handed to the voice, a Codex turn running (unless it began
   * before the owner's latest words, when {@link RESUME_OVER_TURN_TEXT} goes with no owed turn,
   * `./talkPlanResumeOverTurn.ts`) or just ended, a tool call waiting
   * on the page, either side transcribed inside {@link PLAN_CALL_LIMITS.resumeQuietMs} — and inside
   * {@link PLAN_CALL_LIMITS.resumeGapMs} of the last resume, or with nothing of the owner's transcribed since it.
   *
   * Codex's words held for the owner are the one exception: when they are the first thing holding the floor, every
   * check ahead of them is clear, so the owed answer goes in place of the sentence. They were held only because the
   * owner's utterance has no `done`, which a resume ignores. Measured on one call: the owner's words stopped and the
   * provider never closed them; the turn's answer, held 59s later, met this resume 5s after that, refused as "what
   * Codex wrote is waiting for the owner to finish", and was dropped unsaid when their next words started a turn — the
   * owner saw it being written and never received it. Repro:
   * `grep -e held-answer -e '"name":"resume"' $SLOPWEAVER_HOME/talk/calls/<call-id>-*.jsonl`, which lists the held answer and the refused resume in each call's record.
   *
   * @returns whether the voice was handed the owed answer or the sentence, or why not
   */
  async resume(): Promise<PlanResumeOutcome> {
    const floor = this.floor();
    // A turn running since before the owner's latest words never heard them, so it holds nothing (`./talkPlanResumeOverTurn.ts`).
    const heard = {
      heardMs: this.lastHeardWordsMs,
      resumedMs: this.lastResumeMs,
      runningStartsMs: [...this.runningTurns].map((turnId) => this.turnStartedMs.get(turnId)),
    };
    const overTurn = resumesOverRunningTurn({ floor, ...heard });
    // The owner's open utterance never holds a resume: it is the backstop for a silence the provider has not closed.
    const refusal = floorRefusal({
      floor,
      openUtterance: "ignore",
      runningTurn: overTurn ? "ignore" : "hold",
      own: [
        [
          this.resuming || floorWithin({ floor, ms: PLAN_CALL_LIMITS.resumeGapMs, since: this.lastResumeMs }),
          "it was asked to take its turn a moment ago",
        ],
        [
          this.lastResumeMs !== undefined &&
            (this.lastHeardTranscribedMs === undefined || this.lastHeardTranscribedMs <= this.lastResumeMs),
          "the owner has said nothing since it was last asked to take its turn",
        ],
      ],
    });
    if (refusal === HELD_ANSWERS_REFUSAL && this.heldAnswers.releaseOnResume({ why: RESUME_RELEASE_WHY })) {
      return { kind: "sent" };
    }
    if (refusal !== undefined) {
      return { kind: "refused", reason: refusal };
    }
    // Taken: the owner's open utterance is a silence the provider never closed, so an answer written after this goes on
    // the quiet rule (`HeldAnswers.resumeAccepted`). Closed before the hand-over, since an answer can land while it is
    // written, and put back if the session refused it.
    const untaken = this.heldAnswers.resumeAccepted();
    this.resuming = true;
    this.lastResumeMs = this.clock.nowMs();
    try {
      const fate = overTurn
        ? await this.resumeOverTurn({ untaken })
        : await this.owedTurns.handing({ text: RESUME_TEXT, untaken, why: "resume" });
      if (fate !== undefined) {
        return { kind: "failed", reason: `the voice was not asked to take its turn: ${fate}` };
      }
      return { kind: "sent" };
    } finally {
      this.resuming = false;
    }
  }

  /**
   * The fifth unasked write: a Slack send the owner asked for on this call did not go — held or failed — and the
   * page's watch (`./slackSendWatch.ts`) hands it here, so the voice tells them without their asking. Measured: the
   * voice said "Yep, got it. You approved the reply to Seth" of a reply the as-me gates had held, and nothing told the
   * owner.
   * A send that went is never handed here: it is not useful for the voice to say it is sent. The page posts only which send; the developer message is
   * {@link sendOutcomeAnnouncement}'s. Delivered once per `noticeId`, so a retry after a lost response is answered `already`.
   * Refused, with nothing written, whenever other speech or work holds the floor, exactly as a resume is — the page
   * holds the outcome and posts it again.
   *
   * @param noticeId the send's id, which the call delivers once
   * @param outcome the held or failed send
   * @returns whether the voice was handed it, had been already, or why not
   */
  async announceSendOutcome({
    noticeId,
    outcome,
  }: {
    noticeId: string;
    outcome: UnsentSlackSendOutcome;
  }): Promise<PlanSendOutcomeNotice> {
    const line = sendOutcomeAnnouncement({ outcome });
    return this.onceLines.say({ busy: "another send outcome is being handed over", id: noticeId, line, turn: "none" });
  }

  /**
   * The ninth unasked write: a triage card's clock is up, so the voice is handed `TRIAGE_DUE_TEXT` and
   * says so, telling the owner when the card's clock is up, and the console starts the thinking model's turn for one
   * suggested verdict itself, never an automatic parking, and never the voice handing off by itself: measured, the
   * voice, asked to hand off, said "Send it, then." itself. The page's clock posts only the visit's id; the
   * words are this server's. Once per visit, claimed before the write as a send outcome is, and refused whenever other
   * speech or work holds the floor — the owner is mid-word on the card, which is no time to cut in — so the page posts
   * again.
   *
   * The route asks it only for the card a `triage_next` answer last put in front of the owner (`./triagePresented.ts`).
   *
   * @param visitId the page's id for one card's time in front of the owner, which the call says once
   * @returns whether the voice was handed it, had been already, or why not — a send outcome's four answers
   */
  async announceTriageDue({ visitId }: { visitId: string }): Promise<PlanSendOutcomeNotice> {
    const busy = "another own line is being handed";
    return this.onceLines.say({ busy, id: visitId, line: TRIAGE_DUE_ANNOUNCEMENT, turn: "triage" });
  }

  /**
   * The seventh unasked write: a meeting of the owner's is about to start or has started while they are on this call,
   * so the voice says one {@link meetingSpeech} line naming it, and the page puts its join link beside the orb. The
   * voice is the best channel for it: measured, the owner was two minutes late to a meeting while talking to the voice,
   * and an owner already talking to it is not watching anything else. The page posts only which notices it has already
   * shown; the meeting is
   * the server's own read (`talk meeting-due`). Said once per `noticeId` across every call of this server
   * (`./meetingLedger.ts`), claimed before the write as a send outcome is, so a retry after a lost response — on this
   * call or the fresh one a rollover made — is answered `already` and never speaks twice.
   *
   * **Before the start it waits for a clear floor**, exactly as a send outcome does. **From the start on it does not**:
   * getting the owner's attention while they talk is the point, so neither their words, the voice's, a tool call nor a running
   * Codex turn holds it — only the call ending, no thread, or another of this server's own writes still being sent,
   * which the page retries in seconds. It stops nothing: no `turn/interrupt`, so no work is lost to it.
   *
   * @param notice the meeting, as the server read it
   * @param nowMs the instant judged at, which says whether the meeting has started
   * @returns whether the line was said, had been already, or why not
   */
  async announceMeeting({ notice, nowMs }: { notice: MeetingNotice; nowMs: number }): Promise<PlanMeetingOutcome> {
    const { started, ...line } = meetingLine({ meetings: this.meetings, notice, nowMs });
    const floor = this.floor();
    const refusal = started
      ? ownWriteRefusal({ floor })
      : floorRefusal({ floor, openUtterance: "hold", own: [], runningTurn: "hold" });
    return this.sayLine({ ...line, refusal, setBusy: ({ busy }) => void (this.announcingMeeting = busy) });
  }

  /**
   * One once-only fixed sentence through {@link sayScriptedLine}: claimed before the write, since one that timed out
   * may still have been spoken, and none is ever said twice.
   *
   * @returns how it landed
   */
  protected override async sayLine(
    line: Omit<Parameters<typeof sayScriptedLine>[0], "speak" | "onSaid" | "ring">,
  ): Promise<ScriptedLineOutcome> {
    const onSaid = (): void => {
      this.handOff.restartProgress();
    };
    return sayScriptedLine({ ...line, onSaid, ring: this.ring, speak: (s) => this.speak(s) });
  }

  /**
   * Have the voice speak one fixed sentence (`thread/realtime/appendSpeech`), kept as provenance by
   * {@link PlanCall.recordedWrite}.
   *
   * @param why what set it off, in words the thinking model can repeat to the owner
   * @returns how the session answered
   */
  protected override async speak({ text, why }: { text: string; why: string }): Promise<RpcOutcome> {
    const params = { text, threadId: this.threadId! };
    return this.recordedWrite({ method: "thread/realtime/appendSpeech", params, source: "spoken-line", text, why });
  }

  /**
   * One write the voice may say, waited out for one step, its text and `why` recorded in {@link PlanCall.provenance}
   * BEFORE the request: a turn steered while it is out carries it. A timeout, or the call ending while it
   * was in flight, may still have been taken, so it stays and starts the gap the floor waits out, as a taken one
   * does; one that failed outright, or a call already over never sent, said nothing and is withdrawn.
   *
   * @returns how the session answered
   */
  private async recordedWrite(write: OwnWrite): Promise<RpcOutcome> {
    this.writes += 1;
    const [atMs, wasLive, key] = [this.clock.nowMs(), !this.ended, `${write.source}:write-${String(this.writes)}`];
    const onTaken = (): void => {
      this.lastOwnLineMs = this.clock.nowMs();
    };
    const send = ({ method, params }: OwnWrite) =>
      this.request({ method, params, timeoutMs: PLAN_CALL_LIMITS.nudgeStepMs });
    return writeWithProvenance({ atMs, key, ledger: this.provenance, onTaken, send, wasLive, write });
  }

  /**
   * The eleventh unasked write: the owner put something on their running list, so the voice is handed
   * {@link RUNNING_LIST_CHANGED_TEXT} as a developer message and reads the list itself — owed rather than dropped
   * while another write holds the floor ({@link ListNotice}).
   *
   * @returns `undefined` once the voice was handed it, else why not, saying when it is owed
   */
  async notifyRunningListChanged(): Promise<string | undefined> {
    return this.listNotice.notify();
  }

  /**
   * The owner's typed turn: what they typed or pasted into the Messenger box mid-call, handed to the session verbatim
   * as `user` text (`./talkPlanTypedIn.ts`). It is the owner's press, so it cuts in as a started meeting does — only the
   * call ending, no thread, or another of this server's own writes in flight holds it — and it stops nothing. Once
   * taken, it is a `typed-in` event on this call's stream, so whichever window holds the call draws it, writes it and
   * hears it, and the floor counts it as the owner's words. Claimed by `messageId` before the write, since one that
   * timed out may still have landed. Then {@link PLAN_CALL_LIMITS.typedInKickMs} for the voice to answer, holding every
   * other own line off; with no worded voice line and no Codex turn, the voice is handed `TYPED_IN_KICK_TEXT`, and with
   * a file they attached still unread by any `file_read`, `TYPED_IN_ATTACHMENT_KICK_TEXT`. A second message of theirs inside that
   * window is taken — a link, then "what does it say?" — and its own window replaces the first's
   * ({@link TypedInTurns}).
   *
   * @param messageId the page's id for the message, which the call hands over once
   * @param text the owner's words, already bounded by the route
   * @returns whether the session took it now, had already, or why not — `unsure` when it may have
   */
  async typeIn({ messageId, text }: { messageId: string; text: string }): Promise<PlanTypedInOutcome> {
    // The owner's typed opening goes first on a reopened call, exactly as a spoken one does.
    this.reopenReminder.giveWay({ reason: "typed" });
    return this.typedIn.take({ messageId, text });
  }

  /**
   * The call's completed speech a starting turn has not had, steered into it (`./talkPlanSteer.ts`), so the thread can
   * correct a count the voice got wrong: measured, the voice denied its own "fourteen cards". With it, the draft of the card the owner's words began over, and the
   * provenance of every line the console wrote since the last record the thread took.
   *
   * @param record the turn the page saw start, its lines and its card's draft, already bounded by the route
   * @returns whether the turn took it, or why not
   */
  async steerSpokenRecord({ record }: { record: SpokenRecord }): Promise<PlanSpokenRecordOutcome> {
    return steerSpokenRecord({ ...this.steerState(), record });
  }

  /**
   * What a spoken record's steer reads of this call.
   *
   * @returns the call's ended reason as read later, its thread, running turns, records in flight, provenance and request
   */
  protected override steerState(): SteerState {
    const { offer, provenance, recording, runningTurns: running, threadId } = this;
    const endedReason = (): string | undefined => this.endedReason;
    return { endedReason, offer, provenance, recording, request: (input) => this.request(input), running, threadId };
  }

  /**
   * Keep one claim of the voice's the page found nothing on the call grounds — a Queue count the app does not show, a
   * done claim or a PR number nothing said first, fleet work promised as its own — as provenance, for the thread to
   * explain if the owner asks. Only a done claim or a fleet promise is handed back, as the fixed correction its route owes
   * {@link PlanCall.corrections} once this keeps it: a
   * correction the voice was told to make and word itself was a line out of nowhere ("Everything's ninety-three."). Kept once per `source` and `key`, so a page's retry is `already` while
   * the count and the claim checks of one voice line, two different findings, keep one each.
   *
   * @returns whether it was kept now, already, or why not
   */
  recordGrounding({ post }: { post: VoiceGroundingPost }): PlanGroundingOutcome {
    if (this.ended) {
      return { kind: "refused", reason: `the call has ended: ${String(this.endedReason)}` };
    }
    const { source, key, text, why } = post;
    const recorded = this.provenance.record({ atMs: this.clock.nowMs(), key: `${source}:${key}`, source, text, why });
    if (recorded) {
      // Into the running turn now, by the call: its line may already be there.
      void offerProvenance(this.steerState());
    }
    return recorded ? { kind: "recorded" } : { kind: "already" };
  }

  /**
   * Hand the voice a developer message it answers in its own words — seconds later, so the instant the session took it
   * starts the gap the floor waits out, as {@link PlanCall.speak} does.
   *
   * @param why what set it off, which the call's provenance keeps
   * @returns `undefined` once the session took it, else its fate in words
   */
  protected override async handDeveloperText({
    text,
    why,
  }: {
    text: string;
    why: string;
  }): Promise<string | undefined> {
    const handed = await this.handDeveloperOutcome({ text, why });
    return handed.kind === "result" ? undefined : fateOf({ outcome: handed });
  }

  /**
   * Hand the voice {@link RESUME_OVER_TURN_TEXT}, arming no owed turn: the turn already running answers. Mirrors
   * `OwedTurnStarts.handing`: only a write the session surely did not take puts the owner's utterance back.
   *
   * @param untaken told once when the session refused it, ended or threw — never on a timeout, which may have been taken
   * @returns `undefined` once the session took it, else its fate in words
   */
  private async resumeOverTurn({ untaken }: { untaken: () => void }): Promise<string | undefined> {
    const handed = await this.handDeveloperOutcome({ text: RESUME_OVER_TURN_TEXT, why: RESUME_OVER_TURN_WHY });
    if (handed.kind !== "result" && handed.kind !== "timeout") {
      untaken();
    }
    return handed.kind === "result" ? undefined : fateOf({ outcome: handed });
  }

  /**
   * {@link handDeveloperText}'s request (`thread/realtime/appendText`), kept as provenance by
   * {@link PlanCall.recordedWrite}.
   *
   * @param why what set it off, which the call's provenance keeps
   * @returns the request's outcome
   */
  protected override async handDeveloperOutcome({ text, why }: { text: string; why: string }): Promise<RpcOutcome> {
    const params = { role: "developer", text, threadId: this.threadId! };
    return this.recordedWrite({ method: "thread/realtime/appendText", params, source: "developer-message", text, why });
  }

  /**
   * The frame the page took for the owner's look ask, into the Codex turn answering it, so the thread answers from the
   * screen as the owner saw it rather than deciding whether to call `read_screen`, which, measured on four calls, it
   * often did late or not at all (`docs/console/voice-sees-the-owners-screen.md`). The newest running turn takes it as a
   * steer; with none running yet it waits {@link PLAN_CALL_LIMITS.lookStartMs} for the voice's hand-off to start one,
   * and past it starts the turn itself with the frame as its input — the page takes the frame when the owner's words are
   * final, hand-off or not, so a look the voice answered itself still reaches the thinking model, and its answer reaches
   * the owner. It never asks the voice to hand the look over: measured on one call, told to, the voice said "Having a
   * look." and started nothing, the frame expired, and the owner asked where the screenshot was. The words beside
   * the picture are fixed (`./talkPlanSteer.ts`'s `attachLookFrame`); only the picture is the page's.
   *
   * @param imageUrl the frame, a `data:image/` URL the route has already bounded
   * @returns the turn it was steered into or started, or why neither
   */
  async attachLook({ imageUrl }: { imageUrl: string }): Promise<PlanFrameOutcome> {
    return attachLookFrame({
      endedReason: () => this.endedReason,
      imageUrl,
      lookStart: this.lookStart,
      onLookStart: () => {
        this.emit({ event: { kind: "look-start" }, telemetry: true });
      },
      request: (input) => this.request(input),
      threadId: this.threadId,
      turnForFrame: () => lookTurnOf({ clock: this.clock, running: this.runningTurns, waiters: this.turnWaiters }),
    });
  }

  /**
   * The owner's nudge: hand the voice `NUDGE_TEXT` — `NUDGE_STOPPED_TEXT` when a Codex turn is running, `NUDGE_OWED_TEXT`
   * when the voice was transcribed after them (`nudgeTextOf`, `./talkPlanWords.ts`) — as a developer message it answers
   * in its own words, then stop the Codex turns that were running at the press, so the voice answers the owner's last
   * words rather than a fixed line and, when the turn is its own, carries on rather than handing the
   * floor back. The message goes FIRST because
   * an interrupt alone leaves the voice silent (measured, 20s with nothing said), and an interrupt that is
   * then not followed by the voice is worse than no nudge at all. Refused, with nothing written, while a tool call
   * waits on the page — stopping a turn mid-write hides what it wrote and invites the write again — and just after a
   * turn ended, when its answer is about to be spoken.
   *
   * With `promised`, the press is the PAGE's, over a promise the voice made and never started (`promiseDueOf`,
   * `./voiceOwed.ts`): it hands {@link PROMISE_OWED_TEXT}, is refused over a running
   * Codex turn — that turn is the promise being kept — and stops nothing. It holds every other unasked line off exactly
   * as the owner's press does; the page offers the owner's own press only {@link PLAN_CALL_LIMITS.nudgeGapMs} or more
   * after it.
   *
   * @param promised whether the page pressed it itself over a promise, rather than the owner did
   * @returns whether the voice was asked to answer, and which Codex turns were stopped
   */
  async nudge({ promised }: { promised: boolean }): Promise<PlanNudgeOutcome> {
    // The owner's press over an answer held for them to finish is them finishing: it goes now, and no turn is stopped.
    if (!promised && this.heldAnswers.releaseNow({ why: "the owner nudged" })) {
      return { interrupted: [], kind: "sent", notInterrupted: [] };
    }
    const refusal = nudgeRefusal({ floor: this.floor(), promised });
    if (refusal !== undefined) {
      return { kind: "refused", reason: refusal };
    }
    if (promised && this.runningTurns.size > 0) {
      return { kind: "refused", reason: "a Codex turn is already keeping the promise" };
    }
    const threadId = this.threadId!;
    this.nudging = true;
    this.lastNudgeMs = this.clock.nowMs();
    // The turns running at the owner's press. Taken before the write: the voice may answer it by handing their words to a fresh
    // Codex turn, which is the nudge working, never a turn to stop. A promise's press found none, and stops none.
    const running = promised ? [] : Array.from(this.runningTurns);
    try {
      const at = { heardAt: this.lastHeardTranscribedMs, voiceAt: this.lastVoiceTranscribedMs };
      const text = promised ? PROMISE_OWED_TEXT : nudgeTextOf({ ...at, runningTurns: running.length });
      // Armed before the write, so only a turn starting after the press counts: one running at it is being stopped.
      const fate = await this.owedTurns.handing({ text, why: promised ? "promise" : "nudge" });
      if (fate !== undefined) {
        return { kind: "failed", reason: `the voice was not asked to answer: ${fate}` };
      }
      const request = (input: { method: string; params: unknown; timeoutMs: number }) => this.request(input);
      return { ...(await interruptTurns({ request, threadId, turnIds: running })), kind: "sent" };
    } finally {
      this.nudging = false;
    }
  }
}
