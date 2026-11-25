/**
 * The heading over the Fleet page's working-session cards: "Working now" only while the session watch reading they
 * are drawn from is fresh, and the reading's own age once it is not.
 *
 * The cards are the sessions the drain saw working at the reading's `observedAtIso`, not at the page's clock. A page
 * once drew sessions from a weeks-old reading under "Working now", because the only thing that recorded one was a
 * supervisor tick that had stopped. The page now takes its own reading on opening (`fleetOpeningRefresh.ts`), and this
 * heading is what keeps the claim true whenever that run fails or has not landed yet. Pure.
 */
import { ageAt } from "./ageOf";
import { OPEN_FRESH_MINUTES } from "./openingRefresh";

/**
 * The words before the card count: "Working now" for a reading under {@link OPEN_FRESH_MINUTES} old, otherwise
 * "Working as of <age>", the age measured from the reading's own instant.
 *
 * @param observedAtIso the instant the session watch reading the cards come off was read
 * @param nowMs the page's clock
 * @returns the heading's words
 */
export function workingSessionsHeading({ observedAtIso, nowMs }: { observedAtIso: string; nowMs: number }): string {
  const observedMs = Date.parse(observedAtIso);
  if (Number.isNaN(observedMs)) {
    return "Working as of an unreadable instant";
  }
  if (nowMs - observedMs < OPEN_FRESH_MINUTES * 60_000) {
    return "Working now";
  }
  return `Working as of ${ageAt({ iso: observedAtIso, nowMs })}`;
}
