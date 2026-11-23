"use client";

/**
 * What the messenger band reads while the messenger is open: which application is in front, every
 * {@link FRONT_APP_BAND_POLL_MS} and again the moment the voice's window gains or loses the focus, names only and never
 * a picture. It runs only while the card is drawn, the newest read winning, so
 * what it shows is at most about one poll and one read (~0.23s) old — bounded staleness, not an event stream. Opening and
 * closing are told to the shell, which is what lets a typed look go with no call, and closing forgets any look the
 * owner's last message asked for and has not taken.
 */
import { useEffect, useState } from "react";

import {
  FRONT_APP_BAND_POLL_MS,
  type FrontAppBandSample,
  focusedFrontAppBand,
  frontAppBandOf,
} from "../../lib/messengerBand";
import { desktopBridge } from "./useDesktopShell";

/**
 * The band's sample and its clock.
 *
 * @param dropLook forgets a look asked for and not taken, as the messenger closes
 * @returns the application in front or the last one before the messenger, `undefined` when Slopweaver's console is in
 *   front or the shell cannot say, and the instant ages are read from, moving on every sample so an age never sits still
 */
export function useFrontAppBand({ dropLook }: { dropLook: () => void }): {
  readonly front: FrontAppBandSample | undefined;
  readonly nowMs: number;
} {
  const [front, setFront] = useState<FrontAppBandSample | undefined>(undefined);
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const bridge = desktopBridge();
    bridge?.reportMessengerOpen?.({ report: { open: true } });
    let live = true;
    let newest = 0;
    const sample = async (): Promise<void> => {
      // The newest read wins: a focus change's read and the poll's can overlap, and an older one settling last
      // would put a stale title back.
      newest += 1;
      const asked = newest;
      const value = await bridge?.frontAppBand?.().catch(() => undefined);
      if (!live || asked !== newest) {
        return;
      }
      const sampledAt = new Date();
      setFront(frontAppBandOf({ messengerFocused: document.hasFocus(), sampledAtIso: sampledAt.toISOString(), value }));
      setNowMs(sampledAt.getTime());
    };
    const onFocus = (): void => {
      setFront((drawn) => focusedFrontAppBand({ front: drawn }));
      void sample();
    };
    const onBlur = (): void => {
      void sample();
    };
    void sample();
    const timer = setInterval(() => void sample(), FRONT_APP_BAND_POLL_MS);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
      bridge?.reportMessengerOpen?.({ report: { open: false } });
      dropLook();
    };
  }, [dropLook]);
  return { front, nowMs };
}
