/**
 * Whether opening the Queue takes its own currency check — opening a page triggers
 * a freshness refresh of its cards.
 *
 * The cards' marks and order read the latest recorded `handover currency` reading (`cardCurrencyMark.ts`), which the
 * supervisor tick records only while a tick runs. So opening the Queue asks `/api/sync/currency` once (`syncVerbs.ts`)
 * when the check it shows is missing, unreadable, or {@link CURRENCY_OPEN_FRESH_MINUTES} old — the one opening rule
 * every page shares (`openingRefresh.ts`), where its three bounds are stated.
 *
 * What is the Queue's own is the projection: a check is aged from the document's own `checkedIso` — the instant the
 * card says it was checked — never when the page fetched it nor when the ledger appended it. Pure.
 */
import type { Reading } from "../components/live/reading";
import type { CurrencyReading } from "./cardCurrency";
import type { LiveState } from "./liveState";
import { OPEN_FRESH_MINUTES, type OpeningRefreshPlan, openingRefreshPlan } from "./openingRefresh";

/** How old the check shown may be before opening the Queue takes a new one — the route's own automatic backoff. */
export const CURRENCY_OPEN_FRESH_MINUTES = OPEN_FRESH_MINUTES;

/** What opening the Queue does about its currency check. */
export type CurrencyOpeningRefreshPlan = OpeningRefreshPlan;

/**
 * Decide what opening the Queue does about the currency check it shows — {@link openingRefreshPlan} over the
 * Queue's projection.
 *
 * @param state the currency reading as the page draws it
 * @param asked when this page last asked over each reading, keyed by reading id
 * @param settled whether this opening has already decided
 * @param nowMs the instant the page is deciding at
 * @returns the plan
 */
export function currencyOpeningRefreshPlan({
  state,
  asked,
  settled,
  nowMs,
}: {
  state: LiveState<Reading<CurrencyReading>>;
  asked: Readonly<Partial<Record<string, number>>>;
  settled: boolean;
  nowMs: number;
}): CurrencyOpeningRefreshPlan {
  return openingRefreshPlan({
    asked,
    nowMs,
    // Aged from the document's own `checkedIso`, the instant every card mark ages from.
    readingOf: (reading) => ({ observedAtIso: reading.value.checkedIso, readingId: reading.readingId }),
    settled,
    state,
  });
}
