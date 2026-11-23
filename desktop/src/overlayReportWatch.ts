/**
 * The voice's page loaded but never reported: when to reload it. The shell shows the overlay only after its page's
 * first status (`main.ts` `revealOverlay`), and reloads it only when the console's origin is new, so a page that
 * finishes loading and never reports — the voice layout's organisation refusal on a failed `org show`, a hydration
 * that never ran, a missing chunk while the console rebuilt — would leave the voice hidden until the app is quit,
 * with no tray item to bring it back. This decides the retry: a grace after each finished load, doubling after each
 * miss up to a cap, with no attempt ceiling, because a ceiling is the same stranding later. Any accepted status ends
 * the episode; nothing here ever reloads a page that has reported, so a call is never ended by it.
 *
 * Pure: no Electron, no timers, no clock (`overlayReportWatchShell.ts` is the effectful half).
 */

/** How long a finished load waits for its page's first status before the first reload. */
export const OVERLAY_REPORT_GRACE_MS = 20_000;

/** The longest wait between reloads: about twelve an hour while a page keeps failing to report. */
export const OVERLAY_REPORT_RETRY_CAP_MS = 300_000;

/**
 * Waiting for nothing, with the delay the next finished load waits; a load finished and its deadline running; or a
 * reload asked for and not yet committed, which a status accepted meanwhile must still be able to stop.
 */
export type OverlayReportWatchState =
  | { readonly kind: "idle"; readonly nextDelayMs: number }
  | { readonly kind: "armed"; readonly delayMs: number }
  | { readonly kind: "reloading"; readonly nextDelayMs: number };

/**
 * What happened to the overlay's page: its main frame finished loading, its deadline passed with no status, it
 * navigated, or the episode ended (a status accepted, a new origin, a failed load, a crash, the window gone).
 */
export type OverlayReportWatchEvent =
  | { readonly kind: "loaded" }
  | { readonly kind: "missed" }
  | { readonly kind: "navigated" }
  | { readonly kind: "reset" };

/** What the shell does about it. */
export type OverlayReportWatchEffect =
  | { readonly kind: "none" }
  | { readonly kind: "cancel" }
  | { readonly kind: "schedule"; readonly afterMs: number }
  | { readonly kind: "reload" }
  /** Cancel the deadline AND the reload still in flight, so the page that has now reported stays. */
  | { readonly kind: "stop" };

/** The next state and the effect that goes with it. */
export interface OverlayReportWatchTransition {
  readonly state: OverlayReportWatchState;
  readonly effect: OverlayReportWatchEffect;
}

/**
 * The state before any load, and after every episode ends.
 *
 * @returns idle, with the first grace
 */
export function initialOverlayReportWatch(): OverlayReportWatchState {
  return { kind: "idle", nextDelayMs: OVERLAY_REPORT_GRACE_MS };
}

/**
 * Apply one event. A navigation while armed is one the watch did not cause, so it starts again from the first grace;
 * a navigation while reloading is the reload a miss asked for committing, so the doubled delay survives it —
 * otherwise every retry would wait the first grace and the cap would never bind. A miss with nothing armed is a
 * stale deadline and reloads nothing. An episode ending while a reload is in flight stops that reload: a status the
 * page sent just before its deadline can be accepted after the reload started, and that page must not be replaced.
 *
 * @param event what happened
 * @param state the watch now
 * @returns the next state and what to do
 */
export function reduceOverlayReportWatch({
  event,
  state,
}: {
  readonly event: OverlayReportWatchEvent;
  readonly state: OverlayReportWatchState;
}): OverlayReportWatchTransition {
  switch (event.kind) {
    case "loaded": {
      if (state.kind === "armed") {
        return { effect: { afterMs: state.delayMs, kind: "schedule" }, state };
      }
      return {
        effect: { afterMs: state.nextDelayMs, kind: "schedule" },
        state: { delayMs: state.nextDelayMs, kind: "armed" },
      };
    }
    case "missed": {
      if (state.kind !== "armed") {
        return { effect: { kind: "none" }, state };
      }
      const nextDelayMs = Math.min(state.delayMs * 2, OVERLAY_REPORT_RETRY_CAP_MS);
      return { effect: { kind: "reload" }, state: { kind: "reloading", nextDelayMs } };
    }
    case "navigated": {
      if (state.kind === "reloading") {
        return { effect: { kind: "none" }, state: { kind: "idle", nextDelayMs: state.nextDelayMs } };
      }
      if (state.kind === "idle") {
        return { effect: { kind: "none" }, state };
      }
      return { effect: { kind: "cancel" }, state: initialOverlayReportWatch() };
    }
    case "reset": {
      if (state.kind === "reloading") {
        return { effect: { kind: "stop" }, state: initialOverlayReportWatch() };
      }
      return { effect: { kind: "cancel" }, state: initialOverlayReportWatch() };
    }
    default: {
      const unhandled: never = event;
      return unhandled;
    }
  }
}
