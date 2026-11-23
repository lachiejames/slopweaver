/**
 * When one session card reloads, with no Electron in it. A card runs with JavaScript off, so every change it shows is a
 * whole-document reload, and a click landing while one replaces the page is lost: MEASURED on the installed app,
 * six `cmux close --via-card` presses on seats mid-turn each answered "did not see the click within 5s", one
 * listing seven `data:` reloads in those 5s and no Stop navigation. Repro: spawn an app seat, then at once
 * `slopweaver cmux close app:<id> --harness app --via-card` while it streams.
 *
 * So every reload opens a fresh interval, and a document differing from the one on the card only in the streamed agent
 * text (a TAIL) waits for it to close, leading and trailing, while any other change (the state, a note) ignores it and
 * reloads at once, its tail included; loads never overlap; and while somebody is pressing the
 * Stop (a HOLD) nothing reloads at all, the newest document drawn once the last hold lets go.
 * `sessionWindow.ts` adapts this to the window.
 */
import type { ScheduleTimeout } from "./cardStop";

/**
 * How long the streamed agent text may lag behind what the session said. Not measured: a starting value, picked as
 * at most two tail reloads a second; the holds, not this interval, are what keep a press from being lost.
 */
export const TAIL_REDRAW_MS = 500;

/** One card's reloads. */
export interface CardRedraw {
  /**
   * The card as it should now read: `url` the whole document, `frame` the same document with no streamed agent text,
   * so a change of `url` alone is a tail and a change of `frame` reloads at once.
   */
  readonly request: (options: { readonly url: string; readonly frame: string }) => void;
  /**
   * A load this module started has finished, or `failed`, so the next may begin. A failed document never counts as
   * shown: it is loaded again once, unless something newer is waiting, and a later request for it reloads it.
   */
  readonly loaded: (options: { readonly failed: boolean }) => void;
  /** Hold every reload until the returned release is called; calling it twice releases once. */
  readonly hold: () => () => void;
  /** The card is gone: cancel the timer and drop whatever was waiting. */
  readonly retire: () => void;
}

/** What one card's reloads hold between events. */
interface RedrawState {
  /** The document loaded or loading now; none once a load failed with nothing shown before it. */
  current: string | undefined;
  /**
   * The frame of the last load started, the document without the streamed agent text, which a request is a tail of
   * when its own matches. Kept when that load fails, so a successor of the failed document still waits its interval.
   */
  startedFrame: string;
  /** The last document that finished loading, none before the first. */
  shown: string | undefined;
  /** The document whose last load failed, with no load succeeding since, so a second failure in a row gives it up. */
  failedOnce: string | undefined;
  /** The document given up after two failures in a row; only a request for it after that earns it a retry again. */
  givenUp: string | undefined;
  /** The newest document asked for and not yet loading, and its frame. */
  pending: { readonly url: string; readonly frame: string } | undefined;
  /** Whether it differs from {@link current} only by a tail, so waits for the interval even once nothing else blocks it. */
  pendingTail: boolean;
  /** A load is under way, so nothing else may begin. */
  loading: boolean;
  /** How many presses are holding the card still. */
  holds: number;
  /** Cancels the open tail interval, if one is open. */
  closeInterval: (() => void) | undefined;
  /** How many intervals have opened, so a timer knows whether it is the open one. */
  interval: number;
  /** The card is gone. */
  retired: boolean;
}

/**
 * The reloads of one card, whose first document is already loading.
 *
 * @param url the document the card opened on
 * @param frame that document without the streamed agent text
 * @param load starts loading a document; `loaded` must be called once it finishes or fails
 * @param schedule the timer the tail interval runs on
 * @param tailMs how long a tail waits behind the last reload of one
 * @returns the card's reloads
 */
export function cardRedrawFor({
  url,
  frame,
  load,
  schedule,
  tailMs,
}: {
  url: string;
  frame: string;
  load: (options: { url: string }) => void;
  schedule: ScheduleTimeout;
  tailMs: number;
}): CardRedraw {
  const state: RedrawState = {
    closeInterval: undefined,
    current: url,
    failedOnce: undefined,
    givenUp: undefined,
    holds: 0,
    interval: 0,
    loading: true,
    pending: undefined,
    pendingTail: false,
    retired: false,
    shown: undefined,
    startedFrame: frame,
  };
  const draw = (): void => {
    const next = state.pending;
    if (state.retired || state.loading || state.holds > 0 || next === undefined) {
      return;
    }
    state.pending = undefined;
    state.pendingTail = false;
    // A failed load puts back the document shown before it, which may be exactly what was waiting.
    if (next.url === state.current) {
      return;
    }
    state.current = next.url;
    state.startedFrame = next.frame;
    state.loading = true;
    // Every reload opens the interval afresh, whatever it carried, so the next tail waits a whole one out; opened
    // before the load, so a load that settles and asks again inside its own call still finds it open.
    openInterval();
    load({ url: next.url });
  };
  // Once a load ends or the last hold lets go: a tail still inside its interval waits for that interval to close.
  const drawIfDue = (): void => {
    if (!state.pendingTail || state.closeInterval === undefined) {
      draw();
    }
  };
  function openInterval(): void {
    state.closeInterval?.();
    state.interval += 1;
    const opened = state.interval;
    state.closeInterval = schedule({
      afterMs: tailMs,
      run: () => {
        // A timer cancelled or replaced since, firing anyway, is not this card's open interval: it does nothing. Told
        // apart by its own count, never by the cancel a scheduler returned, which may be one function for every timer.
        if (state.interval !== opened || state.closeInterval === undefined) {
          return;
        }
        state.closeInterval = undefined;
        draw();
      },
    });
  }
  const request = (asked: { url: string; frame: string }): void => {
    if (state.retired || asked.url === state.current) {
      state.pending = undefined;
      state.pendingTail = false;
      return;
    }
    // Judged against the last load started, never the last document asked for: a frame changed and changed back while
    // a load was under way never reached the card, so what is left of it is a tail and waits like one. A failed load
    // still started, so what follows it in the same frame waits its interval too.
    // A request for a document already given up earns it its own retry again. Asked for while its failures are still
    // being counted, it is the same run of failures: a second failure in a row gives it up whatever was asked between.
    if (asked.url === state.givenUp) {
      state.givenUp = undefined;
      state.failedOnce = undefined;
    }
    state.pending = { frame: asked.frame, url: asked.url };
    state.pendingTail = asked.frame === state.startedFrame;
    drawIfDue();
  };
  // The first document is a reload like any other, so its interval opens with it.
  openInterval();
  return {
    hold: () => holdOn({ draw: drawIfDue, state }),
    loaded: ({ failed }) => {
      settle({ failed, state });
      drawIfDue();
    },
    request,
    retire: () => {
      state.retired = true;
      state.pending = undefined;
      state.closeInterval?.();
      state.closeInterval = undefined;
    },
  };
}

/**
 * Record how the load under way ended. A failed one puts back the document last shown and, unless something newer
 * waits or it already failed twice, waits again itself at once, so a load the Stop link aborted is not lost.
 */
function settle({ failed, state }: { failed: boolean; state: RedrawState }): void {
  state.loading = false;
  const ended = state.current;
  const endedFrame = state.startedFrame;
  if (!failed) {
    state.shown = ended;
    state.failedOnce = undefined;
    state.givenUp = undefined;
    return;
  }
  state.current = state.shown;
  if (ended === undefined) {
    return;
  }
  if (ended === state.failedOnce) {
    state.givenUp = ended;
    return;
  }
  // Counted even when something newer waits and no retry is queued, so a later request for it is its second try.
  state.failedOnce = ended;
  if (state.pending === undefined) {
    state.pending = { frame: endedFrame, url: ended };
    // A retry waits out an open tail interval like any tail, and goes at once when none is open.
    state.pendingTail = true;
  }
}

/** One hold on a card's reloads; the last one let go draws the newest document waiting, once it is due. */
function holdOn({ state, draw }: { state: RedrawState; draw: () => void }): () => void {
  state.holds += 1;
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    state.holds -= 1;
    draw();
  };
}
