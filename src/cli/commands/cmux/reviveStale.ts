/**
 * Whether a `cmux revive` reading is still fresh enough to journal and judge. A reading is taken, then the probe waits
 * on its knock, so a revive paused in between can hold cmux's state from before a hang that other passes have already
 * journalled behind it.
 */
import { logger } from "#lib/logger.js";

import type { CmuxReading } from "../../../cmux/reviveJournal.js";
import type { FleetPort } from "../../../fleet/port.js";
import { EXIT_DEFERRED, EXIT_ERROR } from "../../exitCodes.js";

/**
 * How far a reading's stamp may sit from the clock when it is journalled: the probe stamps it before its 5s knock, so
 * a normal pass is seconds off here, and a minute either way is a revive paused between its probe and its append —
 * or a clock changed meanwhile, which costs one deferred pass.
 */
const STALE_READING_MS = 60_000;

/**
 * Why a reading may not be journalled or judged, as the exit code that ends the pass: the journal moved since the
 * probe began, or the reading's stamp sits more than a minute off the clock. None when it may.
 *
 * The journal's newest sequence comes first because it is the one order no clock can move: a clock set back by less
 * than the minute leaves a reading taken before a hang stamped AFTER the hang's first line.
 *
 * @param fleet where the revive journal's newest sequence is read
 * @param home the state home whose revive journal is read
 * @param sequenceBeforeProbe the journal's newest sequence read before the probe began
 * @param clock the instant now
 * @returns the exit code, or none
 */
export async function staleReadingExit({
  fleet,
  home,
  reading,
  clock,
  sequenceBeforeProbe,
}: {
  fleet: FleetPort;
  home: string;
  reading: CmuxReading;
  clock: () => string;
  sequenceBeforeProbe: number;
}): Promise<number | undefined> {
  const sequence = await fleet.newestCmuxReviveSequence({ home });
  if (sequence.isErr()) {
    logger.error({ msg: `cmux revive: ${sequence.error.message}` });
    return EXIT_ERROR;
  }
  if (sequence.value !== sequenceBeforeProbe) {
    logger.error({
      msg: `cmux revive: the journal moved while cmux was probed, so the reading from ${reading.atIso} was dropped`,
    });
    return EXIT_DEFERRED;
  }
  const ageMs = Date.parse(clock()) - Date.parse(reading.atIso);
  if (Math.abs(ageMs) > STALE_READING_MS) {
    logger.error({
      msg: `cmux revive: the reading from ${reading.atIso} is ${ageMs}ms off the clock, so it was dropped`,
    });
    return EXIT_DEFERRED;
  }
  return undefined;
}
