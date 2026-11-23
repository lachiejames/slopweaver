/**
 * What the revive appends to name an open hang: a recurring hang's `recurring` line, and a held restart's
 * `restart-held` marker, each written once and re-stated by entry count so it stays inside the bounded tail the
 * revive reads. Whether a hang recurs, and whether its restart is held, is judged in `./recurrence.ts`; this file only
 * decides which lines that judgement owes the journal. Pure.
 */
import { FLEET_JOURNAL_TAIL_ROWS } from "../fleet/journalTail.js";
import { openRecurrenceBefore, recurrenceForHang, recurrenceWasJournalled, recurringHoldOrigin } from "./recurrence.js";
import type { CmuxReviveEvent } from "./reviveJournal.js";

/**
 * How many journal entries may follow a held restart's newest `restart-held` marker, or an open recurring hang's
 * `recurring` line, before it is re-stated: a quarter of the row tail the store read returns. A held hang appends a
 * reading every probe, so the restarts that prove the loop scroll out of the tail; a line re-stated by ENTRIES, never
 * by the clock, stays inside it at any probe rate (an hourly marker would fall out under a burst of
 * manual probes). The tail is counted in rows, so the restatement is too: no entry's size can move it.
 */
const RESTATE_ENTRIES = FLEET_JOURNAL_TAIL_ROWS / 4;

/** How many entries the journal holds after index `afterIndex`. */
function entriesAfter({ events, afterIndex }: { events: readonly CmuxReviveEvent[]; afterIndex: number }): number {
  return events.length - afterIndex - 1;
}

/**
 * What the revive names in the journal for the open hang: its `recurring` line once, the line of a recurring hang
 * still unanswered again once a quarter of the tail is behind it, and a `restart-held` marker when its restart is
 * held and the newest marker for that hang is missing or a quarter of the tail behind.
 *
 * @param events the journal as it stands under the revive's lock
 * @param hungSinceIso the first reading of the open hang's run
 * @param nowIso the instant the lines are stamped with
 * @returns the lines to append, in order
 */
export function hangNamingEvents({
  events,
  hungSinceIso,
  nowIso,
}: {
  events: readonly CmuxReviveEvent[];
  hungSinceIso: string;
  nowIso: string;
}): readonly CmuxReviveEvent[] {
  const lines: CmuxReviveEvent[] = [];
  const recurrence = recurrenceForHang({ events, hungSinceIso });
  if (recurrence !== undefined && !recurrenceWasJournalled({ events, recurrence })) {
    const { afterRestartIso } = recurrence;
    lines.push({ afterRestartIso, atIso: nowIso, hungSinceIso, kind: "recurring", schemaVersion: 1 });
  }
  // A recurring hang still unanswered keeps its line inside the tail, the way a held restart keeps its marker, so a
  // hang of days still reads as the recurrence when its restart finally comes.
  const open = openRecurrenceBefore({ events, position: events.length });
  if (open !== undefined && lines.length === 0 && entriesAfter({ afterIndex: open, events }) >= RESTATE_ENTRIES) {
    const openLine = events[open];
    if (openLine?.kind === "recurring") {
      lines.push({ ...openLine, atIso: nowIso });
    }
  }
  const origin = recurringHoldOrigin({ events, hungSinceIso });
  if (origin === undefined) {
    return lines;
  }
  const marked = events.findLastIndex((event) => event.kind === "restart-held" && event.hungSinceIso === origin);
  if (marked < 0 || entriesAfter({ afterIndex: marked, events }) >= RESTATE_ENTRIES) {
    lines.push({ atIso: nowIso, hungSinceIso: origin, kind: "restart-held", schemaVersion: 1 });
  }
  return lines;
}
