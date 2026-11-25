"use client";

/**
 * Opening the Queue refreshes its cards' currency check: opening a page triggers a
 * freshness refresh of its cards.
 *
 * The shared opening hook (`useOpeningRefresh.ts`) over the Queue's own decision
 * (`../../lib/currencyOpeningRefresh.ts`): the check shown is kept when it is under ten minutes old, and otherwise the
 * page asks `/api/sync/currency` once and re-reads `currency-reading` alone once the run has recorded a new one.
 */
import type { CurrencyReading } from "../../lib/cardCurrency";
import { currencyOpeningRefreshPlan } from "../../lib/currencyOpeningRefresh";
import type { Reading } from "../live/reading";
import type { LiveState } from "../live/useLive";
import { useOpeningRefresh } from "./useOpeningRefresh";

/**
 * Take the Queue's own currency check once per opening, when the one it shows is missing, unreadable or ten minutes
 * old, and re-read it once the run has recorded a new one.
 *
 * @param currency the currency reading as the Queue draws it
 */
export function useCurrencyOpeningRefresh({ currency }: { currency: LiveState<Reading<CurrencyReading>> }): void {
  useOpeningRefresh({
    planOf: currencyOpeningRefreshPlan,
    readsSlug: "currency-reading",
    slug: "currency",
    state: currency,
  });
}
