/**
 * The word a plan call owes the owner when the Codex turn the voice said it was on ends having handed the voice
 * nothing, or fails: a fixed line saying so, rather than a silence the owner waits on forever. Split from
 * `./talkPlanCall.ts`, to keep it under its `max-lines` ceiling; the call owns the floor and the write, this owns only
 * whether a line is owed and when it goes.
 *
 * Why it exists: without it the owner hears "I'll look into that", then nothing, because a turn's end was only ever a
 * `codex-turn` event for the page. MEASURED on one call: a turn started on the owner's unfinished clause; the console's
 * acknowledgement went about one second later ("Okay, I'll look into that."); the turn wrote "Mm-hmm." and two blank
 * messages and completed about ten seconds after it started; the voice, handed the "Mm-hmm.", spoke about three seconds
 * later ("I'm following that and checking what else depends on those citation links.") and nothing was said about the
 * turn ending across the next 36s. Repro: the `segment`, `tool` and `wrote` lines of a call's journal in
 * `$SLOPWEAVER_HOME/talk/calls/<call>-*.jsonl`.
 *
 * **The rule.** Only the NEWEST turn the call has seen start can owe a line: a newer start drops an older one's,
 * since the newer turn answers the owner's newer words. A turn that handed the voice an answer (`HeldAnswers`' `handed`,
 * `./talkPlanHeldAnswers.ts`) owes nothing however it ended. One that handed none owes a line when it ends `failed`
 * ({@link FAILED_TURN_OUTCOME_SPEECH}, never the provider's failure text), or ends `completed` after the voice was told
 * it was on it — the console's acknowledgement taken for that turn (`./talkPlanHandOffSpeech.ts`), commentary of the
 * turn's handed to the voice, or the voice's own promise of work (`voicePromised`, `./voiceOwed.ts`) transcribed while
 * it ran or within {@link PROMISE_AFTER_END_MS} of its end ({@link EMPTY_TURN_OUTCOME_SPEECH}). An `interrupted` turn
 * owes nothing: the owner's words or nudge displaced it. A turn
 * that wrote nothing while nobody said it was on it — the owner's words mid-thought, the voice only nodding — owes
 * nothing either, so the line is never noise over a thought the owner has not finished.
 *
 * **When it goes.** On the clear floor every unasked line waits for (`floorRefusal`, `./talkPlanFloor.ts`): never over
 * the owner's words or open utterance, never ahead of a held answer, never inside the settle after a turn ends. Words of
 * the turn handed to the voice before it goes cancel it; past {@link OUTCOME_STALE_MS} from the turn's end it is
 * dropped unsaid, since it would arrive out of nowhere, and so is one still owed when the call ends; a drop is always
 * a `dropped` event, never silence. Written once: a timeout may still have been said, so only a
 * definite refusal is tried again, {@link OUTCOME_ATTEMPTS} writes in all.
 *
 * **The residue, named.** Once the line's write is sent nothing recalls it: a message of the turn's arriving abnormally
 * late, or a newer turn starting while the write is unanswered, still finds it said, and its
 * `said` event says so, truthfully; a call ending before the write is answered records it `dropped`, "may have been
 * said", while the stream is still open. The floor the write waited on — the owner's words closed, no answer held, the settle after
 * a turn's end passed — keeps that window to the write's own round trip.
 */
import { PLAN_CALL_LIMITS, type PlanCallEvent } from "./planCallContract";
import { floorRefusal, type PlanFloor } from "./talkPlanFloor";
import { fateOf, paramString, type RpcOutcome } from "./talkPlanProtocol";
import type { CallClock } from "./talkPlanStart";
import { EMPTY_TURN_OUTCOME_SPEECH, FAILED_TURN_OUTCOME_SPEECH } from "./talkPlanWords";
import { voicePromised } from "./voiceOwed";

/**
 * How long after a turn's end the voice's own promise still counts as one about it. MEASURED on one call: the voice's
 * "I'm following that and checking …" closed 2.74s after its turn completed — the voice still saying what it was
 * handed. Repro: the `codex … completed` line and the next final voice `segment` in
 * `$SLOPWEAVER_HOME/talk/calls/<call>-*.jsonl`. Wider than that by a margin; a judgement.
 */
export const PROMISE_AFTER_END_MS = 5_000;

/** How long after a turn's end its line may still be said; past it, it is dropped unsaid. A judgement, unmeasured. */
export const OUTCOME_STALE_MS = 20_000;

/** How many writes a line the session refuses outright gets, before it is given up on. */
export const OUTCOME_ATTEMPTS = 3;

/** A write that throws, synchronously or by rejecting, is a refusal: tried again or recorded dropped, never lost. */
async function answeredOrRefused({ write }: { write: () => Promise<RpcOutcome> }): Promise<RpcOutcome> {
  try {
    return await write();
  } catch (cause) {
    return { kind: "error", message: cause instanceof Error ? cause.message : "the write threw" };
  }
}

/** How a turn ended, as `turn/completed` says it. */
export type TurnEnd = "completed" | "interrupted" | "failed";

/** What the outcome lines read off their call. */
export interface TurnOutcomeCall {
  /** The call's state now (`./talkPlanFloor.ts`). */
  readonly floor: () => PlanFloor;
  /** Whether a correction of the voice's own line is owed, which goes first: it corrects what the owner just heard. */
  readonly correctionOwed: () => boolean;
  /** Have the voice say one fixed sentence, naming why for the call's provenance. */
  readonly speak: (input: { readonly text: string; readonly why: string }) => Promise<RpcOutcome>;
  /** Tell the page's stream. */
  readonly emit: (input: { readonly event: PlanCallEvent }) => void;
}

/** The newest turn the call has seen start, and what it owes. */
interface NewestTurn {
  readonly turnId: string;
  /** The voice was told the work was on: the console's acknowledgement for it, or a promise of the voice's own. */
  told: boolean;
  /** Words of the turn's may have reached the voice. */
  handed: boolean;
  end: TurnEnd | undefined;
  endedMs: number | undefined;
  /** Its line is owed and not yet written. */
  owed: boolean;
  /** Its line was said, given up on or dropped: nothing more is owed for it. */
  settled: boolean;
  /** Writes of its line the session refused outright. */
  refused: number;
}

/** One plan call's turn-outcome lines. */
export class TurnOutcomes {
  private readonly call: TurnOutcomeCall;
  private readonly clock: CallClock;
  private newest: NewestTurn | undefined;
  /** Every turn whose start has been seen, so a replayed start of an older one never makes it newest again. */
  private readonly seen = new Set<string>();
  /** The turn whose line's request is unanswered, if any. */
  private sending: NewestTurn | undefined;
  /** The next look at the floor, while a line is owed. */
  private cancelLook: (() => void) | undefined;
  private stopped = false;

  /**
   * The outcome lines of one call.
   *
   * @param call its floor, its fixed-speech write and its stream
   * @param clock the call's own time
   */
  constructor({ call, clock }: { call: TurnOutcomeCall; clock: CallClock }) {
    this.call = call;
    this.clock = clock;
  }

  /**
   * Whether a line's request is unanswered, which holds the call's other own writes (`reportingTurnOutcome`).
   *
   * @returns true while one is being handed over
   */
  get busy(): boolean {
    return this.sending !== undefined;
  }

  /**
   * A Codex turn started: it is the newest, and any line an older one owed is dropped — the newer turn answers the owner's
   * newer words. A start seen before draws nothing.
   *
   * @param turnId the turn that started
   */
  turnStarted({ turnId }: { turnId: string }): void {
    if (this.seen.has(turnId)) {
      return;
    }
    this.seen.add(turnId);
    const older = this.newest;
    if (older?.owed === true) {
      this.drop({ detail: `turn ${turnId} started after it, and its answer is the one owed`, turn: older });
    }
    this.newest = {
      end: undefined,
      endedMs: undefined,
      handed: false,
      owed: false,
      refused: 0,
      settled: false,
      told: false,
      turnId,
    };
  }

  /**
   * The console's acknowledgement for a turn may have been said — taken, or timed out.
   *
   * @param turnId the turn it acknowledged
   */
  acknowledgementTaken({ turnId }: { turnId: string }): void {
    const turn = this.newest;
    if (turn?.turnId !== turnId) {
      return;
    }
    turn.told = true;
    this.judge();
  }

  /**
   * The voice finished a sentence of its own: one promising work ({@link voicePromised}) while the newest turn runs,
   * or within {@link PROMISE_AFTER_END_MS} of its end, tells the owner that turn is on.
   *
   * @param params the voice's `thread/realtime/transcript/done`, its `text` the final transcript for the sentence
   */
  voiceSaid({ params }: { params: unknown }): void {
    const turn = this.newest;
    const text = paramString({ key: "text", params });
    if (turn === undefined || turn.settled || text === undefined || !voicePromised({ text })) {
      return;
    }
    if (turn.endedMs !== undefined && this.clock.nowMs() - turn.endedMs > PROMISE_AFTER_END_MS) {
      return;
    }
    turn.told = true;
    this.judge();
  }

  /**
   * A release may have reached the voice. An answer of the newest turn's means it never ends having said nothing, and
   * a line still owed for it is dropped; only commentary of it ("let me check the logs") tells the owner the work is on,
   * and answers nothing.
   *
   * @param answered the turns whose answer, or running-list line, the release carried
   * @param commented the turns it carried only commentary of
   */
  handed({ answered, commented }: { answered: readonly string[]; commented: readonly string[] }): void {
    const turn = this.newest;
    if (turn === undefined) {
      return;
    }
    if (commented.includes(turn.turnId)) {
      turn.told = true;
      this.judge();
      return;
    }
    if (!answered.includes(turn.turnId)) {
      return;
    }
    turn.handed = true;
    // No event: the turn answered, so nothing was ever owed the owner. Its answer still held at the turn's end — the
    // ordinary turn, since the hold outlasts the end — would otherwise trace a dropped line after nearly every answer.
    turn.owed = false;
  }

  /**
   * A Codex turn ended. Only the newest's end is read, once.
   *
   * @param turnId the turn that ended
   * @param end how it ended
   */
  turnEnded({ turnId, end }: { turnId: string; end: TurnEnd }): void {
    const turn = this.newest;
    if (turn?.turnId !== turnId || turn.end !== undefined) {
      return;
    }
    turn.end = end;
    turn.endedMs = this.clock.nowMs();
    this.judge();
  }

  /** The call ended: nothing owed is said, and a line still owed is recorded dropped rather than lost. */
  stop(): void {
    if (this.stopped) {
      return;
    }
    this.stopped = true;
    const turn = this.newest;
    if (turn?.owed === true) {
      this.drop({ detail: "the call ended before the floor was free", turn });
    }
    // Recorded now, while the stream is still open: the write's own answer settles only after the call has closed.
    const inFlight = this.sending;
    if (inFlight !== undefined && !inFlight.settled) {
      this.drop({
        detail: "the call ended before the voice answered the line's write; it may have been said",
        turn: inFlight,
      });
    }
    this.cancelLook?.();
    this.cancelLook = undefined;
  }

  /** Owe the newest turn's line once it owes one, and look at the floor for it. */
  private judge(): void {
    const turn = this.newest;
    if (this.stopped || turn === undefined || turn.owed || turn.settled || turn.end === undefined) {
      return;
    }
    if (turn.handed || turn.end === "interrupted") {
      return;
    }
    if (turn.end === "completed" && !turn.told) {
      return;
    }
    turn.owed = true;
    this.arm();
  }

  /** Look at the floor again in {@link PLAN_CALL_LIMITS.rolloverPollMs}, once: one look is armed at a time. */
  private arm(): void {
    if (this.stopped || this.cancelLook !== undefined) {
      return;
    }
    this.cancelLook = this.clock.after({
      ms: PLAN_CALL_LIMITS.rolloverPollMs,
      run: () => {
        this.cancelLook = undefined;
        void this.attempt();
      },
    });
  }

  /**
   * A line the newest turn owes no longer goes: traced on the stream, never dropped unseen.
   *
   * @param turn the turn whose line it was
   * @param detail why it is not said
   */
  private drop({ turn, detail }: { turn: NewestTurn; detail: string }): void {
    turn.owed = false;
    turn.settled = true;
    this.call.emit({ event: { detail, kind: "turn-outcome", phase: "dropped", turnId: turn.turnId } });
  }

  /** Say the newest turn's line if the floor is free, else look again; drop it once stale. */
  private async attempt(): Promise<void> {
    const turn = this.newest;
    if (this.stopped || turn === undefined || !turn.owed) {
      return;
    }
    if (this.clock.nowMs() - turn.endedMs! > OUTCOME_STALE_MS) {
      this.drop({
        detail: `the floor was not free within ${String(OUTCOME_STALE_MS / 1000)}s of the turn's end`,
        turn,
      });
      return;
    }
    // Its own write in flight is the floor's `reportingTurnOutcome`, so no own check is needed here.
    const refusal = floorRefusal({ floor: this.call.floor(), openUtterance: "hold", own: [], runningTurn: "hold" });
    if (refusal !== undefined || this.call.correctionOwed()) {
      this.arm();
      return;
    }
    turn.owed = false;
    this.sending = turn;
    const failed = turn.end === "failed";
    const text = failed ? FAILED_TURN_OUTCOME_SPEECH : EMPTY_TURN_OUTCOME_SPEECH;
    const why = failed
      ? "the Codex turn answering the owner failed, so the voice says it has no result"
      : "the voice said it was on it, and the Codex turn ended with no answer for it, so it says so";
    try {
      const spoke = await answeredOrRefused({ write: () => this.call.speak({ text, why }) });
      // Settled while the write was unanswered only by `stop()`, which already recorded it before the stream closed.
      if (turn.settled) {
        return;
      }
      if (spoke.kind === "error" && turn.refused + 1 < OUTCOME_ATTEMPTS && this.newest === turn) {
        turn.refused += 1;
        turn.owed = true;
        return;
      }
      turn.settled = true;
      const said = failed ? "it failed" : "it came back with no answer";
      let detail = `said ${said}`;
      let phase: "said" | "dropped" = "said";
      if (spoke.kind === "timeout") {
        detail = `may have said ${said}, and it is not tried again so it is never said twice: no answer in time`;
      } else if (spoke.kind === "error" || spoke.kind === "ended") {
        detail = `the voice would not take the line: ${fateOf({ outcome: spoke })}`;
        phase = "dropped";
      }
      this.call.emit({ event: { detail, kind: "turn-outcome", phase, turnId: turn.turnId } });
    } finally {
      this.sending = undefined;
      if (turn.owed) {
        this.arm();
      }
    }
  }
}
