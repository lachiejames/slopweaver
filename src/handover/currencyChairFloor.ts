/**
 * Whether the supervisor chat's record bears on one currency card's floor: how far back the chair's walk reached, and
 * whether a chair whose transcript would not read could hold a turn after the floor. Pure: instants in, a verdict out.
 */
import type { UnreadableChair } from "../supervisor/chain.js";
import { instantCeilingMs } from "./currencyStanding.js";

/**
 * Whether the supervisor chat's record reaches back to the floor. Its earliest instant rounds UP past the millisecond
 * (`instantCeilingMs`), as every instant the currency read compares does, so a record starting half a millisecond after
 * the floor does not reach it.
 *
 * @param coverage how far back the intake walk reached
 * @param floorMs the floor, epoch milliseconds
 * @returns whether the record reaches the floor
 */
export function chairReachesFloor({
  coverage,
  floorMs,
}: {
  coverage: { readonly reachesSince: boolean; readonly earliestIso?: string | undefined };
  floorMs: number;
}): boolean {
  if (coverage.reachesSince) {
    return true;
  }
  if (coverage.earliestIso === undefined) {
    return false;
  }
  return !(instantCeilingMs({ iso: coverage.earliestIso }) > floorMs);
}

/**
 * Whether a chair whose transcript would not read could hold a turn after the floor, and so leaves this card's read
 * short. A chair that last stopped holding the pin at or before the floor holds nothing after it: its transcript being
 * gone (another machine, aged out) says nothing about this card. MEASURED: chairs whose transcripts stayed on another
 * machine put the same gaps on every card of a reading, cards asked days after the last of them included, so no card
 * could ever read fresh, and those gaps were most of the reading's bytes. Count them in the latest reading:
 * `slopweaver reading last --producer "handover currency" --json | grep -o "session would not read" | wc -l`.
 * An open tenure, or an end that will not parse, cannot be shown to predate the card, so it stays a gap.
 *
 * @param unreadable the chair and when its latest tenure ended
 * @param floorMs the card's floor, epoch milliseconds
 * @returns true when the gap bears on this card
 */
export function unreadableAfterFloor({
  unreadable,
  floorMs,
}: {
  unreadable: UnreadableChair;
  floorMs: number;
}): boolean {
  if (unreadable.untilIso === undefined) {
    return true;
  }
  const untilMs = instantCeilingMs({ iso: unreadable.untilIso });
  return Number.isNaN(untilMs) || untilMs > floorMs;
}
