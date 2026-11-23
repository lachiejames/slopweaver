"use client";

/**
 * The console's ONE Alignment recovery runner, run inside the shell's single `useAlignmentWaiting`
 * (`./alignmentWaitingShared.tsx`): the record of what it is recovering, the timer, and the re-read. Which read to ask
 * again, and when, is `../../lib/alignmentAutoRefresh.ts`.
 *
 * **This is the owner of the Alignment count's failure recovery**, on every page: it detects a failed reading and reads
 * it again rather than showing an error until a reload. The read-once readings the count is made from are read again on
 * a backoff after their latest read fails, only while the console is in view; the polled ones recover on their own
 * poll. It is failure recovery, never a cadence: a reading that reads is left alone.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import {
  type AlignmentRecovery,
  type AlignmentRetryRecords,
  type AlignmentRetrySource,
  type AlignmentSourceRead,
  alignmentRecoveryAsSeenOf,
  alignmentRecoveryStepOf,
  alignmentRecoveryWordsOf,
} from "../../lib/alignmentAutoRefresh";
import { readerTimeZone } from "../../lib/dateTimeFormat";
import type { LiveState } from "../../lib/liveState";
import { clockWords } from "../../lib/runTimeline";
import { sidebarReadOf } from "../../lib/sidebarCountsBasis";
import { refreshLive } from "../live/useLive";

/**
 * What the Alignment count says the console is doing about a failed read, at the instant it is drawn, in the reader's
 * own clock — one sentence for the sidebar badge, the page head and Start here alike.
 *
 * @param recovery the runner's state
 * @returns the sentence, without its closing stop
 */
export function alignmentNextWords({ recovery }: { recovery: AlignmentRecovery }): string {
  // oxlint-disable-next-line react/purity -- the clock IS the input: the sentence names an instant against the time it is drawn
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  return alignmentRecoveryWordsOf({
    clock: (atMs) => clockWords({ iso: new Date(atMs).toISOString(), nowIso, timeZone: readerTimeZone() }),
    nowMs,
    recovery,
  });
}

/** Subscribe to the document's visibility: a hidden window asks nothing. */
function onVisibility(change: () => void): () => void {
  document.addEventListener("visibilitychange", change);
  return () => {
    document.removeEventListener("visibilitychange", change);
  };
}

/** Whether the document is in view now. */
function visibleNow(): boolean {
  return document.visibilityState === "visible";
}

/** The server render has no document; it is drawn as in view, and the client's first read corrects it. */
function visibleOnServer(): boolean {
  return true;
}

/**
 * How one live reading's latest read stands for the runner. A reading drawn over a failed read while its re-read is on
 * its way (`refreshing`) is loading, never a second failure: otherwise the re-read's own start would step the backoff.
 */
function readOf({ slug, state }: { slug: AlignmentRetrySource; state: LiveState<unknown> }): AlignmentSourceRead {
  const latest = sidebarReadOf({ state });
  if (latest.phase === "not-measured") {
    return { phase: "failed", slug, token: state };
  }
  return { phase: latest.phase === "ready" ? "current" : "loading", slug, token: state };
}

/**
 * Read the Alignment count's read-once readings again after a failed read, on a backoff, while the console is in view.
 *
 * @param sources each read-once reading the count is made from, by its live slug
 * @returns what the count says the console is doing about a failure
 */
export function useAlignmentAutoRefresh({
  sources,
}: {
  sources: readonly { readonly slug: AlignmentRetrySource; readonly state: LiveState<unknown> }[];
}): AlignmentRecovery {
  const visible = useSyncExternalStore(onVisibility, visibleNow, visibleOnServer);
  // Set only by the wake timer, so a re-read that falls due by time alone is judged again at that instant.
  const [wokeMs, setWokeMs] = useState(0);
  // Written synchronously: a second render in the same commit must already see a re-read asked, never ask it twice.
  const records = useRef<AlignmentRetryRecords>({});
  const [recovery, setRecovery] = useState<AlignmentRecovery>({ phase: "idle" });
  const [wakeAtMs, setWakeAtMs] = useState<number | undefined>(undefined);
  const reads = sources.map((source) => readOf(source));
  useEffect(() => {
    const step = alignmentRecoveryStepOf({ nowMs: Date.now(), reads, records: records.current, visible: visibleNow() });
    records.current = step.records;
    for (const slug of step.due) {
      refreshLive({ slug });
    }
    setRecovery(step.recovery);
    setWakeAtMs(step.wakeAtMs);
    // The reads are fresh objects every render; each source's reading object is what this is about.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...sources.map((source) => source.state), visible, wokeMs]);
  useEffect(() => {
    if (wakeAtMs === undefined) {
      return;
    }
    const timer = setTimeout(
      () => {
        setWokeMs(Date.now());
      },
      Math.max(0, wakeAtMs - Date.now()),
    );
    return () => {
      clearTimeout(timer);
    };
  }, [wakeAtMs]);
  // Read against the live visibility so a hide re-words at once, never one render late; memoised so the identity changes
  // only with the step or the visibility — the shared source hands it up through an effect keyed on it
  // (`./alignmentWaitingShared.tsx`).
  return useMemo(() => alignmentRecoveryAsSeenOf({ recovery, visible }), [recovery, visible]);
}
