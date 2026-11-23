"use client";

import { useEffect, useState } from "react";

import {
  LIVE_MACHINE_EVERY_MS,
  LIVE_MACHINE_OPENING,
  type LiveMachineHeld,
  liveMachineHeldAfter,
  readLiveMachineWire,
} from "../../lib/liveMachineClient";

/** The route the reading comes from, served by this console's own server. */
const LIVE_MACHINE_URL = "/api/live-machine";

/**
 * Read the machine every two seconds while this page is mounted and visible, and hold the newest reading.
 *
 * Deliberately outside `useLive` and its shared read slots (`site/lib/liveSlots.ts`): those queue `slopweaver` child
 * processes that take seconds, so a two-second local read behind them would be starved, and would starve them in turn.
 * One request at a time; the next is scheduled when the last settles. A hidden tab reads nothing after its first read
 * — the owner's rule that a tab the owner is not looking at keeps no poll going — so the held reading ages,
 * through amber to "stopped updating", until the tab is shown and the next tick lands, within two seconds.
 *
 * @returns what the page holds
 */
export function useLiveMachine(): LiveMachineHeld {
  const [held, setHeld] = useState<LiveMachineHeld>(LIVE_MACHINE_OPENING);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    const schedule = (): void => {
      if (!stopped) {
        timer = setTimeout(tick, LIVE_MACHINE_EVERY_MS);
      }
    };
    const read = async (): Promise<void> => {
      controller = new AbortController();
      try {
        const response = await fetch(LIVE_MACHINE_URL, { cache: "no-store", signal: controller.signal });
        if (!response.ok) {
          setHeld((prior) =>
            liveMachineHeldAfter({
              answer: { failed: `the console answered ${String(response.status)}` },
              held: prior,
            }),
          );
          return;
        }
        const wire = readLiveMachineWire({ payload: await response.json() });
        setHeld((prior) => {
          if (wire === undefined) {
            return liveMachineHeldAfter({ answer: { failed: "the live machine reading changed shape" }, held: prior });
          }
          return liveMachineHeldAfter({ answer: { wire }, held: prior });
        });
      } catch (cause) {
        if (stopped) {
          return;
        }
        const why = cause instanceof Error ? cause.message : String(cause);
        setHeld((prior) =>
          liveMachineHeldAfter({ answer: { failed: `the console did not answer: ${why}` }, held: prior }),
        );
      }
    };
    let first = true;
    function tick(): void {
      // A first read is never held, as `useLive`'s is not, so a tab opened in the background still draws.
      if (!first && document.visibilityState === "hidden") {
        schedule();
        return;
      }
      first = false;
      void read().finally(schedule);
    }
    tick();
    return () => {
      stopped = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      controller?.abort();
    };
  }, []);
  return held;
}
