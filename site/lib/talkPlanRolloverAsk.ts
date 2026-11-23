/*
 * The server's half of a quiet rollover: when `PlanCall` tells the page to roll its call over onto a fresh one
 * (`./callRollover.ts` is the page's half). Its own module so `./talkPlanCall.ts` stays inside its size.
 *
 * Past `PLAN_CALL_LIMITS.rolloverFromMs`, or sooner once the thread's context nears full, it looks at the call's floor
 * every `rolloverPollMs` and asks the first time the floor is free. Once `rolloverUrgentMs` of the lifetime remain it
 * asks whatever the floor holds — and asks again if it already had, and again at `rolloverLastMs` — naming how long is
 * left; once the context passes `rolloverContextUrgentShare` it asks again at once, marked `contextUrgent`, because across a steady
 * conversation the floor's holds renew one another and the page, which holds the ask on its own floor at the stage
 * that remainder puts it in, is what finds the pause: without it a call was cut mid-word at its lifetime.
 * That window is an elapsed timer, like the lifetime's own, and the remainder is MEASURED on the elapsed clock both
 * timers run on, from the instant they were armed, so a callback that ran late on a loaded event loop reports the time
 * really left rather than the window it was armed for, and no wall clock enters it: a clock stepped either way moves
 * neither timer, while a Mac's sleep moves both, as it moves the remote session's own limit (libuv's darwin clock is
 * `mach_continuous_time`). The page's own count stops in a sleep, so the last stage's ask is what puts it right
 * (`./callRollover.ts`). Nothing here stops the call: a page that never acts meets `PLAN_CALL_LIMITS.lifetimeMs` exactly as before.
 */

import { CONTEXT_ROLLOVER_REASON, PLAN_CALL_LIMITS, type PlanCallEvent, ROLLOVER_REASON } from "./planCallContract";
import { type PlanFloor, rolloverRefusal } from "./talkPlanFloor";
import type { PlanCallClock } from "./talkPlanStart";

/** What the rollover ask reads and writes of its call. */
interface RolloverAskCall {
  readonly ended: () => boolean;
  readonly floor: () => PlanFloor;
  /**
   * Emit the ask onto the call's replayed ring, so a stream that was reconnecting still hears it — with `replayAs`, the
   * ask as measured when it is replayed.
   */
  readonly emit: (input: { event: PlanCallEvent; replayAs: () => PlanCallEvent }) => void;
}

/** One call's rollover ask: told once while the cut is far, and again, with the time left, at each of the last two stages. */
export class PlanRolloverAsk {
  private readonly call: RolloverAskCall;
  private readonly clock: PlanCallClock;
  /** Cancels the timers for the urgent and last windows. */
  private readonly cancelStages: readonly (() => void)[];
  /** The elapsed clock's reading as the call was made, which the lifetime's own timer counts from. */
  private readonly armedAtMs: number;
  /** Whether the lifetime's cut is inside `rolloverUrgentMs`, so the floor no longer gates the ask. */
  private urgent = false;
  /** The next look at the floor, while one is armed. */
  private cancelLook: (() => void) | undefined;
  private sent = false;
  /** Why the rollover is owed: the call's age, until its thread's context nears full. */
  private reason = ROLLOVER_REASON;
  /** Whether this call is ever told to roll over: a voice call is, a typed conversation never. */
  private readonly staged: boolean;
  /** Whether the thread's context passed the urgent share, which every later ask and replay then carries. */
  private contextIsUrgent = false;

  /**
   * Arm a timer for each of the urgent and last windows as the call is made, alongside the lifetime's own. Each asks
   * with the time left: the second corrects a page that got the first late, over a stream that was reconnecting.
   * A conversation that never rolls over (a typed one, `./talkTypedSession.ts`) arms neither: its no-op `armRollover`
   * cannot reach timers armed here.
   *
   * @param call the call the ask belongs to
   * @param clock the timers every window runs on
   * @param staged whether the urgent and last windows are armed at all; `false` for a conversation never told to roll over
   */
  constructor({ call, clock, staged }: { call: RolloverAskCall; clock: PlanCallClock; staged: boolean }) {
    this.call = call;
    this.clock = clock;
    this.staged = staged;
    this.armedAtMs = clock.elapsedMs();
    const stages = staged ? [PLAN_CALL_LIMITS.rolloverUrgentMs, PLAN_CALL_LIMITS.rolloverLastMs] : [];
    this.cancelStages = stages.map((leftMs) =>
      clock.after({
        ms: PLAN_CALL_LIMITS.lifetimeMs - leftMs,
        run: () => {
          this.urgent = true;
          this.cancelLook?.();
          this.cancelLook = undefined;
          if (!this.call.ended()) {
            this.send();
          }
        },
      }),
    );
  }

  /**
   * Whether the page has been told.
   *
   * @returns `true` once the ask went out
   */
  get told(): boolean {
    return this.sent;
  }

  /**
   * Look at the floor after `ms`, once: one look is armed at a time.
   *
   * @param ms how long from now
   */
  arm({ ms }: { ms: number }): void {
    if (this.call.ended() || this.sent || this.cancelLook !== undefined) {
      return;
    }
    this.cancelLook = this.clock.after({
      ms,
      run: () => {
        this.cancelLook = undefined;
        this.check();
      },
    });
  }

  /** The thread's context nears full: owe the ask for that, dropping any look armed, for the caller to arm one now. */
  contextDue(): void {
    this.reason = CONTEXT_ROLLOVER_REASON;
    this.cancelLook?.();
    this.cancelLook = undefined;
  }

  /**
   * The thread's context passed `PLAN_CALL_LIMITS.rolloverContextUrgentShare`: ask now, whatever the floor holds and
   * whether or not the page was told already, marked `contextUrgent`, so a held ask stops waiting for the
   * conversation's next turn (measured: held nine minutes at calm until Codex compacted). Once per
   * call; a conversation never told to roll over is not told now either.
   */
  contextUrgent(): void {
    if (this.contextIsUrgent || !this.staged || this.call.ended()) {
      return;
    }
    this.contextIsUrgent = true;
    this.contextDue();
    this.send();
  }

  /** The call stopped: cancel every timer. */
  stop(): void {
    for (const cancel of this.cancelStages) {
      cancel();
    }
    this.cancelLook?.();
    this.cancelLook = undefined;
  }

  /** Ask the first time the floor is free; else look again in a poll. */
  private check(): void {
    if (this.call.ended() || this.sent) {
      return;
    }
    if (rolloverRefusal({ floor: this.call.floor() }) !== undefined) {
      this.arm({ ms: PLAN_CALL_LIMITS.rolloverPollMs });
      return;
    }
    this.send();
  }

  /**
   * Emit the ask: with the time left, measured, once the urgent window has opened. A stream that reconnects after it
   * hears the time left as it replays, never the remainder this one carried: replayed as sent, a last-stage ask
   * heard 10s late would put the page's count 10s behind the cut, and its work hold past it.
   */
  private send(): void {
    this.sent = true;
    const reason = this.reason;
    const ask = (): PlanCallEvent => ({
      contextUrgent: this.contextIsUrgent,
      kind: "rollover",
      lifetimeRemainingMs: this.remainingMs(),
      reason,
    });
    this.call.emit({ event: ask(), replayAs: ask });
  }

  /**
   * The time left before the lifetime's cut, on the elapsed clock its timer runs on, read as the ask is built: a calm
   * ask replayed once the urgent window has opened names it too.
   *
   * @returns the remainder, never below zero, or `null` while the cut is far
   */
  private remainingMs(): number | null {
    if (!this.urgent) {
      return null;
    }
    const elapsed = this.clock.elapsedMs() - this.armedAtMs;
    return Math.max(0, PLAN_CALL_LIMITS.lifetimeMs - elapsed);
  }
}
