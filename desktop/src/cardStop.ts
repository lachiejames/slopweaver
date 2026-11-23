/**
 * One session card's Stop, with no Electron in it: which navigation starts the card's one stop, and how a press of
 * that Stop learns the stop its own click started. `sessionWindow.ts` wires a card's navigation events into
 * `observe` and sends the click; everything that decides what a press answers lives here, behind a plain injected
 * timer, so it is tested without a window or a clock.
 */
import { err, ok, type Result } from "neverthrow";

import { type SessionLink, sessionLinkOf } from "./sessionCard";

/** Run `run` after `afterMs`, returning what cancels it — `setTimeout` in the app, a plain fake in a test. */
export type ScheduleTimeout = (options: { afterMs: number; run: () => void }) => () => void;

/** What one press waits on: the stop the card's handler handed it, or `undefined` once its deadline passed. */
export type PressSeen = Promise<{ stopping: Promise<void> } | undefined>;

/** One press of a card's Stop, from before its click is sent until the stop that click started settles. */
export interface CardPress {
  /** Arm this press's wait just before its click is sent; a navigation before this never answers it. */
  readonly arm: (options: { timeoutMs: number }) => PressSeen;
  /** Withdraw a press whose click failed: its wait and timer go, and the card takes a press again. */
  readonly abandon: () => void;
}

/** One card's Stop. */
export interface CardStop {
  /** A navigation the card raised: its own Stop link starts the card's one stop and answers an armed press. */
  readonly observe: (options: { target: string }) => void;
  /** Begin a press, refused while another press's stop is still running or once the card's stop has started. */
  readonly press: () => Result<CardPress, string>;
}

/** What one card's Stop holds between events. */
interface CardStopState {
  /** Whether the card's Stop link was followed, which starts its one stop. */
  started: boolean;
  /** The card's one stop; meaningful only once `started`. */
  cardStop: Promise<void>;
  /** A press is begun and its stop has not settled. */
  inFlight: boolean;
  /** The armed press's answer, if one is armed. */
  waiter: ((stopping: Promise<void>) => void) | undefined;
}

/**
 * The Stop of the card showing one session.
 *
 * @param sessionId the control plane's id, the only one this card's Stop link may name
 * @param startStop starts the session's stop, settling once it has finished and never rejecting
 * @param schedule the timer a press's deadline runs on
 * @returns the card's Stop
 */
export function cardStopFor({
  sessionId,
  startStop,
  schedule,
}: {
  sessionId: string;
  startStop: (options: { link: SessionLink }) => Promise<void>;
  schedule: ScheduleTimeout;
}): CardStop {
  const state: CardStopState = { cardStop: Promise.resolve(), inFlight: false, started: false, waiter: undefined };
  const observe = ({ target }: { target: string }): void => {
    const link = sessionLinkOf({ url: target });
    if (link?.sessionId !== sessionId) {
      return;
    }
    if (!state.started) {
      state.started = true;
      state.cardStop = startStop({ link });
    }
    const answer = state.waiter;
    state.waiter = undefined;
    answer?.(state.cardStop);
  };
  const press = (): Result<CardPress, string> => {
    if (state.inFlight) {
      return err("a press of that card's Stop is already in flight");
    }
    // A card has one stop: once it started, a press could only be handed it, never start one, so it is refused.
    if (state.started) {
      return err("that card's Stop was already pressed and its stop has started, so read cmux list");
    }
    state.inFlight = true;
    return ok(pressOn({ schedule, state }));
  };
  return { observe, press };
}

/** One begun press on a card's state; everything it finishes is its OWN, never a later press's waiter or timer. */
function pressOn({ state, schedule }: { state: CardStopState; schedule: ScheduleTimeout }): CardPress {
  let finished = false;
  let own: ((stopping: Promise<void>) => void) | undefined;
  let cancel = (): void => undefined;
  const finish = (): void => {
    finished = true;
    cancel();
    if (state.waiter === own) {
      state.waiter = undefined;
    }
  };
  const release = (): void => {
    state.inFlight = false;
  };
  const arm = ({ timeoutMs }: { timeoutMs: number }): PressSeen =>
    // The stop rides in an object: a promise handed to `resolve` is adopted, so the wait would settle to the stop's
    // own `undefined` once it finished and read as a click nobody saw.
    new Promise((resolve) => {
      own = (stopping) => {
        finish();
        void stopping.then(release, release);
        resolve({ stopping });
      };
      cancel = schedule({
        afterMs: timeoutMs,
        run: () => {
          finish();
          release();
          resolve(undefined);
        },
      });
      state.waiter = own;
    });
  const abandon = (): void => {
    if (!finished) {
      finish();
      release();
    }
  };
  return { abandon, arm };
}
