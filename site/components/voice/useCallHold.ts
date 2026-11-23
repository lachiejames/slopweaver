"use client";

/**
 * A rebuild waits for the console voice's call — the page's half, as one hook `VoiceProvider` calls with
 * whether its call is live. The mechanism and its reason are `site/lib/consoleHold.ts`'s header.
 *
 * While the call is live it does two things. It beats the call's LEASE to `/api/console/call`, which holds the
 * refresh round's swap and answers with the build waiting behind the call — for the sidebar build chip
 * (`BuildStatus.tsx`) to name, never either voice view; the last beat, on the way out —
 * Stop, a dropped connection or `pagehide` — rides `keepalive` so an unloading page still ends its lease, and a
 * beat that does not land lets the lease lapse a minute later with the call untouched. And it holds any
 * navigation that would unload this document on the Navigation API's `navigate` event — a newer build's forced
 * reload, a crossing into the docs' own layout, a link off the console — and opens it once the call ends.
 * Chrome, which the console runs in, has that API; a browser without it keeps the server-side hold only.
 */
import { useEffect, useState } from "react";

import {
  CALL_BEAT_EVERY_MS,
  CALL_BEAT_ROUTE,
  type CallBeatAnswer,
  holdsNavigation,
  parseBeatAnswer,
  type WaitingBuild,
} from "../../lib/consoleHold";

/**
 * Post one beat and read the route's answer.
 *
 * @param callId the call's own id, fixed for its whole life
 * @param live `false` for the hang-up, which ends the lease
 * @returns the answer, or `undefined` when the beat did not land or the body was not one
 */
async function postBeat({ callId, live }: { callId: string; live: boolean }): Promise<CallBeatAnswer | undefined> {
  try {
    const response = await fetch(CALL_BEAT_ROUTE, {
      body: JSON.stringify({ callId, live }),
      cache: "no-store",
      headers: { "content-type": "application/json" },
      keepalive: !live,
      method: "POST",
    });
    return parseBeatAnswer({ body: await response.json() });
  } catch {
    return undefined;
  }
}

/**
 * The call hold.
 *
 * @param live whether the voice's call is up now
 * @returns the build a refresh is holding behind the call, and a navigation held until it ends — both only
 *   while it is live
 */
export function useCallHold({ live }: { live: boolean }): {
  waiting: WaitingBuild | undefined;
  held: string | undefined;
} {
  const [waiting, setWaiting] = useState<WaitingBuild | undefined>(undefined);
  const [held, setHeld] = useState<string | undefined>(undefined);
  const [wasLive, setWasLive] = useState(live);
  // A new call starts with nothing waiting and nothing held: reset while rendering, on the change itself.
  if (live !== wasLive) {
    setWasLive(live);
    if (live) {
      setWaiting(undefined);
      setHeld(undefined);
    }
  }

  useEffect(() => {
    if (!live) {
      return undefined;
    }
    const callId = crypto.randomUUID();
    let current = true;
    const beat = async (): Promise<void> => {
      const answer = await postBeat({ callId, live: true });
      if (current && answer !== undefined) {
        setWaiting(answer.waiting);
      }
    };
    void beat();
    const timer = window.setInterval(() => {
      void beat();
    }, CALL_BEAT_EVERY_MS);
    return () => {
      current = false;
      window.clearInterval(timer);
      void postBeat({ callId, live: false });
    };
  }, [live]);

  useEffect(() => {
    if (!live || !("navigation" in window)) {
      return undefined;
    }
    const onNavigate = (event: NavigateEvent): void => {
      const hold = holdsNavigation({
        cancelable: event.cancelable,
        download: event.downloadRequest !== null,
        navigationType: event.navigationType,
        sameDocument: event.destination.sameDocument,
      });
      if (hold) {
        event.preventDefault();
        setHeld(event.destination.url);
      }
    };
    window.navigation.addEventListener("navigate", onNavigate);
    return () => {
      window.navigation.removeEventListener("navigate", onNavigate);
    };
  }, [live]);

  // Hung up with a navigation held: open it now — the reload the call was spared.
  useEffect(() => {
    if (!live && held !== undefined) {
      window.location.assign(held);
    }
  }, [held, live]);

  if (!live) {
    return { held: undefined, waiting: undefined };
  }
  return { held, waiting };
}
