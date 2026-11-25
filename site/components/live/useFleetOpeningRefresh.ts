"use client";

/**
 * Opening the Fleet page takes its own session watch and fleet burn readings, so the seats and burn it draws never
 * depend on a supervisor tick having run.
 *
 * Two unconditional calls of the shared opening hook (`../console/useOpeningRefresh.ts`), each over the Fleet page's
 * own decision (`../../lib/fleetOpeningRefresh.ts`): the seats ask `/api/sync/session-watch` and re-read
 * `watch-reading`; the burn asks `/api/sync/fleet-burn` and re-reads `burn-reading`. Each decides once per opening.
 * `machine capacity` is not taken here: its plan-ceiling read spends a token at Anthropic (`../../lib/syncVerbs.ts`).
 */
import { burnOpeningRefreshPlan, seatsOpeningRefreshPlan } from "../../lib/fleetOpeningRefresh";
import type { FleetBurn } from "../../lib/planMeters";
import { useOpeningRefresh } from "../console/useOpeningRefresh";
import type { Reading, RecordedReading } from "./reading";
import type { Seats } from "./readNow";
import type { LiveState } from "./useLive";

/**
 * Take the Fleet page's own seat and burn readings once per opening each, when the one shown is missing, not
 * recorded or ten minutes old, and re-read each once its run has recorded a new one.
 *
 * @param seats the session watch reading as the seats tile draws it
 * @param burn the fleet burn reading as the seats tile draws it
 */
export function useFleetOpeningRefresh({
  seats,
  burn,
}: {
  seats: LiveState<RecordedReading<Seats>>;
  burn: LiveState<Reading<FleetBurn>>;
}): void {
  useOpeningRefresh({
    planOf: seatsOpeningRefreshPlan,
    readsSlug: "watch-reading",
    slug: "session-watch",
    state: seats,
  });
  useOpeningRefresh({ planOf: burnOpeningRefreshPlan, readsSlug: "burn-reading", slug: "fleet-burn", state: burn });
}
