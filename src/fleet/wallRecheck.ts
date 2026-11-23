/**
 * What the screen reads after a relaunch say about the seat's wall: walled, clear, or not known — never "clear"
 * because nothing could be read.
 *
 * A recovery pass watches a relaunched seat's screen for fifteen polls, because a signed-out store or a plan still at
 * its usage limit walls it again within seconds (`../cli/commands/fleet/resumeSeat.ts`). That watch used to read a
 * screen that would not read as a screen with no wall on it, so a seat whose every read failed was journalled
 * `reseated`. A clear verdict now needs the LAST read to have read: an earlier clear screen
 * does not show the seat stayed clear, since the wall is exactly what appears after a relaunch.
 */
import type { CmuxError } from "../cmux/errors.js";
import type { Result } from "../lib/result.js";
import { detectSeatWall, type SeatWall } from "../sessions/seatRecovery.js";

/** One post-relaunch wall watch's verdict. */
export type WallRecheckVerdict =
  | { readonly kind: "walled"; readonly wall: SeatWall }
  | { readonly kind: "clear" }
  | { readonly kind: "unreadable"; readonly cause: string };

/**
 * Judge a post-relaunch watch over every read it took, in order: the first wall any read showed, else clear only
 * when the last read read and showed none, else unreadable naming the last read's failure.
 *
 * @param readings each screen read of the watch, oldest first
 * @returns the verdict
 */
export function wallRecheckVerdict({
  readings,
}: {
  readings: readonly Result<string, CmuxError>[];
}): WallRecheckVerdict {
  for (const reading of readings) {
    const wall = reading.isOk() ? detectSeatWall({ screen: reading.value }) : undefined;
    if (wall !== undefined) {
      return { kind: "walled", wall };
    }
  }
  const last = readings.at(-1);
  if (last === undefined) {
    return { cause: "no screen read was attempted", kind: "unreadable" };
  }
  if (last.isErr()) {
    return { cause: last.error.message, kind: "unreadable" };
  }
  return { kind: "clear" };
}
