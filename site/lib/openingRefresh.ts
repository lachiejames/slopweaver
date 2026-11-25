/**
 * Whether opening a page takes a fresh reading of its own — the one rule the Queue's currency check and the Fleet
 * page's session watch and burn readings share.
 *
 * A page draws the latest recorded reading from the ledger, never a verb's stdout. When the reading it shows is
 * missing, unreadable, or {@link OPEN_FRESH_MINUTES} old, opening the page asks its sync row once
 * (`/api/sync/<slug>`, `syncVerbs.ts`) to record a fresh one. Bounded three ways, none of them a timer:
 *
 * - ONE decision per opening: the caller settles the opening at the first plan that is not `wait`, and a settled
 *   opening never asks again, however many polls, rerenders or newer readings arrive while the page stays open;
 * - a reading younger than the window is kept: a successful run records a NEW reading id, so the route's per-reading
 *   backoff alone would let an immediate reopen run again;
 * - the route's own per-reading backoff and in-flight join (`syncFreshness.ts`), across tabs and remounts.
 *
 * What is shared is this decision. What stays with each page is its projection — which instant a reading is aged
 * from (the currency check's `checkedIso`, a ledger reading's `observedAtIso`) and when a value names no reading at
 * all. Pure: the reading, what was asked and the instant in, the plan out.
 */
import type { LiveState } from "./liveState";
import { AUTO_RETRY_MINUTES, NO_READING_ID, pageMayAsk } from "./syncFreshness";

/** How old the reading shown may be before opening the page takes a new one — the route's own automatic backoff. */
export const OPEN_FRESH_MINUTES = AUTO_RETRY_MINUTES;

/** The reading a page shows, as the opening decision reads it: its ledger id and the instant it is aged from. */
export interface OpeningReadingIdentity {
  readonly readingId: string;
  readonly observedAtIso: string;
}

/** What opening a page does about the reading it shows. */
export type OpeningRefreshPlan =
  | { readonly kind: "wait" }
  | { readonly kind: "skip"; readonly why: "settled" | "fixture" | "fresh" | "already-asked" }
  | { readonly kind: "ask"; readonly forReading: string };

/**
 * Decide what opening a page does about the reading it shows.
 *
 * - settled — this opening already decided — skips;
 * - loading waits, so the one opening decision is never spent before the first reading arrives;
 * - a frozen fixture skips;
 * - no reading it can show (none recorded, the ledger read failed, or a value naming no reading) asks over
 *   `NO_READING_ID`;
 * - a reading kept over a failed poll, or one whose instant will not parse, asks over its id;
 * - a reading under {@link OPEN_FRESH_MINUTES} old skips as fresh, and one at least that old asks;
 * - every ask is subject to {@link pageMayAsk}, so a reading this page already asked over skips.
 *
 * @param state the reading as the page draws it
 * @param readingOf the page's projection of a ready value onto the reading it is, or `undefined` for none
 * @param asked when this page last asked over each reading, keyed by reading id
 * @param settled whether this opening has already decided
 * @param nowMs the instant the page is deciding at
 * @returns the plan
 */
export function openingRefreshPlan<T>({
  state,
  readingOf,
  asked,
  settled,
  nowMs,
}: {
  state: LiveState<T>;
  readingOf: (value: T) => OpeningReadingIdentity | undefined;
  asked: Readonly<Partial<Record<string, number>>>;
  settled: boolean;
  nowMs: number;
}): OpeningRefreshPlan {
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
    const shown = readingOf(state.value);
    if (shown !== undefined) {
      forReading = shown.readingId;
      const observedMs = Date.parse(shown.observedAtIso);
      const fresh =
        state.stale === undefined && !Number.isNaN(observedMs) && nowMs - observedMs < OPEN_FRESH_MINUTES * 60_000;
      if (fresh) {
        return { kind: "skip", why: "fresh" };
      }
    }
  }
  if (!pageMayAsk({ asked, nowMs, readingId: forReading })) {
    return { kind: "skip", why: "already-asked" };
  }
  return { forReading, kind: "ask" };
}
