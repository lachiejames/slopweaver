/**
 * The effectful half of `overlayReportWatch.ts`: one timer per overlay, armed when its page's main frame finishes
 * loading, reloading that page when the deadline passes with no status accepted. `webContents.reload()`, never a
 * fresh `loadURL`: the origin is unchanged, and the reload's own `did-navigate` already retires the page
 * (`main.ts` `retireOverlayPage`) while keeping any command asked meanwhile for the first page that reports.
 *
 * A failed load and a crash cancel the watch, because each already has its own recovery (`recover()`, the reload on
 * `render-process-gone`); a status accepted or a new origin ends the episode through the controller. Each arm
 * carries a generation, so a deadline already queued for an older load never acts on a newer one. A status the page
 * sent just before its deadline can still be accepted after the reload has started, so an episode ending before the
 * reload commits stops it, and the page that reported stays.
 */
import type { BrowserWindow } from "electron";

import {
  initialOverlayReportWatch,
  type OverlayReportWatchEvent,
  type OverlayReportWatchState,
  reduceOverlayReportWatch,
} from "./overlayReportWatch";

/** What `main.ts` tells the watch beyond what the window's own events say. */
export interface OverlayReportWatchController {
  /** The page's status was accepted: it listens, so the episode is over. */
  readonly reported: () => void;
  /** A new console origin is about to be loaded: the episode starts again from the first grace. */
  readonly newOrigin: () => void;
}

/**
 * Install the watch on a freshly created overlay. Called once per overlay, from `main.ts`'s `createOverlay`.
 *
 * @param target the overlay window just made
 * @param listening whether this window is still the overlay and its page has reported since its last load
 * @returns the controller `main.ts` calls on an accepted status and before a new origin's load
 */
export function installOverlayReportWatch({
  listening,
  target,
}: {
  readonly listening: () => boolean;
  readonly target: BrowserWindow;
}): OverlayReportWatchController {
  const contents = target.webContents;
  let state: OverlayReportWatchState = initialOverlayReportWatch();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  const cancel = (): void => {
    clearTimeout(timer);
    timer = undefined;
    generation += 1;
  };
  const apply = ({ event }: { event: OverlayReportWatchEvent }): void => {
    const transition = reduceOverlayReportWatch({ event, state });
    state = transition.state;
    const { effect } = transition;
    switch (effect.kind) {
      case "none": {
        return;
      }
      case "cancel": {
        cancel();
        return;
      }
      case "schedule": {
        cancel();
        const armed = generation;
        timer = setTimeout(() => {
          timer = undefined;
          if (armed !== generation || target.isDestroyed() || contents.isDestroyed() || listening()) {
            return;
          }
          apply({ event: { kind: "missed" } });
        }, effect.afterMs);
        return;
      }
      case "reload": {
        cancel();
        contents.reload();
        return;
      }
      case "stop": {
        cancel();
        // A destroyed page has no navigation left to stop; anything else, stopped before it commits, keeps the page
        // that just reported (`webContents.stop`: "Stops any pending navigation").
        if (!contents.isDestroyed()) {
          contents.stop();
        }
        return;
      }
      default: {
        const unhandled: never = effect;
        return unhandled;
      }
    }
  };
  contents.on("did-finish-load", () => {
    if (!listening()) {
      apply({ event: { kind: "loaded" } });
    }
  });
  contents.on("did-navigate", () => {
    apply({ event: { kind: "navigated" } });
  });
  contents.on("did-fail-load", (_event, _code, _description, _url, isMainFrame) => {
    if (isMainFrame) {
      apply({ event: { kind: "reset" } });
    }
  });
  contents.on("render-process-gone", () => {
    apply({ event: { kind: "reset" } });
  });
  contents.on("destroyed", () => {
    apply({ event: { kind: "reset" } });
  });
  target.on("closed", () => {
    apply({ event: { kind: "reset" } });
  });
  return {
    newOrigin: () => {
      apply({ event: { kind: "reset" } });
    },
    reported: () => {
      apply({ event: { kind: "reset" } });
    },
  };
}
