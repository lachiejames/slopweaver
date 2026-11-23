"use client";

/**
 * The header's two lines of status, beside its controls: the voice's live state with its age, and under it what that
 * state's headline cannot say — a failure, the connecting step, or the state's detail such as the verb it is running —
 * with its nudge. The second line keeps its height when it has nothing to say, so the header never grows or shrinks as
 * a verb starts and ends (a row whose height changes flickers).
 */
import type { ReactElement } from "react";

import { messengerHeaderStatus } from "../../lib/messengerMode";
import { plainReasonOf } from "../../lib/plainReason";
import type { VoiceStatus } from "../../lib/voiceActivity";
import { NUDGE_COPY } from "./orbParts";
import type { VoiceState } from "./voiceContext";

/**
 * The two lines.
 *
 * @param voice the console voice's state
 * @param status the state the orb shows, a preview's included
 * @returns the status block
 */
export function CallCardStatus({ voice, status }: { voice: VoiceState; status: VoiceStatus }): ReactElement {
  const detail = status.detail;
  const showDetail = detail !== undefined && !detail.startsWith(status.headline);
  let line: string | undefined;
  let lineTitle: string | undefined;
  if (voice.phase === "error" && voice.failure !== undefined) {
    // One truncated line has no room for a fold, so the plain words lead and the raw message is its hover.
    const reason = plainReasonOf({ why: voice.failure });
    line = reason.plain;
    lineTitle = reason.raw;
  } else if ((voice.phase === "connecting" || voice.phase === "reconnecting") && voice.step !== undefined) {
    line = `${voice.step}…`;
  } else if (showDetail) {
    line = detail;
  }
  const nudge = status.nudge === undefined ? undefined : NUDGE_COPY[status.nudge];
  const words = messengerHeaderStatus({
    callActiveAnywhere: voice.callActiveAnywhere,
    headline: status.headline,
    phase: status.phase,
    seconds: status.seconds,
  });
  return (
    <div className="grid min-w-0 flex-1 grid-rows-[1.15rem_1rem] content-center">
      {/* Only the headline is announced, so a ticking age is not read aloud every second. */}
      <span className="sr-only" aria-live="polite">
        {status.headline}
      </span>
      <span aria-hidden="true" className="flex min-w-0 items-center gap-[0.4rem]">
        <span className="size-[0.5rem] shrink-0 rounded-full bg-(--v-ring)" />
        <span className="min-w-0 truncate text-[12.6px] font-[620] text-foreground tabular-nums">{words}</span>
      </span>
      <span data-status-detail="" className="flex min-w-0 items-center gap-[0.4rem] text-[11px] text-muted-foreground">
        <span className="min-w-0 flex-1 truncate tabular-nums" title={lineTitle ?? line}>
          {line}
        </span>
        {nudge === undefined ? null : (
          <button
            type="button"
            className="shrink-0 cursor-pointer border-0 bg-transparent p-0 text-[11px] text-primary underline"
            title={nudge.title}
            onClick={voice.nudge}
          >
            {nudge.label}
          </button>
        )}
      </span>
    </div>
  );
}
