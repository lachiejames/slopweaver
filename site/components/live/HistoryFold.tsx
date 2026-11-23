/**
 * The Fleet page's history fold: the supervisor's recorded ticks over the last day, judged by the badge's own rules
 * (`lib/fleetHistory.ts`). The badge reads the machine and the sessions live, so between two ticks it can be ahead of
 * the newest span here; the fold names its newest tick and says when the badge has read past it, rather than letting
 * an older span pass for the state the badge shows.
 */
import type { ReactElement, ReactNode } from "react";

import {
  type FleetHistory,
  type HistorySpan,
  historyBehindBadge,
  historySpansOf,
  newestTickIsoOf,
} from "../../lib/fleetHistory";
import { clockWords } from "../../lib/planMetersWords";
import { ReadMark, ReadStandIn } from "./LiveMarks";
import type { LiveState } from "./useLive";

/**
 * One span's figures: when, how many ticks and the working range.
 *
 * @returns the phrase
 */
function spanWords({ span, nowMs }: { span: HistorySpan; nowMs: number }): string {
  // The reader refused any instant that does not parse, so both clocks exist.
  const from = clockWords({ iso: span.fromIso, nowMs })!;
  const to = clockWords({ iso: span.toIso, nowMs })!;
  let when = `${from} to ${to}`;
  if (span.ticks === 1) {
    when = from;
  }
  let working = "";
  if (span.working !== undefined && span.working.low === span.working.high) {
    working = ` · ${String(span.working.low)} working`;
  } else if (span.working !== undefined) {
    working = ` · ${String(span.working.low)} to ${String(span.working.high)} working`;
  }
  let ticks = `${String(span.ticks)} ticks`;
  if (span.ticks === 1) {
    ticks = "1 tick";
  }
  return `${when} · ${ticks}${working}`;
}

/**
 * The fleet's states over the last day, closed by default: each run of ticks in one state for one cause, newest
 * first. A fixture page never borrows this machine's live history.
 *
 * @param badgeReadAtIso the instant the badge's facts were read at
 * @returns the fold
 */
export function HistoryFold({
  history,
  badgeReadAtIso,
}: {
  history: LiveState<FleetHistory>;
  badgeReadAtIso: string;
}): ReactElement {
  // Nothing to unfold until the ticks have been read: the mark beside the summary says why.
  let body: ReactNode = undefined;
  let newest = "";
  let mark: ReactNode = null;
  if (history.phase !== "ready") {
    mark = <ReadStandIn state={history} subject="the supervisor's ticks" />;
  } else {
    mark = <ReadMark state={history} subject="The supervisor's ticks" />;
    const nowMs = Date.parse(history.value.toIso);
    const spans = historySpansOf({ history: history.value });
    const last = newestTickIsoOf({ history: history.value });
    if (last !== undefined) {
      newest = `, newest tick ${clockWords({ iso: last, nowMs })!}`;
    }
    body = (
      <>
        {last !== undefined && historyBehindBadge({ badgeReadAtIso, history: history.value }) && (
          <p className="m-0 text-muted-foreground" data-history-lag>
            The badge above has read the machine since the newest tick here; this catches up at the next tick.
          </p>
        )}
        {spans.length === 0 && <p className="m-0 text-muted-foreground">no supervisor tick in the last day</p>}
        <ol className="m-0 grid list-none gap-1 p-0">
          {spans.map((span) => (
            <li key={`${span.fromIso}-${span.kind}`} data-span={span.kind}>
              <strong className="font-semibold">{span.badge}</strong>
              {span.cause !== "" && <span>: {span.cause}</span>}
              <span className="text-muted-foreground"> · {spanWords({ nowMs, span })}</span>
            </li>
          ))}
        </ol>
        {!history.value.reachedFrom && (
          <p className="m-0 text-muted-foreground">
            The read stopped at its size budget, so the history starts at its earliest tick, not a day ago.
          </p>
        )}
      </>
    );
  }
  return (
    <details className="text-[0.82rem]" data-history>
      <summary className="cursor-pointer text-muted-foreground">
        history: the last day, as the supervisor saw it{newest} {mark}
      </summary>
      {body !== undefined && <div className="mt-1 grid gap-1">{body}</div>}
    </details>
  );
}
