/**
 * The running-list notice a call hands the voice when the owner puts something on their running list: its fixed words, and the
 * owing and retrying that keep one add from being lost behind another write. Split from `./talkPlanCall.ts`, to
 * keep it under its 300-line cap; the call owns the floor and the handoff, this owns only when the notice goes.
 */
import { PLAN_CALL_LIMITS } from "./planCallContract";
import { ownWriteRefusal, type PlanFloor } from "./talkPlanFloor";
import type { CallClock } from "./talkPlanStart";

/**
 * What the voice (or a typed conversation's next turn) is told when the owner puts something on their running list. FIXED
 * words, never an item's bytes: the item is read through `running_list`, where every item's credentials arrive
 * masked, so nothing on the list reaches the model by this route at all.
 */
export const RUNNING_LIST_CHANGED_TEXT = "the owner put something in the running list; read it with running_list";

/** How many handoffs of one running-list notice the session may fail in a row before it is given up. */
const LIST_NOTICE_TRIES = 3;

/**
 * One call's running-list notice. What the owner puts on the list is meant to reach the voice. Only the
 * fixed words go — never an item — and it cuts in as a count correction does, held only by the call ending, no
 * thread, or another of this server's own writes, since a notice that waits for a clear floor arrives after the owner has
 * moved on. An add that finds another write out — this server's own, or a notice whose list may have been read
 * before this add landed — is OWED rather than dropped: one more notice goes every
 * {@link PLAN_CALL_LIMITS.rolloverPollMs} the floor still holds it, until it goes or the call ends. Several adds owed
 * at once are one notice, because the voice reads the whole list. A handoff the session fails is owed again, up to
 * three failures in a row: one that timed out may still have been taken, and a duplicate
 * notice is accepted over a lost one.
 */
export class ListNotice {
  /** A notice's request is unanswered. */
  private notifying = false;
  /** The owner added while the notice could not go: one is owed, and goes when the floor lets it. */
  private owed = false;
  /** The next try at an owed notice, while one is armed. */
  private cancelRetry: (() => void) | undefined;
  /** Handoffs the session has failed in a row; past three, one is not tried again. */
  private failures = 0;
  private readonly call: {
    readonly ended: () => boolean;
    readonly floor: () => PlanFloor;
    readonly hand: (input: { text: string; why: string }) => Promise<string | undefined>;
  };
  private readonly clock: CallClock;

  /**
   * The notice of one call.
   *
   * @param call what the notice reads off its call: whether it ended, its floor, and the developer-text handoff
   * @param clock the call's clock, which the retry is armed on
   */
  constructor({
    call,
    clock,
  }: {
    call: {
      readonly ended: () => boolean;
      readonly floor: () => PlanFloor;
      readonly hand: (input: { text: string; why: string }) => Promise<string | undefined>;
    };
    clock: CallClock;
  }) {
    this.call = call;
    this.clock = clock;
  }

  /**
   * Whether a notice's request is unanswered, which holds a completion correction.
   *
   * @returns true while one is being handed over
   */
  get busy(): boolean {
    return this.notifying;
  }

  /**
   * Hand the voice {@link RUNNING_LIST_CHANGED_TEXT}, or owe it.
   *
   * @returns `undefined` once the voice was handed it, else why not, saying when it is owed
   */
  async notify(): Promise<string | undefined> {
    if (this.notifying) {
      this.owed = true;
      return "a running-list notice is already being handed over; one more follows it for this add";
    }
    const refusal = ownWriteRefusal({ floor: this.call.floor() });
    if (refusal !== undefined) {
      if (this.call.ended()) {
        return refusal;
      }
      this.owed = true;
      this.arm();
      return `${refusal}; the notice is owed and goes once that clears`;
    }
    this.owed = false;
    this.notifying = true;
    try {
      const fate = await this.call.hand({
        text: RUNNING_LIST_CHANGED_TEXT,
        why: "the owner put something on their running list",
      });
      if (fate === undefined) {
        this.failures = 0;
        return undefined;
      }
      this.failures += 1;
      if (this.failures < LIST_NOTICE_TRIES) {
        this.owed = true;
        return `the voice was not told the running list changed: ${fate}; it is tried again`;
      }
      this.failures = 0;
      return `the voice was not told the running list changed: ${fate}`;
    } finally {
      this.notifying = false;
      if (this.owed) {
        this.arm();
      }
    }
  }

  /** The call ended: an armed retry never fires. */
  stop(): void {
    this.cancelRetry?.();
    this.cancelRetry = undefined;
  }

  /** Try an owed notice again shortly, once: one try is armed at a time, and none after the call ends. */
  private arm(): void {
    if (this.call.ended() || this.cancelRetry !== undefined) {
      return;
    }
    this.cancelRetry = this.clock.after({
      ms: PLAN_CALL_LIMITS.rolloverPollMs,
      run: () => {
        this.cancelRetry = undefined;
        if (this.owed) {
          void this.notify();
        }
      },
    });
  }
}
