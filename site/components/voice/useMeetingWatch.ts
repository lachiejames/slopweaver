"use client";

/**
 * The provider's meeting watch (`../../lib/meetingDueWatch.ts`), wired to real timers and the call's `meeting-due`
 * route: it starts each time a call goes live on a plan call and stops when that call is no longer the page's, and it
 * holds the one meeting whose join pill is beside the orb. Its own file so `VoiceProvider.tsx` stays under the line cap.
 *
 * What it has shown is kept for the provider's whole life, not one call's, so a rollover or a reconnect onto a fresh
 * plan call never says a meeting twice. The pill stays until the owner clicks it, dismisses it, or the meeting ends — past the
 * call, too: hanging up to go to the meeting is exactly when the owner wants the link.
 *
 * The meetings the owner told the voice they have had or will not go to (`meeting_skip`, `./meetingSkipRun.ts`) are
 * held here for the same provider life and posted with every ask, so the route never says one. A pill already up for
 * one goes the moment the owner says so ([why](../../../docs/console/voice-notices-meetings.md)).
 */
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  type MeetingNotice,
  type MeetingSkip,
  meetingPillLive,
  pillAfterSkips,
  refreshedPill,
  shownAfter,
} from "../../lib/meetingDue";
import { type MeetingPost, meetingPostOf, watchMeetings } from "../../lib/meetingDueWatch";
import type { HeardSegment } from "../../lib/voiceTranscript";
import { newestFinalWordsOf } from "./focusRun";
import type { MeetingSkipSeams } from "./meetingSkipRun";
import type { HeldPlanCall } from "./planWiringHeld";
import { afterWhileLive } from "./sendWatchWiring";
import type { ToolLine } from "./voiceContext";

/** How long one ask may take: the route's own calendar read, then the voice's one step, with room. */
const MEETING_POST_MS = 30_000;

/** How often a shown pill checks whether its meeting has ended. */
const PILL_CHECK_MS = 30_000;

/**
 * One ask of the call's `meeting-due` route, never a rejection.
 *
 * @param callId the plan call
 * @param shown the notice ids already put in front of the owner
 * @param skipped the meetings the owner said they have had or will not go to
 * @returns what it came to
 */
async function postMeetingDue({
  callId,
  shown,
  skipped,
}: {
  callId: string;
  shown: readonly string[];
  skipped: readonly MeetingSkip[];
}): Promise<MeetingPost> {
  let response: Response;
  try {
    response = await fetch(`/api/talk/call/${encodeURIComponent(callId)}/meeting-due`, {
      body: JSON.stringify({ shown, skipped }),
      cache: "no-store",
      headers: { "content-type": "application/json" },
      method: "POST",
      signal: AbortSignal.timeout(MEETING_POST_MS),
    });
  } catch (cause) {
    return meetingPostOf({
      body: undefined,
      status: undefined,
      why: `the meeting check did not answer: ${String(cause)}`,
    });
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  let why = `the meeting-due route answered HTTP ${String(response.status)}`;
  if (typeof body === "object" && body !== null && "refused" in body && typeof body.refused === "string") {
    why = body.refused;
  }
  return meetingPostOf({ body, status: response.status, why });
}

/**
 * The meeting watch and its pill.
 *
 * @param live the live call's meta, `undefined` with no call up — the watch starts each time it becomes defined
 * @param planCall the plan call this page holds
 * @param note writes a line in the call's log
 * @param heard the conversation so far, which a skip is bound to
 * @returns the pill — the meeting it shows, if any, and how the owner dismisses it, one object the provider's state spreads —
 *   and the seams `meeting_skip` runs over
 */
export function useMeetingWatch({
  live,
  planCall,
  note,
  heard,
}: {
  live: unknown;
  planCall: RefObject<HeldPlanCall | undefined>;
  note: (input: { line: ToolLine }) => void;
  heard: RefObject<{ readonly segments: readonly HeardSegment[] }>;
}): {
  pill: { readonly meeting: MeetingNotice | undefined; readonly dismissMeeting: () => void };
  meetingSkip: MeetingSkipSeams;
} {
  const [meeting, setMeeting] = useState<MeetingNotice | undefined>(undefined);
  const shown = useRef<readonly string[]>([]);
  const skipped = useRef<readonly MeetingSkip[]>([]);
  useEffect(() => {
    const held = planCall.current;
    if (live === undefined || held === undefined) {
      return undefined;
    }
    const current = (): boolean => planCall.current === held;
    return watchMeetings({
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
          note({ line: { detail, ms: undefined, name: "meeting", refused, usage: undefined } });
        },
        post: async ({ shown: ids, skipped: skips }) =>
          postMeetingDue({ callId: held.callId, shown: ids, skipped: skips }),
        refresh: ({ notices }) => {
          setMeeting((pill) => refreshedPill({ pill, refreshed: notices }));
        },
        show: ({ meeting: due }) => {
          shown.current = shownAfter({ noticeId: due.noticeId, shown: shown.current });
          setMeeting(due);
        },
        shown: () => shown.current,
        skipped: () => skipped.current,
      },
    });
  }, [live, note, planCall]);
  // The pill goes when its meeting ends, checked on a slow clock rather than a timer per meeting.
  useEffect(() => {
    if (meeting === undefined) {
      return undefined;
    }
    const timer = setInterval(() => {
      if (!meetingPillLive({ notice: meeting, nowMs: Date.now() })) {
        setMeeting(undefined);
      }
    }, PILL_CHECK_MS);
    return () => {
      clearInterval(timer);
    };
  }, [meeting]);
  const dismissMeeting = useCallback((): void => {
    setMeeting(undefined);
  }, []);
  // The owner's word takes the pill for that meeting down now, not at the next poll.
  const meetingSkip = useMemo(
    (): MeetingSkipSeams => ({
      heard: () => newestFinalWordsOf({ segments: heard.current.segments }),
      nowMs: () => Date.now(),
      read: () => skipped.current,
      write: ({ skips }) => {
        skipped.current = skips;
        setMeeting((pill) => pillAfterSkips({ pill, skips }));
      },
    }),
    [heard],
  );
  const pill = useMemo(() => ({ dismissMeeting, meeting }), [dismissMeeting, meeting]);
  return { meetingSkip, pill };
}
