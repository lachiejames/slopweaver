/**
 * What a plan call (`PlanCall`, `./talkPlanCall.ts`) does with each notification its child sends — the SDP, a
 * realtime error or close, both sides' transcripts, the thread's token usage, its Codex turns starting and ending,
 * their item progress and completed messages — and the rollover that usage or age makes owed, judged against the
 * floor this layer gathers. Methods only — the state is `./talkPlanCallBase.ts`'s.
 */
import { CANDID_ANSWER } from "./coverageHold";
import { contextRolloverDue, contextRolloverUrgent, PLAN_CALL_LIMITS } from "./planCallContract";
import { PlanCallWire } from "./talkPlanCallWire";
import type { PlanFloor } from "./talkPlanFloor";
import { turnItemMoveOf } from "./talkPlanModelWait";
import { fateOf, paramString, type RpcOutcome } from "./talkPlanProtocol";
import { threadTokenUsageOf } from "./talkPlanProtocolItems";
import { agentMessageOf, codexTurnOf, startedTurnIdOf } from "./talkPlanProtocolTurns";
import { offerProvenance, type SteerState } from "./talkPlanSteer";
import { codexNoticeEventsOf, itemEventsOf, turnStarted } from "./talkPlanTurns";
import { processTriagePresented } from "./triagePresented";

/** A plan call's notifications, rollover and floor, above its wire. */
export abstract class PlanCallNotifications extends PlanCallWire {
  /** What a spoken record's steer reads of this call (`./talkPlanCall.ts`). */
  protected abstract steerState(): SteerState;

  /**
   * A notification: the SDP, a close, an error, the Codex turn, or a realtime transcript. The page reads the
   * transcript off the data channel, and the app-server sends this process its own copy, both sides, with the thread id.
   *
   * @param method its method
   * @param params its params
   */
  protected override notification({ method, params }: { method: string; params: unknown }): void {
    if (method === "thread/realtime/sdp") {
      const sdp = paramString({ key: "sdp", params });
      if (sdp !== undefined && sdp !== "") {
        this.sdpWaiter?.(sdp);
        this.sdpWaiter = undefined;
      }
    } else if (method === "thread/realtime/error") {
      const said = paramString({ key: "message", params });
      const unnamed = said === undefined || said === "";
      this.emit({ event: { kind: "error", message: unnamed ? "an unnamed realtime error" : said } });
    } else if (method.startsWith("thread/realtime/transcript/")) {
      // `delta` and `done`, both sides', as a live call carries them; another thread's says nothing about this one.
      const threadId = paramString({ key: "threadId", params });
      if (threadId === undefined || threadId === this.threadId) {
        this.lastTranscribedMs = this.clock.nowMs();
        // Only the exact `done` closes the owner's utterance or supersedes a held answer; a name this parser has not met
        // keeps the floor the owner's, as a delta does.
        const phase = method === "thread/realtime/transcript/done" ? "done" : "delta";
        // Anything not the owner's is the voice's: read wider rather than narrower, so a role this parser has not met holds an
        // acknowledgement back instead of letting one talk over the voice.
        if (paramString({ key: "role", params }) === "user") {
          this.lastHeardTranscribedMs = this.lastTranscribedMs;
          // The exact delta carrying text only: `done` repeats the whole utterance, often after the turn it started, and
          // a name this parser has not met proves no speech.
          const exactDelta = method === "thread/realtime/transcript/delta";
          const words = exactDelta ? paramString({ key: "delta", params }) : undefined;
          if (words !== undefined && words.trim() !== "") this.lastHeardWordsMs = this.lastTranscribedMs;
          // The page's meter hears the owner first; their transcribed words are the backstop for a post that never came.
          this.reopenReminder.giveWay({ reason: "transcribed" });
          this.heldAnswers.heardIn({ atMs: this.lastTranscribedMs, params, phase });
          // After the held answers took the owner's words, so the final transcript is on record before any walk turn can start.
          this.walkAsk({ params, phase });
        } else {
          this.lastVoiceTranscribedMs = this.lastTranscribedMs;
          // The voice speaking first — a console line, or a greeting of its own — is the call's opening line already.
          this.reopenReminder.giveWay({ reason: "voice-spoke" });
          // A wordless "." still holds the floor above, but answers none of the owner's typed turns.
          this.typedIn.voiceTranscribed({ text: paramString({ key: phase === "done" ? "text" : "delta", params }) });
          this.handOff.holdProgress();
          if (method === "thread/realtime/transcript/done") this.turnOutcomes.voiceSaid({ params });
        }
      }
    } else if (method === "thread/tokenUsage/updated") {
      this.tokenUsage({ params });
    } else if (method === "turn/started" || method === "turn/completed") {
      this.codexTurn({ params, started: method === "turn/started" });
    } else if (method.startsWith("item/")) {
      this.turnActivity({ method, params });
      this.completedMessage({ method, params });
    } else if (method === "error" || method === "warning") {
      const turns = { running: this.runningTurns, threadId: this.threadId };
      const events = this.ended ? [] : codexNoticeEventsOf({ ...turns, method, params });
      for (const event of events) this.emit({ event, telemetry: true });
    } else if (method === "thread/realtime/closed") {
      const reason = paramString({ key: "reason", params });
      this.stop({
        reason: reason === undefined ? "the realtime transport closed" : `the realtime transport closed: ${reason}`,
      });
    }
  }

  /**
   * The owner's words, watched for a next-card ask no turn answered (`./talkPlanWalkWatch.ts`): a delta fixes the utterance's
   * count of turn starts, and a `done` that asked for the next card with none started opens the owed start's window
   * with no developer message (`OwedTurnStarts.startWindow`). MEASURED on one call: "All right, next
   * card please" drew "Pulling it up now. Okay, got it here." and no turn for 25s, and the card stayed up 40s.
   *
   * @param params the transcript notification's params
   * @param phase whether it is a delta or the owner's utterance's `done`
   */
  private walkAsk({ params, phase }: { params: unknown; phase: "delta" | "done" }): void {
    if (phase === "delta") {
      this.walkAsks.heard();
      return;
    }
    const text = paramString({ key: "text", params });
    if (!this.ended && this.walkAsks.done({ running: this.runningTurns.size, text })) {
      this.owedTurns.startWindow({ why: "walk" });
    }
  }

  /**
   * A message this call's own thread completed, forwarded whole so the page writes it into the call file beside what
   * the voice said of it. Measured: the voice said "that covers fourteen cards", and with only the spoken line on
   * record nothing could say whether the thinking model wrote fourteen or the voice made it
   * up — so the thinking model blamed speech, and the owner heard it deny a line it had said. A voice call only: a typed
   * conversation streams its own (`./talkTypedSession.ts`), and each completed message is sent once, then held for
   * the voice until the owner's words go quiet (`HeldAnswers`, `./talkPlanHeldAnswers.ts`), since the call manages its own
   * handoffs.
   *
   * @param method the notification's method
   * @param params its params
   */
  private completedMessage({ method, params }: { method: string; params: unknown }): void {
    if (this.surface !== "voice" || this.ended) {
      return;
    }
    const piece = agentMessageOf({ method, params });
    if (piece?.kind !== "completed" || piece.threadId !== this.threadId || this.completedItems.has(piece.itemId)) {
      return;
    }
    this.completedItems.add(piece.itemId);
    const { commentary, itemId, text, turnId } = piece;
    this.emit({ event: { final: true, itemId, kind: "written", text, turnId } });
    // Before it is held for the voice: an answer claiming a whole read over a read still cut never reaches it
    // (`./coverageHold.ts`).
    const verdict = this.coverage.judge({ text, turnId });
    if (verdict.kind === "hand") {
      this.heldAnswers.hold({ answer: { commentary, itemId, text, turnId } });
      return;
    }
    const pending = this.heldAnswers.count() > 0;
    const candid = (): void => {
      this.heldAnswers.hold({ answer: { commentary, itemId, text: CANDID_ANSWER, turnId } });
    };
    // What takes the claim's place is in hand before the event goes out, so no listener can leave it with none.
    if (verdict.kind === "candid") {
      candid();
    } else {
      void this.readOnTurn({ candid, text: verdict.turnText });
    }
    const detail = `held back from the voice: it claims ${verdict.claims.join(" ")} over a read still cut`;
    this.emit({ event: { detail, itemId, kind: "held-answer", pending, phase: "dropped", turnId } });
  }

  /**
   * Send the thinking model back to read on: `turn/start` adds its input to a turn still running, else starts one,
   * whose answer reaches the voice as a hand-off's does. A send-back that did not start, a timeout included, is said as
   * the call's `error` and the candid line is held in the claim's place, so a lost send-back never leaves silence.
   * The voice stops waiting after `nudgeStepMs`, but the request stays open for
   * the call's life: the wire sends no cancel, so a late start may still run, and only its answer says which turn it is.
   * Until then no turn start wipes the cuts it reads on from, and after an
   * answer naming no turn, an error included, none does for the rest of the call.
   *
   * @param text the developer text naming the claim held and the reads that stand cut
   * @param candid holds the candid line for the voice in place of the held answer
   */
  private async readOnTurn({ text, candid }: { text: string; candid: () => void }): Promise<void> {
    if (this.ended) {
      this.coverage.sendBackRefused();
      return;
    }
    const threadId = this.threadId;
    if (threadId === undefined) {
      this.coverage.sendBackRefused();
      candid();
      return;
    }
    let settled = false;
    const notStarted = (outcome: RpcOutcome): void => {
      if (settled || this.ended) {
        return;
      }
      settled = true;
      const message = `an answer held back for a cut read was not sent back to read on: ${fateOf({ outcome })}`;
      // The candid line is held first, so nothing a listener of the error does can leave the claim with no answer.
      candid();
      this.emit({ event: { kind: "error", message } });
    };
    const cancelWait = this.clock.after({
      ms: PLAN_CALL_LIMITS.nudgeStepMs,
      run: () => {
        notStarted({ kind: "timeout" });
      },
    });
    const params = { input: [{ text, type: "text" }], threadId };
    const started = await this.request({ method: "turn/start", params, timeoutMs: PLAN_CALL_LIMITS.lifetimeMs });
    cancelWait();
    const turnId = started.kind === "result" ? startedTurnIdOf({ result: started.result }) : undefined;
    if (turnId === undefined) {
      this.coverage.sendBackUnbound();
    } else {
      this.coverage.sendBackStarted({ turnId });
    }
    if (started.kind === "result") {
      settled = true;
      return;
    }
    notStarted(started);
  }

  /**
   * The delegated thread's usage after a turn: this call's own thread becomes a `usage` event; another thread's is
   * ignored; a malformed one of its own is said as an error, so a lost measurement is never silent.
   *
   * @param params the notification's params
   */
  private tokenUsage({ params }: { params: unknown }): void {
    if (this.ended) {
      return;
    }
    const usage = threadTokenUsageOf({ params });
    if (usage === undefined) {
      if (paramString({ key: "threadId", params }) === this.threadId) {
        const message = "the plan thread reported token usage the console cannot read";
        this.emit({ event: { kind: "error", message }, telemetry: true });
      }
      return;
    }
    if (usage.threadId !== this.threadId) {
      return;
    }
    const { contextWindow, last, total, turnId } = usage;
    this.emit({ event: { contextWindow, kind: "usage", last, total, turnId }, telemetry: true });
    if (contextRolloverUrgent({ contextWindow, inputTokens: last.inputTokens })) {
      // Past the urgent share the page's floor stops waiting on the next turn, told or not.
      this.rolloverAsk.contextUrgent();
    } else if (!this.rolloverAsk.told && contextRolloverDue({ contextWindow, inputTokens: last.inputTokens })) {
      // Whatever its age: the next free floor beats a compaction that would land inside the owner's next question. Armed,
      // never checked here, so a typed conversation's no-op `armRollover` still keeps it from ever rolling over.
      this.rolloverAsk.contextDue();
      this.armRollover({ ms: 0 });
    }
  }

  /**
   * A Codex turn of this call's own thread starting or ending, forwarded so the orb shows the work a hand-off became
   * and can tell a turn that went quiet from one still going. Another thread's is ignored; a malformed one of its own
   * is said as an error, like usage, so a turn the orb cannot see is never silent.
   *
   * @param params the notification's params
   * @param started whether it is `turn/started` rather than `turn/completed`
   */
  private codexTurn({ params, started }: { params: unknown; started: boolean }): void {
    if (this.ended) {
      return;
    }
    const notice = codexTurnOf({ params });
    if (notice === undefined) {
      this.unreadableTurn({ params });
      return;
    }
    if (notice.threadId !== this.threadId) {
      return;
    }
    const { failure, status, turnId } = notice;
    // A replayed start of a turn already completed is nothing running: neither the cue nor the page's row reopens.
    if (started && this.handOff.hasEnded({ turnId })) {
      return;
    }
    if (started) {
      // First, so nothing this start sets off — a listener nudging, say — can release an answer it overtook.
      if (status === "inProgress") this.heldAnswers.turnStarted({ turnId });
      // A new ask's turn, never the owner's late `done`, is where the cut reads stop holding (`./coverageHold.ts`).
      const othersRunning = [...this.runningTurns].filter((running) => running !== turnId).length;
      if (status === "inProgress") this.coverage.turnStarted({ othersRunning, turnId });
      // A turn that started during the owner's words answers them, even one ended by the owner's `done` (`./talkPlanWalkWatch.ts`); a
      // start that arrives already terminal is one too, so any status counts.
      this.walkAsks.turnStarted({ turnId });
      // Any start, a terminal one too: it is the newest turn, whose end alone is read.
      this.turnOutcomes.turnStarted({ turnId });
      // The card in front of the owner as this answer began, which a triage ruling in it is about.
      processTriagePresented().turnStarted({ call: this, turnId });
      turnStarted({ running: this.runningTurns, turnId, waiters: this.turnWaiters });
      // Its first start only: a replayed one is the same turn, which began then.
      if (!this.turnStartedMs.has(turnId)) this.turnStartedMs.set(turnId, this.clock.nowMs());
      this.emit({ event: { kind: "codex-turn", phase: "started", turnId }, telemetry: true });
      if (status === "inProgress") {
        // Its request is out to the model until an item starts; a replayed start keeps the wait it opened.
        const startedMs = this.clock.nowMs();
        turnItemMoveOf({ input: { kind: "turn-started", turnId }, nowMs: startedMs, turns: this.turnItems });
        this.handOff.turnStarted({ turnId });
        // An offer no turn took is owed to this one, which no page post may carry.
        if (this.offer.owed) void offerProvenance(this.steerState());
        return;
      }
      // A start whose own payload says the turn is over is not a hand-off the owner is waiting on, nor
      // work still running: it ends here too, so it never holds the progress cue or the page's row open.
    }
    // A completion still in progress says nothing about how the turn ended: unreadable, and the turn stays open.
    // Read before `turnEnded` records it: a replayed completion is the same turn ending, so it is not counted twice
    // (counted, it would suppress the walk start the owner's next-card ask is owed).
    const firstEnd = !this.handOff.hasEnded({ turnId });
    // A first completion of a turn whose start was never read is a turn that ran, whose late start will be dropped
    // above: the walk watch counts it as a start, so one inside the owner's words still answers them — an unreadable one too,
    // since it can only make the console owe less.
    if (!started && firstEnd && !this.runningTurns.has(turnId)) this.walkAsks.turnStarted({ turnId });
    if (status === "inProgress") {
      this.unreadableTurn({ params });
      return;
    }
    this.runningTurns.delete(turnId);
    this.coverage.turnEnded({ turnId });
    this.turnStartedMs.delete(turnId);
    this.progressSentMs.delete(turnId);
    const nowMs = this.clock.nowMs();
    const { wait } = turnItemMoveOf({ input: { kind: "turn-ended", turnId }, nowMs, turns: this.turnItems });
    if (wait !== undefined) this.emit({ event: wait, telemetry: true });
    this.handOff.turnEnded({ turnId });
    if (this.runningTurns.size === 0) {
      this.handOff.turnsDone();
    }
    this.lastTurnEndedMs = this.clock.nowMs();
    if (firstEnd) this.turnsEnded += 1;
    // Before the page hears of the end, so no listener acts ahead of the line the end may owe.
    this.turnOutcomes.turnEnded({ end: status, turnId });
    this.emit({ event: { failure, kind: "codex-turn", phase: "completed", status, turnId }, telemetry: true });
  }

  /**
   * Say a turn notification of this call's own thread could not be read; another thread's is ignored.
   *
   * @param params the notification's params
   */
  private unreadableTurn({ params }: { params: unknown }): void {
    if (paramString({ key: "threadId", params }) === this.threadId) {
      const message = "the plan thread reported a Codex turn the console cannot read";
      this.emit({ event: { kind: "error", message }, telemetry: true });
    }
  }

  /**
   * One item notification inside a running Codex turn of this call's own thread, forwarded as the wait it closed and
   * the turn's progress when one is due (`itemEventsOf`, `./talkPlanTurns.ts`).
   *
   * @param method the notification's method
   * @param params the notification's params
   */
  private turnActivity({ method, params }: { method: string; params: unknown }): void {
    if (this.ended) {
      return;
    }
    const events = itemEventsOf({
      method,
      nowMs: this.clock.nowMs(),
      params,
      running: this.runningTurns,
      sentMs: this.progressSentMs,
      threadId: this.threadId,
      turns: this.turnItems,
    });
    for (const event of events) this.emit({ event, telemetry: true });
  }

  /**
   * Look at the floor for a rollover after `ms`, once (`./talkPlanRolloverAsk.ts`); a typed conversation overrides
   * this to never look.
   *
   * @param ms how long from now
   */
  protected override armRollover({ ms }: { ms: number }): void {
    this.rolloverAsk.arm({ ms });
  }

  /**
   * This call's state now, as the floor checks (`./talkPlanFloor.ts`) read it.
   *
   * @returns the snapshot
   */
  protected override floor(): PlanFloor {
    return {
      announcing: this.onceLines.busy,
      announcingWindowNotice: this.windowNotices.busy,
      announcingMeeting: this.announcingMeeting,
      correctingCompletion: this.corrections.busy,
      reportingTurnOutcome: this.turnOutcomes.busy,
      ended: this.ended,
      endedReason: this.endedReason,
      ...this.handOff.floor(),
      ...this.heldAnswers.floor(),
      lastLookMs: this.lastLookMs,
      lastNudgeMs: this.lastNudgeMs,
      lastResumeMs: this.lastResumeMs,
      lastOwnLineMs: this.lastOwnLineMs,
      lastTranscribedMs: this.lastTranscribedMs,
      lastTurnEndedMs: this.lastTurnEndedMs,
      looking: this.looking,
      nowMs: this.clock.nowMs(),
      nudging: this.nudging,
      pendingTools: this.pending.size,
      resuming: this.resuming,
      runningTurns: this.runningTurns.size,
      threadId: this.threadId,
      typingIn: this.typedIn.holding(),
      waitingRequests: this.waiting.size,
    };
  }
}
