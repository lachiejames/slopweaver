/**
 * Whether opening the Fleet page takes its own session watch and fleet burn readings.
 *
 * The Now view's seats and burn draw the latest recorded `session watch` and `fleet burn` readings from the ledger.
 * Before this, only a running supervisor tick recorded either, so a page opened with no tick running showed weeks-old
 * seats as working. Opening the page now asks each one's sync row once (`syncVerbs.ts`) when the reading it shows is
 * missing, unreadable, or {@link OPEN_FRESH_MINUTES} old — the one opening rule every page shares
 * (`openingRefresh.ts`), where its three bounds are stated.
 *
 * What is the Fleet page's own is the projection: both readings are aged from the ledger reading's own
 * `observedAtIso`, the instant the verb read the machine, and a seat reading the ledger holds as NOT recorded names
 * no reading at all, so opening the page asks over none. Pure.
 */
import { isReadingNotRecorded, type Reading, type RecordedReading } from "../components/live/reading";
import type { Seats } from "../components/live/readNow";
import type { LiveState } from "./liveState";
import { type OpeningRefreshPlan, openingRefreshPlan } from "./openingRefresh";
import type { FleetBurn } from "./planMeters";

/**
 * Decide what opening the Fleet page does about the session watch reading its seats show.
 *
 * @param state the seat reading as the page draws it
 * @param asked when this page last asked over each reading, keyed by reading id
 * @param settled whether this opening has already decided
 * @param nowMs the instant the page is deciding at
 * @returns the plan
 */
export function seatsOpeningRefreshPlan({
  state,
  asked,
  settled,
  nowMs,
}: {
  state: LiveState<RecordedReading<Seats>>;
  asked: Readonly<Partial<Record<string, number>>>;
  settled: boolean;
  nowMs: number;
}): OpeningRefreshPlan {
  return openingRefreshPlan({
    asked,
    nowMs,
    // A reading the ledger holds as not recorded names no reading, so the page asks over none.
    readingOf: (reading) => {
      if (isReadingNotRecorded(reading)) {
        return undefined;
      }
      return { observedAtIso: reading.observedAtIso, readingId: reading.readingId };
    },
    settled,
    state,
  });
}

/**
 * Decide what opening the Fleet page does about the fleet burn reading it shows.
 *
 * @param state the burn reading as the page draws it
 * @param asked when this page last asked over each reading, keyed by reading id
 * @param settled whether this opening has already decided
 * @param nowMs the instant the page is deciding at
 * @returns the plan
 */
export function burnOpeningRefreshPlan({
  state,
  asked,
  settled,
  nowMs,
}: {
  state: LiveState<Reading<FleetBurn>>;
  asked: Readonly<Partial<Record<string, number>>>;
  settled: boolean;
  nowMs: number;
}): OpeningRefreshPlan {
  return openingRefreshPlan({
    asked,
    nowMs,
    readingOf: (reading) => ({ observedAtIso: reading.observedAtIso, readingId: reading.readingId }),
    settled,
    state,
  });
}
