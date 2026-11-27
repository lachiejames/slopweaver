"use client";

/**
 * The voice's window coming back from its renderer dying under a call (`site/lib/overlayCrashRecovery.ts` says what
 * and why). Once, as the page mounts, it asks the shell for what it held; a call that was up is ended on the server
 * with the crash as its reason, its transcript closed with the same words, and a reconnect opened — the same
 * reconnect a dropped link gets, minted to carry on from the newest call file. Its own file so `./VoiceProvider.tsx`
 * stays under the line cap.
 */
import { type RefObject, useEffect, useRef } from "react";

import {
  type CrashRecoverySteps,
  crashRecoveryFailure,
  overlayCrashRecoveryOf,
  recoverCrashedCall,
} from "../../lib/overlayCrashRecovery";
import type { DesktopVoiceSeam } from "./desktopVoiceSeam";
import { stopCrashedPlanCall } from "./planCallClient";
import { windowInstance } from "./useDesktopShell";
import type { LiveMeta } from "./voiceContext";

/**
 * Post the closing batch to the transcript route.
 *
 * @param wire the batch
 * @returns whether the route took it
 */
const closeTranscript: CrashRecoverySteps["closeTranscript"] = async ({ wire }) => {
  try {
    const response = await fetch("/api/talk/transcript", {
      body: JSON.stringify(wire),
      cache: "no-store",
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    return response.ok;
  } catch {
    return false;
  }
};

/**
 * Tell the shell the call up now, and take and act on its recovery once for the page's life. The call is reported as
 * it goes live and cleared as it is released, so the stretch while one is still connecting is not covered: a death
 * there leaves that attempt to the server's absent-stream timer, as before.
 *
 * @param desktop the provider's place in the shell; only the voice's window carries `reportCall` and `takeRecovery`
 * @param live the call live now, its plan call's id among what it was minted with
 * @param currentCall the transcript's call now, which the live call's lines are written to
 * @param reopen open the reconnect, as a dropped link's wait does
 * @param generation the page's call counter, bumped by every call or typed answer opened or released, so one the owner
 *   began while the recovery's posts were out stops the reconnect
 * @param failed show why a recovery did not bring the call back
 */
export function useCrashRecovery({
  desktop,
  live,
  currentCall,
  reopen,
  generation,
  failed,
}: {
  desktop: DesktopVoiceSeam | undefined;
  live: LiveMeta | undefined;
  currentCall: () => string | undefined;
  reopen: RefObject<() => void>;
  generation: RefObject<number>;
  failed: (why: string) => void;
}): void {
  const report = desktop?.reportCall;
  useEffect(() => {
    if (report === undefined) {
      return;
    }
    const transcriptCallId = currentCall();
    if (live === undefined || transcriptCallId === undefined) {
      report(null);
      return;
    }
    report({ planCallId: live.callId, transcriptCallId });
  }, [currentCall, live, report]);
  const asked = useRef(false);
  const take = desktop?.takeRecovery;
  // The test instance marks the closing batch too, so a crash never lands the walk's call as the owner's.
  const instance = windowInstance();
  // Read through a ref, so a provider re-rendering hands the one ask its latest callback without asking again.
  const latest = useRef(failed);
  useEffect(() => {
    latest.current = failed;
  }, [failed]);
  useEffect(() => {
    if (take === undefined || asked.current) {
      return;
    }
    asked.current = true;
    const since = generation.current;
    void (async (): Promise<void> => {
      const recovery = overlayCrashRecoveryOf({ value: await take().catch(() => null) });
      if (recovery === undefined) {
        return;
      }
      const steps: CrashRecoverySteps = {
        closeTranscript,
        reconnect: () => {
          reopen.current();
        },
        stopPlan: async ({ callId, why }) => stopCrashedPlanCall({ callId, why }),
        superseded: () => generation.current !== since,
      };
      const outcome = await recoverCrashedCall({ instance, recovery, steps, writeId: crypto.randomUUID() });
      const failure = crashRecoveryFailure({ outcome, recovery });
      if (failure !== undefined) {
        latest.current(failure);
      }
    })();
  }, [generation, instance, reopen, take]);
}
