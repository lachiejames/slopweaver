/**
 * The readings a Queue answer projects, built from one fresh read of the record (`./freshVoiceRecord.ts`). Pure: the
 * one input not on the record is the steers this browser collapsed a card on and has not yet seen come back, which only
 * the page holds (`../console/steered.tsx`); the overlay is rebuilt over them with the fresh `talk steers` and
 * `talk cards` readings, the same pure judgement the Queue draws with.
 */

import { type LocalSteer, steerOverlay } from "../../lib/steeredCards";
import type { ActionItemReadings, UnreadSource } from "../../lib/talkActionItems";
import type { SteeredCardsReading } from "../live/readSteeredCards";
import type { LiveState } from "../live/useLive";
import type { VoiceRecord } from "./voiceRecordSources";

/** How the voice names the `talk steers` reading when it could not be read. */
export const HELD_STEERS_SOURCE = "your steers on this call";

/**
 * The `talk steers` reading, named unread when a steer held on this call was judged against it and it did not arrive.
 * An unread reading keeps a held steer's card collapsed (`judgeSteer`, `../../lib/steeredCards.ts`), so that card is
 * hidden on an unread register and must be said so, never left out as gone. With nothing held, the
 * reading decides nothing, and is not named.
 *
 * @param held the steers this browser holds
 * @param reading the fresh `talk steers` reading
 * @returns the unread source, or `undefined` when nothing held rests on an unread reading
 */
export function heldSteersUnreadOf({
  held,
  reading,
}: {
  held: readonly LocalSteer[];
  reading: LiveState<SteeredCardsReading>;
}): UnreadSource | undefined {
  if (held.length === 0 || reading.phase === "ready") {
    return undefined;
  }
  if (reading.phase === "loading") {
    return { source: HELD_STEERS_SOURCE, why: "still loading" };
  }
  return { source: HELD_STEERS_SOURCE, why: reading.why };
}

/**
 * The Queue answer's readings over a fresh record.
 *
 * @param record one fresh read of every source
 * @param heldSteers the steers this browser holds, at the instant the tool asked
 * @returns the readings `action_items`, `read_card` and `open_card` project
 */
export function recordReadingsOf({
  heldSteers,
  record,
}: {
  heldSteers: readonly LocalSteer[];
  record: VoiceRecord;
}): ActionItemReadings {
  const { steers, ...rest } = record;
  const overlay = steerOverlay({ held: heldSteers, reading: steers, spoken: record.spoken });
  const unread = heldSteersUnreadOf({ held: heldSteers, reading: steers });
  if (unread === undefined) {
    return { ...rest, steers: overlay };
  }
  return { ...rest, steers: { ...overlay, unread } };
}
