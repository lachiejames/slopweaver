"use client";

/**
 * How current a provider's stored data is, said inside a panel drawn from the corpus (`SourceFreshnessLine`).
 *
 * A reader must know when what they are looking at is potentially stale, and be told upfront when a source's sync has
 * a problem, so they can account for it in what they do next. The sidebar's per-source strip and its notice are
 * noise and are not drawn; the line inside a panel is what remains. The words are `site/lib/sourceFreshness.ts`; this
 * draws them. Every line rides the shared poll (`useLive`), so they cost one child process between them however
 * many are on the page.
 *
 * A report that cannot be read is a staleness mark whose hover says why, never left blank. A report still being
 * read is a spinner: a progress indicator, never text saying it is in progress.
 */
import { type ReactElement, useEffect, useState } from "react";

import { FRESHNESS_CLOCK_TICK_MS, freshnessWordsOf } from "../../lib/sourceFreshness";
import type { SourceFreshnessReport, SourceFreshnessSource } from "../../lib/sourceFreshnessReport";
import { FRESHNESS_TONES } from "../../lib/sourceFreshnessTones";
import { cn } from "../../lib/utils";
import { ReadMark } from "../live/LiveMarks";
import { readSourceFreshness } from "../live/readSourceFreshness";
import { type LiveState, useLive } from "../live/useLive";
import { PlainWhy } from "./RawFold";
import { ReadingIndicator } from "./ReadingIndicator";
import { StaleMark } from "./StaleMark";

/** The fast lane's cadence, the same every other live tile polls at. */
const FAST_POLL_MS = 20_000;

/**
 * The freshness report on the shared channel.
 *
 * @returns its live state
 */
function useSourceFreshness(): LiveState<SourceFreshnessReport> {
  return useLive<SourceFreshnessReport>({
    everyMs: FAST_POLL_MS,
    read: (payload) => readSourceFreshness({ payload }),
    slug: "source-freshness",
  });
}

/**
 * A clock that moves once a minute, so an age keeps counting between reads.
 *
 * @returns the current instant
 */
function useMinuteClock(): number {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => {
      setNowMs(Date.now());
    }, FRESHNESS_CLOCK_TICK_MS);
    return () => {
      clearInterval(tick);
    };
  }, []);
  return nowMs;
}

/**
 * One source's freshness inside a panel drawn from the corpus — labelled as the STORED copy's age, so it is never
 * confused with the panel's own "read" receipt, which is when the page fetched it.
 *
 * @param source the corpus source the panel's bytes came from
 * @returns the line
 */
export function SourceFreshnessLine({
  source,
  className,
}: {
  source: SourceFreshnessSource;
  className?: string;
}): ReactElement {
  const state = useSourceFreshness();
  const nowMs = useMinuteClock();
  const subject = `how current stored ${source} data is`;
  if (state.phase === "loading") {
    return <ReadingIndicator label={`Reading ${subject}`} className={className} />;
  }
  if (state.phase === "not-measured") {
    return <StaleMark facts={[{ subject, why: state.why }]} className={className} />;
  }
  const row = state.value.sources.find((one) => one.source === source);
  if (row === undefined) {
    return (
      <span className="inline-flex items-center gap-[0.3rem]">
        <span className={cn("text-primary", className)}>no freshness reported for {source}</span>
        <ReadMark state={state} subject={subject} />
      </span>
    );
  }
  const words = freshnessWordsOf({ nowMs, row });
  const line = (
    <span className="inline-flex items-center gap-[0.3rem]">
      <span className={cn(FRESHNESS_TONES[words.tone].className, className)} title={words.sentence}>
        stored copy: {words.sentence}
      </span>
      <ReadMark state={state} subject={subject} />
    </span>
  );
  if (words.failure === undefined) {
    return line;
  }
  // The failed sync's own reason, said plainly with its raw folded under it — a block, since no `<span>` or `<p>` may
  // hold the fold's `<details>`, and never in the hover, which would draw the raw whole (steer 7).
  return (
    <div className="grid gap-0.5">
      {line}
      <div className="text-[0.8rem] text-muted-foreground">
        <PlainWhy why={words.failure} />
      </div>
    </div>
  );
}
