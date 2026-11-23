/**
 * The Codex turn a resume, the owner's nudge or the page's promise press owed, started by the console itself when the
 * voice took the developer message and handed nothing over. A resume closed the owner's open turn, the voice said "On
 * it." and started nothing; the page's promise press drew "One sec." and nothing; the call sat silent 143s until the
 * owner spoke, and the owner's own nudge drew "Sure, on it." and nothing again. A developer
 * message is a sentence the voice may ignore, and across every call file measured it was ignored almost always: 0
 * of 6 promise presses, 0 of 17 nudges and 6 of 55 resumes with no turn running were followed by a Codex turn
 * before the owner spoke again. Repro, the promise half (the nudges and resumes are the same walk over `"name":"nudge"`
 * with `"detail":"asked it to answer"`, and over `"name":"resume"`):
 * `jq -rn 'def t: .[0:19]+"Z"|fromdate; [inputs|.f=input_filename] | group_by(.f) | [.[] | sort_by(.atIso) as $e
 * | range(0;$e|length) as $i | $e[$i] | select(.name=="nudge" and ((.detail//"")|startswith("pressed it itself")))
 * | ([$e[$i+1:][]|select(.kind=="segment" and .who!="voice" and ((.beganIso//.atIso) > $e[$i].atIso))]|first) as $n
 * | ([$e[$i+1:][]|select(.name=="codex" and ((.detail//"")|test("started$")))]|first) as $s
 * | ($s != null and ($n == null or $s.atIso < $n.atIso))] | "\(map(select(.))|length) of \(length)"'
 * $SLOPWEAVER_HOME/talk/calls/*.jsonl`.
 *
 * So the developer message stays — it closes the owner's open turn; for a nudge or promise it gives the voice its
 * chance to hand off, while for a resume it asks only for an acknowledgement — and the turn no longer depends on it:
 * armed before the message is written, so a fast hand-off is never missed, and timed from the moment the session took
 * it, a turn starting within {@link PLAN_CALL_LIMITS.owedTurnStartMs} settles it, and past that the console writes
 * `turn/start` with {@link OWED_TURN_TEXT}, exactly as a look's frame does. A resume's turn
 * asks {@link RESUME_TURN_TEXT} instead: the voice is asked only to acknowledge the owner, never to hand off, so that
 * turn is the console's, and the window stays so the owner's final words, closed by the message, reach the spoken
 * record first (the old resume sentence gave the voice a turn, and it invented "the missing NPM token" card;
 * `./talkPlanWords.ts`'s `RESUME_TEXT` carries the measurement). A voice that hands off anyway inside the window
 * settles it as any hand-off does, so the answer is still a thinking-model turn, asked in the voice's words rather than
 * {@link RESUME_TURN_TEXT}'s. The triage clock's line owes its
 * suggestion with no window at all ({@link TRIAGE_SUGGESTION_TURN_TEXT}: the voice
 * invented "Send it" rather than hand off) (`./talkPlanSteer.ts`). The page steers the spoken record into the turn the moment it starts, and its answer reaches
 * the voice as a hand-off's does, held until the owner's words go quiet (`./talkPlanHeldAnswers.ts`). One owed start per call waits at a time: a second resume
 * or nudge inside its window joins it rather than start another — a nudge joining a resume's making it a nudge's start,
 * asked with {@link OWED_TURN_TEXT} — and one after the console's own start is written arms afresh. A start that failed or went unanswered is said
 * as the call's `error` event, so the silence always carries a reason. The owner's own final words asking for the next card
 * open the same window with no developer message at all ({@link OwedTurnStarts.startWindow}), and outrank a resume's, nudge's or promise's reason in a window they share, since only
 * {@link WALK_TURN_TEXT} moves the walk before any prose; a walk start finding a turn already running writes nothing. Its own file so `./talkPlanCall.ts` stays under
 * its line cap.
 */
import { type OwedTurnWhy, PLAN_CALL_LIMITS, type PlanOwedStartEvent } from "./planCallContract";
import { fateOf, type RpcOutcome } from "./talkPlanProtocol";
import { startedTurnIdOf } from "./talkPlanProtocolTurns";
import type { CallClock } from "./talkPlanStart";
import type { TurnWaiter } from "./talkPlanTurns";
import { OWED_TURN_TEXT, RESUME_TURN_TEXT, WALK_TURN_TEXT } from "./talkPlanWords";
import { TRIAGE_DUE_ANNOUNCEMENT, TRIAGE_SUGGESTION_TURN_TEXT } from "./triageDueWords";

/** What {@link OwedTurnStarts} needs of the call it serves. */
export interface OwedTurnCall {
  readonly clock: CallClock;
  /**
   * The call's thread once it has one, why it ended once it has, how many Codex turns run now, and how many ends of
   * one it has read so far, counted in notification order.
   */
  readonly state: () => {
    readonly endedReason: string | undefined;
    readonly running: number;
    readonly threadId: string | undefined;
    readonly turnsEnded: number;
  };
  /** The call's waiters on the next Codex turn's start, which a start and the call's end each resolve. */
  readonly waiters: Set<TurnWaiter>;
  /** Hand the voice a developer message, naming why for the call's provenance, answering its request's outcome. */
  readonly hand: (input: { text: string; why: string }) => Promise<RpcOutcome>;
  /** The call's own request to its child, which writes before it returns. */
  readonly request: (input: { method: string; params: unknown; timeoutMs: number }) => Promise<RpcOutcome>;
  /**
   * The call's event stream: `owed-start` once the console's own `turn/start` is written, as telemetry, and `error`
   * when that start came to no turn.
   */
  readonly emit: (input: {
    event: PlanOwedStartEvent | { readonly kind: "error"; readonly message: string };
    telemetry?: boolean;
  }) => void;
}

/** One caller's hold on the owed start: its developer message was taken, or it was not. */
export interface OwedTurnLease {
  /** The session took the developer message: the owed turn's clock starts, if it has not already. */
  readonly handed: () => void;
  /** The developer message never reached the session: this caller owes nothing. */
  readonly abandoned: () => void;
}

/** The one owed start a call holds at a time, from its first arm until a turn starts, it is written, or it is dropped. */
interface OwedStart {
  readonly waiter: TurnWaiter;
  /**
   * The first taken message's reason, which the start and its event carry — bar a resume's, which a nudge or promise
   * press taken inside its window replaces, since that one did ask the voice to hand off.
   */
  why: OwedTurnWhy | undefined;
  /** Leases neither handed nor abandoned yet. */
  live: number;
  cancelDeadline: (() => void) | undefined;
  /** A turn started, the call ended, or the start was written: nothing more is owed by it. */
  settled: boolean;
  /** The call's turn-end count when the owner's latest next-card ask joined this start, so a turn ENDING after it answered. */
  walkAskedAtEnds: number | undefined;
}

/**
 * How the sentence a failed start leaves opens, by reason: the voice was asked to hand off and did not, or — a resume —
 * it was never asked to, since that turn is the console's from the moment the message is taken.
 */
const FAILED_START_OPENS: Readonly<Record<OwedTurnWhy, string>> = {
  nudge: "the voice took the owner's nudge and handed nothing to the thinking model",
  promise: "the voice took the page's promise press and handed nothing to the thinking model",
  resume: "the resume made the answer the thinking model's",
  triage: "the voice took the triage card's time-up line and handed nothing to the thinking model",
  walk: "the owner's ask for the next card reached no thinking-model turn",
};

/** Why each message was handed, as the call's provenance keeps it. */
const WHY_HANDED: Readonly<Record<OwedTurnWhy, string>> = {
  nudge: "the owner pressed nudge because the voice had gone quiet on their last words",
  promise: "the voice promised to do something and started nothing, so the page pressed for it",
  resume:
    "the owner's words had gone unanswered and the page judged the silence not theirs, so the voice was asked only to " +
    "acknowledge them while the console started the thinking model's turn",
  triage: TRIAGE_DUE_ANNOUNCEMENT.why,
  // Never handed: `startWindow` writes no developer message. Kept so the record stays exhaustive.
  walk: "the owner's final words asked for the next card",
};

/** What the console's own `turn/start` asks the thinking model, by why it was owed. */
const TURN_TEXT: Readonly<Record<OwedTurnWhy, string>> = {
  nudge: OWED_TURN_TEXT,
  promise: OWED_TURN_TEXT,
  resume: RESUME_TURN_TEXT,
  triage: TRIAGE_SUGGESTION_TURN_TEXT,
  walk: WALK_TURN_TEXT,
};

/**
 * Why the console's own `turn/start` did not come to a turn, or `undefined` when the thread named the turn it started.
 *
 * @param started the request's fate
 * @returns the clause the failure sentence ends on
 */
export function owedStartFailure({ started }: { started: RpcOutcome }): string | undefined {
  if (started.kind === "timeout") {
    return "the console's own start went unanswered, and may still run";
  }
  if (started.kind === "ended") {
    return `the call ended before the console's own start answered: ${started.reason}`;
  }
  if (started.kind !== "result") {
    return `the console's own start failed: ${fateOf({ outcome: started })}`;
  }
  if (startedTurnIdOf({ result: started.result }) === undefined) {
    return "the thread took the console's own start and named no turn";
  }
  return undefined;
}

/**
 * The call's owed starts: {@link OwedTurnStarts.arm} before each resume or nudge writes its developer message, then
 * tell the lease whether the session took it.
 */
export class OwedTurnStarts {
  private readonly call: OwedTurnCall;
  private pending: OwedStart | undefined;
  /**
   * The console's own walk `turn/start`, written and not yet seen to come to a turn: the call's turn-end count when it
   * was, and the waiter the next turn's start clears it through. It answers any next-card ask while it stands.
   */
  private walkWritten: { readonly atEnds: number; readonly waiter: TurnWaiter } | undefined;
  /** A later ask's deadline passed while {@link walkWritten} stood, so it rides on that write, and retries if it fails. */
  private walkDeferred = false;

  /**
   * Owed starts for one call.
   *
   * @param call what the owed start reads of the call and how it writes
   */
  constructor({ call }: { call: OwedTurnCall }) {
    this.call = call;
  }

  /**
   * Watch for the next Codex turn to start, before the developer message is written, joining the owed start already
   * held when there is one.
   *
   * @param why which developer message is about to be written
   * @returns the caller's lease, told once whether the session took it
   */
  arm({ why }: { why: OwedTurnWhy }): OwedTurnLease {
    const held = this.open();
    held.live += 1;
    let told = false;
    return {
      abandoned: () => {
        if (told) {
          return;
        }
        told = true;
        held.live -= 1;
        if (held.live === 0 && held.why === undefined) {
          this.settle({ owed: held });
        }
      },
      handed: () => {
        if (told) {
          return;
        }
        told = true;
        held.live -= 1;
        this.taken({ owed: held, why });
      },
    };
  }

  /**
   * Hand the voice a resume's or nudge's developer message with the owed start armed around it: taken, the window
   * opens; refused, ended, or thrown, this caller owes nothing. A request that went unanswered may still have been
   * taken, so it opens the window too: a turn the voice never started is started, and one it did settles
   * it. The press itself still reports the timeout as its fate. The triage clock's line has no window: taken with no
   * turn started while it was written, the console starts the suggestion's turn at once.
   *
   * @param text the developer message
   * @param why which press it is
   * @param untaken told once when the session refused it, ended or threw: the same judgement that opens no window, so
   *   a timeout, which may have been taken, never tells it
   * @returns why the session did not answer that it took it, or `undefined` when it did
   */
  async handing({
    text,
    untaken,
    why,
  }: {
    text: string;
    untaken?: () => void;
    why: OwedTurnWhy;
  }): Promise<string | undefined> {
    const lease = this.arm({ why });
    let mayHaveTaken = false;
    try {
      const handed = await this.call.hand({ text, why: WHY_HANDED[why] });
      mayHaveTaken = handed.kind === "result" || handed.kind === "timeout";
      if (mayHaveTaken) {
        lease.handed();
      }
      return handed.kind === "result" ? undefined : fateOf({ outcome: handed });
    } finally {
      // First, so a settle the lease's end sets off judges the owner's utterance as it now stands, and cannot skip the put-back.
      if (!mayHaveTaken) {
        untaken?.();
      }
      lease.abandoned();
    }
  }

  /**
   * Open, or join, an owed start whose trigger was no developer message: the owner's own final words asked for the next card
   * and no turn started during them (`./talkPlanWalkAsk.ts`). Nothing is handed to the voice, so there is no lease to
   * take; the window opens now, and a turn starting inside it — the voice's late hand-off — settles it as any does.
   *
   * @param why the trigger, `walk`
   */
  startWindow({ why }: { why: OwedTurnWhy }): void {
    this.taken({ owed: this.open(), why });
  }

  /** The call ended: drop the owed start, writing nothing. */
  stop(): void {
    if (this.pending !== undefined) {
      this.settle({ owed: this.pending });
    }
  }

  /**
   * The owed start already held, else a fresh one, its waiter registered at once so a hand-off starting while the
   * message is written counts.
   *
   * @returns the owed start, now the call's one
   */
  private open(): OwedStart {
    if (this.pending !== undefined) {
      return this.pending;
    }
    const owed: OwedStart = {
      cancelDeadline: undefined,
      live: 0,
      settled: false,
      waiter: () => {
        // A turn started — the voice handed off — or the call ended: either way nothing more is owed.
        this.settle({ owed });
      },
      walkAskedAtEnds: undefined,
      why: undefined,
    };
    this.pending = owed;
    this.call.waiters.add(owed.waiter);
    return owed;
  }

  /**
   * One lease's message was taken: the first starts the owed turn's clock and names its reason. A lease taken after its
   * start settled — a turn started, or the console's own start was written — with no turn running by then owes afresh
   * (a nudge joining a resume's window, whose turn started and ended while the nudge was being
   * written, would otherwise be dropped, and the call fall silent).
   *
   * @param owed the owed start the lease holds
   * @param why the lease's reason
   */
  private taken({ owed, why }: { owed: OwedStart; why: OwedTurnWhy }): void {
    if (owed.settled) {
      // A triage line's start settled while it was written: the voice started its turn, so nothing more is owed even
      // once that turn has ended.
      if (why === "triage") {
        return;
      }
      const { endedReason, running } = this.call.state();
      if (endedReason === undefined && running === 0) {
        this.taken({ owed: this.open(), why });
      }
      return;
    }
    // The owner's LATEST ask sets it: an end read between two asks answered the first, never the one after it.
    if (why === "walk") {
      owed.walkAskedAtEnds = this.call.state().turnsEnded;
    }
    if (why === "triage") {
      // No window: the voice is never asked to hand the suggestion off, so a turn that has not started while the line
      // was written is the console's to start now — and one joining another press's window starts it now, as this.
      // Bar the owner's next-card ask's: it starts now too, but as the walk, which outranks every reason.
      const reason = owed.why === "walk" ? "walk" : why;
      owed.why = reason;
      void this.start({ owed, why: reason });
      return;
    }
    if (owed.why !== undefined) {
      // A nudge or promise press taken inside a resume's window did ask the voice to hand off, so the start is owed
      // for that reason and asks OWED_TURN_TEXT, never RESUME_TURN_TEXT's "asked only to acknowledge the owner". The owner's ask for the next card outranks all three, whichever came first, since only
      // WALK_TURN_TEXT moves the walk before any prose. The window keeps the first deadline either way.
      if (why === "walk" || (owed.why === "resume" && why !== "resume")) {
        owed.why = why;
      }
      return;
    }
    owed.why = why;
    owed.cancelDeadline = this.call.clock.after({
      ms: PLAN_CALL_LIMITS.owedTurnStartMs,
      run: () => {
        owed.cancelDeadline = undefined;
        // Set just above and only ever replaced, never cleared: the reason the start is owed for when it is written.
        void this.start({ owed, why: owed.why! });
      },
    });
  }

  /**
   * Nothing started in the window: write the console's own `turn/start`, then say what it came to when it failed.
   * Settled before the write, so a resume or nudge from here on arms a fresh owed start rather than join this one:
   * a nudge joining a written start whose turn was already running would stop that turn and be owed nothing.
   *
   * @param owed the owed start whose window passed
   * @param why its reason
   */
  private async start({ owed, why }: { owed: OwedStart; why: OwedTurnWhy }): Promise<void> {
    this.settle({ owed });
    const { endedReason, running, threadId, turnsEnded } = this.call.state();
    // A walk's window opened with no turn running, so one running now, or one that ENDED since the owner's ask, answers it
    // however its start escaped the waiter — a completion arriving before its own start drops that start as a replay
    // Counted by notification order, never by instant: an end read just after the owner's ask
    // in the same millisecond answered it, and one read just before did not. Only a
    // walk's: a nudge interrupts the turn it presses over, which can still be winding down here.
    const answeredSinceAsk = owed.walkAskedAtEnds !== undefined && turnsEnded > owed.walkAskedAtEnds;
    // And one the console already wrote answers it too, until a turn starts or ends after it: a replayed final of the
    // same words would otherwise open a second window and a second walk, whether the write is unanswered or answered
    // ahead of its turn's own notification.
    const walkPending = this.walkWritten?.atEnds === turnsEnded;
    const walkAnswered = running > 0 || answeredSinceAsk || walkPending;
    if (endedReason !== undefined || threadId === undefined || (why === "walk" && walkAnswered)) {
      // Riding on the console's own standing write alone: should that write come to no turn, this ask retries.
      if (why === "walk" && running === 0 && !answeredSinceAsk && walkPending) {
        this.walkDeferred = true;
      }
      return;
    }
    if (why === "walk") {
      this.markWalkWritten({ atEnds: turnsEnded });
    }
    const mark = this.walkWritten;
    let reason: string | undefined;
    let mayRun = true;
    try {
      const request = this.call.request({
        method: "turn/start",
        params: { input: [{ text: TURN_TEXT[why], type: "text" }], threadId },
        timeoutMs: PLAN_CALL_LIMITS.nudgeStepMs,
      });
      // Told after the write, as a look's start is, so the call file never names a start that was not written.
      this.call.emit({ event: { kind: "owed-start", why }, telemetry: true });
      const started = await request;
      reason = owedStartFailure({ started });
      // A start that went unanswered may still run, as its failure line says; any other failure came to no turn.
      mayRun = reason === undefined || started.kind === "timeout";
    } catch (cause) {
      const said = cause instanceof Error ? cause.message : String(cause);
      reason = `the console's own start could not be written: ${said}`;
      mayRun = false;
    }
    if (why === "walk" && !mayRun && mark !== undefined && this.walkWritten === mark) {
      this.walkCameToNone({ atEnds: mark.atEnds });
    }
    if (reason !== undefined) {
      const message = `${FAILED_START_OPENS[why]}, and ${reason}`;
      this.call.emit({ event: { kind: "error", message } });
    }
  }

  /**
   * The console just wrote a walk start: it stands until the next turn starts, a turn ends, or the write comes to none.
   *
   * @param atEnds the call's turn-end count as it was written
   */
  private markWalkWritten({ atEnds }: { atEnds: number }): void {
    this.clearWalkWritten();
    const waiter: TurnWaiter = () => {
      if (this.walkWritten?.waiter === waiter) {
        // A turn started: it answers every ask that rode on this write.
        this.walkWritten = undefined;
        this.walkDeferred = false;
      }
    };
    this.walkWritten = { atEnds, waiter };
    this.call.waiters.add(waiter);
  }

  /** The console's walk start is replaced or came to none: it answers no later ask. */
  private clearWalkWritten(): void {
    this.walkDeferred = false;
    if (this.walkWritten !== undefined) {
      this.call.waiters.delete(this.walkWritten.waiter);
      this.walkWritten = undefined;
    }
  }

  /**
   * The console's walk start definitively came to no turn: an ask that rode on it retries once, in a fresh window,
   * unless a turn has run or ended since the write, which answered it.
   */
  private walkCameToNone({ atEnds }: { atEnds: number }): void {
    const deferred = this.walkDeferred;
    this.clearWalkWritten();
    const { endedReason, running, turnsEnded } = this.call.state();
    if (deferred && endedReason === undefined && running === 0 && turnsEnded === atEnds) {
      this.startWindow({ why: "walk" });
    }
  }

  /**
   * Nothing more is owed by this start: its deadline and waiter go, and the call may hold a fresh one.
   *
   * @param owed the owed start to settle
   */
  private settle({ owed }: { owed: OwedStart }): void {
    owed.settled = true;
    owed.cancelDeadline?.();
    owed.cancelDeadline = undefined;
    this.call.waiters.delete(owed.waiter);
    if (this.pending === owed) {
      this.pending = undefined;
    }
  }
}
