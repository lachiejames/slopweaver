/**
 * A reopened call's opening window: the owner's own first words go first, and only after
 * {@link PLAN_CALL_LIMITS.reopenReminderSilenceMs} of their silence is the voice handed the reminder of where they left
 * off. The rule: a silent owner gets the reminder after the window, and one who comes in straight away within it does
 * not need it; the window is three seconds.
 *
 * Whether a call is a reopen, and the words, are the mint's (`src/talk/reopenReminder.ts`); this owns only the clock.
 * The page starts it the moment its WebRTC connection is up — what the owner hears as the call starting, later than the
 * server's realtime start — and gives it away the moment its microphone meter hears them, which the transcript lags
 * by a second or more. The owner's transcribed words, a typed message and the voice speaking first each give it away here too.
 *
 * Every step is written to the call's stream as a `reopen-reminder` event carrying the elapsed milliseconds on the
 * call's never-stepped clock, so the call file measures the window rather than two wall-clock stamps subtracted.
 *
 * The transition is pure ({@link reopenReminderStep}); the class is its effectful shell. Its own file so
 * `./talkPlanCall.ts` stays under the line cap.
 */
import {
  PLAN_CALL_LIMITS,
  type PlanCallEvent,
  type PlanReopenReminderEvent,
  type ReopenReminderGiveWay,
} from "./planCallContract";
import { fateOf, type PlanReopenReminder, type RpcOutcome } from "./talkPlanProtocol";
import type { PlanCallClock } from "./talkPlanStart";

/** Where one call's opening window is. */
export type ReopenReminderState =
  | { readonly kind: "none" }
  | { readonly kind: "loaded"; readonly reminder: PlanReopenReminder }
  | { readonly kind: "waiting"; readonly reminder: PlanReopenReminder; readonly armedAtMs: number }
  | { readonly kind: "done" };

/** What moves the window: the page's connection up, something taking the opening from it, or its deadline. */
export type ReopenReminderInput =
  | { readonly kind: "ready" }
  | { readonly kind: "give-way"; readonly reason: ReopenReminderGiveWay }
  | { readonly kind: "deadline" };

/** What one step asks the shell to do. */
export type ReopenReminderEffect = "arm" | "hand" | "gave-way" | undefined;

/**
 * One step of the window. A call minted with no reminder never arms; a ready arms once; anything taking the opening
 * before the deadline ends it for good; a deadline hands the reminder only while still waiting and only once a whole
 * window has passed on the elapsed clock, so a timer that fired early hands nothing.
 *
 * @param state where the window is
 * @param input what happened
 * @param elapsedMs the elapsed clock now, never the wall clock
 * @returns the next state and the effect the shell owes
 */
export function reopenReminderStep({
  state,
  input,
  elapsedMs,
}: {
  state: ReopenReminderState;
  input: ReopenReminderInput;
  elapsedMs: number;
}): { readonly state: ReopenReminderState; readonly effect: ReopenReminderEffect } {
  if (input.kind === "ready") {
    if (state.kind !== "loaded") {
      return { effect: undefined, state };
    }
    return { effect: "arm", state: { armedAtMs: elapsedMs, kind: "waiting", reminder: state.reminder } };
  }
  if (input.kind === "give-way") {
    if (state.kind === "loaded" || state.kind === "waiting") {
      return { effect: "gave-way", state: { kind: "done" } };
    }
    return { effect: undefined, state };
  }
  if (state.kind !== "waiting" || elapsedMs - state.armedAtMs < PLAN_CALL_LIMITS.reopenReminderSilenceMs) {
    return { effect: undefined, state };
  }
  return { effect: "hand", state: { kind: "done" } };
}

/** What the window reads of, and writes to, its call. */
export interface ReopenReminderCall {
  readonly clock: PlanCallClock;
  /** The reminder as a developer message, its text and `why` kept as provenance by the call. */
  readonly hand: (input: { text: string; why: string }) => Promise<RpcOutcome>;
  /** One event onto the call's stream, which the page writes into the call file. */
  readonly emit: (input: { event: PlanCallEvent }) => void;
  /** Whether the call has ended. */
  readonly ended: () => boolean;
}

/** How a page's post to the window landed. */
export type ReopenReminderPostOutcome = "armed" | "gave-way" | "already" | "unavailable";

/** The fields a step that has none of them records: every one is on the event, `null` when it does not apply. */
const NOTHING_MORE = { acceptedElapsedMs: null, failure: null, reason: null } as const;

/** Why the reminder is handed, in words the thinking model can repeat if the owner asks where it came from. */
const HAND_WHY =
  "the owner reopened the call within a minute of hanging up and stayed silent for its first three seconds";

/** One call's opening window. */
export class ReopenReminderWindow {
  private state: ReopenReminderState = { kind: "none" };
  private cancel: (() => void) | undefined;
  /** What took the opening before the reminder loaded: the voice can speak in the handshake's last turn. */
  private takenBeforeLoad: ReopenReminderGiveWay | undefined;
  private readonly call: ReopenReminderCall;

  /**
   * @param call the call it reads and writes
   */
  constructor({ call }: { call: ReopenReminderCall }) {
    this.call = call;
  }

  /**
   * The reminder the mint composed, once the realtime session is open; `null` leaves the window shut for good.
   *
   * @param reminder the mint's reminder, or `null` for a call that is not a reopen
   */
  load({ reminder }: { reminder: PlanReopenReminder | null }): void {
    if (reminder === null || this.state.kind !== "none") {
      return;
    }
    if (this.takenBeforeLoad !== undefined) {
      this.state = { kind: "done" };
      this.record({ ...NOTHING_MORE, elapsedMs: 0, phase: "gave-way", reason: this.takenBeforeLoad, reminder });
      return;
    }
    this.state = { kind: "loaded", reminder };
  }

  /**
   * The page's connection is up: start the window, once.
   *
   * @returns `armed`, `already` for a window already started or over, or `unavailable` for a call with none
   */
  ready(): ReopenReminderPostOutcome {
    const before = this.state;
    if (before.kind === "none" || this.call.ended()) {
      return "unavailable";
    }
    const step = reopenReminderStep({
      elapsedMs: this.call.clock.elapsedMs(),
      input: { kind: "ready" },
      state: before,
    });
    this.state = step.state;
    if (step.effect !== "arm" || step.state.kind !== "waiting") {
      return "already";
    }
    this.record({ ...NOTHING_MORE, elapsedMs: 0, phase: "armed", reminder: step.state.reminder });
    this.armFor({ ms: PLAN_CALL_LIMITS.reopenReminderSilenceMs });
    return "armed";
  }

  /** The deadline's timer, `ms` from now. */
  private armFor({ ms }: { ms: number }): void {
    this.cancel = this.call.clock.after({
      ms,
      run: () => {
        void this.deadline();
      },
    });
  }

  /**
   * Something took the opening first — the owner's voice, their typing, the voice itself: the reminder gives way, for good.
   *
   * @param reason what took it
   * @returns `gave-way`, `already` once the window is over, or `unavailable` for a call with none
   */
  giveWay({ reason }: { reason: ReopenReminderGiveWay }): ReopenReminderPostOutcome {
    const before = this.state;
    if (before.kind === "none") {
      // Kept, not dropped: a reminder that loads after this is given way at once rather than armed over it.
      // The FIRST taker is the one kept, so a later one changes nothing.
      if (this.takenBeforeLoad !== undefined) {
        return "unavailable";
      }
      this.takenBeforeLoad = reason;
      return "unavailable";
    }
    const elapsedMs = this.call.clock.elapsedMs();
    const step = reopenReminderStep({ elapsedMs, input: { kind: "give-way", reason }, state: before });
    this.state = step.state;
    if (step.effect !== "gave-way" || (before.kind !== "loaded" && before.kind !== "waiting")) {
      return "already";
    }
    this.cancel?.();
    this.cancel = undefined;
    // Before the page's ready, nothing was armed, so nothing was measured: the window gave way at its start.
    const sinceArm = before.kind === "waiting" ? elapsedMs - before.armedAtMs : 0;
    this.record({ ...NOTHING_MORE, elapsedMs: sinceArm, phase: "gave-way", reason, reminder: before.reminder });
    return "gave-way";
  }

  /** The call ended: the window closes with nothing written, since the call file is closing too. */
  stop(): void {
    this.cancel?.();
    this.cancel = undefined;
    this.state = { kind: "done" };
  }

  /** The window's deadline: hand the reminder if nothing took the opening, and record how it landed. */
  private async deadline(): Promise<void> {
    this.cancel = undefined;
    const before = this.state;
    if (before.kind !== "waiting" || this.call.ended()) {
      return;
    }
    const firedMs = this.call.clock.elapsedMs();
    const step = reopenReminderStep({ elapsedMs: firedMs, input: { kind: "deadline" }, state: before });
    this.state = step.state;
    if (step.effect !== "hand") {
      // A timer that fired a hair early on the elapsed clock waits out the rest rather than dropping the reminder.
      const left = PLAN_CALL_LIMITS.reopenReminderSilenceMs - (firedMs - before.armedAtMs);
      this.armFor({ ms: Math.max(1, Math.ceil(left)) });
      return;
    }
    const { reminder, armedAtMs } = before;
    const elapsedMs = firedMs - armedAtMs;
    const outcome = await this.call.hand({ text: reminder.text, why: HAND_WHY });
    const acceptedElapsedMs = this.call.clock.elapsedMs() - armedAtMs;
    if (outcome.kind === "result") {
      this.record({ ...NOTHING_MORE, acceptedElapsedMs, elapsedMs, phase: "handed", reminder });
      return;
    }
    // Never retried: a timeout may still have been taken, and a reminder said twice is worse than none.
    const failure = fateOf({ outcome });
    this.record({ ...NOTHING_MORE, acceptedElapsedMs, elapsedMs, failure, phase: "failed", reminder });
  }

  /** One `reopen-reminder` event onto the call's stream, its milliseconds whole. */
  private record({
    phase,
    elapsedMs,
    reminder,
    reason,
    acceptedElapsedMs,
    failure,
  }: {
    phase: PlanReopenReminderEvent["phase"];
    elapsedMs: number;
    reminder: PlanReopenReminder;
    reason: ReopenReminderGiveWay | null;
    acceptedElapsedMs: number | null;
    failure: string | null;
  }): void {
    const event: PlanReopenReminderEvent = {
      acceptedElapsedMs: acceptedElapsedMs === null ? null : Math.round(acceptedElapsedMs),
      elapsedMs: Math.round(elapsedMs),
      failure,
      kind: "reopen-reminder",
      phase,
      previousCallId: reminder.previousCallId,
      reason,
      windowMs: PLAN_CALL_LIMITS.reopenReminderSilenceMs,
    };
    this.call.emit({ event });
  }
}
