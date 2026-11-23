"use client";

/**
 * The desktop shell's commands into the voice widget (`VoiceWidget.tsx`): the tray's Start voice, a launcher's
 * `slopweaver://voice`, an update's hang-up, a fold on a click away and the tray's window moves. Each reads the call as
 * it is when it arrives, not as it was when the listener was subscribed.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { OverlayShellCommand } from "../../lib/desktopShellOverlay";
import type { VoiceWindowState } from "../../lib/voiceWindow";

/**
 * Subscribe the widget to the shell's commands for as long as a shell drives it.
 *
 * @param shell the subscription a desktop shell offers, absent in a page with none
 * @param callActive whether this render shows a call up, connecting included
 * @param start begins a fresh call, as the owner's Talk press does
 * @param stop ends the call, as the owner's end button does
 * @param fold folds the widget to the orb for now, or lifts that fold, writing nothing
 * @param moveTo the owner's own move to a window state, which lets a fold go
 */
export function useShellCommands({
  shell,
  callActive,
  start,
  stop,
  fold,
  moveTo,
}: {
  shell: { readonly onCommand: (listener: (command: OverlayShellCommand) => void) => () => void } | undefined;
  callActive: boolean;
  start: (() => void) | undefined;
  stop: (() => void) | undefined;
  fold: (folded: boolean) => void;
  moveTo: { readonly current: (next: VoiceWindowState) => void };
}): void {
  const now = useRef<{
    readonly active: boolean;
    readonly start: (() => void) | undefined;
    readonly stop: (() => void) | undefined;
  }>({ active: false, start: undefined, stop: undefined });
  // A start the shell asked for counts as a call until a render made after it commits: `start` sets the link to
  // connecting before its first await, so that render already shows the call, or shows it refused. Without it a
  // second `activate` landing before that commit (a launcher's hotkey pressed twice) opens a second call.
  // `asked` forces that render, since a refusal that leaves every state as it was would otherwise make none and
  // leave the latch set for good.
  const pendingStart = useRef<object | undefined>(undefined);
  const pendingAtRender = pendingStart.current;
  // A fresh object each time, never `Object.is` equal to the last, so the render is never skipped.
  const [, asked] = useState<object>({});
  // A press while a start is still pending is held, never dropped: it runs once that start's render commits, against
  // the call as it then is, so a start refused with nothing changed never swallows the press after it. Each held
  // press runs in turn, one per commit, as each `activate` starts its own; once a call is up the rest only lift a fold.
  const deferred = useRef(0);
  const activate = useRef<() => void>(() => undefined);
  const replay = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // A layout effect, so a committed call is copied in the same commit: a passive one leaves a gap after a Talk press
  // commits connecting where an `activate` still reads no call and supersedes it.
  useLayoutEffect(() => {
    now.current = { active: callActive, start, stop };
    // Starting a call is never a window move: it opens in whichever state the owner left. One that arrives with the call
    // already up is stale, and only lifts a fold.
    activate.current = () => {
      if (now.current.active) {
        deferred.current = 0;
        fold(false);
        return;
      }
      if (pendingStart.current !== undefined) {
        deferred.current += 1;
        return;
      }
      const latch = {};
      pendingStart.current = latch;
      asked(latch);
      now.current.start?.();
    };
    if (pendingAtRender !== undefined && pendingStart.current === pendingAtRender) {
      pendingStart.current = undefined;
      // With the call up every held press would only lift a fold, so all are spent at once and none outlives it.
      if (deferred.current > 0 && callActive) {
        deferred.current = 0;
        fold(false);
      }
      // In a task of its own, never inside this commit: a backlog replayed synchronously cascades nested updates into
      // React's update-depth limit. Never two at once, so the one slot unmount clears holds every
      // timer; the replay's own commit schedules the next.
      if (deferred.current > 0 && replay.current === undefined) {
        deferred.current -= 1;
        replay.current = setTimeout(() => {
          replay.current = undefined;
          activate.current();
        }, 0);
      }
    }
  });
  useEffect(
    () => () => {
      clearTimeout(replay.current);
    },
    [],
  );
  useEffect(() => {
    if (shell === undefined) {
      return undefined;
    }
    return shell.onCommand((command) => {
      if (command === "activate") {
        activate.current();
        return;
      }
      // The shell ends the call for an update the owner pressed, as their own end button would; this only hangs up, and
      // the shell itself restarts the call once the update settles (`desktop/src/updateCallShell.ts`).
      if (command === "hang-up") {
        if (now.current.active) {
          now.current.stop?.();
        }
        return;
      }
      // A click into another app folds to the orb for now and writes nothing (`overlayCommandOnBlur`); the tray
      // menu's `collapse` and `expand` are the owner's moves, to the middle and to full screen.
      if (command === "fold") {
        fold(true);
        return;
      }
      let next: VoiceWindowState = "fullscreen";
      if (command === "collapse") {
        next = "middle";
      }
      moveTo.current(next);
    });
  }, [shell, fold, moveTo]);
}
