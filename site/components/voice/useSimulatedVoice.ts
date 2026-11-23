"use client";

/**
 * The clock behind a `?voice=sim` preview (`voiceSimOf`, `site/lib/voiceStage.ts`): seconds since it started, ticking
 * about thirty times a second, so the orb swells with a made-up voice exactly as a call's levels would move it. Off,
 * it never ticks, and the console renders nothing for it.
 */
import { useEffect, useState } from "react";

/** How often the made-up voice's level is re-read: a call's levels arrive about twelve times a second, this faster. */
const TICK_MS = 33;

/**
 * Seconds since the made-up voice started, or `undefined` while none is asked for.
 *
 * @param on whether a preview asked for one, held off a live call by the caller
 * @returns the clock, or `undefined`
 */
export function useSimulatedVoice({ on }: { on: boolean }): number | undefined {
  const [clock, setClock] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (!on) {
      return undefined;
    }
    const started = performance.now();
    const timer = window.setInterval(() => {
      setClock((performance.now() - started) / 1000);
    }, TICK_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [on]);
  if (!on) {
    return undefined;
  }
  return clock;
}
