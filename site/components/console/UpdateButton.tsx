"use client";

/**
 * The sidebar's one Update button, under the build line and never inside its fold, so it is there at a glance — and
 * the menu bar's update item, which this publishes its offer to and which asks it to run (a very clear update-now
 * button that quits and reopens on the latest build, the same from the menu bar, and on a call an offer to end it,
 * update, and restart it as soon as the update lands).
 *
 * The release-notes modal carries the same button in its footer (`ReleaseNotesModal.tsx`). Both draw ONE controller,
 * `useUpdateControl`, so the sidebar, the modal and the menu bar press the same action through the same guard, and
 * the menu bar's offer and listeners are registered once whichever surfaces are drawn.
 *
 * What a press does is `site/lib/updateAction.ts`'s; every effect is the shell's (`desktop/src/updateShell.ts`). A
 * press that ends a call says so on the button itself, and the shell restarts the call once the update settles —
 * whether it landed or the previous app was put back, so the voice can say what happened.
 */
import { type ReactElement, useCallback, useEffect, useRef, useState } from "react";

import type { BuildStanding } from "../../lib/buildStanding";
import { type UpdateBridge, type UpdateState, updateRefusalOf } from "../../lib/desktopShellUpdate";
import type { ShellStanding } from "../../lib/shellStandingWords";
import {
  outcomeLine,
  refusalSentence,
  SWAP_POLL_MS,
  SWAP_WAIT_MS,
  sidebarAction,
  trayOfferOf,
  type UpdateAction,
  updateAction,
} from "../../lib/updateAction";
import { cn } from "../../lib/utils";
import { refreshLive } from "../live/useLive";
import { Button } from "../ui/button";
import { PlainWhy } from "./RawFold";

/**
 * A button as wide as the sidebar column that wraps its words onto a second line rather than overflowing it: the
 * button's own `whitespace-nowrap` centred "What's changed — 3 changes, 1 in the app" past both edges of a ~170px
 * column, so its fold clipped it to "t's changed — 3 changes, 1 in the".
 */
export const SIDEBAR_BUTTON_WRAP = "h-auto min-h-6 w-full py-[0.2rem] leading-snug text-balance whitespace-normal";

/** The one update controller every surface draws. */
export interface UpdateControl {
  /** What a press does now. */
  readonly action: UpdateAction;
  /** How the last update ended, or `undefined` when there is nothing to say. */
  readonly last: { readonly lead: string; readonly why: string } | undefined;
  /** The last update's log, for the outcome line's hover. */
  readonly logPath: string | undefined;
  /** Why the last press could not go ahead, or `undefined`. */
  readonly problem: string | undefined;
  /** Press the button: runs the action as it stands when the press arrives. */
  readonly press: () => void;
}

/**
 * The update's state and effects: the action, the press guard, the swap's wait, and the menu bar's offer and
 * listeners. Call it once, and hand the result to every `UpdateButton`.
 *
 * @param page the page's build standing
 * @param app the app's build standing, `undefined` in a browser or before the app answers
 * @param callLive whether a voice call is up now
 * @param update the shell's update half and its standing (`useUpdateShell`)
 * @returns the controller
 */
export function useUpdateControl({
  page,
  app,
  callLive,
  update,
}: {
  page: BuildStanding;
  app: ShellStanding | undefined;
  callLive: boolean;
  update: { readonly bridge: UpdateBridge | undefined; readonly state: UpdateState };
}): UpdateControl {
  const { bridge, state } = update;
  const [problem, setProblem] = useState<string | undefined>(undefined);
  // The instant a swap's call ended, while the console's held build is still swapping in.
  const [swapSinceMs, setSwapSinceMs] = useState<number | undefined>(undefined);
  let action = updateAction({ app, callLive, canUpdate: bridge !== undefined, page, running: state.running });
  if (swapSinceMs !== undefined) {
    action = { kind: "busy", label: "Updating…" };
  }
  const offer = trayOfferOf({ action });
  const offerLabel = offer?.label;
  const offerEnabled = offer?.enabled;
  useEffect(() => {
    if (bridge === undefined) {
      return;
    }
    if (offerLabel === undefined || offerEnabled === undefined) {
      bridge.publishUpdateOffer({ offer: null });
      return;
    }
    bridge.publishUpdateOffer({ offer: { enabled: offerEnabled, label: offerLabel } });
  }, [bridge, offerEnabled, offerLabel]);
  // One press at a time: a double click, or the menu bar's item beside the button, before the running state redraws.
  const pressing = useRef(false);
  const run = useCallback(
    async (pressed: UpdateAction): Promise<void> => {
      if (bridge === undefined || pressed.kind === "none" || pressed.kind === "busy" || pressing.current) {
        return;
      }
      pressing.current = true;
      try {
        await pressUpdate({ bridge, onProblem: setProblem, onSwap: setSwapSinceMs, pressed });
      } finally {
        pressing.current = false;
      }
    },
    [bridge],
  );
  // Every surface, and the menu bar's item, runs whatever the button would, as it stands when the press arrives.
  const latest = useRef(action);
  useEffect(() => {
    latest.current = action;
  });
  const press = useCallback((): void => {
    void run(latest.current);
  }, [run]);
  useEffect(() => {
    if (bridge === undefined) {
      return undefined;
    }
    const offRun = bridge.onUpdateRun(() => {
      press();
    });
    const offCheck = bridge.onUpdateCheck(() => {
      refreshLive({ slug: "build" });
    });
    return () => {
      offRun();
      offCheck();
    };
  }, [bridge, press]);
  // A swap waits, after its call ends, for the console to serve the build held for it — then reloads onto it, which
  // restarts the call. Past the wait it reloads anyway, so the call is never left ended. The reload replaces this
  // page, so there is no state to clear.
  const finishSwap = useCallback((): void => {
    bridge?.reloadForUpdate();
  }, [bridge]);
  useEffect(() => {
    if (swapSinceMs === undefined) {
      return undefined;
    }
    const poll = setInterval(() => {
      refreshLive({ slug: "build" });
    }, SWAP_POLL_MS);
    const giveUp = setTimeout(
      () => {
        finishSwap();
      },
      Math.max(0, swapSinceMs + SWAP_WAIT_MS - Date.now()),
    );
    return () => {
      clearInterval(poll);
      clearTimeout(giveUp);
    };
  }, [finishSwap, swapSinceMs]);
  const swapped = swapSinceMs !== undefined && (page.kind === "reload" || page.kind === "current");
  useEffect(() => {
    if (swapped) {
      finishSwap();
    }
  }, [finishSwap, swapped]);
  return { action, last: outcomeLine({ outcome: state.outcome }), logPath: state.outcome?.logPath, press, problem };
}

/**
 * The button, the line saying how the last update failed, and why a press could not go ahead. The modal's footer
 * leaves the last update's line to the sidebar: the modal is only what updating NOW brings.
 *
 * @param control the one controller (`useUpdateControl`)
 * @param surface where it is drawn: under the sidebar's build line, or in the release-notes modal's footer
 * @returns the button, or nothing when there is nothing to do and nothing to say
 */
export function UpdateButton({
  control,
  surface,
}: {
  control: UpdateControl;
  surface: "modal" | "sidebar";
}): ReactElement | null {
  const { logPath, problem, press } = control;
  let action = control.action;
  let last = control.last;
  if (surface === "modal") {
    last = undefined;
  }
  if (surface === "sidebar") {
    action = sidebarAction({ action });
  }
  if (action.kind === "none" && last === undefined && problem === undefined) {
    return null;
  }
  return (
    <div
      className={cn(
        "text-muted-foreground",
        surface === "sidebar" && "px-[0.55rem] pb-[0.3rem] text-[0.72rem] group-data-[sidebar=icons]/console:hidden",
        surface === "modal" && "text-[0.8rem]",
      )}
    >
      {action.kind === "none" ? null : (
        <Button
          type="button"
          size={surface === "sidebar" ? "xs" : "sm"}
          variant={action.kind === "busy" ? "outline" : "default"}
          className={cn(surface === "sidebar" && SIDEBAR_BUTTON_WRAP)}
          disabled={action.kind === "busy"}
          title={pressTitle({ action })}
          onClick={press}
        >
          {action.label}
        </Button>
      )}
      {problem === undefined ? null : <p className="m-0 mt-[0.2rem] text-foreground">{problem}</p>}
      {last === undefined ? null : (
        <div className="m-0 mt-[0.2rem]" title={logPath}>
          {last.lead} <PlainWhy why={last.why} />
        </div>
      )}
    </div>
  );
}

/**
 * One press: end the call first when the action says so, then take the action's step.
 *
 * @param onProblem shows why a step could not go ahead, or clears it
 * @param onSwap marks the instant a swap's call ended
 */
async function pressUpdate({
  bridge,
  onProblem,
  onSwap,
  pressed,
}: {
  bridge: UpdateBridge;
  onProblem: (problem: string | undefined) => void;
  onSwap: (sinceMs: number) => void;
  pressed: Exclude<UpdateAction, { readonly kind: "none" | "busy" }>;
}): Promise<void> {
  onProblem(undefined);
  // Every press asks the shell to end a call first, which is no work with none up: the shell sees the voice window's
  // call the moment it starts, while this page hears of it only once the overlay's status arrives — and a press in
  // that gap, labelled for no call, is refused for the call it had not ended.
  const callRefused = updateRefusalOf({ value: await bridge.endCallForUpdate() });
  if (callRefused !== undefined) {
    onProblem(refusalSentence({ code: callRefused }));
    return;
  }
  switch (pressed.kind) {
    case "install": {
      const refused = updateRefusalOf({ value: await bridge.startUpdate() });
      if (refused !== undefined) {
        onProblem(refusalSentence({ code: refused }));
      }
      return;
    }
    case "relaunch":
      bridge.relaunchForUpdate();
      return;
    case "reload":
      bridge.reloadForUpdate();
      return;
    case "swap":
      // The shell's deadline survives this page being reloaded under the wait; the page's own below is the backup.
      bridge.beginSwapForUpdate?.();
      onSwap(Date.now());
      refreshLive({ slug: "build" });
      return;
    default: {
      const unhandled: never = pressed.kind;
      return unhandled;
    }
  }
}

/**
 * What a press will do, in a sentence, for the button's hover.
 *
 * @returns the sentence
 */
function pressTitle({ action }: { action: UpdateAction }): string {
  switch (action.kind) {
    case "install":
      return withCall({
        action,
        line: "Pulls the latest main, rebuilds the app, quits it and reopens it on the new build. If the new build does not start, the previous one comes back.",
      });
    case "relaunch":
      return withCall({ action, line: "Quits the app and reopens it on the build already installed." });
    case "reload":
      return withCall({ action, line: "Reloads the console onto the build it now serves." });
    case "swap":
      return withCall({
        action,
        line: "The new console build swaps in as the call ends; then the page reloads onto it.",
      });
    case "busy":
      return "An update is under way.";
    case "none":
      return "";
    default: {
      const unhandled: never = action;
      return unhandled;
    }
  }
}

/**
 * A press's sentence, with what happens to the call when it ends one.
 *
 * @returns the sentence
 */
function withCall({ action, line }: { action: { readonly endsCall: boolean }; line: string }): string {
  if (!action.endsCall) {
    return line;
  }
  return `Ends the call first, and starts it again once the update lands. ${line}`;
}
