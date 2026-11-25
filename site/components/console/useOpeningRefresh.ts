"use client";

/**
 * Opening a page takes a fresh reading of its own: the one hook the Queue's currency check and the Fleet page's
 * session watch and burn readings share.
 *
 * One decision per opening (`../../lib/openingRefresh.ts`): once the first reading has arrived, the reading shown is
 * kept when it is under ten minutes old, and otherwise the page asks `/api/sync/<slug>` once. A run that records its
 * reading re-reads that one live channel alone; a failed run leaves the reading on screen as it was. No timer: a page
 * left open asks nothing more, and a tick's own reading reaches it through the ordinary poll.
 */
import { useEffect, useRef } from "react";

import type { OpeningRefreshPlan } from "../../lib/openingRefresh";
import { takeReading } from "../live/takeReading";
import { type LiveState, refreshLive } from "../live/useLive";

/**
 * Take a page's own reading once per opening, when the one it shows is missing, unreadable or ten minutes old, and
 * re-read it once the run has recorded a new one.
 *
 * @param state the reading as the page draws it
 * @param planOf the page's opening decision over that reading — a module-level function, so the effect does not
 *   re-run for a new identity on every render
 * @param slug the sync row the page asks, `/api/sync/<slug>`
 * @param readsSlug the live channel the page re-reads once the run recorded its reading
 */
export function useOpeningRefresh<T>({
  state,
  planOf,
  slug,
  readsSlug,
}: {
  state: LiveState<T>;
  planOf: (input: {
    state: LiveState<T>;
    asked: Readonly<Partial<Record<string, number>>>;
    settled: boolean;
    nowMs: number;
  }) => OpeningRefreshPlan;
  slug: string;
  readsSlug: string;
}): void {
  // Per mount, so each opening decides once; the route's own backoff bounds a remount across tabs.
  const asked = useRef<Record<string, number>>({});
  const settled = useRef(false);
  useEffect(() => {
    const plan = planOf({ asked: asked.current, nowMs: Date.now(), settled: settled.current, state });
    if (plan.kind === "wait") {
      return;
    }
    // Settled before the request goes out, so a rerender while it runs never asks a second time.
    settled.current = true;
    if (plan.kind === "skip") {
      return;
    }
    const { forReading } = plan;
    asked.current[forReading] = Date.now();
    const take = async (): Promise<void> => {
      const outcome = await takeReading({ forReading, slug });
      if (outcome.phase === "taken") {
        refreshLive({ slug: readsSlug });
      }
    };
    void take();
  }, [state, planOf, slug, readsSlug]);
}
