"use client";

/**
 * Opening the Queue refreshes its cards' currency check: opening a page triggers a
 * freshness refresh of its cards.
 *
 * One decision per opening (`../../lib/currencyOpeningRefresh.ts`): once the first reading has arrived, the check it
 * shows is kept when it is under ten minutes old, and otherwise the page asks `/api/sync/currency` once. A run that
 * records its reading re-reads `currency-reading` alone; a failed run leaves the reading on screen as it was. No timer:
 * a page left open asks nothing more, and the tick's own check reaches it through the ordinary poll.
 */
import { useEffect, useRef } from "react";

import type { CurrencyReading } from "../../lib/cardCurrency";
import { currencyOpeningRefreshPlan } from "../../lib/currencyOpeningRefresh";
import type { Reading } from "../live/reading";
import { takeReading } from "../live/takeReading";
import { type LiveState, refreshLive } from "../live/useLive";

/**
 * Take the Queue's own currency check once per opening, when the one it shows is missing, unreadable or ten minutes
 * old, and re-read it once the run has recorded a new one.
 *
 * @param currency the currency reading as the Queue draws it
 */
export function useCurrencyOpeningRefresh({ currency }: { currency: LiveState<Reading<CurrencyReading>> }): void {
  // Per mount, so each opening decides once; the route's own backoff bounds a remount across tabs.
  const asked = useRef<Record<string, number>>({});
  const settled = useRef(false);
  useEffect(() => {
    const plan = currencyOpeningRefreshPlan({
      asked: asked.current,
      nowMs: Date.now(),
      settled: settled.current,
      state: currency,
    });
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
      const outcome = await takeReading({ forReading, slug: "currency" });
      if (outcome.phase === "taken") {
        refreshLive({ slug: "currency-reading" });
      }
    };
    void take();
  }, [currency]);
}
