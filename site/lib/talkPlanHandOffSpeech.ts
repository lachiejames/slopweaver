/**
 * What the call does while a hand-off of the owner's words runs, so they are never left wondering whether the call dropped: an
 * {@link ackSpeech} line — "on it" — a second into the hand-off, said by the voice through a plan call's
 * `thread/realtime/appendSpeech` (`./talkPlanCall.ts`, which owns the session), and a `progress` event once it runs on
 * with the voice silent, which the page plays as its `working` cue — a sound, never words. This owns only their
 * timing. Split from that file, which sits at its 300-line cap.
 *
 * Why: silence from the voice could mean the call disconnected, so a hand-off that runs for ten or twenty seconds
 * with no update reads as a drop. MEASURED on 8 calls: of 192 hand-offs of the owner's words, the voice's first words
 * came a median 4.6s after the owner stopped, 91 of them past 5s and 37 past 10s, and only 2 opened on a look or find
 * line (`./lookAck.ts`), the one hand-off line there was. Repro: for each `codex … started` tool line between the
 * owner's words and the voice's next segment in a call's `$SLOPWEAVER_HOME/talk/calls/*.jsonl`, that segment's
 * `atIso` minus the later of the hand-off and the owner's last segment whose text changed. The why, at length:
 * `docs/console/walk-silences.md`.
 *
 * The update between is a subtle sound effect rather than a spoken line, because spoken words there were annoying;
 * the cadence stayed and the words went.
 */
import { PLAN_CALL_LIMITS, type PlanCallEvent } from "./planCallContract";
import { fateOf, type RpcOutcome } from "./talkPlanProtocol";
import type { CallClock } from "./talkPlanStart";
import { ackSpeech } from "./talkPlanWords";

/** What the hand-off speech reads of the call it speaks on, and the two things it does there. */
export interface HandOffCall {
  /** The call has not ended, and has a voice to speak — a typed conversation has none. */
  readonly speaks: () => boolean;
  /** Codex turns started and not completed. */
  readonly runningTurns: ReadonlySet<string>;
  /** Why the floor will not take an acknowledgement now (`ackRefusal`, `./talkPlanFloor.ts`). */
  readonly ackRefusal: () => string | undefined;
  /** When the realtime session last transcribed the owner, and when the voice. */
  readonly transcribed: () => { readonly heardAt: number | undefined; readonly voiceAt: number | undefined };
  /** Have the voice say one line, naming why for the call's provenance (`./talkVoiceProvenance.ts`). */
  readonly speak: (input: { readonly text: string; readonly why: string }) => Promise<RpcOutcome>;
  /** Tell the page's stream. */
  readonly emit: (input: { readonly event: PlanCallEvent }) => void;
  /**
   * The acknowledgement for this turn may have been said — taken, or timed out — so the voice told the owner it was on it
   * (`./talkPlanTurnOutcome.ts`).
   */
  readonly acknowledgementTaken: (input: { readonly turnId: string }) => void;
}

/** The acknowledgement line and progress cues of one plan call. */
export class HandOffSpeech {
  private readonly clock: CallClock;
  private readonly call: HandOffCall;
  /** The armed progress cue, while a delegated turn runs. */
  private cancelProgress: (() => void) | undefined;
  /**
   * Whether a progress cue has been sent since the voice last spoke, which sets how long the next one waits:
   * {@link PLAN_CALL_LIMITS.progressFirstMs} for the first, {@link PLAN_CALL_LIMITS.progressCueMs} after it.
   */
  private progressSinceVoiced = false;
  /**
   * When the current first window opened — the newest turn's start or the voice's last words — so a cue armed late,
   * once the call can speak, still falls due {@link PLAN_CALL_LIMITS.progressFirstMs} after that instant.
   */
  private progressFromMs = 0;
  /** The armed acknowledgement of a hand-off, while one waits on its hold or on the owner's words going quiet. */
  private cancelAck: (() => void) | undefined;
  /** An acknowledgement's request is unanswered. */
  private acking = false;
  /** When the last acknowledgement was written. */
  private lastAckMs: number | undefined;
  /** How many acknowledgements this call has spoken, which picks the next one's wording. */
  private ackSaid = 0;
  /** Every turn whose start has been seen: a start repeated or replayed later is not a new hand-off. */
  private readonly seenTurns = new Set<string>();
  /** Every turn that has completed: a replayed start never makes it running again, and its ack stays unsaid. */
  private readonly endedTurns = new Set<string>();

  /**
   * The speech of one call.
   *
   * @param clock the call's own time
   * @param call what it reads of the call, and how it speaks there
   */
  constructor({ clock, call }: { clock: CallClock; call: HandOffCall }) {
    this.clock = clock;
    this.call = call;
  }

  /**
   * This speech's part of the call's floor (`PlanFloor`, `./talkPlanFloor.ts`). A progress cue is a sound on the page,
   * never a write into the session, so it holds nothing here.
   *
   * @returns whether an acknowledgement is being sent, and when the last was written
   */
  floor(): { acking: boolean; lastAckMs: number | undefined } {
    const { acking, lastAckMs } = this;
    return { acking, lastAckMs };
  }

  /**
   * A Codex turn of the owner's words started: arm its acknowledgement, in place of any still waiting — the newest hand-off is
   * the one the owner is waiting on, and two lines are never owed at once — and the progress cue's first window from now. A turn
   * whose start was seen before — running or completed, and whether or not the call could speak then — arms nothing
   * new: its hold would restart from the repeat, past its real give-up, and one turn could be said to be on twice.
   * **What it does not close:** a start the call dropped before it knew its thread (one
   * arriving in the same chunk as `thread/start`'s answer) is never seen here, so a replay of it much later reads as a
   * first start. No hand-off can exist before the realtime session that hears the owner's words, so no live call has produced
   * one; a call-wide record of every start PlanCall received, routed or not, is the mechanism that would close it.
   *
   * @param turnId the turn the hand-off became
   */
  turnStarted({ turnId }: { turnId: string }): void {
    if (this.seenTurns.has(turnId)) {
      this.armProgress();
      return;
    }
    this.seenTurns.add(turnId);
    // A new hand-off is a first window from its own start, though another turn's cue was already armed.
    this.restartProgress();
    this.cancelAck?.();
    this.cancelAck = undefined;
    if (!this.call.speaks()) {
      return;
    }
    const startedMs = this.clock.nowMs();
    this.cancelAck = this.clock.after({
      ms: PLAN_CALL_LIMITS.ackHoldMs,
      run: () => {
        this.cancelAck = undefined;
        this.checkAck({ startedMs, turnId });
      },
    });
  }

  /**
   * A Codex turn completed: its acknowledgement is never said after this, though its start arrives again.
   *
   * @param turnId the turn that completed
   */
  turnEnded({ turnId }: { turnId: string }): void {
    this.endedTurns.add(turnId);
  }

  /**
   * Whether a turn has completed on this call, so a replay of its start is no work starting again:
   * put back among the running, it would hold the progress cue on after every real turn had completed.
   *
   * @param turnId the turn a start names
   * @returns true when that turn has already completed
   */
  hasEnded({ turnId }: { turnId: string }): boolean {
    return this.endedTurns.has(turnId);
  }

  /** Every running turn has completed: no cue falls due after it, and the next hand-off's cue is a first one. */
  turnsDone(): void {
    this.cancelProgress?.();
    this.cancelProgress = undefined;
    this.progressSinceVoiced = false;
  }

  /**
   * The voice has just spoken a line the server knows of — a commentary message, a look line, an acknowledgement — so
   * the next progress cue is a whole {@link PLAN_CALL_LIMITS.progressFirstMs} from now rather than from the turn's
   * start: a walk's next question is voiced mid-lookup, and a signal timed from the start landed on it (live probe).
   */
  restartProgress(): void {
    this.cancelProgress?.();
    this.cancelProgress = undefined;
    this.progressSinceVoiced = false;
    this.progressFromMs = this.clock.nowMs();
    this.armProgress();
  }

  /**
   * The call can speak now: a turn started while it could not — mid-handshake — arms its cue here, still due
   * {@link PLAN_CALL_LIMITS.progressFirstMs} after that turn's start rather than after the call opened.
   */
  callSpeaks(): void {
    this.armProgress();
  }

  /**
   * The voice is talking, so a running turn's next progress cue is a first one again, a whole
   * {@link PLAN_CALL_LIMITS.progressFirstMs} from now: the cue is timed from when the voice last spoke, whoever wrote
   * the words. The cue is a sound, so no transcript is ever the cue's own and none can restart
   * it in a loop. Nothing is armed when no delegated turn runs, and this arms nothing then.
   */
  holdProgress(): void {
    // Keyed on a turn running, not on a cue armed: words heard before the call could speak still time the first window.
    if (this.call.runningTurns.size === 0) {
      return;
    }
    this.restartProgress();
  }

  /** The call ended: nothing armed is said or sent. */
  stop(): void {
    this.cancelProgress?.();
    this.cancelProgress = undefined;
    this.cancelAck?.();
    this.cancelAck = undefined;
  }

  /**
   * Arm the next progress cue, once, while a delegated turn runs on a speaking call:
   * {@link PLAN_CALL_LIMITS.progressFirstMs} after the voice last spoke, then {@link PLAN_CALL_LIMITS.progressCueMs}
   * after each cue.
   */
  private armProgress(): void {
    if (!this.call.speaks() || this.cancelProgress !== undefined || this.call.runningTurns.size === 0) {
      return;
    }
    let ms = Math.max(0, PLAN_CALL_LIMITS.progressFirstMs - (this.clock.nowMs() - this.progressFromMs));
    if (this.progressSinceVoiced) {
      ms = PLAN_CALL_LIMITS.progressCueMs;
    }
    this.cancelProgress = this.clock.after({
      ms,
      run: () => {
        this.cancelProgress = undefined;
        this.signalProgress();
      },
    });
  }

  /**
   * A delegated turn has run {@link PLAN_CALL_LIMITS.progressFirstMs} past the voice's last words —
   * {@link PLAN_CALL_LIMITS.progressCueMs} past the last cue — so the page is sent one `progress` event and the next is
   * armed. Nothing is written into the session: the page plays the cue only while the work still runs, the call is
   * quiet and the owner's sound is on (`progressCueStillDue`, `./orbCue.ts`), so a cue sent just as the answer starts is
   * dropped there rather than played over it.
   */
  private signalProgress(): void {
    if (!this.call.speaks() || this.call.runningTurns.size === 0) {
      return;
    }
    this.call.emit({ event: { kind: "progress" } });
    this.progressSinceVoiced = true;
    this.armProgress();
  }

  /**
   * An unasked write: a hand-off of the owner's words is {@link PLAN_CALL_LIMITS.ackHoldMs} into its Codex turn with the voice
   * silent since, so the voice says one {@link ackSpeech} line — "on it" — and the answer follows.
   *
   * Said only when every one of these holds, looked at again each {@link PLAN_CALL_LIMITS.ackPollMs} while only the
   * owner's words are not yet quiet, and dropped past {@link PLAN_CALL_LIMITS.ackGiveUpMs}: the turn still runs; the voice has
   * not been transcribed since it started (it said something itself, and a second line is noise); the owner has been
   * transcribed since the voice last was (the turn is the owner's words', not a walk's read-ahead after the voice's question);
   * the owner has been quiet {@link PLAN_CALL_LIMITS.ackQuietMs}; and `ackRefusal` finds no line of the server's said, being
   * said, or just said — a look line for the same hand-off above all.
   *
   * **The residue, named.** Every check is on what the server has heard, at the write; a line
   * written is spoken ~1s later and has no cancel, so a voice that starts its own answer inside that second hears "on
   * it" land on its opening words. On the 8 calls above, the voice's first words were transcribed within 2s after the
   * write in 8 of 192 hand-offs (a 2s hold: 15; 0.5s: 9, since the owner's quiet sets the write). Live, an `ack` call-file line
   * with a voice segment under 2s after it is that race.
   *
   * @param turnId the turn the hand-off became
   * @param startedMs when it started
   */
  private checkAck({ turnId, startedMs }: { turnId: string; startedMs: number }): void {
    if (!this.call.speaks() || !this.call.runningTurns.has(turnId) || this.endedTurns.has(turnId)) {
      return;
    }
    const { heardAt, voiceAt } = this.call.transcribed();
    if (heardAt === undefined) {
      return;
    }
    const voiceSince = voiceAt !== undefined && voiceAt >= startedMs;
    const voiceLast = voiceAt !== undefined && voiceAt >= heardAt;
    if (voiceSince || voiceLast || this.call.ackRefusal() !== undefined) {
      return;
    }
    const nowMs = this.clock.nowMs();
    // A timer that fired late (an event-loop stall) is past the give-up as surely as one that polled there.
    if (nowMs - startedMs > PLAN_CALL_LIMITS.ackGiveUpMs) {
      return;
    }
    if (nowMs - heardAt < PLAN_CALL_LIMITS.ackQuietMs) {
      if (nowMs + PLAN_CALL_LIMITS.ackPollMs - startedMs <= PLAN_CALL_LIMITS.ackGiveUpMs) {
        this.cancelAck = this.clock.after({
          ms: PLAN_CALL_LIMITS.ackPollMs,
          run: () => {
            this.cancelAck = undefined;
            this.checkAck({ startedMs, turnId });
          },
        });
      }
      return;
    }
    void this.sayAck({ turnId });
  }

  /**
   * Have the voice say the next acknowledgement, which restarts the progress window once the voice has taken it, and
   * journal it on the page's stream so the call file can tell it from the voice's own words. Stops nothing. A line the
   * voice would not take is said as an error, never lost silently, and leaves the cue due where it was.
   * One taken or timed out tells the turn's outcome it was said to be on (`acknowledgementTaken`).
   *
   * @param turnId the turn it acknowledges
   */
  private async sayAck({ turnId }: { turnId: string }): Promise<void> {
    const text = ackSpeech({ said: this.ackSaid });
    this.ackSaid += 1;
    this.lastAckMs = this.clock.nowMs();
    this.acking = true;
    try {
      const why = "the owner's words were handed to the thinking model and the voice had said nothing for a moment";
      const spoke = await this.call.speak({ text, why });
      if (spoke.kind === "result" || spoke.kind === "timeout") {
        this.call.acknowledgementTaken({ turnId });
      }
      if (spoke.kind === "result") {
        this.restartProgress();
        this.call.emit({ event: { kind: "acknowledged" } });
      } else if (spoke.kind !== "ended") {
        const message = `the voice did not say it was on it: ${fateOf({ outcome: spoke })}`;
        this.call.emit({ event: { kind: "error", message } });
      }
    } finally {
      this.acking = false;
    }
  }
}
