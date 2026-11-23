"use client";

/**
 * The provider's steer-risk watch (`../../lib/steerRiskWatch.ts`), wired to real timers and the call's `steer-risk`
 * route: it starts each time a call goes live on a plan call and stops when that call is no longer the page's. Its own
 * file so `VoiceProvider.tsx` stays under the line cap. What has been said is the server's to remember
 * (`../../lib/talkNoticeLedger.ts`), so a rollover onto a fresh plan call never says a note twice.
 */
import { type RefObject, useEffect } from "react";

import { type SteerRiskPost, steerRiskPostOf, watchSteerRisk } from "../../lib/steerRiskWatch";
import type { HeldPlanCall } from "./planWiringHeld";
import { afterWhileLive } from "./sendWatchWiring";
import type { ToolLine } from "./voiceContext";

/** How long one ask may take: the route's own register read, then the voice's one step, with room. */
const STEER_RISK_POST_MS = 30_000;

/**
 * One ask of the call's `steer-risk` route, never a rejection.
 *
 * @param callId the plan call
 * @returns what it came to
 */
async function postSteerRisk({ callId }: { callId: string }): Promise<SteerRiskPost> {
  let response: Response;
  try {
    response = await fetch(`/api/talk/call/${encodeURIComponent(callId)}/steer-risk`, {
      body: "{}",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      method: "POST",
      signal: AbortSignal.timeout(STEER_RISK_POST_MS),
    });
  } catch (cause) {
    return steerRiskPostOf({
      body: undefined,
      status: undefined,
      why: `the steer-risk check did not answer: ${String(cause)}`,
    });
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  let why = `the steer-risk route answered HTTP ${String(response.status)}`;
  if (typeof body === "object" && body !== null && "refused" in body && typeof body.refused === "string") {
    why = body.refused;
  }
  return steerRiskPostOf({ body, status: response.status, why });
}

/**
 * The steer-risk watch.
 *
 * @param live the live call's meta, `undefined` with no call up — the watch starts each time it becomes defined
 * @param planCall the plan call this page holds
 * @param note writes a line in the call's log
 */
export function useSteerRiskWatch({
  live,
  planCall,
  note,
}: {
  live: unknown;
  planCall: RefObject<HeldPlanCall | undefined>;
  note: (input: { line: ToolLine }) => void;
}): void {
  useEffect(() => {
    const held = planCall.current;
    if (live === undefined || held === undefined) {
      return undefined;
    }
    const current = (): boolean => planCall.current === held;
    return watchSteerRisk({
      seams: {
        after: ({ ms, run }) =>
          afterWhileLive({
            every: ({ ms: tickMs, tick }) => {
              const timer = setInterval(tick, tickMs);
              return () => {
                clearInterval(timer);
              };
            },
            live: current,
            ms,
            nowMs: () => Date.now(),
            run,
          }),
        live: current,
        note: ({ detail, refused }) => {
          note({ line: { detail, ms: undefined, name: "steer-risk", refused, usage: undefined } });
        },
        post: async () => postSteerRisk({ callId: held.callId }),
      },
    });
  }, [live, note, planCall]);
}
