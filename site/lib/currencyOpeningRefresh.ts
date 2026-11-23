/**
 * Whether opening the Queue takes its own currency check — opening a page triggers
 * a freshness refresh of its cards.
 *
 * The cards' marks and order read the latest recorded `handover currency` reading (`cardCurrencyMark.ts`), which the
 * supervisor tick records only while a tick runs. So opening the Queue asks `/api/sync/currency` once (`syncVerbs.ts`)
 * when the check it shows is missing, unreadable, or {@link CURRENCY_OPEN_FRESH_MINUTES} old. Bounded three ways,
 * none of them a timer:
 *
 * - ONE decision per opening: the caller settles the opening at the first plan that is not `wait`, and a settled
 *   opening never asks again, however many polls, rerenders or newer readings arrive while the page stays open;
 * - a check younger than the window is kept: a successful run records a NEW reading id, so the route's per-reading
 *   backoff alone would let an immediate reopen run again;
 * - the route's own per-reading backoff and in-flight join (`syncFreshness.ts`), across tabs and remounts.
 *
 * Aged from the document's own `checkedIso` — the instant the card says it was checked — never when the page fetched
 * it nor when the ledger appended it. Pure: the reading, what was asked and the instant in, the plan out.
 */
import type { Reading } from "../components/live/reading";
import type { CurrencyReading } from "./cardCurrency";
import type { LiveState } from "./liveState";
import { AUTO_RETRY_MINUTES, NO_READING_ID, pageMayAsk } from "./syncFreshness";

/** How old the check shown may be before opening the Queue takes a new one — the route's own automatic backoff. */
export const CURRENCY_OPEN_FRESH_MINUTES = AUTO_RETRY_MINUTES;

/** What opening the Queue does about its currency check. */
export type CurrencyOpeningRefreshPlan =
  | { readonly kind: "wait" }
  | { readonly kind: "skip"; readonly why: "settled" | "fixture" | "fresh" | "already-asked" }
  | { readonly kind: "ask"; readonly forReading: string };

/**
 * Decide what opening the Queue does about the currency check it shows.
 *
 * - settled — this opening already decided — skips;
 * - loading waits, so the one opening decision is never spent before the first reading arrives;
 * - a frozen fixture skips;
 * - no reading it can show (none recorded, or the ledger read failed) asks over `NO_READING_ID`;
 * - a reading kept over a failed poll, or one whose `checkedIso` will not parse, asks over its id;
 * - a reading checked under {@link CURRENCY_OPEN_FRESH_MINUTES} ago skips as fresh, and one at least that old asks;
 * - every ask is subject to {@link pageMayAsk}, so a reading this page already asked over skips.
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
  if (settled) {
    return { kind: "skip", why: "settled" };
  }
  if (state.phase === "loading") {
    return { kind: "wait" };
  }
  let forReading = NO_READING_ID;
  if (state.phase === "ready") {
    if (state.fixture !== undefined) {
      return { kind: "skip", why: "fixture" };
    }
    forReading = state.value.readingId;
    const checkedMs = Date.parse(state.value.value.checkedIso);
    const fresh =
      state.stale === undefined && !Number.isNaN(checkedMs) && nowMs - checkedMs < CURRENCY_OPEN_FRESH_MINUTES * 60_000;
    if (fresh) {
      return { kind: "skip", why: "fresh" };
    }
  }
  if (!pageMayAsk({ asked, nowMs, readingId: forReading })) {
    return { kind: "skip", why: "already-asked" };
  }
  return { forReading, kind: "ask" };
}
